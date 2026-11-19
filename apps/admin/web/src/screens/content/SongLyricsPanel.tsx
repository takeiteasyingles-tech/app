// "Música e sincronização" (tab 2 · Música of the episode editor): upload the song, then the AI writes
// the lyrics in English and Portuguese (mode generate) or finds when each typed line starts (mode
// align). The browser decodes the song and sends a 16 kHz mono WAV (Workers AI's Whisper input), so
// the server never has to decode MP3. Results land in the draft only; nothing is saved until Salvar.
import { adminApi, type MediaRow } from '@tie/shared/contracts/admin';
import type { SongLyricsMode, SongLyricsRes } from '@tie/shared/contracts/songLyrics';
import { useEffect, useRef, useState } from 'preact/hooks';
import { callForm, errorMessage, uploadMedia } from '../../api';
import { fmtBytes } from '../../format';
import type { Obj } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Button, Spinner } from '../../ui/kit';
import { ACCEPT, MediaPreview, mediaMeta, mediaName, precheck, rememberMedia, useMedia } from '../../ui/media';
import { confirmAction } from '../../ui/modal';
import { toast } from '../../ui/toast';

const RATE = 16000;

/** 16-bit PCM mono WAV of `samples` at `rate`. */
function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] as number));
    view.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  return out;
}

