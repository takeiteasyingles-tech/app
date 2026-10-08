// Hoje (prototipo/js/screens/inicio.js): the course first (the current episode's next step), then
// today's plan, missions, EXTRA picks, the Mic mission, the week's focus and the weekly rhythm.
// Same markup and classes as the prototype; the numbers come from the server-backed store.
import type { Catalog } from '@tie/shared/content/schema';
import { getAssistant } from '@tie/shared/domain/assist';
import { current, plan } from '@tie/shared/domain/guide';
import { buildPersonalization, hour, reminders } from '@tie/shared/domain/personalize';
import type { Profile, TieState } from '@tie/shared/state';
import { AssistThumb, activator, Btn, type CoverItem, Icon, Logo, Missions, Ring } from '@tie/ui';
import type { ScreenProps } from '../../frame';
import { catalogImage, dueNow, state } from '../../store';
import { AiBadge, LiveGamebar, LiveLevelPill, UserAvatarBtn } from '../../ui-blocks/chrome';
import { isDesktop, publishedEpisodes, summary, todayKey, WithCatalog } from './today';

const pad2 = (n: number) => String(n).padStart(2, '0');

// Layout refinements on top of the prototype's classes (inline, so tie.css stays verbatim).
const TWO_LINES = {
  display: '-webkit-box',
  '-webkit-box-orient': 'vertical',
  '-webkit-line-clamp': '2',
  overflow: 'hidden',
} as const;
const BALANCE = { 'text-wrap': 'balance' } as const;
/**
 * Plan rows: the title wraps (never cut) with a tight leading; the detail keeps at most two lines.
 * The detail uses the full width and wraps "pretty" (no lone last word, but no narrow balanced
 * block either); the title keeps its last two words together.
 */
const TASK_T = { ...TWO_LINES, fontSize: '1rem', lineHeight: '1.3' } as const;
const TASK_SUB = { ...TWO_LINES, 'text-wrap': 'pretty', lineHeight: '1.35', marginTop: '2px' } as const;
/** Desktop: a size up for the row's title and detail (the phone's 13px read small on a wide card). */
const TASK_T_DESK = { fontSize: '1.05rem' } as const;
const TASK_SUB_DESK = { fontSize: '.875rem', marginTop: '3px' } as const;
/**
 * Phone: the row's kind ("Maggie", "EXTRA", "Episódio 1") as a small eyebrow over the title, so a long
 * title never breaks after "Maggie ·". Same text content: the " · " stays in the DOM, not drawn.
 */
const TASK_KIND = {
  display: 'block',
  fontSize: '.72rem',
  fontWeight: 800,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  lineHeight: '1.3',
  marginBottom: '2px',
} as const;
const HIDDEN_SEP = { display: 'none' } as const;
/** "Kind · Title" → [kind, title]; null when the title has no kind. */
const splitKind = (t: string): readonly [string, string] | null => {
  const i = t.indexOf(' · ');
  return i > 0 ? [t.slice(0, i), t.slice(i + 3)] : null;
};
/**
 * A done row reads as done, like a done mission: title struck through, detail and time muted
 * (tie.css greys only the title, which left the dark time and read as a disabled row).
 */
const DONE_T = { color: 'var(--muted)', textDecoration: 'line-through', textDecorationThickness: '1.5px' } as const;
/** A done row's kind ("Episódio 1 · "): muted, a weight lighter, never struck. */
const DONE_KIND = { color: 'var(--muted)', fontWeight: 700 } as const;

/**
 * Text whose hyphenated words never break at the hyphen ("check-/in"): balanced wrapping would
 * otherwise pick that break. Same text content; the hyphenated words are wrapped in no-wrap spans.
 */
