// Episode editor → 1 · Música: the song and its timed lyrics. Staff send the recording (WAV or MP3; it
// becomes the episode's song media) and the AI writes the lyrics in English and Portuguese with the start
// of each line (generate), or only times the lyrics already typed (align). The browser converts the song
// to 16 kHz mono first (ui/audio16k.ts); POST /admin-api/ai/song-lyrics does the rest
// (contracts/songLyrics.ts). The result goes into the draft: nothing is saved until Salvar.
import type { MediaRow } from '@tie/shared/contracts/admin';
import { adminApi } from '@tie/shared/contracts/admin';
import type { SongLyricsMode, SongLyricsRes } from '@tie/shared/contracts/songLyrics';
import { useEffect, useRef, useState } from 'preact/hooks';
import { callForm, errorMessage, uploadMedia } from '../../api';
import { fmtBytes } from '../../format';
import { toAsrWav } from '../../ui/audio16k';
import type { Obj } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Button, Spinner } from '../../ui/kit';
import { ACCEPT, MediaPreview, mediaMeta, mediaName, precheck, rememberMedia, useMedia } from '../../ui/media';
import { confirmAction } from '../../ui/modal';
import { toast } from '../../ui/toast';

type Phase = { k: 'idle' } | { k: 'upload'; p: number } | { k: 'prep' } | { k: 'ai'; mode: SongLyricsMode };

/** "1:05.3" */
export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Why the demo path ran, for staff (the server's detail is a log string). */
function whyDemo(detail: string): string {
  if (detail === 'no AI binding') return 'A IA não está disponível neste ambiente (no servidor local ela não roda)';
  if (detail === 'ai.enabled is off') return 'A IA está desligada nas configurações (Configurações, flag ai.enabled)';
  return 'A IA não conseguiu ouvir a música agora (tente de novo em instantes)';
}

export function SongSync({ doc, set }: { doc: Obj; set: (fn: (d: Obj) => Obj) => void }) {
  const songId = (doc.songMedia as string | null) ?? null;
  const song = useMedia(songId);
  const lyrics = (Array.isArray(doc.lyrics) ? doc.lyrics : []) as Obj[];
  const timed = lyrics.filter((l) => typeof l.t === 'number').length;
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** The file picked in this session (skips downloading the stored song again). */
  const picked = useRef<{ id: string; file: File } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = phase.k !== 'idle';
  useEffect(() => () => abort.current?.abort(), []);

  const audioBytes = async (row: MediaRow, signal: AbortSignal): Promise<ArrayBuffer> => {
    if (picked.current?.id === row.id) return picked.current.file.arrayBuffer();
    const res = await fetch(row.url, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error('Não deu para baixar a música salva. Tente enviar o arquivo de novo.');
    return res.arrayBuffer();
  };

  const run = async (mode: SongLyricsMode, row: MediaRow | null = song ?? null) => {
    if (!row || busy) return;
    const ac = new AbortController();
    abort.current = ac;
    setNote(null);
    try {
      setPhase({ k: 'prep' });
      const { wav } = await toAsrWav(await audioBytes(row, ac.signal));
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
      const res = await callForm(adminApi.songLyrics.run, form, { signal: ac.signal });
      apply(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error && !('code' in e) ? e.message : errorMessage(e);
      setNote({ kind: 'warn', text: msg });
      toast(msg, 'err');
    } finally {
      if (abort.current === ac) abort.current = null;
      setPhase({ k: 'idle' });
    }
  };

  const apply = (res: SongLyricsRes) => {
    const why = whyDemo(res.detail);
    if (res.mode === 'align') {
      set((d) => {
        const cur = (Array.isArray(d.lyrics) ? d.lyrics : []) as Obj[];
        return { ...d, lyrics: cur.map((l, i) => (res.lines[i] ? { ...l, t: res.lines[i].t } : l)) };
      });
      const heard = res.lines.filter((l) => l.heard).length;
      const text =
        res.source === 'demo'
          ? `${why}. As ${res.lines.length} linhas foram espalhadas por igual na música: ajuste os tempos à mão.`
          : heard === res.lines.length
            ? `Pronto: as ${heard} linhas ganharam o tempo de início pela voz da música. Confira na prévia e salve.`
            : `Pronto: ${heard} de ${res.lines.length} linhas sincronizadas pela voz; as outras ficaram com tempo estimado. Confira na prévia e salve.`;
      setNote({ kind: res.source === 'demo' || heard < res.lines.length ? 'warn' : 'ok', text });
      return;
    }
    if (!res.lines.length) {
      const text =
        res.source === 'demo'
          ? `${why}, e gerar a letra precisa dela. Digite a letra e use "Sincronizar letra atual".`
          : 'A IA não reconheceu nenhuma letra cantada nesta música.';
      setNote({ kind: 'warn', text });
      return;
    }
    set((d) => ({
      ...d,
      lyrics: res.lines.map((l) => ({ en: l.en, pt: l.pt, ...(l.gap ? { gap: l.gap } : {}), t: l.t })),
    }));
    setNote({
      kind: res.translated ? 'ok' : 'warn',
      text: res.translated
        ? `Pronto: ${res.lines.length} linhas em inglês e português, com lacuna e tempo. Revise o que a IA ouviu e salve.`
        : `${res.lines.length} linhas transcritas com tempo, mas a tradução falhou: preencha o português e salve.`,
    });
  };

  const generate = async (row: MediaRow | null = song ?? null) => {
    if (lyrics.length) {
      const ok = await confirmAction({
        title: 'Substituir a letra?',
        body: `As ${lyrics.length} linhas atuais (com tradução e lacunas) dão lugar à letra que a IA ouvir na música. Nada é salvo até você clicar em Salvar.`,
        confirm: 'Gerar letra nova',
      });
      if (!ok) return;
    }
    await run('generate', row);
  };

  const upload = (file: File) => {
    const bad = precheck(file, 'audio');
    if (bad) {
      toast(bad, 'err');
      return;
    }
    setNote(null);
    setPhase({ k: 'upload', p: 0 });
    const h = uploadMedia(file, (p) => setPhase({ k: 'upload', p }));
    h.promise.then(
      (row) => {
        rememberMedia([row]);
        picked.current = { id: row.id, file };
        set((d) => ({ ...d, songMedia: row.id }));
        setPhase({ k: 'idle' });
        toast('Música enviada. Agora a IA monta a letra.');
        // With lyrics already typed, keep them and only find the times; otherwise write them from the song.
        void run(lyrics.length ? 'align' : 'generate', row);
      },
      (e: unknown) => {
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
    // Sits at the top of the Música tab's card, above the lyrics, split from them by a rule.
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
            onClick={() => input.current?.click()}
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
                  lyrics: ((Array.isArray(d.lyrics) ? d.lyrics : []) as Obj[]).map(({ t: _t, ...l }) => l),
                }))
              }
            />
          ) : null}
          {busy && phase.k !== 'upload' ? (
            <Button label="Cancelar" kind="light" onClick={() => abort.current?.abort()} />
          ) : null}
        </div>
        <input
          ref={input}
          class="sr"
          type="file"
          accept={ACCEPT.audio}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const el = e.currentTarget as HTMLInputElement;
            const f = el.files?.[0];
            el.value = '';
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