/** Decodes any audio the browser can play and resamples it to a 16 kHz mono WAV. */
async function toWav16k(buf: ArrayBuffer): Promise<{ wav: Blob; duration: number }> {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Este navegador não consegue preparar o áudio. Use o Chrome, o Edge ou o Firefox atualizados.');
  }
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } catch {
    throw new Error('Não deu para ler este áudio. Envie um WAV ou MP3.');
  } finally {
    void ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
  const off = new OfflineAudioContext(1, frames, RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const bytes = wavBytes((await off.startRendering()).getChannelData(0), RATE);
  return { wav: new Blob([bytes as BlobPart], { type: 'audio/wav' }), duration: decoded.duration };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Why the server answered with the demo engine (SongLyricsRes.detail), in pt-BR. */
function demoReason(detail: string): string {
  if (detail === 'no AI binding') return 'A IA não está disponível neste ambiente (no servidor local ela não roda)';
  if (detail === 'ai.enabled is off') return 'A IA está desligada nas configurações (Configurações, flag ai.enabled)';
  return 'A IA não conseguiu ouvir a música agora (tente de novo em instantes)';
}

type Phase = { k: 'idle' } | { k: 'upload'; p: number } | { k: 'prep' } | { k: 'ai'; mode: SongLyricsMode };

type Line = { en?: unknown; pt?: unknown; gap?: unknown; t?: unknown };

export function SongLyricsPanel({ doc, set }: { doc: Obj; set: (fn: (d: Obj) => Obj) => void }) {
  const songId = (doc.songMedia as string | null | undefined) ?? null;
  const song = useMedia(songId);
  const lyrics = (Array.isArray(doc.lyrics) ? doc.lyrics : []) as Line[];
  const timed = lyrics.filter((l) => typeof l.t === 'number').length;
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The file just uploaded, so the AI step does not download it again. */
  const local = useRef<{ id: string; file: File } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = phase.k !== 'idle';
  useEffect(() => () => abort.current?.abort(), []);

  const audioOf = async (m: MediaRow, signal: AbortSignal): Promise<ArrayBuffer> => {
    if (local.current?.id === m.id) return local.current.file.arrayBuffer();
    const res = await fetch(m.url, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error('Não deu para baixar a música salva. Tente enviar o arquivo de novo.');
    return res.arrayBuffer();
  };

  const apply = (r: SongLyricsRes) => {
    const why = demoReason(r.detail);
    if (r.mode === 'align') {
      set((d) => {
        const cur = (Array.isArray(d.lyrics) ? d.lyrics : []) as Obj[];
        return { ...d, lyrics: cur.map((l, i) => (r.lines[i] ? { ...l, t: r.lines[i].t } : l)) };
      });
      const heard = r.lines.filter((l) => l.heard).length;
      const text =
        r.source === 'demo'
          ? `${why}. As ${r.lines.length} linhas foram espalhadas por igual na música: ajuste os tempos à mão.`
          : heard === r.lines.length
            ? `Pronto: as ${heard} linhas ganharam o tempo de início pela voz da música. Confira na prévia e salve.`
            : `Pronto: ${heard} de ${r.lines.length} linhas sincronizadas pela voz; as outras ficaram com tempo estimado. Confira na prévia e salve.`;
      setNote({ kind: r.source === 'demo' || heard < r.lines.length ? 'warn' : 'ok', text });
    } else if (r.lines.length) {
      set((d) => ({
        ...d,
        lyrics: r.lines.map((l) => ({ en: l.en, pt: l.pt, ...(l.gap ? { gap: l.gap } : {}), t: l.t })),
      }));
      setNote({
        kind: r.translated ? 'ok' : 'warn',
        text: r.translated
          ? `Pronto: ${r.lines.length} linhas em inglês e português, com lacuna e tempo. Revise o que a IA ouviu e salve.`
          : `${r.lines.length} linhas transcritas com tempo, mas a tradução falhou: preencha o português e salve.`,
      });
    } else {
      setNote({
        kind: 'warn',
        text:
          r.source === 'demo'
            ? `${why}, e gerar a letra precisa dela. Digite a letra e use "Sincronizar letra atual".`
            : 'A IA não reconheceu nenhuma letra cantada nesta música.',
      });
    }
  };

  const run = async (mode: SongLyricsMode, m: MediaRow | null = song ?? null) => {
    if (!m || busy) return;
    const ac = new AbortController();
    abort.current = ac;
    setNote(null);
    try {
      setPhase({ k: 'prep' });
      const { wav } = await toWav16k(await audioOf(m, ac.signal));
      const form = new FormData();
      form.append('audio', wav, 'song-16k.wav');
      form.append('mode', mode);
      const title = str(doc.songTitle).trim();
      if (title) form.append('title', title);
      if (mode === 'align') {
        form.append(
          'lines',
          JSON.stringify(
            lyrics.map((l) => ({
              en: str(l.en).trim() || '…',
              ...(str(l.pt) ? { pt: str(l.pt) } : {}),
              ...(str(l.gap) ? { gap: str(l.gap) } : {}),
            })),
          ),
        );
      }
      setPhase({ k: 'ai', mode });
      apply(await callForm(adminApi.songLyrics.run, form, { signal: ac.signal }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const text = e instanceof Error && !('code' in e) ? e.message : errorMessage(e);
      setNote({ kind: 'warn', text });
      toast(text, 'err');
    } finally {
      if (abort.current === ac) abort.current = null;
      setPhase({ k: 'idle' });
    }
  };

  const generate = async (m: MediaRow | null = song ?? null) => {
    const ok =
      !lyrics.length ||
      (await confirmAction({
        title: 'Substituir a letra?',
        body: `As ${lyrics.length} linhas atuais (com tradução e lacunas) dão lugar à letra que a IA ouvir na música. Nada é salvo até você clicar em Salvar.`,
        confirm: 'Gerar letra nova',
      }));
    if (ok) await run('generate', m);
  };

  const upload = (file: File) => {
    const bad = precheck(file, 'audio');
    if (bad) {
      toast(bad, 'err');
      return;
    }
    setNote(null);
    setPhase({ k: 'upload', p: 0 });
    uploadMedia(file, (p) => setPhase({ k: 'upload', p })).promise.then(
      (row) => {
        rememberMedia([row]);
        local.current = { id: row.id, file };
        set((d) => ({ ...d, songMedia: row.id }));
        setPhase({ k: 'idle' });
        toast('Música enviada. Agora a IA monta a letra.');
        void run(lyrics.length ? 'align' : 'generate', row);
      },
      (e) => {
        setPhase({ k: 'idle' });
        toast(`Não deu para enviar a música: ${errorMessage(e)}`, 'err');
      },
    );
  };

  const status =
    phase.k === 'upload'
      ? `Enviando a música… ${Math.round(phase.p * 100)}%`
      : phase.k === 'prep'
        ? 'Preparando o áudio para a IA…'
        : phase.k === 'ai'
          ? phase.mode === 'generate'
            ? 'A IA está ouvindo a música e escrevendo a letra… (pode levar 1 minuto)'
            : 'A IA está ouvindo a música para achar o início de cada linha…'
          : null;

  return (
    <div class="stack" style={{ '--gap': '14px', paddingBottom: '18px', borderBottom: '1.5px solid var(--line)' }}>
      <div>
        <h2 class="h3">Música e sincronização</h2>
        <div class="xs mt4">
          Envie a música (WAV ou MP3): a IA escreve a letra em inglês e português e marca quando cada linha começa, para
          o aluno acompanhar no player.
        </div>
      </div>
      <div class="stack" style={{ '--gap': '12px' }}>
        {songId ? (
          song === undefined ? (
            <span class="ad-skel" style={{ height: '56px' }} />
          ) : song ? (
            <div class="stack" style={{ '--gap': '4px', minWidth: '0' }}>
              <span class="ad-pick-n">
                <Icon name="music" size={15} /> {mediaName(song)}
              </span>
              <span class="xs">{mediaMeta(song)}</span>
              <MediaPreview m={song} />
            </div>
          ) : (
            <div class="xs ad-err-t">Arquivo {songId} não encontrado.</div>
          )
        ) : (
          <div class="xs">Este episódio ainda não tem a música.</div>
        )}
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          <Button
            label={songId ? 'Enviar outra música' : 'Enviar a música'}
            icon="upload"
            kind={songId ? 'light' : 'navy'}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          />
          <Button
            label="Gerar letra pelo áudio"
            icon="music"
            kind={songId && !lyrics.length ? 'navy' : 'light'}
            disabled={busy || !song}
            onClick={() => void generate()}
          />
          <Button
            label="Sincronizar letra atual"
            icon="refresh"
            kind={songId && lyrics.length ? 'navy' : 'light'}
            disabled={busy || !song || !lyrics.length}
            title={lyrics.length ? undefined : 'Escreva ou gere a letra primeiro.'}
            onClick={() => void run('align')}
          />
          {timed && !busy ? (
            <Button
              label="Limpar tempos"
              icon="close"
              kind="light"
              onClick={() =>
                set((d) => ({
                  ...d,
                  lyrics: ((Array.isArray(d.lyrics) ? d.lyrics : []) as Obj[]).map(({ t: _t, ...rest }) => rest),
                }))
              }
            />
          ) : null}
          {busy && phase.k !== 'upload' ? (
            <Button label="Cancelar" kind="light" onClick={() => abort.current?.abort()} />
          ) : null}
        </div>
        <input
          ref={fileRef}
          class="sr"
          type="file"
          accept={ACCEPT.audio}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const input = e.currentTarget;
            const f = input.files?.[0];
            input.value = '';
            if (f) upload(f);
          }}
        />
        {status ? (
          <div class="ad-note bl" role="status">
            <Spinner size={16} />
            <span>{status}</span>
          </div>
        ) : note ? (
          <div class={`ad-note${note.kind === 'ok' ? ' bl' : ''}`} role="status">
            <Icon name={note.kind === 'ok' ? 'check' : 'alert'} size={16} />
            <span>{note.text}</span>
          </div>
        ) : (
          <div class="xs">
            {lyrics.length
              ? timed === lyrics.length
                ? `As ${timed} linhas têm tempo: o player do aluno destaca cada uma quando ela é cantada.`
                : timed
                  ? `${timed} de ${lyrics.length} linhas têm tempo; as outras são estimadas entre as vizinhas.`
                  : 'A letra ainda não tem tempos: o player avança as linhas por igual ao longo da música.'
              : 'Sem letra ainda.'}
            {song && song.bytes > 20 * 1024 * 1024
              ? ` O arquivo tem ${fmtBytes(song.bytes)}: um MP3 carrega bem mais rápido no celular do aluno.`
              : ''}
          </div>
        )}
      </div>
    </div>
  );
}
