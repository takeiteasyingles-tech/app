// Live preview of the episode being edited, drawn with the student app's own tie.css classes inside a
// phone frame: the part shown follows the editor tab (lyrics, dialogue, lesson blocks, exercises…).
import type { Block, BlockRow } from '@tie/shared/content/schema';
import type { ComponentChildren } from 'preact';
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

function Lyric({ en, pt, gap }: { en: string; pt: string; gap: string }) {
  let enNode: ComponentChildren = en;
  if (gap) {
    const i = en.toLowerCase().indexOf(gap.toLowerCase());
    if (i >= 0) {
      enNode = (
        <>
          {en.slice(0, i)}
          <span class="gap filled">{en.slice(i, i + gap.length)}</span>
          {en.slice(i + gap.length)}
        </>
      );
    }
  }
  return (
    <div class="lyric">
      <div class="en">{enNode}</div>
      {pt ? <div class="pt">{pt}</div> : null}
    </div>
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
    case 'midia':
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
          {tab === 'midia' ? (
            <div class="card stack">
              <MediaById id={(d.introMedia as string) ?? null} label="Intro" />
              <MediaById id={(d.songMedia as string) ?? null} label={str(d.songTitle) || 'Música'} />
              <MediaById id={(d.sceneMedia as string) ?? null} label="Cena" />
              {str(d.sceneNote) ? <p class="sm">{str(d.sceneNote)}</p> : null}
            </div>
          ) : null}
        </>
      );
    case 'musica': {
      const ly = arr<Any>(d.lyrics);
      return ly.length ? (
        <div class="on-navy stack" style={{ '--gap': '8px' }}>
          <div class="lbl">{str(d.songTitle) || 'Música'}</div>
          <div class="lyrics">
            {ly.map((l, i) => (
              <Lyric key={i} en={str(l.en)} pt={str(l.pt)} gap={str(l.gap)} />
            ))}
          </div>
        </div>
      ) : (
        <Empty what="A letra aparece aqui." />
      );
    }
    case 'olhar': {
      const v = arr<Any>(d.visual);
      return v.length ? (
        <div class="grid2">
          {v.map((w, i) => (
            <div key={i} class="card stack" style={{ '--gap': '4px', padding: '14px' }}>
              <span class="en">{str(w.en)}</span>
              <span class="pt sm">{str(w.pt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty what="As palavras da cena aparecem aqui." />
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
  const navy = tab === 'musica';
  return (
    <aside class="ad-preview" aria-label="Prévia para o aluno">
      <div class="row between wrapx" style={{ '--gap': '6px' }}>
        <span class="lbl">Prévia no app</span>
        <span class="xs">{dirty ? 'Com as edições ainda não salvas' : 'Versão do rascunho (vale após publicar)'}</span>
      </div>
      <div class="ad-phone">
        <div class={`ad-phone-in${navy ? ' navy' : ''}`}>
          <Body d={doc} tab={tab} />
        </div>
      </div>
    </aside>
  );
}
