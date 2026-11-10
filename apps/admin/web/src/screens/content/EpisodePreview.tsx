// Live preview of the episode being edited, drawn with the student app's own tie.css classes inside a
// phone frame: the part shown follows the editor tab (lyrics, dialogue, lesson blocks, exercises…).
import type { Block, BlockRow } from '@tie/shared/content/schema';
import { lyricLineAt } from '@tie/shared/domain/songSync';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { MediaPreview, useMedia } from '../../ui/media';
import type { TabId } from './episodeSpecs';

type Any = Record<string, unknown>;

/**
 * One hue per character, in cast order: the student app's castColor() fallback (apps/app/web
 * screens/player/steps.tsx HUES) used while the course cast shares one colour.
 */
export const CAST_HUES = ['#F45A28', '#2A6FF5', '#1F7A4C', '#E9A200', '#8E5BD6', '#D9645B', '#0E8A9A'];

function castHue(cast: readonly string[], who: string): string {
  const i = cast.findIndex((n) => n.toLowerCase() === who.toLowerCase());
  return i < 0 ? 'var(--muted)' : (CAST_HUES[i % CAST_HUES.length] as string);
}
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function MediaById({ id, label }: { id: string | null; label: string }) {
  const m = useMedia(id);
  if (!id) return <div class="xs">{label}: sem arquivo.</div>;
  if (!m) return <div class="ad-skel" style={{ height: '40px' }} />;
  return (
    <div class="stack" style={{ '--gap': '6px' }}>
      <span class="lbl">{label}</span>
      <MediaPreview m={m} />
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** m:ss, as the student player's clock. */
const mmss = (t: number) => {
  const x = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(x / 60)}:${pad2(x % 60)}`;
};

/**
 * Lyric rows as the student player shows them (screens/player/model.ts lyricRows): a line sung twice in a
 * row is one row with a ×N tag; of[i] maps a lyric index to its row.
 */
function lyricRows(lyrics: readonly Any[]): { rows: { l: Any; n: number; first: number }[]; of: number[] } {
  const rows: { l: Any; n: number; first: number }[] = [];
  const of: number[] = [];
  lyrics.forEach((l, i) => {
    const last = rows[rows.length - 1];
    if (last && str(last.l.en) === str(l.en) && str(last.l.pt) === str(l.pt)) last.n++;
    else rows.push({ l, n: 1, first: i });
    of.push(rows.length - 1);
  });
  return { rows, of };
}

/**
 * Step 1 (Música) as the student sees it: the dock (label, title, Tradução, play, bar and clock) stays
 * fixed at the top of the phone while the lyrics scroll under it, and the line being sung (line times,
 * domain/songSync.ts lyricLineAt) is highlighted and kept in the middle. Staff can also click the bar to
 * seek, or a line to play from its start, to check the times before publishing.
 */
function SongPreview({ lyrics, songId, title }: { lyrics: Any[]; songId: string | null; title: string }) {
  const m = useMedia(songId);
  const audio = useRef<HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ t: 0, d: 0 });
  const [playing, setPlaying] = useState(false);
  const [trans, setTrans] = useState(true);
  const times = lyrics.map((l) => ({ t: typeof l.t === 'number' ? l.t : undefined }));
  const line = lyricLineAt(times, at.t, at.d);
  const { rows, of } = lyricRows(lyrics);
  const on = of[line] ?? 0;
  const started = playing || at.t > 0;
  useEffect(() => {
    if (!started) return;
    // Scroll the phone, never the admin page: centre the row inside the phone's own scroller.
    const row = box.current?.children[on] as HTMLElement | undefined;
    const scroller = row?.closest('.ad-phone-in') as HTMLElement | null;
    if (!row || !scroller) return;
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: top - scroller.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' });
  }, [on, started]);
  const sync = () => {
    const a = audio.current;
    if (a) setAt({ t: a.currentTime, d: Number.isFinite(a.duration) ? a.duration : 0 });
  };
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const seekTo = (t: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, t);
    sync();
    if (a.paused) void a.play().catch(() => setPlaying(false));
  };
  const pct = at.d ? Math.min(100, Math.round((at.t / at.d) * 100)) : 0;
  return (
    <>
      <div class="player-dock ad-psong-dock">
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="row between" style={{ '--gap': '12px' }}>
            <div class="stack" style={{ '--gap': '2px', minWidth: '0' }}>
              <div class="lbl">Música · 1ª passada</div>
              <div class="h2">{title}</div>
            </div>
            <button
              type="button"
              class="row"
              aria-pressed={trans}
              onClick={() => setTrans((v) => !v)}
              style={{ '--gap': '8px', fontWeight: '800', minHeight: '44px', flex: 'none', alignItems: 'center' }}
            >
              <span>Tradução</span>
              <span class={`toggle${trans ? ' on' : ''}`}>
                <i />
              </span>
            </button>
          </div>
          {m ? (
            <div class="card row" style={{ '--gap': '12px', padding: '8px 14px 8px 8px' }}>
              <button
                type="button"
                class={`playbtn${playing ? '' : ' navy'}`}
                onClick={toggle}
                aria-label={playing ? 'Pausar' : 'Tocar'}
                style={{ width: '48px', height: '48px' }}
              >
                <Icon name={playing ? 'pause' : 'play'} size={20} />
              </button>
              <button
                type="button"
                class="bar grow ad-psong-bar"
                aria-label="Ir para este ponto da música"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  if (at.d && r.width) seekTo(((e.clientX - r.left) / r.width) * at.d);
                }}
              >
                <i style={{ width: `${pct}%` }} />
              </button>
              <span class="xs" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {`${mmss(at.t)} / ${mmss(at.d)}`}
              </span>
              {/* biome-ignore lint/a11y/useMediaCaption: the lyrics below are the captions. */}
              <audio
                ref={audio}
                src={m.url}
                preload="metadata"
                onLoadedMetadata={sync}
                onTimeUpdate={sync}
                onSeeked={sync}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            </div>
          ) : (
            <p class="xs">Sem a gravação desta música: a trilha é sintetizada e a letra avança sozinha.</p>
          )}
        </div>
      </div>
      <div class="stack" style={{ '--gap': '2px' }} ref={box}>
        {rows.map(({ l, n, first }, i) => (
          <button
            type="button"
            key={first}
            class={`dialog-line ad-psong-line${started && i === on ? ' on' : ''}`}
            title={typeof l.t === 'number' ? `Tocar a partir de ${mmss(l.t)}` : undefined}
            onClick={() => (typeof l.t === 'number' ? seekTo(l.t) : undefined)}
          >
            <div
              class="en"
              style={{
                fontSize: started && i === on ? '1.2rem' : '1.08rem',
                color: !started || i === on ? 'var(--navy)' : 'var(--muted)',
              }}
            >
              {str(l.en)}
              {n > 1 ? <span class="pill ad-psong-rep">{`×${n}`}</span> : null}
            </div>
            {trans && str(l.pt) ? (
              <div class="pt sm" style={{ marginTop: '2px' }}>
                {str(l.pt)}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

function BlockRowView({ r, bad }: { r: BlockRow; bad: string }) {
  return (
    <div
      class="stack"
      style={{ '--gap': '4px', padding: '12px 14px', borderRadius: '14px', background: 'var(--cream)' }}
    >
      {r.q ? (
        <div class="sm" style={{ fontWeight: '700' }}>
          {r.q}
        </div>
      ) : null}
      <div class="en" style={{ fontSize: '1.06rem' }}>
        {r.en}
      </div>
      {r.pt ? <div class="pt">{r.pt}</div> : null}
      {r.bad ? (
        <div class="row base mt4" style={{ '--gap': '8px' }}>
          <span class="lbl bl" style={{ flex: 'none' }}>
            {bad}
          </span>
          <span class="strike" style={{ fontWeight: '700' }}>
            {r.bad}
          </span>
        </div>
      ) : null}
      {r.note ? <div class="sm mt4">{r.note}</div> : null}
    </div>
  );
}

/** Same markup as the app's TIE.blocks (ui-blocks/Blocks.tsx). */
export function BlockView({ b }: { b: Block }) {
  const bad = b.badLabel || 'NÃO É';
  return (
    <div class="card stack" style={{ '--gap': '12px' }}>
      <div class="lbl or">{b.k || ''}</div>
      {b.title ? <div class="h2">{b.title}</div> : null}
      {b.body ? <p class="p-read">{b.body}</p> : null}
      {b.body2 ? <p class="p-read">{b.body2}</p> : null}
      {b.rows?.length ? (
        <div class="stack" style={{ '--gap': '8px' }}>
          {b.rows.map((r, i) => (
            <BlockRowView key={i} r={r} bad={bad} />
          ))}
        </div>
      ) : null}
      {b.bullets?.length ? (
        <div class="stack" style={{ '--gap': '10px' }}>
          {b.bullets.map((x, i) => (
            <div key={i} class="row top" style={{ '--gap': '10px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--orange)',
                  flex: 'none',
                  marginTop: '9px',
                }}
              />
              <span class="p-read">{x}</span>
            </div>
          ))}
        </div>
      ) : null}
      {b.callout ? (
        <div class="card navy" style={{ padding: '14px 16px' }}>
          <div class="h3" style={{ color: '#fff' }}>
            {b.callout}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <div class="card dash tc sm">{what}</div>;
}

function Body({ d, tab }: { d: Any; tab: TabId }) {
  const num = Number(d.num) || 0;
  switch (tab) {
    case 'geral':
      return (
        <>
          <div class="now-card stack" style={{ '--gap': '10px' }}>
            <span class="pill" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', alignSelf: 'flex-start' }}>
              Ep. {String(num).padStart(2, '0')}
            </span>
            <div class="h1">{str(d.title) || 'Sem título'}</div>
            {str(d.synopsis) ? <p class="sm">{str(d.synopsis)}</p> : null}
            {arr<string>(d.castNames).length ? (
              <div class="row wrapx" style={{ '--gap': '6px' }}>
                {arr<string>(d.castNames).map((n, i) => (
                  <span key={n} class="pill ad-castpill" style={{ '--c': CAST_HUES[i % CAST_HUES.length] }}>
                    <i aria-hidden="true" />
                    {n}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </>
      );
    case 'apresentacao':
      return (
        <div class="stack ad-pres" style={{ '--gap': '14px' }}>
          <div class="h2" style={{ textAlign: 'center' }}>
            Apresentação do Episódio
          </div>
          <MediaById id={(d.introMedia as string) ?? null} label="Áudio da apresentação" />
          <div class="ad-porb" aria-hidden="true">
            <span />
          </div>
          {str(d.synopsis) ? (
            <p class="ad-ptext">{str(d.synopsis)}</p>
          ) : (
            <Empty what="O texto da apresentação aparece aqui." />
          )}
        </div>
      );
    case 'musica': {
      const ly = arr<Any>(d.lyrics);
      return ly.length ? (
        <SongPreview lyrics={ly} songId={(d.songMedia as string) ?? null} title={str(d.songTitle) || 'Música'} />
      ) : (
        <Empty what="A letra aparece aqui." />
      );
    }
    case 'olhar': {
      const v = arr<Any>(d.visual);
      const scene = (
        <div class="card stack">
          {d.lookMedia ? <MediaById id={d.lookMedia as string} label="1º Áudio de contexto" /> : null}
          <MediaById id={(d.sceneMedia as string) ?? null} label={d.lookMedia ? '2º Cena' : 'Cena'} />
          {str(d.sceneNote) ? <p class="sm">{str(d.sceneNote)}</p> : null}
        </div>
      );
      return v.length ? (
        <>
          {scene}
          <div class="grid2">
            {v.map((w, i) => (
              <div key={i} class="card stack" style={{ '--gap': '4px', padding: '14px' }}>
                <span class="en">{str(w.en)}</span>
                <span class="pt sm">{str(w.pt)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {scene}
          <Empty what="As palavras da cena aparecem aqui." />
        </>
      );
    }
    case 'dialogo': {
      const lines = arr<Any>(d.dialog);
      return (
        <>
          {str(d.dialogTitle) ? <div class="h2">{str(d.dialogTitle)}</div> : null}
          {str(d.dialogSub) ? <p class="sm">{str(d.dialogSub)}</p> : null}
          {lines.length ? (
            <div class="stack" style={{ '--gap': '4px' }}>
              {lines.map((l, i) => (
                <div key={i} class={`dialog-line${l.stage ? ' stage' : ''}`}>
                  {str(l.who) && !l.stage ? (
                    <div class="who ad-who" style={{ '--c': castHue(arr<string>(d.castNames), str(l.who)) }}>
                      <i aria-hidden="true" />
                      {str(l.who).toUpperCase()}
                    </div>
                  ) : null}
                  <div class="en">{str(l.en)}</div>
                  <div class="pt">{str(l.pt)}</div>
                  {str(l.err) ? <div class="note err">{str(l.err)}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <Empty what="As falas aparecem aqui." />
          )}
        </>
      );
    }
    case 'mic': {
      const ph = arr<Any>(d.mic);
      return ph.length ? (
        <div class="stack" style={{ '--gap': '10px' }}>
          {ph.map((p, i) => (
            <div key={i} class="card stack" style={{ '--gap': '8px' }}>
              <div class="row between">
                <span class="lbl or">Frase {i + 1}</span>
                <Icon name="mic" size={18} />
              </div>
              <div class="en" style={{ fontSize: '1.1rem' }}>
                {str(p.en)}
              </div>
              {str(p.tip) ? <div class="fb tip">{str(p.tip)}</div> : null}
              {str(p.fb) ? <div class={`fb ${p.blue ? 'fix' : 'ok'}`}>{str(p.fb)}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty what="As frases para gravar aparecem aqui." />
      );
    }
    case 'licao': {
      const blocks = arr<Block>(d.lesson);
      const pron = d.pron as {
        k?: string;
        parts?: { b: string; t: string }[];
        pairs?: { a: string; b: string; c: string }[];
        words?: string[];
      } | null;
      return (
        <>
          {blocks.length ? (
            blocks.map((b, i) => <BlockView key={i} b={b} />)
          ) : (
            <Empty what="Os blocos da lição aparecem aqui." />
          )}
          {pron ? (
            <div class="card stack" style={{ '--gap': '10px' }}>
              <div class="lbl or">{pron.k || 'Pronúncia'}</div>
              {(pron.parts ?? []).map((p, i) => (
                <p key={i} class="p-read">
                  <b>{p.b}</b> {p.t}
                </p>
              ))}
              {(pron.pairs ?? []).map((p, i) => (
                <div key={i} class="row" style={{ '--gap': '8px' }}>
                  <span class="en">{p.a}</span>
                  <span class="muted">≠</span>
                  <span class="en">{p.b}</span>
                  <span class="xs grow">{p.c}</span>
                </div>
              ))}
              {pron.words?.length ? (
                <div class="row wrapx" style={{ '--gap': '6px' }}>
                  {pron.words.map((w) => (
                    <span key={w} class="pill saypill">
                      {w}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      );
    }
    case 'away': {
      const exps = arr<Any>(d.awayExp);
      const words = arr<string>(d.awayWords);
      return (
        <>
          {exps.length ? (
            <div class="card">
              {exps.map((x, i) => (
                <div key={i} class="listrow" style={{ alignItems: 'flex-start' }}>
                  <div class="grow">
                    <div class="en">{str(x.en)}</div>
                    <div class="pt sm">{str(x.pt)}</div>
                    {str(x.note) ? (
                      <div class="xs" style={{ fontStyle: 'italic' }}>
                        {str(x.note)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty what="As expressões aparecem aqui." />
          )}
          {words.length ? (
            <div class="chips">
              {words.map((w) => (
                <span key={w} class="pill">
                  {w}
                </span>
              ))}
            </div>
          ) : null}
        </>
      );
    }
    case 'exercicios': {
      const exs = arr<Any>(d.ex);
      return exs.length ? (
        <>
          {exs.map((x, i) => (
            <div key={i} class="card stack" style={{ '--gap': '10px' }}>
              <span class="lbl or">{str(x.kind)}</span>
              <div class="h3">{str(x.title) || `Exercício ${i + 1}`}</div>
              {str(x.intro) ? <p class="sm">{str(x.intro)}</p> : null}
              {arr<Any>(x.items).map((it, j) => (
                <div key={j} class="stack" style={{ '--gap': '6px' }}>
                  <div class="p" style={{ fontWeight: 700 }}>
                    {j + 1}. {str(it.q)}
                  </div>
                  {arr<string>(it.opts).map((o, k) => (
                    <div key={k} class={`opt${k === it.answerIdx ? ' right' : ''}`}>
                      <span class="key">{String.fromCharCode(65 + k)}</span>
                      <span>{o}</span>
                    </div>
                  ))}
                  {str(it.fix) ? <div class="fb fix">{str(it.fix)}</div> : null}
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <Empty what="Os exercícios aparecem aqui." />
      );
    }
    case 'fim': {
      const done = d.done as Record<string, string> | null;
      if (!done) return <Empty what="Sem tela de conclusão: o episódio não pode ser publicado." />;
      return (
        <div class="stack" style={{ '--gap': '12px' }}>
          <div class="card tc stack" style={{ '--gap': '8px', alignItems: 'center' }}>
            <span
              class="ad-kpi-ic"
              style={{
                width: '56px',
                height: '56px',
                background: 'var(--goldT)',
                color: '#B27A00',
                borderRadius: '50%',
              }}
            >
              <Icon name="trophy" size={28} />
            </span>
            <div class="h2">{done.title}</div>
            <p class="p">{(done.line ?? '').replace(/\{N\}/g, 'Ana')}</p>
            <span class="pill gold">+40 pontos</span>
          </div>
          <div class="card dash stack" style={{ '--gap': '4px' }}>
            <span class="lbl">Próximo · {done.nextNum}</span>
            <div class="h3">{done.nextTitle}</div>
            <div class="sm">{done.nextSub}</div>
            {done.nextNote ? <div class="xs">{done.nextNote}</div> : null}
          </div>
          <div class="btn block">{done.cta || 'Continuar'}</div>
          <div class="xs tc ad-mono">#/{done.go}</div>
        </div>
      );
    }
    default:
      return null;
  }
}

export function EpisodePreview({ doc, tab, dirty }: { doc: Any; tab: TabId; dirty?: boolean }) {
  return (
    <aside class="ad-preview" aria-label="Prévia para o aluno">
      <div class="row between wrapx" style={{ '--gap': '6px' }}>
        <span class="lbl">Prévia no app</span>
        <span class="xs">{dirty ? 'Com as edições ainda não salvas' : 'Versão do rascunho (vale após publicar)'}</span>
      </div>
      <div class="ad-phone">
        <div class="ad-phone-in">
          <Body d={doc} tab={tab} />
        </div>
      </div>
    </aside>
  );
}
