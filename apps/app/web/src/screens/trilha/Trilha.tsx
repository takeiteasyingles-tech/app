// Trilha (#/trilha): port of TIE.screens.trilha in prototipo/js/screens/curso.js. The season header
// (progress "n de 20", synopsis, the 8 seasons in a <details>), then 10 e-book chapters × 2 episode
// nodes (done / now / locked, "Em produção" for unscripted episodes before the current one) and the
// "Extras e teste do e-book N" node after each chapter (e-book 1 opens once episodes 1 and 2 are done).
import type { Catalog } from '@tie/shared/content/schema';
import { type CurrentEpisode, current } from '@tie/shared/domain/guide';
import { levelInfo } from '@tie/shared/domain/personalize';
import type { TieState } from '@tie/shared/state';
import { Icon, Segs, Topbar } from '@tie/ui';
import { type ScreenProps, useChrome } from '../../frame';
import { layoutOf } from '../../shell';
import { catalog, state } from '../../store';
import { UserAvatarBtn } from '../../ui-blocks';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The prototype's trail: 10 e-books of 2 episodes each. */
const EBOOKS = 10;
/** Only e-book 1 has a hub route (#/ebook/1), as in the prototype's ROUTES. */
const HUB_EBOOK = 1;
/**
 * Locked rows: not faded as a whole (tie.css's .55 left the titles low-contrast), but clearly not
 * tappable either: cream body without the white card, a muted title, the number in a soft navy (not
 * the orange of the open ones) and the lock in the trail dot (one lock per row, none at the row's end).
 */
const LOCKED_STYLE = { opacity: '1' };
/** The number of a locked row: the solid soft navy of the dot's icon (not a faded grey-blue). */
const LOCKED_EP = { color: 'var(--navy3)' };
const LOCKED_TITLE = { display: 'block', color: 'var(--muted)' };
const LOCKED_DOT = { background: 'var(--cream)', borderColor: 'var(--line2)', color: 'var(--navy3)' };

/** The e-book's title, or (e-books 4-10 have none yet) the title of its first episode, as 1-3 do. */
function chapterTitle(c: Catalog, e: number, eps: readonly number[]): string {
  const book = c.ebooks.find((b) => b.num === e);
  return book?.title || c.titles[(book?.episodes[0] ?? eps[0] ?? 1) - 1] || `Episódios ${eps.map(pad2).join(' e ')}`;
}

/** The trail line through a chapter label, so the trail reads as one line from e-book to e-book. */
function ChapterLine({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '15px',
        top: '0',
        bottom: '0',
        width: '4px',
        background: on ? 'var(--blue)' : 'var(--line)',
      }}
    />
  );
}

/** Season 1's CEFR label from the level list (A1), for the desktop heading. */
function seasonCefr(c: Catalog, season: number): string {
  return c.onboarding.levels.find((l) => l.season === season)?.cefr ?? 'A1';
}

