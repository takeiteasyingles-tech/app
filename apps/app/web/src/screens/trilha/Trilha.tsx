// Trilha (#/trilha): port of TIE.screens.trilha in prototipo/js/screens/curso.js. The season header
// (progress "n de 20", synopsis, the 8 seasons in a <details>), then 10 e-book chapters × 2 episode
// nodes (done / now / locked, "Em produção" for unscripted episodes before the current one) and the
// "Extras e teste do e-book N" node after each chapter (e-book 1 opens once episodes 1 and 2 are done).
import type { Catalog } from '@tie/shared/content/schema';
import { type CurrentEpisode, current } from '@tie/shared/domain/guide';
import { levelInfo } from '@tie/shared/domain/personalize';
import type { TieState } from '@tie/shared/state';
import { Icon, Topbar } from '@tie/ui';
import { useState } from 'preact/hooks';
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
 * Locked rows read as "not yet" without going pale (the prototype's .55 left them low-contrast): a
 * compact row with no card fill (only a hairline edge on the cream page), a slate number and title,
 * still AA on cream (≈4.6:1). Their stop on the line is a small hollow dot, with no lock: one lock per
 * locked e-book sits in its chapter label (a lock on every row was repetitive noise).
 */
const LOCKED_STYLE = { opacity: '1', minHeight: '60px', padding: '5px 0 5px 44px' };
const SLATE = '#646D82';
const LOCKED_EP = { color: SLATE, fontSize: '1.15rem' };
const LOCKED_TITLE = { display: 'block', color: SLATE, fontWeight: '700', fontSize: '1rem' };
const LOCKED_BODY = { background: 'transparent', borderColor: '#DDD3B8', padding: '9px 14px' };
const LOCKED_DOT = { background: 'var(--cream)', borderColor: 'var(--line2)', color: SLATE };
/** The small hollow stop of a locked row (centred on the line, like the 26px dots). */
const LOCKED_STOP = { ...LOCKED_DOT, left: '10px', width: '14px', height: '14px', borderWidth: '3px' };

/**
 * The current episode's steps: ten even bars (tie.css's .sep gaps before steps 4 and 10 read as an
 * uneven gap in a row this short). Same .segs markup and colours.
 */
function EvenSegs({ cur, total }: { cur: number; total: number }) {
  const bars = [];
  for (let n = 1; n <= total; n++) bars.push(<i key={n} class={n < cur ? 'done' : n === cur ? 'now' : ''} />);
  return (
    <span class="segs" style={{ display: 'flex' }}>
      {bars}
    </span>
  );
}

/**
 * The season bar: one segment per episode (the prototype's plain bar was a bare track). Done episodes
 * are blue; the current one is an empty white segment with an orange ring ("you are here"), never
 * partly filled (a half-filled segment beside "0 de 20" read as a contradiction), so the bar counts
 * exactly what the line beside it says: episodes done.
 */
function SeasonBar({
  total,
  isDone,
  cur,
  curOpen,
  valuetext,
  desk,
}: {
  total: number;
  isDone: (n: number) => boolean;
  cur: number;
  curOpen: boolean;
  valuetext: string;
  desk: boolean;
}) {
  const segs = [];
  let doneN = 0;
  for (let n = 1; n <= total; n++) {
    const done = isDone(n);
    if (done) doneN++;
    const now = !done && n === cur && curOpen;
    segs.push(
      <span
        key={n}
        class={done ? 'done' : now ? 'now' : undefined}
        style={{
          flex: '1 1 0',
          minWidth: '0',
          height: desk ? '12px' : '10px',
          borderRadius: '999px',
          overflow: 'hidden',
          background: done ? 'var(--blue)' : now ? '#fff' : 'var(--line)',
          boxShadow: now ? 'inset 0 0 0 2px var(--orange)' : undefined,
        }}
      />,
    );
  }
  return (
    <div
      class="seasonbar"
      role="progressbar"
      aria-label="Progresso da temporada"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={doneN}
      aria-valuetext={valuetext}
      style={{ display: 'flex', gap: desk ? '4px' : '2px', width: '100%' }}
    >
      {segs}
    </div>
  );
}

/** The Extras star: a gold chip (filled when open), so the row has its own mark and not a thin outline. */
function StarChip({ open, small = false }: { open: boolean; small?: boolean }) {
  return (
    <span
      style={{
        width: small ? '30px' : '34px',
        height: small ? '30px' : '34px',
        borderRadius: '10px',
        background: 'var(--goldT)',
        color: open ? 'var(--gold)' : '#B88A1E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="star" size={18} extra={open ? { fill: 'currentColor' } : undefined} />
    </span>
  );
}

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
  // The current line, "Take the Mic · etapa 6 de 10", on one line. On a phone "Agora" moves up beside
  // the title so the line has the row's full width; on a very narrow screen it breaks before the "·".
  const subl = now
    ? cur.started
      ? [
          <span key="s" style={{ whiteSpace: 'nowrap' }}>
            {step?.name ?? ''}
          </span>,
          ' ',
          <span key="e" style={{ whiteSpace: 'nowrap' }}>
            {`· etapa ${cur.step} de ${c.steps.length || 10}`}
          </span>,
        ]
      : 'Comece por aqui'
    : done
      ? 'Concluído'
      : n < cur.num
        ? 'Em produção'
        : 'A seguir';
  // Locked: a small hollow stop on the line (the chapter label carries the e-book's one lock) and a
  // compact unfilled row; less faded than tie.css's .55.
  const body = (
    <>
      <span class="dot" style={open ? undefined : LOCKED_STOP}>
        {done ? <Icon name="check" size={12} /> : now ? <Icon name="play" size={10} /> : null}
      </span>
      <div class="body" style={open ? undefined : LOCKED_BODY}>
        <span class="ep" style={open ? undefined : LOCKED_EP}>
          {pad2(n)}
        </span>
        <span class="grow">
          {now && !desk ? (
            <span class="row between" style={{ '--gap': '8px' }}>
              <span class="h3" style={{ minWidth: '0' }}>
                {c.titles[n - 1] ?? ''}
              </span>
              <span class="pill or">Agora</span>
            </span>
          ) : (
            <span class="h3" style={open ? { display: 'block' } : LOCKED_TITLE}>
              {c.titles[n - 1] ?? ''}
            </span>
          )}
          <span class="sm" style={{ display: 'block' }}>
            {subl}
          </span>
          {now ? (
            <span class="mt8" style={{ display: 'block' }}>
              <EvenSegs cur={cur.step} total={c.steps.length || 10} />
            </span>
          ) : null}
        </span>
        {now && desk ? (
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
            <StarChip open />
          </span>
          <span class="grow">
            <span class="h3" style={{ display: 'block', fontSize: '1rem' }}>
              Extras e teste do <span style={{ whiteSpace: 'nowrap' }}>{`e-book ${e}`}</span>
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
      <span class="dot" style={LOCKED_STOP} />
      {/* The dashed edge in a sand tone that shows on the cream page (tie.css's --line barely did). */}
      <div class="body" style={{ ...LOCKED_BODY, borderColor: '#CFC4A6' }}>
        <span class="ep">
          <StarChip open={false} small />
        </span>
        <span class="grow">
          <span class="h3" style={{ ...LOCKED_TITLE, fontSize: '1rem' }}>
            Extras e teste do <span style={{ whiteSpace: 'nowrap' }}>{`e-book ${e}`}</span>
          </span>
          <span class="sm">{e === EBOOKS ? 'Mais o Season Check' : 'Liberam com os dois episódios'}</span>
        </span>
        {/* No row-end lock here: the dashed body and the lock in the dot say it, and the title keeps the room. */}
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
      : { ...LOCKED_STOP, left: '10px' };
  const small = !here && !all;
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
          border: small ? '3px solid' : '4px solid',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...dot,
        }}
      >
        {here ? <Icon name="play" size={10} /> : all ? <Icon name="check" size={12} /> : null}
      </span>
      <div
        class="row"
        style={{
          justifyContent: 'space-between',
          '--gap': '14px',
          padding: '12px 16px',
          borderRadius: '16px',
          // A column still to come has no card fill, like its locked rows.
          background: small ? 'transparent' : '#fff',
          border: `1.5px solid ${small ? '#DDD3B8' : 'var(--line)'}`,
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
          // Plain slate words with the lock, not a second pill: "Você está aqui" stays the one status
          // mark across the two heads.
          <span class="sm row" style={{ '--gap': '6px', color: SLATE, fontWeight: '700', whiteSpace: 'nowrap' }}>
            <Icon name="lock" size={14} />
            {`Abre depois do episódio ${pad2(from - 1)}`}
          </span>
        ) : (
          <span class="pill" style={{ padding: '6px 12px' }}>{`${doneIn} de ${n} concluídos`}</span>
        )}
      </div>
    </div>
  );
}

/** Phone: the folded e-books the learner opened (kept while the app is open). */
const unfolded = new Set<number>();

/**
 * A folded e-book on a phone: its label as a button (with a chevron) over its two episode titles, on
 * a soft card beside a locked stop of the line. Unfolded, it is the plain label with the chevron up.
 */
function FoldToggle({
  e,
  label,
  open,
  summary,
  onToggle,
}: {
  e: number;
  label: string;
  open: boolean;
  summary: readonly string[];
  onToggle: () => void;
}) {
  return (
    <>
      {open ? null : (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 'calc(50% + 6px)',
            transform: 'translateY(-50%)',
            borderRadius: '50%',
            border: '3px solid',
            ...LOCKED_STOP,
          }}
        />
      )}
      <button
        type="button"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={`trilha-eb${e}`}
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '100%',
          minHeight: '44px',
          textAlign: 'left',
          ...(open
            ? {}
            : {
                padding: '10px 12px 10px 14px',
                borderRadius: '14px',
                background: 'var(--cream)',
                border: '1.5px solid var(--line2)',
              }),
        }}
      >
        <span class="grow" style={{ minWidth: '0' }}>
          {open ? (
            <span class="lbl" style={{ display: 'block' }}>
              {label}
            </span>
          ) : (
            // Folded: the same short kicker on every e-book ("E-BOOK 4", with its lock), then one line
            // per episode in the locked rows' slate (the titles are the e-books' names too, so a
            // second title on the kicker only repeated the first episode).
            <span class="lbl row" style={{ '--gap': '6px', whiteSpace: 'nowrap' }}>
              <Icon name="lock" size={12} />
              {`E-book ${e}`}
            </span>
          )}
          {open
            ? null
            : summary.map((t) => (
                // One episode per line, so a title never breaks in the middle.
                <span
                  key={t}
                  class="sm"
                  style={{
                    display: 'block',
                    marginTop: '2px',
                    color: SLATE,
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t}
                </span>
              ))}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: '34px',
            height: '34px',
            flex: 'none',
            borderRadius: '50%',
            background: open ? '#fff' : 'var(--blueT)',
            border: open ? '1.5px solid var(--line2)' : '0',
            color: 'var(--blueD)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: open ? 'rotate(180deg)' : undefined,
          }}
        >
          <Icon name="down" size={18} extra={{ 'stroke-width': '2.6' }} />
        </span>
      </button>
    </>
  );
}

