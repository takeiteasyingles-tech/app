// Desafio relâmpago (TIE.screens.desafio): 60 seconds; an EN line from the Extras falls down the
// field and the learner taps its PT translation before it hits the ground. +10 × combo (up to ×5);
// the fall gets faster as the score grows. The result goes to /api/extras/challenge (record, and
// ex_right once a day with 5+ hits). ?x=id limits the lines to one title.
import type { Extra } from '@tie/shared/content/schema';
import { activator, Btn, Icon, Topbar } from '@tie/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { sfx } from '../../core/sound';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { saveChallenge } from '../../store/actions';
import { showToast } from '../../store/award';
import { state } from '../../store/state';
import { allExtrasNow, isDesktop, loadAllExtras, pad2, pick, shuffle, useCatalog, useRerender } from './data';
import { OnNavy } from './parts';

interface QLine {
  en: string;
  pt: string;
}

/** The prototype's G. */
interface GState {
  state: 'idle' | 'play' | 'over';
  score: number;
  combo: number;
  left: number;
  only: string;
  pool: QLine[];
  all: QLine[];
  hits: number;
  miss: number;
  q: QLine | null;
  /** Bumped per question: the faller is a new element each time (as the prototype's re-render made it). */
  qn: number;
  opts: string[];
  t0: number;
  dur: number;
  clock?: ReturnType<typeof setInterval>;
  raf?: number;
}

const gfresh = (only: string): GState => ({
  state: 'idle',
  score: 0,
  combo: 1,
  left: 60,
  only,
  pool: [],
  all: [],
  hits: 0,
  miss: 0,
  q: null,
  qn: 0,
  opts: [],
  t0: 0,
  dur: 7000,
});

/** pool(onlyId): every line of the extras that have lines (or of one extra). */
function linePool(all: readonly Extra[], onlyId?: string): QLine[] {
  return all
    .filter((x) => x.lines.length && (!onlyId || x.id === onlyId))
    .flatMap((x) => x.lines.map((l) => ({ en: l.en, pt: l.pt })));
}

function newQ(G: GState): void {
  const q = pick(G.pool.filter((l) => l.en !== G.q?.en)) ?? G.pool[0] ?? null;
  if (!q) return;
  const wrong = shuffle(G.all.filter((l) => l.pt !== q.pt))
    .slice(0, 2)
    .map((l) => l.pt);
  G.q = q;
  G.qn++;
  G.opts = shuffle([q.pt, ...wrong]);
  G.t0 = performance.now();
  G.dur = Math.max(3200, 7000 - G.score * 12);
}

const act = (fn: () => void) => activator(undefined, fn);