function EpisodeNode({
  n,
  s,
  c,
  cur,
  desk,
}: {
  n: number;
  s: TieState;
  c: Catalog;
  cur: CurrentEpisode;
  desk: boolean;
}) {
  // Only what is done and the current episode open. Unscripted episodes before the current one are
  // "Em produção".
  const done = !!s.epsDone[n];
  const now = n === cur.num && !done;
  const open = done || now;
  const step = c.steps[cur.step - 1];
  // The current line: one line on desktop ("Take the Mic · etapa 6 de 10"); on a phone, where it
  // cannot fit beside "Agora", two clean lines (step, then "etapa 6 de 10"), never a dangling "·".
  const subl = now
    ? cur.started
      ? [
          <span key="s" style={{ whiteSpace: 'nowrap', display: desk ? undefined : 'block' }}>
            {step?.name ?? ''}
          </span>,
          <span key="d" style={desk ? undefined : { display: 'none' }}>
            {' · '}
          </span>,
          <span key="e" style={{ whiteSpace: 'nowrap', display: desk ? undefined : 'block' }}>
            {`etapa ${cur.step} de 10`}
          </span>,
        ]
      : 'Comece por aqui'
    : done
      ? 'Concluído'
      : n < cur.num
        ? 'Em produção'
        : 'A seguir';
  // Locked: the lock sits in the trail dot (more room for the title, and easier to see than the
  // prototype's faint icon at the row's end); the row is less faded than tie.css's .55.
  const body = (
    <>
      <span class="dot" style={open ? undefined : LOCKED_DOT}>
        {done ? <Icon name="check" size={12} /> : now ? <Icon name="play" size={10} /> : <Icon name="lock" size={13} />}
      </span>
      <div class="body">
        <span class="ep" style={open ? undefined : LOCKED_EP}>
          {pad2(n)}
        </span>
        <span class="grow">
          <span class="h3" style={open ? { display: 'block' } : LOCKED_TITLE}>
            {c.titles[n - 1] ?? ''}
          </span>
          <span class="sm">{subl}</span>
          {now ? (
            <span class="mt8" style={{ display: 'block' }}>
              <Segs cur={cur.step} reached={cur.step} total={c.steps.length} />
            </span>
          ) : null}
        </span>
        {now ? (
          <span class="pill or">Agora</span>
        ) : done ? (
          <span class="pill gold">+{c.game.points.episode ?? 40}</span>
        ) : null}
      </div>
    </>
  );
  const cls = `node ${done ? 'done' : now ? 'now' : 'locked'}`;
  return open ? (
    <a href={`#/episodio/${n}${done ? '/1' : ''}`} class={cls}>
      {body}
    </a>
  ) : (
    <div class={cls} style={LOCKED_STYLE}>
      {body}
    </div>
  );
}