export default function Trilha(_props: ScreenProps) {
  useChrome({ title: 'Trilha' });
  const [, bump] = useState(0);
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

  // The bar counts episodes, one segment each; the current one is ringed (where the learner is).
  const stepsPer = c.steps.length || 10;
  const curOpen = !s.epsDone[cur.num] && cur.started;
  // No separate "Agora" strip under the bar: the current card right below says it (with its step bar).
  const countText = `${doneN} de ${total} episódios concluídos`;
  const bar = (
    <SeasonBar
      total={total}
      isDone={(n) => !!s.epsDone[n]}
      cur={cur.num}
      curOpen={curOpen}
      valuetext={curOpen ? `${countText}; episódio ${pad2(cur.num)} na etapa ${cur.step} de ${stepsPer}` : countText}
      desk={desk}
    />
  );
  const count = (
    <span class="sm" style={{ fontWeight: '800', color: 'var(--navy)' }}>
      {countText}
    </span>
  );

  // Desktop: two columns, each its own unbroken line (e-books 1-5, then 6-10). The second column's line
  // runs up through its first label too: it carries on from the foot of the first column.
  const perCol = desk ? Math.ceil(EBOOKS / 2) : EBOOKS;
  // Phone: the e-books after the next one start folded (label + their episode titles), so the trail is
  // not a 7000px scroll of locked rows; a tap unfolds one. Desktop shows all (two columns).
  const curBook = Math.ceil(cur.num / 2);
  const chapters = [];
  for (let e = 1; e <= EBOOKS; e++) {
    const eps = [e * 2 - 1, e * 2];
    // Desktop: every label is on a line (each column's line starts at its head).
    const lineIn = desk || e > 1;
    const lineOn = !!s.epsDone[(e - 1) * 2] || cur.num >= e * 2 - 1;
    const label = `E-book ${e} · ${chapterTitle(c, e, eps)}`;
    const foldable = !desk && e > curBook + 1 && eps.every((n) => !s.epsDone[n]);
    const isOpen = !foldable || unfolded.has(e);
    const chLocked = eps.every((n) => !s.epsDone[n] && n !== cur.num);
    const nodes = [
      ...eps.map((n) => <EpisodeNode key={`e${n}`} n={n} s={s} c={c} cur={cur} desk={desk} />),
      <ExtrasNode key="x" e={e} s={s} c={c} />,
    ];
    // The line colour of the chapter's last node, carried down by the desktop filler.
    const tailOn = !!s.epsDone[eps[0] ?? 0] && !!s.epsDone[eps[1] ?? 0] && e === HUB_EBOOK;
    chapters.push(
      <div key={`c${e}`} style={desk ? { display: 'flex', flexDirection: 'column', flex: '1' } : undefined}>
        <div class="chapter">
          {lineIn ? <ChapterLine on={lineOn} /> : null}
          {foldable ? (
            <FoldToggle
              e={e}
              label={label}
              open={isOpen}
              summary={eps.map((n) => `${pad2(n)} ${c.titles[n - 1] ?? ''}`)}
              onToggle={() => {
                if (unfolded.has(e)) unfolded.delete(e);
                else unfolded.add(e);
                bump((x) => x + 1);
              }}
            />
          ) : (
            // A locked e-book carries its one lock here (its rows have none).
            <div class="lbl" style={chLocked ? { display: 'flex', alignItems: 'center', gap: '6px' } : undefined}>
              {chLocked ? <Icon name="lock" size={13} /> : null}
              {label}
            </div>
          )}
        </div>
        {foldable ? (
          <div id={`trilha-eb${e}`} hidden={!isOpen}>
            {nodes}
          </div>
        ) : (
          nodes
        )}
        {/* Desktop rows line up across the two columns: the shorter cell's line runs on to the row's foot. */}
        {desk ? (
          <div aria-hidden="true" style={{ flex: '1', position: 'relative', minHeight: '0' }}>
            <ChapterLine on={tailOn} />
          </div>
        ) : null}
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
            {/* One metric: the bar and the line over it both count episodes. Desktop: a labelled
                head (label | count) over the bar. Phone: the count over the bar. */}
            {desk ? (
              <div class="row between base">
                <span class="lbl">Progresso da temporada</span>
                {count}
              </div>
            ) : (
              count
            )}
            {bar}
            <p class="p">{season?.synopsis ?? ''}</p>
            <details>
              <summary
                class="p"
                style={{
                  fontWeight: '800',
                  color: 'var(--blue)',
                  cursor: 'pointer',
                  padding: '4px 0',
                  width: 'fit-content',
                }}
              >
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
            // One grid row per pair of chapters (1|6, 2|7, …), so the two columns' rows and feet line up.
            <div class="trail" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '28px' }}>
              <div style={{ gridColumn: '1', gridRow: '1' }}>
                <ColHead from={1} to={perCol * 2} s={s} cur={cur} />
              </div>
              <div style={{ gridColumn: '2', gridRow: '1' }}>
                <ColHead from={perCol * 2 + 1} to={EBOOKS * 2} s={s} cur={cur} />
              </div>
              {chapters.map((ch, i) => (
                <div
                  key={`g${i}`}
                  style={{
                    gridColumn: i < perCol ? '1' : '2',
                    gridRow: String((i % perCol) + 2),
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {ch}
                </div>
              ))}
            </div>
          ) : (
            <div class="trail">{chapters}</div>
          )}
        </div>
      </div>
    </>
  );
}
