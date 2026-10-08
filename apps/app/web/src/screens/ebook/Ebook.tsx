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
  testIntroParts,
  useEbook,
} from './common';

/**
 * The dashed "Na próxima" card (what is still to come): a 1.5px dash (tie.css's 2px dark dash was heavy) in a
 * sand tone strong enough to read as an edge on the cream page, over a faint white body.
 */
const DASH = { '--gap': '6px', borderWidth: '1.5px', borderColor: '#A3946B', background: '#fff' };

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
    // Not started: the next one in line says what comes first (as the Trilha's "A seguir" does).
    const prev = eb?.episodes.filter((x) => x < n && !s.epsDone[x]) ?? [];
    if (prev.length) return `A fazer · depois do episódio ${pad2(prev[prev.length - 1] ?? n - 1)}`;
    return 'A fazer';
  };

  const testText = eb ? (
    <>
      <div class="lbl" style={{ color: 'var(--onNavy)' }}>
        Take a test
      </div>
      <div class="h2" style={{ color: '#fff' }}>
        Take the episode test
      </div>
      {desk ? (
        // Desktop: o escopo numa linha e "Recomenda, não bloqueia." como nota abaixo (a frase inteira
        // quebrava deixando "não bloqueia." sozinha ao lado do botão).
        <p class="p">
          {testIntroParts(eb)[0]}
          <span class="sm" style={{ display: 'block', marginTop: '2px' }}>
            {testIntroParts(eb)[1]}
          </span>
        </p>
      ) : (
        <p class="p">{testIntro(eb)}</p>
      )}
      {last != null ? (
        <div class="h3" style={{ color: '#fff' }}>
          {`Última tentativa: ${last}/${eb.test.reduce((a, p) => a + p.qs.length, 0)}`}
        </div>
      ) : null}
    </>
  ) : null;
  const testBtn = (
    <Btn
      label={last != null ? 'Refazer o teste' : `Fazer o teste · +${testPts} pontos`}
      go={`ebook/${EB}/teste`}
      cls="block"
    />
  );
  // Desktop: one full-width card, the text on the left and the button (its own width, centred on the
  // text block) on the right, with the same padding all round. Phone: the prototype's stack.
  const testCard = eb ? (
    desk ? (
      <div class="card navy row" style={{ '--gap': '32px', padding: '24px', alignItems: 'center' }}>
        <div class="stack grow" style={{ '--gap': '8px', minWidth: '0' }}>
          {testText}
        </div>
        <div style={{ flex: 'none' }}>
          <Btn
            label={last != null ? 'Refazer o teste' : `Fazer o teste · +${testPts} pontos`}
            go={`ebook/${EB}/teste`}
          />
        </div>
      </div>
    ) : (
      <div class="card navy stack" style={{ '--gap': '12px' }}>
        {testText}
        {testBtn}
      </div>
    )
  ) : null;
  // "Na próxima": the prototype's dashed card (what is still to come), on white with a clearly visible
  // edge and a book mark, as wide as the test card above it and only as tall as its text.
  const teaser = eb?.teaser ? (
    <div
      class={`card dash stack${desk ? '' : ' mt8'}`}
      style={{ ...DASH, '--gap': '6px', padding: desk ? '18px 24px' : '16px' }}
    >
      {/* Hierarquia: o rótulo "Na próxima" com o livro (na mesma linha, sem uma coluna de ícone que
          estreitava o texto no celular); a frase da história como corpo principal; a referência
          (e-book, lições) como meta discreta embaixo. */}
      <span class="row" style={{ '--gap': '8px' }}>
        <span aria-hidden="true" style={{ color: 'var(--orange)', display: 'flex' }}>
          <Icon name="book" size={16} />
        </span>
        <span class="lbl or">Na próxima</span>
      </span>
      <span class="p" style={{ color: 'var(--navy)', fontWeight: '700', lineHeight: '1.5', textWrap: 'pretty' }}>
        {eb.teaser.title}
      </span>
      <span class="sm" style={{ fontWeight: '600' }}>
        {eb.teaser.sub}
      </span>
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
                    {/* One number colour (the brand orange of the Trilha's numbers); the state goes in
                        the status line, with a dot in its colour (green done, orange in progress). */}
                    <span class="num" style={{ fontSize: '1.4rem', width: '38px', color: 'var(--orange)' }}>
                      {pad2(n)}
                    </span>
                    <span class="grow">
                      <span class="h3" style={{ display: 'block' }}>
                        {c?.titles[n - 1] ?? ''}
                      </span>
                      <span class="sm row" style={{ '--gap': '6px' }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: '8px',
                            height: '8px',
                            flex: 'none',
                            borderRadius: '50%',
                            background: s.epsDone[n]
                              ? 'var(--green)'
                              : (s.prog[n] ?? 1) > 1
                                ? 'var(--orange)'
                                : 'var(--line2)',
                          }}
                        />
                        <span>{epStatus(n)}</span>
                      </span>
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
                  card with an "Em produção" pill and nothing to open. */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: desk ? '1fr 1fr' : '1fr',
                  // Each row as tall as its own taller card (equal rows left a short pair half empty).
                  gap: '10px',
                }}
              >
                {[...ready, ...soon].map((x) => {
                  const inner = (
                    <>
                      <div class={`row between ${x.go ? 'base' : ''}`}>
                        <span class="h3">{x.name}</span>
                        {x.go ? (
                          // The meta as a soft-blue pill with a full-size chevron (a bare 16px chevron
                          // read small and sat on the card's edge).
                          <span class="pill bl" style={{ gap: '2px', padding: '4px 6px 4px 10px' }}>
                            {x.meta}
                            <Icon name="next" size={18} />
                          </span>
                        ) : (
                          // Not playable yet: an explicit status pill with a clock, not a muted word.
                          <span class="pill" style={{ background: 'var(--goldT)', color: '#7A5400' }}>
                            <Icon name="clock" size={13} />
                            {x.meta}
                          </span>
                        )}
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
                    // The same solid card as its siblings (a dashed edge read as noise beside them):
                    // the "Em produção" pill and no chevron say it cannot be opened yet.
                    <div key={x.name} class="card stack soon" style={{ '--gap': '6px' }}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* The test, then "Na próxima", one under the other at the same width (as in the prototype). */}
            {testCard}
            {teaser}
          </div>
        ) : null}
      </div>
    </>
  );
}