function ExtrasNode({ e, s, c }: { e: number; s: TieState; c: Catalog }) {
  const eps = c.ebooks.find((b) => b.num === e)?.episodes ?? [e * 2 - 1, e * 2];
  const open = e === HUB_EBOOK && eps.length > 0 && eps.every((n) => s.epsDone[n]);
  if (open) {
    const k = String(e);
    return (
      <a href={`#/ebook/${e}`} class="node aside done">
        <span class="dot">
          <Icon name="check" size={12} />
        </span>
        <div class="body">
          <span class="ep">
            <Icon name="star" size={18} />
          </span>
          <span class="grow">
            <span class="h3" style={{ display: 'block', fontSize: '1rem' }}>
              {`Extras e teste do e-book ${e}`}
            </span>
            <span class="sm">
              {`Take Five · Take the Lead · Take it for Real · teste${
                s.testDone[k] ? ` · ${s.testScore[k] ?? 0}/20` : ''
              }`}
            </span>
          </span>
          <Icon name="next" size={18} />
        </div>
      </a>
    );
  }
  return (
    <div class="node aside locked" style={LOCKED_STYLE}>
      <span class="dot" style={LOCKED_DOT}>
        <Icon name="lock" size={13} />
      </span>
      <div class="body">
        <span class="ep" style={LOCKED_EP}>
          <Icon name="star" size={18} />
        </span>
        <span class="grow">
          <span class="h3" style={{ ...LOCKED_TITLE, fontSize: '1rem' }}>
            {`Extras e teste do e-book ${e}`}
          </span>
          <span class="sm">{e === EBOOKS ? 'Mais o Season Check' : 'Liberam com os dois episódios'}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Desktop column head: which episodes the column holds and where the learner stands in them, so each
 * of the two columns opens on an anchor (the second one has no current node of its own).
 */
function ColHead({ from, to, s, cur }: { from: number; to: number; s: TieState; cur: CurrentEpisode }) {
  const n = to - from + 1;
  let doneIn = 0;
  for (let i = from; i <= to; i++) if (s.epsDone[i]) doneIn++;
  const here = cur.num >= from && cur.num <= to && !s.epsDone[cur.num];
  const all = doneIn === n;
  const next = !here && doneIn === 0 && cur.num < from;
  const ebFrom = Math.ceil(from / 2);
  const ebTo = Math.ceil(to / 2);
  // A stop on the column's own line (its start), so neither column's line begins in mid-air: the
  // trail's dot geometry (.node .dot / .node::before), drawn here without .node so the head is not
  // counted as an episode.
  const dot = here
    ? { background: 'var(--orange)', borderColor: 'var(--orange)', color: '#fff' }
    : all
      ? { background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' }
      : LOCKED_DOT;
  return (
    <div style={{ position: 'relative', paddingLeft: '44px' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '15px',
          top: '50%',
          bottom: '0',
          width: '4px',
          background: here || doneIn ? 'var(--blue)' : 'var(--line)',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          border: '4px solid',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...dot,
        }}
      >
        {here ? <Icon name="play" size={10} /> : all ? <Icon name="check" size={12} /> : <Icon name="lock" size={13} />}
      </span>
      <div
        class="row"
        style={{
          justifyContent: 'space-between',
          '--gap': '14px',
          padding: '12px 16px',
          borderRadius: '16px',
          background: '#fff',
          border: '1.5px solid var(--line)',
        }}
      >
        <span style={{ minWidth: '0' }}>
          <span class="lbl" style={{ display: 'block', color: 'var(--navy)' }}>
            {`Episódios ${pad2(from)} a ${pad2(to)}`}
          </span>
          <span class="xs" style={{ display: 'block' }}>{`E-books ${ebFrom} a ${ebTo}`}</span>
        </span>
        {here ? (
          <span class="pill or" style={{ padding: '6px 12px' }}>
            Você está aqui
          </span>
        ) : all ? (
          <span class="pill gr" style={{ padding: '6px 12px' }}>
            Concluídos
          </span>
        ) : next ? (
          <span class="pill" style={{ padding: '6px 12px' }}>{`Depois do episódio ${pad2(from - 1)}`}</span>
        ) : (
          <span class="pill" style={{ padding: '6px 12px' }}>{`${doneIn} de ${n} concluídos`}</span>
        )}
      </div>
    </div>
  );
}

/** Pieces of a line that wrap only between them. */
const nw = (t: string) => <span style={{ whiteSpace: 'nowrap' }}>{t}</span>;

export default function Trilha(_props: ScreenProps) {
  useChrome({ title: 'Trilha' });
  const s = state.value;
  const c = catalog.value;
  if (!c) return null;
  const desk = layoutOf(s) === 'desktop';
  const published = c.episodes.filter((x) => x.status === 'published').map((x) => x.num);
  const cur = current(s, published.length ? published : [1]);
  const season = c.seasons[0];
  const seasonN = season?.n ?? 1;
  const seasonTitle = season?.title ?? 'Arrival';
  const total = c.episodes.filter((x) => (x.season ?? 1) === seasonN).length || 20;
  const doneN = Object.keys(s.epsDone).filter((k) => s.epsDone[k]).length;
  const lvl = s.profile ? levelInfo(c.onboarding.levels, s.profile) : null;

  // The bar counts steps, not only finished episodes: "etapa 6 de 10" of episode 1 already moves it
  // (the prototype's bar stayed empty at "0 de 20" while the trail said "etapa 6 de 10").
  const stepsPer = c.steps.length || 10;
  const curOpen = !s.epsDone[cur.num] && cur.started;
  const stepPart = curOpen ? Math.max(0, cur.step - 1) : 0;
  const pct = Math.min(100, Math.round(((doneN * stepsPer + stepPart) / (total * stepsPer)) * 100));
  const nowLine = curOpen ? (
    <a href={`#/episodio/${cur.num}`} class="sm" style={{ fontWeight: '800', color: 'var(--orange)' }}>
      {nw(`Agora: ${pad2(cur.num)} ${c.titles[cur.num - 1] ?? ''} ·`)} {nw(`etapa ${cur.step} de ${stepsPer}`)}
    </a>
  ) : null;
  // The percentage says what it counts ("das etapas"), so it never reads against "0 de 20 episódios".
  const pctLabel = (
    <span class="sm" style={{ fontWeight: '800', color: 'var(--navy)', whiteSpace: 'nowrap' }}>
      {`${pct}% das etapas`}
    </span>
  );
  const bar = (
    <div
      class="bar grow"
      role="progressbar"
      aria-label="Progresso da temporada"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}% das etapas`}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
  const count = <span class="sm">{`${doneN} de ${total} episódios concluídos`}</span>;

  // Desktop: two columns, each its own unbroken line (e-books 1-5, then 6-10). The second column's line
  // runs up through its first label too: it carries on from the foot of the first column.
  const perCol = desk ? Math.ceil(EBOOKS / 2) : EBOOKS;
  const chapters = [];
  for (let e = 1; e <= EBOOKS; e++) {
    const eps = [e * 2 - 1, e * 2];
    // Desktop: every label is on a line (each column's line starts at its head).
    const lineIn = desk || e > 1;
    chapters.push(
      <div key={`c${e}`}>
        <div class="chapter">
          {lineIn ? <ChapterLine on={!!s.epsDone[(e - 1) * 2] || cur.num >= e * 2 - 1} /> : null}
          <div class="lbl">{`E-book ${e} · ${chapterTitle(c, e, eps)}`}</div>
        </div>
        {eps.map((n) => (
          <EpisodeNode key={`e${n}`} n={n} s={s} c={c} cur={cur} desk={desk} />
        ))}
        <ExtrasNode e={e} s={s} c={c} />
      </div>,
    );
  }

  return (
    <>
      {desk ? null : (
        <Topbar kicker={`Temporada ${seasonN} · ${lvl?.cefr ?? 'A1'}`} title={seasonTitle} right={<UserAvatarBtn />} />
      )}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': desk ? '1040px' : '760px', '--gap': '14px' }}>
          {desk ? (
            <div>
              <div class="lbl">{`Temporada ${seasonN} · ${seasonCefr(c, seasonN)} · ${total} episódios`}</div>
              <h1 class="h1 mt4">{seasonTitle}</h1>
            </div>
          ) : null}
          <div class="card stack" style={{ '--gap': '10px' }}>
            {/* The bar and its label say the same thing (a share of the season's steps); the
                finished-episode count and the current episode have their own line under it.
                Desktop: a labelled head over the bar, count and "Agora" on one line. Phone: the
                prototype's compact row (bar + figure), then the count and "Agora". */}
            {desk ? (
              <>
                <div class="row between base">
                  <span class="lbl">Progresso da temporada</span>
                  {pctLabel}
                </div>
                <div class="row">{bar}</div>
                <div class="row between wrapx" style={{ '--gap': '4px 16px' }}>
                  {count}
                  {nowLine}
                </div>
              </>
            ) : (
              <>
                <div class="row" style={{ '--gap': '10px' }}>
                  {bar}
                  {pctLabel}
                </div>
                <div class="stack" style={{ '--gap': '2px' }}>
                  {count}
                  {nowLine}
                </div>
              </>
            )}
            <p class="p">{season?.synopsis ?? ''}</p>
            <details>
              <summary class="sm" style={{ fontWeight: '800', color: 'var(--blue)', cursor: 'pointer' }}>
                {`Ver as ${c.seasons.length} temporadas`}
              </summary>
              <div class="chips mt8">
                {c.seasons.map((x, i) => (
                  <span key={x.n} class={`pill${i === 0 ? ' navy' : ''}`}>
                    <b>{x.n}</b>
                    {` ${x.title}`}
                  </span>
                ))}
              </div>
            </details>
          </div>
          {/* Desktop: the chapters in two columns (the single 700px column left most of the main empty). */}
          {desk ? (
            <div class="trail" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '28px' }}>
              <div>
                <ColHead from={1} to={perCol * 2} s={s} cur={cur} />
                {chapters.slice(0, perCol)}
              </div>
              <div>
                <ColHead from={perCol * 2 + 1} to={EBOOKS * 2} s={s} cur={cur} />
                {chapters.slice(perCol)}
              </div>
            </div>
          ) : (
            <div class="trail">{chapters}</div>
          )}
        </div>
      </div>
    </>
  );
}
