// Conquistas (prototipo/js/screens/conta.js, TIE.screens.conquistas): level card, gamebar, today's
// missions, the medals and the "Como ganhar pontos" table. Points, medals and missions come from the
// server-backed store; the table reads the catalog's point values (same numbers as the prototype).
import type { Catalog, PointKind } from '@tie/shared/content/schema';
import { POINTS } from '@tie/shared/domain/game';
import { Icon, Missions, Topbar } from '@tie/ui';
import { type ScreenProps, useChrome } from '../../frame';
import { levels, state } from '../../store';
import { LiveGamebar, LiveLevelPill } from '../../ui-blocks/chrome';
import { isDesktop, summary, WithCatalog } from '../inicio/today';

/** The prototype's static table: [label, point kind]. */
const EARN: readonly (readonly [string, PointKind])[] = [
  ['Etapa do episódio', 'step'],
  ['Episódio inteiro', 'episode'],
  ['Exercício certo', 'ex_right'],
  ['Pronúncia nota 8+', 'mic_good'],
  ['Fala no Mic', 'maggie_turn'],
  ['Conversa inteira', 'maggie_session'],
  ['Extra até o fim', 'extra'],
  ['Cartão revisado', 'card'],
  ['Missão do dia', 'mission'],
  ['Teste do e-book', 'test_pass'],
];

const BALANCE = { 'text-wrap': 'balance' } as const;

/**
 * Desktop medal: the prototype's tile (disc over title over description) in a fixed 7 × 2 grid, the
 * state mark in the tile's top-right corner (clear of the disc and the title).
 * Phone medal: one row per medal in a single card (disc, title over description, the state mark at the
 * row's end), so every row has the same height and nothing wraps in a cramped column (the prototype's
 * three narrow columns wrapped badly and left ragged rows).
 */
const MEDAL_DESK = { position: 'relative', padding: '16px 10px 14px', justifyContent: 'flex-start' } as const;
const MEDAL_PHONE = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '40px minmax(0, 1fr)',
  gridTemplateRows: 'auto auto',
  columnGap: '12px',
  rowGap: '1px',
  alignItems: 'center',
  padding: '9px 34px 9px 0',
  textAlign: 'left',
  background: 'transparent',
  border: '0',
  borderRadius: '0',
} as const;
/** Phone: the disc spans the title and the description. */
const IC_PHONE = { width: '40px', height: '40px', gridRow: '1 / span 2' } as const;
const ROW_RULE = { borderTop: '1.5px solid var(--line)' } as const;
/**
 * Locked medals: the prototype faded the whole tile to 50%, which left grey-on-cream text hard to
 * read. Here the text stays legible but quieter than an earned medal's (slate title, muted
 * description), and the state shows in the medal itself: no fill on a quiet solid edge (desktop), a
 * plain grey disc with a slate icon, and a padlock.
 */
const LOCKED_DESK = {
  opacity: '1',
  background: 'transparent',
  border: '1.5px solid var(--line)',
} as const;
/**
 * Phone: the locked medals sit together on a cream panel (a separate element behind the group's rows;
 * the rows themselves stay unfilled, with white rules between them), each with an outlined white
 * disc, so the "still to earn" group reads apart from the earned rows above at a glance.
 */