export default function Desafio({ q }: ScreenProps) {
  const { c } = useCatalog();
  const re = useRerender();
  const ref = useRef<GState | null>(null);
  ref.current ??= gfresh(q.x || '');
  const G = ref.current;
  // Full screen like the prototype (no tab bar / side nav: the registry's chrome).
  useChrome({ title: 'Desafio' });
  const fall = useRef<HTMLDivElement>(null);

  // The lines of every extra, ready before "Começar".
  useEffect(() => {
    let alive = true;
    // Re-render once they land: the intro's sample line comes from them.
    void loadAllExtras()
      .then(() => {
        if (alive) re();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // leave()
  useEffect(
    () => () => {
      const g = ref.current;
      if (g) {
        clearInterval(g.clock);
        cancelAnimationFrame(g.raf ?? 0);
        g.state = 'idle';
      }
    },
    [],
  );

  // after(): the faller drops from the top to the ground in G.dur ms; reaching it is a miss.
  useEffect(() => {
    if (G.state !== 'play') return;
    const el = fall.current;
    if (!el) return;
    cancelAnimationFrame(G.raf ?? 0);
    const field = el.parentElement;
    const H = (field?.clientHeight ?? 0) - el.offsetHeight - 6;
    const tick = () => {
      if (ref.current !== G || G.state !== 'play') return;
      const k = Math.min(1, (performance.now() - G.t0) / G.dur);
      el.style.top = `${Math.round(k * H)}px`;
      if (k >= 1) {
        G.miss++;
        G.combo = 1;
        sfx.soft();
        newQ(G);
        re();
        return;
      }
      G.raf = requestAnimationFrame(tick);
    };
    G.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(G.raf ?? 0);
  }, [G.state, G.qn]);

  // ?x= names a title that is not in the catalog or still locked (no lines yet): play with every
  // Extra instead of a round that can never start (the prototype crashed here).
  const onlyMeta = G.only && c ? (c.extras.find((x) => x.id === G.only) ?? null) : null;
  const badOnly = !!G.only && !!c && (!onlyMeta || onlyMeta.locked);
  useEffect(() => {
    if (!badOnly || ref.current !== G) return;
    G.only = '';
    replace('extra/desafio');
    re();
  }, [badOnly]);

  const s = state.value;
  const best = s.extras.best;
  const onlyTitle = onlyMeta && !badOnly ? onlyMeta.title : '';

  const finish = () => {
    clearInterval(G.clock);
    cancelAnimationFrame(G.raf ?? 0);
    G.state = 'over';
    void saveChallenge(G.score, G.hits, G.only || undefined);
    sfx.done();
    re();
  };
  const gStart = async () => {
    // Preloaded on mount, so the round starts at once like the prototype's in-memory data.
    let extras = allExtrasNow();
    if (!extras.length) extras = await loadAllExtras().catch(() => []);
    if (ref.current !== G) return;
    const all = linePool(extras);
    let pool = linePool(extras, G.only);
    // A title whose lines this plan does not open: the round uses every Extra instead.
    if (!pool.length && G.only && all.length) {
      G.only = '';
      pool = all;
    }
    if (!pool.length || !all.length) {
      showToast('Não deu para carregar as falas. Tente de novo.');
      return;
    }
    Object.assign(G, { state: 'play', score: 0, combo: 1, left: 60, hits: 0, miss: 0, pool, all, q: null });
    newQ(G);
    clearInterval(G.clock);
    G.clock = setInterval(() => {
      if (ref.current !== G || G.state !== 'play') return;
      G.left--;
      if (G.left <= 0) finish();
      else re();
    }, 1000);
    re();
  };
  const gPick = (i: number) => {
    if (G.state !== 'play' || !G.q) return;
    if (G.opts[i] === G.q.pt) {
      G.score += 10 * G.combo;
      G.combo = Math.min(5, G.combo + 1);
      G.hits++;
      sfx.ok();
    } else {
      G.combo = 1;
      G.miss++;
      sfx.soft();
      showToast(`${G.q.en} = ${G.q.pt}`, 1800);
    }
    newQ(G);
    re();
  };

  const desk = isDesktop();
  let inner: JSX.Element;
  let dock: JSX.Element | null = null;
  if (G.state !== 'play' || !G.q) {
    const over = G.state === 'over';
    // A sample line for the "how it works" field: the first line of the pool once the Extras load.
    const sampleFrom = linePool(allExtrasNow(), G.only || undefined);
    const sample = sampleFrom[1] ?? sampleFrom[0];
    // The two wrong answers of the example: the shortest other lines, so each option fits one line.
    const others = sampleFrom
      .filter((l) => l.pt !== sample?.pt)
      .sort((a, b) => a.pt.length - b.pt.length)
      .slice(0, 2);
    const cta = <Btn label={over ? 'Jogar de novo' : 'Começar'} onClick={() => void gStart()} icon="game" />;
    const record = (
      <div class="x-record">
        <Icon name="trophy" size={22} />
        <span>
          Recorde: <b>{best}</b> pontos
        </span>
      </div>
    );
    // Phones: the record and the button stay docked at the foot of the screen while the page scrolls.
    if (!desk) {
      dock = (
        <div class="x-dock">
          {record}
          {cta}
        </div>
      );
    }
    // How the points work, as three tiles side by side (the description says how a round goes).
    const rules = (
      <ul class="x-steps x-rules" aria-label="Pontuação">
        <li>
          <b>+10</b>
          <span>por tradução certa</span>
        </li>
        <li>
          <b>até x5</b>
          <span>com acertos seguidos</span>
        </li>
        <li>
          <b>x1</b>
          <span>errou: a sequência recomeça</span>
        </li>
      </ul>
    );
    const demo = (
      <div class="x-demo" aria-hidden="true">
        {/* What a round looks like: the round's own score line over the field. */}
        <div class="x-hud">
          <span class="pill x-dark x-tag">Exemplo</span>
          <span class="x-hudv">30 pts</span>
          <span class="pill or">x3</span>
          <span class="x-hudv x-time">42s</span>
        </div>
        <div class="quiz-field">
          {/* The line on its way down: where it came from (the trail) and where it is going (the ground). */}
          <div class="x-from" />
          {sample ? <div class="faller">{sample.en}</div> : null}
          <div class="x-trail">
            <Icon name="down" size={18} />
          </div>
          <div class="x-groundnote">Responda antes de a fala chegar ao chão</div>
          <div class="ground" />
        </div>
        {sample
          ? [others[0], sample, others[1]].map((l) =>
              l ? (
                <div key={l.pt} class={`x-opt${l === sample ? ' ok' : ''}`}>
                  {l.pt}
                  {l === sample ? <Icon name="check" size={18} /> : null}
                </div>
              ) : null,
            )
          : null}
      </div>
    );
    inner = (
      <div class="wrap x-des-wrap" style={{ '--wrap': '960px' }}>
        <div class="x-des-grid">
          <div class="x-des-copy">
            <div class="x-des-head">
              {over ? (
                <>
                  <span class="pill x-dark">
                    <Icon name="clock" size={14} /> Fim dos 60 segundos
                  </span>
                  <div class="h1" style={{ color: '#fff' }}>
                    Tempo esgotado.
                  </div>
                  <div class="h2" style={{ color: '#fff' }}>
                    {`${G.score} pontos · ${G.hits} acertos`}
                  </div>
                  {G.score >= best && G.score > 0 ? <span class="pill gold">Novo recorde</span> : null}
                </>
              ) : (
                <>
                  <span class="pill x-dark">
                    <Icon name="clock" size={14} /> 60 segundos
                  </span>
                  <div class="h1" style={{ color: '#fff' }}>
                    Desafio relâmpago
                  </div>
                  <p class="p">
                    As falas dos Extras caem na tela. Toque na tradução certa antes que a fala chegue ao chão.
                  </p>
                </>
              )}
              {G.only && onlyTitle ? <div class="xs">{`Só com as falas de ${onlyTitle}`}</div> : null}
            </div>
            {/* Phones: the example comes right after the description; the rules follow. */}
            {!desk && !over ? demo : null}
            {rules}
            {desk ? (
              <div class="x-des-foot">
                {record}
                {cta}
              </div>
            ) : null}
          </div>
          {over ? (
            <div class="card x-result">
              <div class="lbl">Sua rodada</div>
              <div class="big">{G.score}</div>
              <div class="sm">pontos</div>
              <div class="stats">
                <span class="pill gr">
                  <Icon name="check" size={14} /> {`${G.hits} acertos`}
                </span>
                <span class="pill x-dark">{`${G.miss} erros`}</span>
              </div>
            </div>
          ) : desk ? (
            demo
          ) : null}
        </div>
      </div>
    );
  } else {
    inner = (
      <div class="wrap stack" style={{ '--gap': '12px' }}>
        <div class="row between">
          <span class="h2" style={{ color: '#fff' }}>
            {`${G.score} pts`}
          </span>
          <span class="pill or">{`x${G.combo}`}</span>
          <span class="h2" style={{ color: '#FFD27A' }} id="g-left">
            {`${pad2(G.left)}s`}
          </span>
        </div>
        <div class="quiz-field">
          <div class="faller" id="g-fall" key={G.qn} ref={fall}>
            {G.q.en}
          </div>
          <div class="ground" />
        </div>
        <div class="stack" style={{ '--gap': '8px' }}>
          {G.opts.map((o, i) => (
            <button
              type="button"
              key={`${G.qn}-${i}`}
              class="btn light"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={act(() => gPick(i))}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <OnNavy cls={`x-des${G.state === 'play' ? ' x-round' : ''}`} w={960}>
      {/* The prototype's bar. Before and after a round it names where the back button goes (the page's
          big title names the game, so the two never repeat or contradict each other); during a round,
          with no big title on the page, it is the game's name. */}
      <Topbar back="extra" kicker={G.state === 'play' ? 'EXTRA' : undefined} title={G.state === 'play' ? 'Desafio relâmpago' : 'EXTRA'} />
      <div class="scroll">{inner}</div>
      {dock}
    </OnNavy>
  );
}