function keepHyphens(text: string) {
  return text.split(/(\S*\S-\S\S*)/).map((part, i) =>
    i % 2 ? (
      <span key={i} style={{ whiteSpace: 'nowrap' }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** A title whose last two words wrap together (same text content), and no break at a hyphen. */
function noOrphan(text: string) {
  const cut = text.lastIndexOf(' ', text.lastIndexOf(' ') - 1);
  if (cut <= 0) return keepHyphens(text);
  return (
    <>
      {keepHyphens(text.slice(0, cut + 1))}
      <span style={{ whiteSpace: 'nowrap' }}>{text.slice(cut + 1)}</span>
    </>
  );
}

/**
 * The cover's "why" always on two lines: the reason's lead ("Porque você curte") then what it is
 * about ("animes e música e bandas"), so every poster's caption ends on the same line and the shelf's
 * rows stay level (the prototype let each caption wrap wherever it fell). Same words as the domain's
 * sentence; only the break is chosen.
 */
const WHY_SPLIT = /^(Porque você \S+|Tem a ver com|No seu nível,|Para \S+)\s+(.+)$/;
const WHY_LINE = { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
/** The reason a touch larger than tie.css's .78rem, with a little more leading (read small on the shelf). */
const WHY_SIZE = { fontSize: '.8125rem', lineHeight: '1.35', marginTop: '3px' } as const;

/**
 * Desktop: the same cover as a wide card (poster on the left, title, kind and the whole reason on the
 * right), three to a row. Six posters in one row were narrow and every reason wrapped; here the reason
 * reads as a sentence. Same markup order and text content as C.cover.
 */
const WIDE_COVER = {
  display: 'grid',
  /** A poster big enough to carry the card (a small one left a white band beside a short reason). */
  gridTemplateColumns: '124px minmax(0, 1fr)',
  alignItems: 'center',
  columnGap: '16px',
  padding: '12px 14px 12px 12px',
  background: '#fff',
  border: '1.5px solid var(--line)',
  borderRadius: '18px',
  height: '100%',
  /** Two of the shelf's six tracks: three cards to a row. */
  gridColumn: 'span 2',
} as const;
const WIDE_TTL = { marginTop: '0', fontSize: '1.15rem', ...TWO_LINES } as const;
/** The reason fills its lines (no "pretty" wrap, which pulled a word down and left a ragged gap). */
const WIDE_WHY = { fontSize: '.875rem', lineHeight: '1.4', marginTop: '8px' } as const;

function WideCover({ x }: { x: CoverItem }) {
  return (
    <button
      type="button"
      class="cover"
      aria-label={x.title}
      onClick={activator(`extra/${x.id}`, undefined)}
      style={WIDE_COVER}
    >
      <div class="art">
        <img src={x.cover ?? ''} alt="" loading="lazy" />
        <span class="pill lvl lv">{x.level}</span>
      </div>
      <div style={{ minWidth: '0' }}>
        <div class="ttl" style={WIDE_TTL} title={x.title}>
          {x.title}
        </div>
        <div class="xs" style={{ marginTop: '3px', fontSize: '.875rem' }}>
          {x.kind}
        </div>
        {x.why ? (
          <div class="why" style={WIDE_WHY}>
            {x.why}
          </div>
        ) : null}
      </div>
    </button>
  );
}

/** C.cover (same markup and classes as @tie/ui's Cover) with the two-line reason. */
function PickCover({ x }: { x: CoverItem }) {
  const m = x.why ? WHY_SPLIT.exec(x.why) : null;
  return (
    <button type="button" class="cover" aria-label={x.title} onClick={activator(`extra/${x.id}`, undefined)}>
      <div class="art">
        <img src={x.cover ?? ''} alt="" loading="lazy" />
        <span class="pill lvl lv">{x.level}</span>
      </div>
      <div class="ttl" style={WHY_LINE} title={x.title}>
        {x.title}
      </div>
      <div class="xs" style={WHY_LINE}>
        {x.kind}
      </div>
      {x.why ? (
        <div class="why" title={x.why} style={WHY_SIZE}>
          {m ? (
            <>
              <span style={WHY_LINE}>{m[1]}</span>
              <span style={WHY_LINE}>{` ${m[2]}`}</span>
            </>
          ) : (
            <span style={{ display: 'block', minHeight: '2.6em' }}>{x.why}</span>
          )}
        </div>
      ) : null}
    </button>
  );
}

/**
 * The plan's Extra row says "· 9 min" (the video's length) in its detail while the row's own budget
 * is 8 min; the detail drops the video length so the row shows one duration.
 */
const taskSub = (k: string, sub: string) => (k === 'extra' ? sub.replace(/ · \d+ min$/, '') : sub);

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export default function Inicio(_props: ScreenProps) {
  return <WithCatalog>{(c) => <Hoje c={c} />}</WithCatalog>;
}

function Hoje({ c }: { c: Catalog }) {
  const s = state.value;
  const p = s.profile;
  if (!p) return null;
  const desk = isDesktop(s);
  const t = todayKey(s);
  const P = buildPersonalization(p, c);
  const g = summary(s, c);
  const eps = publishedEpisodes(c);
  const homeImg = catalogImage('bg/home') ?? null;
  const pl = plan({
    state: { ...s, due: dueNow.value, profile: p },
    content: { ...c, episodes: eps },
    today: t,
    epImg: homeImg,
  });

  const hello = (
    <div class="row between top">
      <div>
        <h1 class="h1">{`Oi, ${p.name}.`}</h1>
        <div class="row mt8 wrapx" style={{ '--gap': '8px' }}>
          <LiveLevelPill />
          <span class="sm">{`Temporada ${P.level.season} · ${P.level.cefr}`}</span>
        </div>
      </div>
      <UserAvatarBtn />
    </div>
  );

  const course = (
    <CourseCard s={s} c={c} eps={eps} epDone={!!pl.tasks.find((x) => x.k === 'ep')?.done} img={homeImg} grow={desk} />
  );

  // Desktop: the now-card keeps its natural height and the plan takes up any difference with the
  // right column (the room goes above its "Meta de hoje" foot), so both columns end level above the
  // EXTRA shelf without an empty band in the navy card.
  const planCard = (
    <div class="card stack" style={desk ? { '--gap': '8px', flex: '1 1 auto' } : { '--gap': '8px' }}>
      <div class="row between">
        <div>
          <div class="lbl">Plano de hoje</div>
          <div class="h2 mt4">{`${pl.tasks.filter((x) => x.done).length} de ${pl.tasks.length} feitos · ${pl.total} min`}</div>
        </div>
        <Ring pct={g.goal.pct} label={`${g.goal.pct}%`} />
      </div>
      {/* Desktop: the rows share any room the card takes up (each grows a little, content centred). */}
      <div class="plan" style={desk ? { flex: '1 1 auto' } : undefined}>
        {pl.tasks.map((x, i) => {
          const split = splitKind(x.t);
          // Phone: the kind as an eyebrow over an open row's title. A done row reads as one quiet
          // line on both layouts ("Episódio 1 · Take the Mic"): the kind muted and not struck, only
          // the title struck through (no third text level, no heavy strike over the prefix).
          const kind = desk || x.done ? null : split;
          const tStyle = { ...TASK_T, ...(desk ? TASK_T_DESK : {}), ...(x.done ? { color: 'var(--muted)' } : {}) };
          return (
            <a
              key={x.k}
              class={`task${x.done ? ' done' : x === pl.now ? ' now' : ''}`}
              href={`#/${x.go}`}
              style={desk ? { flex: '1 1 auto' } : undefined}
            >
              <span class="n">{x.done ? <Icon name="check" size={16} /> : i + 1}</span>
              {/* Tighter leading than the prototype (its rows looked loose); titles wrap in full. */}
              <span class="grow" style={{ minWidth: '0' }}>
                {kind ? (
                  <>
                    <span style={{ ...TASK_KIND, color: x === pl.now ? 'var(--orangeD)' : 'var(--muted)' }}>
                      {kind[0]}
                    </span>
                    <span style={HIDDEN_SEP}> · </span>
                  </>
                ) : null}
                <span class="h3" title={x.t} style={tStyle}>
                  {x.done ? (
                    split ? (
                      <>
                        <span style={DONE_KIND}>{`${split[0]} · `}</span>
                        <span style={DONE_T}>{split[1]}</span>
                      </>
                    ) : (
                      <span style={DONE_T}>{x.t}</span>
                    )
                  ) : (
                    noOrphan(kind ? kind[1] : x.t)
                  )}
                </span>
                <span class="xs" style={desk ? { ...TASK_SUB, ...TASK_SUB_DESK } : TASK_SUB}>
                  {keepHyphens(taskSub(x.k, x.sub))}
                </span>
              </span>
              <span
                class="xs"
                style={{
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  color: x.done ? 'var(--muted)' : 'var(--navy)',
                  fontSize: desk ? '.875rem' : undefined,
                }}
              >
                {`${x.min} min`}
              </span>
            </a>
          );
        })}
      </div>
      <div class="xs" style={desk ? { marginTop: 'auto' } : undefined}>
        {`Meta de hoje: ${g.goal.done} de ${g.goal.target} pontos.${g.goal.hit ? ' Batida.' : ''}`}
      </div>
    </div>
  );

  const missions = (
    <div class="card stack" style={{ '--gap': '8px' }}>
      <div class="row between">
        <div class="lbl">Missões do dia</div>
        <span class="xs">{`${g.missions.filter((m) => m.done).length}/${g.missions.length}`}</span>
      </div>
      <Missions list={g.missions} />
    </div>
  );

  const f = pl.focus;
  // Desktop: the focus card takes up whatever the right column lacks next to the left one (its CTA
  // stays at the card's foot), so both columns end level above the EXTRA shelf.
  const focus = (
    <div class="card or stack" style={desk ? { '--gap': '6px', flex: '1 1 auto' } : { '--gap': '6px' }}>
      <div class="lbl or">Foco da semana</div>
      <div class="h2">{f.t}</div>
      <p class="p">{f.b}</p>
      <a
        class="btn link"
        href={`#/${f.go}`}
        style={{ justifyContent: 'flex-start', '--fg': 'var(--orangeD)', marginTop: desk ? 'auto' : undefined }}
      >
        <span>{f.cta}</span>
        <Icon name="next" size={18} />
      </a>
    </div>
  );

  const picks = P.extras.filter((x) => !x.locked).slice(0, desk ? 6 : 4);
  // "Ver tudo" shares the heading's baseline (flex baseline alignment; the prototype's link floated
  // between the eyebrow and the title). Its 44px hit area overhangs the line box with negative
  // margins, so the row keeps the heading's height.
  // The posters start on the same line (the covers are buttons, which the prototype let centre
  // vertically in their grid row, so its rows looked ragged). On desktop the shelf runs under both
  // columns as two rows of three wide cards (poster beside its title and reason).
  const extras = (
    <section class="stack" style={{ '--gap': '10px' }}>
      <div>
        <div class="lbl or">EXTRA pra você</div>
        <div
          class="mt4"
          style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}
        >
          <div class="h2" style={{ minWidth: '0' }}>
            No seu nível e no seu gosto
          </div>
          {/* A lighter link than the section's h2 (the button's 800/1.02rem competed with it). */}
          <a
            class="btn link"
            href="#/extra"
            style={{
              flex: 'none',
              whiteSpace: 'nowrap',
              margin: '-9px -4px -9px 0',
              fontSize: '.95rem',
              fontWeight: 800,
              gap: '4px',
            }}
          >
            Ver tudo
          </a>
        </div>
      </div>
      <div
        class="covers"
        style={
          desk
            ? { alignItems: 'stretch', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '16px' }
            : { alignItems: 'start' }
        }
      >
        {picks.map((x) => (desk ? <WideCover key={x.id} x={x} /> : <PickCover key={x.id} x={x} />))}
      </div>
    </section>
  );

  const m = P.missions[0];
  const a = getAssistant(c.assistants, p.assistant);
  const micLbl = `Mic · ${a.name} · missão de hoje`;
  const micText = (withLbl: boolean) => (
    <div class="grow" style={{ minWidth: '0' }}>
      {withLbl ? (
        <div class="lbl" style={BALANCE}>
          {micLbl}
        </div>
      ) : null}
      <div class={withLbl ? 'h3 mt4' : 'h3'} style={withLbl ? undefined : { fontSize: '1rem', lineHeight: '1.3' }}>
        {m ? noOrphan(m.t) : null}
      </div>
      {/* The minutes left, then the mission's points as a pill (like the missions' +15), so the line
          never breaks at its " · " (same text content: the separator stays in the DOM, not drawn). */}
      <div class="xs mt4" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
        <span>{`${Math.round(s.maggie.secLeft / 60)} min de conversa no mês`}</span>
        <span style={HIDDEN_SEP}> · </span>
        <span class="pill gold" style={{ fontSize: '.75rem', padding: '2px 8px' }}>
          +30 pontos
        </span>
      </div>
    </div>
  );
  // Desktop: the prototype's row (the eyebrow fits beside the portrait). Phone: the eyebrow takes the
  // card's width above the portrait and the mission, so it stays on one line and the mission title
  // gets the room beside the portrait; the chevron is centred on the whole card.
  const maggie = m ? (
    desk ? (
      <a class="card row" href={`#/maggie?modo=missao&m=${m.k}`} style={{ '--gap': '14px' }}>
        <span class="mic-pic">
          <AssistThumb a={a} size={64} />
        </span>
        {micText(true)}
        <Icon name="next" size={20} />
      </a>
    ) : (
      <a class="card row" href={`#/maggie?modo=missao&m=${m.k}`} style={{ '--gap': '8px', flexWrap: 'nowrap' }}>
        <div class="stack grow" style={{ '--gap': '10px', minWidth: '0' }}>
          <div class="lbl" style={BALANCE}>
            {micLbl}
          </div>
          <div class="row" style={{ '--gap': '12px', flexWrap: 'nowrap' }}>
            <span class="mic-pic" style={{ width: '56px', height: '56px' }}>
              <AssistThumb a={a} size={56} />
            </span>
            {micText(false)}
          </div>
        </div>
        <Icon name="next" size={20} />
      </a>
    )
  ) : null;

  const week = <WeekCard p={p} weekdayToday={weekday(t)} />;

  const body = desk ? (
    <>
      <div class="home-grid" style={{ alignItems: 'stretch' }}>
        <div class="stack" style={{ '--gap': '16px' }}>
          {course}
          {planCard}
        </div>
        <div class="stack" style={{ '--gap': '16px' }}>
          <LiveGamebar />
          {missions}
          {maggie}
          {focus}
          {week}
        </div>
      </div>
      {extras}
    </>
  ) : (
    <div class="stack" style={{ '--gap': '16px' }}>
      <LiveGamebar />
      {course}
      {planCard}
      {missions}
      {extras}
      {maggie}
      {focus}
      {week}
    </div>
  );

  return (
    <>
      {desk ? null : (
        <header class="topbar">
          <Logo size={16} />
          <span class="grow" />
          <AiBadge />
        </header>
      )}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': '1120px', '--gap': '16px' }}>
          {hello}
          {body}
        </div>
      </div>
    </>
  );
}

/** The now-card: the current episode, its step bar and the CTA into the player. */
function CourseCard({
  s,
  c,
  eps,
  epDone,
  img,
  grow,
}: {
  s: TieState;
  c: Catalog;
  eps: readonly number[];
  epDone: boolean;
  img: string | null;
  /** Desktop: the card takes up the difference between the two columns (its rows spread evenly). */
  grow: boolean;
}) {
  const cur = current(s, eps);
  const E = c.episodes.find((e) => e.num === cur.num);
  const stepN = cur.step;
  const st = c.steps[stepN - 1];
  const stepName = st?.name ?? '';
  // The plan's episode task is one step a day: once today's step is done the kick says so (the
  // prototype's "Episódio de hoje feito" read as the whole episode finished next to "6/10").
  const kick = epDone ? ' Etapa de hoje feita' : cur.started ? ' Continue o curso' : ' Comece o curso';
  const cta = epDone
    ? 'Seguir para a próxima etapa'
    : cur.started
      ? `Continuar em ${stepName}`
      : `Começar o episódio ${cur.num}`;
  const total = c.steps.length;
  const segs = [];
  for (let n = 1; n <= total; n++) {
    // C.segs(stepN, stepN): everything before the current step is done.
    const cls = n < stepN ? 'done' : n === stepN ? 'now' : '';
    // The prototype's group gaps (tie.css .segs i.sep) before step 4 and step 10.
    const sep = n === 4 || n === 10;
    segs.push(<i key={n} class={cls + (sep ? ' sep' : '')} style={grow ? { height: '11px' } : undefined} />);
  }
  // The progress, where you are and the CTA read as one block at the card's foot. Phone: "Você está
  // em <step>", then the time as a meta line led by a clock (the " · " stays in the DOM but is not
  // drawn, so the line never breaks after a dangling middot; the clock marks the second line as
  // the step's duration instead of a loose wrap).
  const foot = (
    <>
      <div class="stack" style={{ '--gap': grow ? '10px' : '8px' }}>
        <div class="row" style={{ '--gap': '0' }}>
          <div class="segs grow">{segs}</div>
          <span class="stepcount" style={grow ? { fontSize: '1rem' } : undefined}>{`${stepN}/10`}</span>
        </div>
        <div class="sm" style={grow ? { fontSize: '1rem' } : { lineHeight: '1.4' }}>
          {cur.started ? 'Você está em ' : 'Primeira etapa: '}
          <b style={{ color: '#fff' }}>{stepName}</b>
          {grow ? (
            ' · cerca de 8 min para esta etapa'
          ) : (
            <>
              <span style={HIDDEN_SEP}> · </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '3px',
                  fontSize: '.8125rem',
                  color: '#B9C6E0',
                }}
              >
                <Icon name="clock" size={14} />
                cerca de 8 min para esta etapa
              </span>
            </>
          )}
        </div>
      </div>
      <Btn label={cta} go={`episodio/${cur.num}`} icon="play" cls="block" />
    </>
  );
  return (
    <div class="now-card stack" style={grow ? { '--gap': '16px', flex: 'none', padding: '24px' } : { '--gap': '12px' }}>
      <div class="bgimg" style={img ? { backgroundImage: `url(${img})` } : undefined} />
      {/* Kick and points pill share one line (neither breaks inside) and the same height. */}
      <div class="row between" style={{ '--gap': '8px', flexWrap: 'nowrap', alignItems: 'stretch' }}>
        <span class="kick" style={{ whiteSpace: 'nowrap', minWidth: '0' }}>
          <Icon name="play" size={12} />
          {kick}
        </span>
        <span class="pill gold">+10 por etapa</span>
      </div>
      {/* Desktop: a larger episode number and title (the card keeps its natural height). */}
      <div class="row" style={{ '--gap': grow ? '18px' : '14px', alignItems: 'flex-end' }}>
        <span class="num" style={{ fontSize: grow ? '4.75rem' : '3rem', color: 'var(--orange)', lineHeight: '.85' }}>
          {pad2(cur.num)}
        </span>
        <div>
          <div class={grow ? 'sm' : 'xs'}>{`Temporada ${E?.season ?? 1} · E-book ${E?.ebook ?? ''}`}</div>
          <div class="h1" style={grow ? { fontSize: '2.5rem', lineHeight: '1.1' } : undefined}>
            {E?.title ?? c.titles[cur.num - 1] ?? ''}
          </div>
        </div>
      </div>
      {grow ? (
        <div class="stack" style={{ '--gap': '16px' }}>
          {foot}
        </div>
      ) : (
        foot
      )}
    </div>
  );
}

/** Weekday initials (0 = domingo), as on a Brazilian calendar. */
const DAY_INITIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

/** Week dots (study days up to today in blue) and the reminder hours. */
function WeekCard({ p, weekdayToday }: { p: Profile; weekdayToday: number }) {
  const R = reminders(p).map(hour);
  return (
    <div class="card row" style={{ '--gap': '14px' }}>
      {/* Each study day: a dot (solid blue up to today; a sand disc with a slightly darker rim while
          still ahead, so it reads on white without a heavy outline) over its weekday's initial. */}
      <div class="row" style={{ '--gap': '6px', flex: 'none', alignItems: 'flex-start' }} aria-hidden="true">
        {p.days.map((dd) => {
          const past = dd <= weekdayToday;
          return (
            <span
              key={dd}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', width: '20px' }}
            >
              <span
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: past ? 'var(--blue)' : 'var(--line2)',
                  boxShadow: past ? undefined : 'inset 0 0 0 1.5px #BDB397',
                }}
              />
              <span
                style={{
                  fontSize: '.75rem',
                  fontWeight: 800,
                  lineHeight: '1',
                  color: past ? 'var(--navy)' : 'var(--muted)',
                }}
              >
                {DAY_INITIAL[dd] ?? ''}
              </span>
            </span>
          );
        })}
      </div>
      {/* Two short lines instead of one long wrapped one next to the dots. */}
      <div class="p grow" style={{ minWidth: '0', lineHeight: '1.4' }}>
        <b style={{ display: 'block' }}>{`${p.days.length} dias por semana`}</b>
        {R.length ? <span class="sm">{`Lembrete${R.length > 1 ? 's' : ''} às ${R.join(', ')}`}</span> : null}
      </div>
    </div>
  );
}
