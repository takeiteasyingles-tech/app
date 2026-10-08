// Hoje (prototipo/js/screens/inicio.js): the course first (the current episode's next step), then
// today's plan, missions, EXTRA picks, the Mic mission, the week's focus and the weekly rhythm.
// Same markup and classes as the prototype; the numbers come from the server-backed store.
import type { Catalog } from '@tie/shared/content/schema';
import { getAssistant } from '@tie/shared/domain/assist';
import { current, plan } from '@tie/shared/domain/guide';
import { buildPersonalization, hour, reminders } from '@tie/shared/domain/personalize';
import type { Profile, TieState } from '@tie/shared/state';
import { activator, AssistThumb, Btn, type CoverItem, Icon, Logo, Missions, Ring } from '@tie/ui';
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
 * The detail wraps balanced and the title keeps its last two words together, so a second line never
 * holds a lone orphan word ("… e bandas", "aeroporto").
 */
const TASK_T = { ...TWO_LINES, fontSize: '1rem', lineHeight: '1.3' } as const;
const TASK_SUB = { ...TWO_LINES, ...BALANCE, lineHeight: '1.35', marginTop: '2px' } as const;

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
        <div class="why" title={x.why}>
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

  const course = <CourseCard s={s} c={c} eps={eps} epDone={!!pl.tasks.find((x) => x.k === 'ep')?.done} img={homeImg} />;

  // Desktop: the plan card grows to the right column's height and its rows share the extra room, so
  // both columns end level above the EXTRA shelf (no blank band under the shorter one).
  const planCard = (
    <div class="card stack" style={desk ? { '--gap': '8px', flex: '1 1 auto' } : { '--gap': '8px' }}>
      <div class="row between">
        <div>
          <div class="lbl">Plano de hoje</div>
          <div class="h2 mt4">{`${pl.tasks.filter((x) => x.done).length} de ${pl.tasks.length} feitos · ${pl.total} min`}</div>
        </div>
        <Ring pct={g.goal.pct} label={`${g.goal.pct}%`} />
      </div>
      <div class="plan" style={desk ? { flex: '1 1 auto' } : undefined}>
        {pl.tasks.map((x, i) => (
          <a
            key={x.k}
            class={`task${x.done ? ' done' : x === pl.now ? ' now' : ''}`}
            href={`#/${x.go}`}
            style={desk ? { flex: '1 1 auto' } : undefined}
          >
            <span class="n">{x.done ? <Icon name="check" size={16} /> : i + 1}</span>
            {/* Tighter leading than the prototype (its rows looked loose); titles wrap in full. */}
            <span class="grow" style={{ minWidth: '0' }}>
              <span class="h3" title={x.t} style={TASK_T}>
                {noOrphan(x.t)}
              </span>
              <span class="xs" style={TASK_SUB}>
                {keepHyphens(taskSub(x.k, x.sub))}
              </span>
            </span>
            <span class="xs" style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
              {`${x.min} min`}
            </span>
          </a>
        ))}
      </div>
      <div class="xs">{`Meta de hoje: ${g.goal.done} de ${g.goal.target} pontos.${g.goal.hit ? ' Batida.' : ''}`}</div>
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
  const focus = (
    <div class="card or stack" style={{ '--gap': '6px' }}>
      <div class="lbl or">Foco da semana</div>
      <div class="h2">{f.t}</div>
      <p class="p">{f.b}</p>
      <a class="btn link" href={`#/${f.go}`} style={{ justifyContent: 'flex-start', '--fg': 'var(--orangeD)' }}>
        <span>{f.cta}</span>
        <Icon name="next" size={18} />
      </a>
    </div>
  );

  const picks = P.extras.filter((x) => !x.locked).slice(0, desk ? 6 : 4);
  // "Ver tudo" is centred on the heading's line: its 44px hit area overhangs the heading's 26px line
  // box equally above and below (the prototype's link floated between the eyebrow and the title).
  // The posters start on the same line (the covers are buttons, which the prototype let centre
  // vertically in their grid row, so its rows looked ragged). On desktop the shelf runs under both
  // columns as one row of six, so the two columns above end level.
  const extras = (
    <section class="stack" style={{ '--gap': '10px' }}>
      <div class="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div class="lbl or">EXTRA pra você</div>
          <div class="h2 mt4">No seu nível e no seu gosto</div>
        </div>
        {/* A lighter link than the section's h2 (the button's 800/1.02rem competed with it). */}
        <a
          class="btn link"
          href="#/extra"
          style={{ whiteSpace: 'nowrap', marginBottom: '-11px', fontSize: '.9rem', fontWeight: 700, gap: '4px' }}
        >
          Ver tudo
        </a>
      </div>
      <div
        class="covers"
        style={desk ? { alignItems: 'start', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' } : { alignItems: 'start' }}
      >
        {picks.map((x) => (
          <PickCover key={x.id} x={x} />
        ))}
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
      <div class={withLbl ? 'h3 mt4' : 'h3'}>{m ? noOrphan(m.t) : null}</div>
      <div class="xs mt4">{`${Math.round(s.maggie.secLeft / 60)} min de conversa no mês · +30 pontos`}</div>
    </div>
  );
  // Desktop: the prototype's row (the eyebrow fits beside the portrait). Phone: the eyebrow takes the
  // card's full width above the row, so it stays on one line instead of wrapping beside the portrait.
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
      <a class="card stack" href={`#/maggie?modo=missao&m=${m.k}`} style={{ '--gap': '10px' }}>
        <div class="lbl" style={BALANCE}>
          {micLbl}
        </div>
        <div class="row" style={{ '--gap': '14px' }}>
          <span class="mic-pic">
            <AssistThumb a={a} size={64} />
          </span>
          {micText(false)}
          <Icon name="next" size={20} />
        </div>
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
}: {
  s: TieState;
  c: Catalog;
  eps: readonly number[];
  epDone: boolean;
  img: string | null;
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
    segs.push(<i key={n} class={cls + (sep ? ' sep' : '')} />);
  }
  return (
    <div class="now-card stack" style={{ '--gap': '12px' }}>
      <div class="bgimg" style={img ? { backgroundImage: `url(${img})` } : undefined} />
      {/* Kick and points pill share one line (neither breaks inside). */}
      <div class="row between" style={{ '--gap': '8px', flexWrap: 'nowrap' }}>
        <span class="kick" style={{ whiteSpace: 'nowrap', minWidth: '0' }}>
          <Icon name="play" size={12} />
          {kick}
        </span>
        <span class="pill gold">+10 por etapa</span>
      </div>
      <div class="row" style={{ '--gap': '14px', alignItems: 'flex-end' }}>
        <span class="num" style={{ fontSize: '3rem', color: 'var(--orange)', lineHeight: '.85' }}>
          {pad2(cur.num)}
        </span>
        <div>
          <div class="xs">{`Temporada ${E?.season ?? 1} · E-book ${E?.ebook ?? ''}`}</div>
          <div class="h1">{E?.title ?? c.titles[cur.num - 1] ?? ''}</div>
        </div>
      </div>
      <div class="row" style={{ '--gap': '0' }}>
        <div class="segs grow">{segs}</div>
        <span class="stepcount">{`${stepN}/10`}</span>
      </div>
      <div class="sm">
        {cur.started ? 'Você está em ' : 'Primeira etapa: '}
        <b style={{ color: '#fff' }}>{stepName}</b>
        {' · cerca de 8 min para esta etapa'}
      </div>
      <Btn label={cta} go={`episodio/${cur.num}`} icon="play" cls="block" />
    </div>
  );
}

/** Week dots (study days up to today in blue) and the reminder hours. */
function WeekCard({ p, weekdayToday }: { p: Profile; weekdayToday: number }) {
  const R = reminders(p).map(hour);
  return (
    <div class="card row" style={{ '--gap': '14px' }}>
      <div class="row" style={{ '--gap': '6px', flex: 'none' }}>
        {p.days.map((dd) => (
          <span
            key={dd}
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: dd <= weekdayToday ? 'var(--blue)' : 'var(--line2)',
            }}
          />
        ))}
      </div>
      {/* Two short lines instead of one long wrapped one next to the dots. */}
      <div class="p grow" style={{ minWidth: '0', lineHeight: '1.4' }}>
        <b style={{ display: 'block' }}>{`${p.days.length} dias por semana`}</b>
        {R.length ? <span class="sm">{`Lembrete${R.length > 1 ? 's' : ''} às ${R.join(', ')}`}</span> : null}
      </div>
    </div>
  );
}
