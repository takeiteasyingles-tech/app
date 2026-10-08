// E-book hub (#/ebook/1): port of TIE.screens.ebook in prototipo/js/screens/curso.js. Scope card, the
// two episodes, the optional extras (Take Five, Take the Lead, Take it for Real, Take It Out "Em
// produção"), the test card with the last score, and the "Na próxima" teaser.
import { Btn, Icon, Topbar } from '@tie/ui';
import { type ScreenProps, useChrome } from '../../frame';
import { layoutOf } from '../../shell';
import { catalog, state } from '../../store';
import {
  DESK_WRAP,
  DeskHead,
  EB,
  ebookSeason,
  LoadFailed,
  lessonsLabel,
  pad2,
  seasonCefr,
  testIntro,
  useEbook,
} from './common';

/** The dashed cards (Take It Out, Na próxima) at the weight of their siblings' edge (1.5px, not 2px). */
const DASH = { '--gap': '6px', borderWidth: '1.5px', background: 'rgba(255,255,255,.45)' };

export default function Ebook(_props: ScreenProps) {
  useChrome({ title: `E-book ${EB}` });
  const s = state.value;
  const c = catalog.value;
  const { data: eb, error } = useEbook();
  const entry = c?.ebooks.find((b) => b.num === EB);
  const season = eb ? ebookSeason(c, eb) : 1;
  const kicker = `Temporada ${season} · E-book ${pad2(EB)}`;
  const title = eb?.title ?? entry?.title ?? '';
  if (error) return <LoadFailed back="trilha" kicker={kicker} title={title} />;
  const desk = layoutOf(s) === 'desktop';
  const k = String(EB);
  const last = s.testScore[k];
  const testPts = c?.game.points.test_pass ?? 50;
  const ready = eb?.extrasCards.filter((x) => x.go) ?? [];
  const soon = eb?.extrasCards.filter((x) => !x.go) ?? [];

  // The episode line says where the learner is, like the Trilha node does ("etapa 6 de 10").
  const epStatus = (n: number): string => {
    if (s.epsDone[n]) return 'Concluído · abrir de novo';
    const p = s.prog[n] ?? 1;
    if (p > 1) return `Em andamento · etapa ${p} de ${c?.steps.length ?? 10}`;
    return 'A fazer';
  };

  const testCard = eb ? (
    <div class="card navy stack" style={{ '--gap': '12px' }}>
      <div class="lbl" style={{ color: 'var(--onNavy)' }}>
        Take a test
      </div>
      <div class="h2" style={{ color: '#fff' }}>
        Take the episode test
      </div>
      <p class="p">{testIntro(eb)}</p>
      {last != null ? (
        <div class="h3" style={{ color: '#fff' }}>
          {`Última tentativa: ${last}/${eb.test.reduce((a, p) => a + p.qs.length, 0)}`}
        </div>
      ) : null}
      <Btn label={last != null ? 'Refazer o teste' : `Fazer o teste · +${testPts} pontos`} go={`ebook/${EB}/teste`} />
    </div>
  ) : null;
  const teaser = eb?.teaser ? (
    <div
      class={`card dash stack${desk ? '' : ' mt8'}`}
      style={{ ...DASH, justifyContent: desk ? 'center' : undefined }}
    >
      <div class="lbl or">Na próxima</div>
      <div class="h3">{eb.teaser.title}</div>
      <p class="p">{eb.teaser.sub}</p>
    </div>
  ) : null;

  return (
    <>
      {desk ? null : <Topbar back="trilha" kicker={kicker} title={title} />}
      <div class="scroll">
        {desk ? (
          <div class="wrap" style={{ '--wrap': DESK_WRAP, paddingBottom: '0' }}>
            <DeskHead back="trilha" kicker={kicker} title={title} />
          </div>
        ) : null}
        {eb ? (
          <div class="wrap stack" style={{ '--wrap': desk ? DESK_WRAP : '900px', '--gap': '16px' }}>
            <div class="card stack" style={{ '--gap': '10px' }}>
              <div class="row between">
                <span class="lbl">{`${lessonsLabel(eb)} · ${seasonCefr(c, season)}`}</span>
                <span class="pill">{`E-book ${pad2(eb.num)}`}</span>
              </div>
              <p class="p-read">{eb.scope}</p>
            </div>
            <div class="stack" style={{ '--gap': '8px' }}>
              <div class="lbl">Os episódios</div>
              <div style={{ display: 'grid', gridTemplateColumns: desk ? '1fr 1fr' : '1fr', gap: '8px 10px' }}>
                {eb.episodes.map((n) => (
                  <a
                    key={n}
                    class="card row"
                    href={`#/episodio/${n}/1`}
                    style={{ '--gap': '12px', padding: '14px 16px' }}
                  >
                    <span class="num" style={{ fontSize: '1.4rem', color: 'var(--green)', width: '38px' }}>
                      {pad2(n)}
                    </span>
                    <span class="grow">
                      <span class="h3" style={{ display: 'block' }}>
                        {c?.titles[n - 1] ?? ''}
                      </span>
                      <span class="sm">{epStatus(n)}</span>
                    </span>
                    <Icon name="next" size={20} />
                  </a>
                ))}
              </div>
            </div>
            <div class="stack" style={{ '--gap': '8px' }}>
              <div class="lbl">Take some extras · opcionais</div>
              {/* The prototype's grid: the four extras as cards of one shape (two columns on desktop).
                  A playable one carries a chevron by its meta; the one still in production is the same
                  card, dashed, with a muted meta and nothing to open. */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: desk ? '1fr 1fr' : '1fr',
                  // Desktop: every row as tall as the tallest card, so the grid reads as one block.
                  gridAutoRows: desk ? '1fr' : undefined,
                  gap: '10px',
                }}
              >
                {[...ready, ...soon].map((x) => {
                  const inner = (
                    <>
                      <div class="row between base">
                        <span class="h3">{x.name}</span>
                        <span
                          class="xs row"
                          style={{
                            '--gap': '2px',
                            fontWeight: '800',
                            color: x.go ? 'var(--blue)' : 'var(--muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {x.meta}
                          {x.go ? <Icon name="next" size={16} /> : null}
                        </span>
                      </div>
                      <div class="sm" style={{ fontWeight: '700' }}>
                        {x.pt}
                      </div>
                      <div class="p">{x.desc}</div>
                    </>
                  );
                  return x.go ? (
                    <a key={x.name} href={`#/${x.go}`} class="card stack" style={{ '--gap': '6px' }}>
                      {inner}
                    </a>
                  ) : (
                    // The dashed card at the weight of its siblings' edge (1.5px), not tie.css's 2px.
                    <div key={x.name} class="card dash stack" style={DASH}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Desktop: the test and "Na próxima" side by side (the page used to end on a long empty
                stretch under a full-width teaser). Phone: one under the other, as in the prototype. */}
            {desk && teaser ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: '14px' }}>
                {testCard}
                {teaser}
              </div>
            ) : (
              <>
                {testCard}
                {teaser}
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