const LOCKED_PHONE = { opacity: '1', padding: '9px 40px 9px 12px' } as const;
const LOCKED_RULE = { borderTop: '1.5px solid #fff' } as const;
const LOCKED_IC = { background: '#ECE6D6', color: '#56607A' } as const;
const LOCKED_IC_PHONE = { background: '#fff', color: '#56607A', boxShadow: 'inset 0 0 0 1.5px var(--line2)' } as const;
/** The state mark: a green check (earned) or a padlock (locked), in the tile's corner / row's end. */
const MARK_BASE = {
  position: 'absolute',
  width: '22px',
  height: '22px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;
const HAS_MARK = { ...MARK_BASE, background: 'var(--green)', color: '#fff' } as const;
/** The padlock on a filled sand disc, the same size as the green check, so both marks read alike. */
const LOCK_MARK = { ...MARK_BASE, background: '#E3DCC8', color: '#3F4A63' } as const;
const MARK_DESK = { top: '8px', right: '8px' } as const;
const MARK_PHONE = { top: '50%', right: '2px', transform: 'translateY(-50%)' } as const;
const MARK_PHONE_LOCKED = { top: '50%', right: '12px', transform: 'translateY(-50%)', background: '#fff' } as const;
/** Brand names stay whole ("episode test" never splits); same text content. */
function brandTerms(text: string) {
  return text.split(/(episode test)/).map((part, i) =>
    i % 2 ? (
      <span key={i} style={{ whiteSpace: 'nowrap' }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * Phone: a group's heading inside the medal list ("Conquistadas · 7", "Para conquistar · 7"). Placed
 * on its grid row; hidden from assistive tech (each medal's own label says whether it is earned).
 */
function GroupHead({ row, locked, text }: { row: number; locked: boolean; text: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        gridColumn: '1 / -1',
        gridRow: String(row),
        padding: locked ? '16px 0 8px' : '6px 0 4px',
        fontSize: '.8rem',
        fontWeight: 800,
        color: locked ? 'var(--muted)' : 'var(--green)',
      }}
    >
      {text}
    </div>
  );
}

/**
 * Desktop: five levels around the current one on a track (done levels filled orange with a check, the
 * current one ringed, the next ones outlined), each with its name and the points it starts at.
 */
function LevelLadder({ current, list }: { current: number; list: readonly (readonly [number, string])[] }) {
  const size = Math.min(5, list.length);
  if (size < 2) return null;
  const start = Math.max(0, Math.min(current - 3, list.length - size));
  const shown = list.slice(start, start + size);
  // The track's filled part runs to the current level's node (half a column per node edge).
  const curPos = Math.max(0, Math.min(size - 1, current - 1 - start));
  const half = 50 / size;
  const done = (curPos / (size - 1)) * (100 - 2 * half);
  return (
    <div
      class="stack"
      style={{
        '--gap': '12px',
        paddingTop: '18px',
        borderTop: '1.5px solid rgba(255,255,255,.12)',
      }}
    >
      <div class="lbl" style={{ color: 'var(--onNavy)' }}>
        Trilha de níveis
      </div>
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '16.5px',
            left: `${half}%`,
            right: `${half}%`,
            height: '3px',
            borderRadius: '2px',
            background: 'rgba(255,255,255,.18)',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '16.5px',
            left: `${half}%`,
            width: `${done}%`,
            height: '3px',
            borderRadius: '2px',
            background: 'var(--orange)',
          }}
        />
        {shown.map(([min, name], i) => {
          const n = start + i + 1;
          const st = n < current ? 'done' : n === current ? 'now' : 'ahead';
          return (
            <div
              key={n}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '7px',
              }}
              aria-label={`Nível ${n} · ${name} · ${min} pontos${st === 'now' ? ' · seu nível' : ''}`}
              role="img"
            >
              <span
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '.95rem',
                  background: st === 'done' ? 'var(--orange)' : st === 'now' ? '#fff' : 'var(--navy)',
                  color: st === 'done' ? '#fff' : st === 'now' ? 'var(--navy)' : 'var(--onNavy)',
                  boxShadow:
                    st === 'now'
                      ? '0 0 0 3px var(--orange)'
                      : st === 'ahead'
                        ? 'inset 0 0 0 2px rgba(255,255,255,.35)'
                        : undefined,
                }}
              >
                {st === 'done' ? <Icon name="check" size={17} /> : n}
              </span>
              <span
                style={{
                  fontSize: '.875rem',
                  fontWeight: 800,
                  lineHeight: '1.2',
                  textAlign: 'center',
                  color: st === 'now' ? '#fff' : 'var(--onNavy)',
                }}
              >
                {name}
              </span>
              <span style={{ fontSize: '.78rem', lineHeight: '1', color: st === 'now' ? '#FFB08F' : '#93A3C2' }}>
                {`${min} pontos`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Conquistas(_props: ScreenProps) {
  const desk = isDesktop();
  // Phone: Conquistas is a pushed screen (it opens from the gamebar and its back arrow returns), and
  // the tab bar has no Conquistas tab: the prototype showed the bar with no tab lit, and lighting Hoje
  // said "you are on Hoje". Like any pushed screen it hides the tab bar; the back arrow leads out.
  // Desktop keeps the side nav's own Conquistas entry.
  useChrome(desk ? {} : { tabs: false });
  return (
    <>
      {desk ? null : <Topbar back="inicio" kicker="Sua caminhada" title="Conquistas" />}
      <WithCatalog>{(c) => <Body c={c} desk={desk} />}</WithCatalog>
    </>
  );
}

function Body({ c, desk }: { c: Catalog; desk: boolean }) {
  const g = summary(state.value, c);
  const l = g.level;
  const nextName = levels.value[l.n]?.[1];
  const pts = (k: PointKind) => c.game?.points?.[k] ?? POINTS[k];
  // Fixed columns on a grid of twice as many tracks (each medal spans 2). The column count divides
  // the 14 medals (7 on desktop: two full rows; one per row on a phone), so no row is short; should
  // the catalog's count not divide, the short last row keeps the medals' width and is centred.
  const cols = desk ? 7 : 1;
  const tracks = cols * 2;
  const rest = g.badges.length % cols;
  const lastRow = g.badges.length - rest;
  const offset = (tracks - rest * 2) / 2;
  const span = (i: number) =>
    rest && i >= lastRow && Number.isInteger(offset) ? `${offset + 1 + (i - lastRow) * 2} / span 2` : 'span 2';

  const progress = (
    <>
      <div class="bar" style={desk ? { height: '12px' } : undefined}>
        <i style={{ width: `${l.pct}%`, background: 'var(--orange)' }} />
      </div>
      <div class="xs" style={desk ? { color: 'var(--onNavy)', fontSize: '.9rem' } : { color: 'var(--onNavy)' }}>
        {l.next !== null && nextName
          ? `Faltam ${l.next - g.points} pontos para o nível ${l.n + 1} · ${nextName}`
          : 'Nível máximo alcançado.'}
      </div>
    </>
  );
  // Desktop: the level card is as tall as the gamebar and missions beside it, and uses that room for
  // the level ladder (the levels around the current one and the points each starts at).
  const levelCard = (
    // Desktop: the three blocks (level and points, progress, ladder) spread over the card's height, so
    // any room the right column leaves is shared between them instead of one empty navy band.
    <div
      class="card navy stack"
      style={desk ? { '--gap': '18px', padding: '22px 24px', justifyContent: 'space-between' } : { '--gap': '12px' }}
    >
      <div class="row between">
        <LiveLevelPill />
        <span
          class="h2"
          style={desk ? { color: '#fff', fontSize: '1.9rem' } : { color: '#fff' }}
        >{`${g.points} pontos`}</span>
      </div>
      {desk ? (
        <div class="stack" style={{ '--gap': '10px' }}>
          {progress}
        </div>
      ) : (
        progress
      )}
      {desk ? <LevelLadder current={l.n} list={levels.value} /> : null}
    </div>
  );
  const missions = (
    <div class="card stack" style={desk ? { '--gap': '8px', flex: '1 1 auto' } : { '--gap': '8px' }}>
      <div class="row between">
        <div class="lbl">Missões do dia</div>
        <span class="xs">{`${g.missions.filter((m) => m.done).length}/${g.missions.length}`}</span>
      </div>
      <Missions list={g.missions} />
    </div>
  );

  // Phone: the medal rows in one card, like the missions above (label inside, rows ruled), grouped
  // into earned and still locked. The grouping is visual (CSS order), so the medals keep the
  // catalog's order in the DOM; each medal's label already says whether it is earned.
  const earned = g.badges.filter((b) => b.has).length;
  const firstOfGroup = new Set([g.badges.findIndex((b) => b.has), g.badges.findIndex((b) => !b.has)]);
  // Phone: explicit grid rows (earned heading, earned medals, locked heading, locked medals), so the
  // locked group's panel can span exactly its rows.
  const lockedN = g.badges.length - g.badges.filter((b) => b.has).length;
  const rowOf: number[] = [];
  const earnedHead = lockedN < g.badges.length ? 1 : 0;
  let r = earnedHead + 1;
  g.badges.forEach((b, i) => {
    if (b.has) rowOf[i] = r++;
  });
  const lockedHead = lockedN ? r++ : 0;
  const panelStart = r;
  g.badges.forEach((b, i) => {
    if (!b.has) rowOf[i] = r++;
  });
  const medals = (
    <div
      class={desk ? 'stack' : 'card stack'}
      style={desk ? { '--gap': '8px' } : { '--gap': '4px', paddingBottom: '6px' }}
    >
      <div class="lbl">{`Medalhas · ${g.badges.filter((b) => b.has).length} de ${g.badges.length}`}</div>
      {/* Fixed columns and equal row heights, so the grid never looks ragged. */}
      <div
        class="badges"
        style={{
          gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))`,
          gridAutoRows: desk ? '1fr' : 'auto',
          gap: desk ? '10px' : '0',
        }}
      >
        {!desk && earnedHead ? <GroupHead row={earnedHead} locked={false} text={`Conquistadas · ${earned}`} /> : null}
        {!desk && lockedHead ? <GroupHead row={lockedHead} locked text={`Para conquistar · ${lockedN}`} /> : null}
        {/* Phone: the locked group's cream panel, behind its rows (decorative). */}
        {!desk && lockedN ? (
          <div
            aria-hidden="true"
            style={{
              gridColumn: '1 / -1',
              gridRow: `${panelStart} / span ${lockedN}`,
              background: 'var(--cream)',
              borderRadius: '12px',
            }}
          />
        ) : null}
        {g.badges.map((b, i) => (
          // The state is spoken too (the check and padlock are decorative): "…, conquistada".
          <div
            key={b.id}
            class={`medal${b.has ? '' : ' locked'}`}
            role="img"
            aria-label={`${b.t}: ${b.s}. ${b.has ? 'Conquistada' : 'Bloqueada'}.`}
            style={{
              ...(desk ? MEDAL_DESK : MEDAL_PHONE),
              ...(!desk && !firstOfGroup.has(i) ? (b.has ? ROW_RULE : LOCKED_RULE) : {}),
              ...(b.has ? {} : desk ? LOCKED_DESK : LOCKED_PHONE),
              // Phone: a definite full-width column, so a locked row may sit over its group's panel
              // (auto placement would push it beside the panel instead).
              gridColumn: desk ? span(i) : '1 / -1',
              // Phone: earned medals first, then the locked ones (DOM order stays the catalog's).
              gridRow: desk ? undefined : String(rowOf[i]),
            }}
          >
            <span
              class="ic"
              style={{
                flex: 'none',
                ...(desk ? {} : IC_PHONE),
                ...(b.has ? {} : desk ? LOCKED_IC : LOCKED_IC_PHONE),
              }}
            >
              <Icon name={b.icon} size={desk ? 24 : 20} />
              <span
                style={{
                  ...(b.has ? HAS_MARK : LOCK_MARK),
                  ...(desk ? MARK_DESK : b.has ? MARK_PHONE : MARK_PHONE_LOCKED),
                }}
                aria-hidden="true"
              >
                <Icon name={b.has ? 'check' : 'lock'} size={13} />
              </span>
            </span>
            <b
              style={{
                ...(desk ? BALANCE : {}),
                fontSize: desk ? '.9rem' : '.95rem',
                fontWeight: 800,
                color: b.has ? 'var(--navy)' : 'var(--navy3)',
                lineHeight: '1.25',
                alignSelf: desk ? undefined : 'end',
              }}
            >
              {b.t}
            </b>
            <span
              class="xs"
              style={{
                ...(desk ? BALANCE : {}),
                fontSize: desk ? '.84rem' : '.84rem',
                lineHeight: '1.35',
                color: 'var(--muted)',
                alignSelf: desk ? undefined : 'start',
              }}
            >
              {brandTerms(b.s)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  // Desktop: five compact tiles per row, each with its points right under its label (one glance per
  // item; the prototype's full-width rows put the points a whole page away from their labels).
  const earn = (
    <div class="card soft" style={{ background: '#fff', borderColor: 'var(--line)' }}>
      <div class="lbl">Como ganhar pontos</div>
      {desk ? (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px', marginTop: '12px' }}
        >
          {EARN.map(([t, k]) => (
            <div
              key={k}
              class="stack"
              style={{
                '--gap': '4px',
                alignItems: 'center',
                textAlign: 'center',
                padding: '9px 8px',
                borderRadius: '12px',
                background: 'var(--cream)',
              }}
            >
              <span
                class="p"
                style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--navy)', lineHeight: '1.3', minWidth: '0' }}
              >
                {t}
              </span>
              <span class="pill gold" style={{ fontSize: '.8rem', padding: '2px 9px' }}>{`+${pts(k)}`}</span>
            </div>
          ))}
        </div>
      ) : (
        // Phone: two columns of small cream tiles (label, then its points at the tile's end) instead of
        // the prototype's flat list of text rows.
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '12px' }}
        >
          {EARN.map(([t, k]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                minHeight: '52px',
                padding: '8px 10px 8px 12px',
                borderRadius: '12px',
                background: 'var(--cream)',
              }}
            >
              <span
                style={{
                  fontSize: '.875rem',
                  fontWeight: 700,
                  color: 'var(--navy)',
                  lineHeight: '1.25',
                  minWidth: '0',
                  'text-wrap': 'balance',
                }}
              >
                {t}
              </span>
              <span class="pill gold" style={{ flex: 'none', fontSize: '.8rem', padding: '2px 8px' }}>
                {`+${pts(k)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div class="scroll">
      <div class="wrap stack" style={{ '--wrap': desk ? '1120px' : '760px', '--gap': '16px' }}>
        {desk ? (
          <>
            <div>
              <div class="lbl">Sua caminhada</div>
              <h1 class="h1 mt4">Conquistas</h1>
            </div>
            {/* The level card beside the gamebar and today's missions (the missions' short rows do
                not run across the whole page); both sides are the same height. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
                gap: '16px',
                alignItems: 'stretch',
              }}
            >
              {levelCard}
              <div class="stack" style={{ '--gap': '16px' }}>
                <LiveGamebar />
                {missions}
              </div>
            </div>
          </>
        ) : (
          <>
            {levelCard}
            <LiveGamebar />
            {missions}
          </>
        )}
        {medals}
        {earn}
      </div>
    </div>
  );
}
