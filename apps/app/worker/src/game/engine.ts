// S4 game engine: the server side of prototipo/js/core/game.js. Points live in point_ledger (one row
// per award key, so replays are free); the trg_ledger_ai trigger keeps user_stats and daily_stats in
// step. Streaks, goals, missions and badges are evaluated here in the user's timezone.
import {
  ApiError,
  type AwardResult,
  type BadgeDef,
  type BadgeStats,
  current,
  type DailyStats,
  DEFAULT_TZ,
  dailyMissions,
  emptyDaily,
  type GameSummary,
  gameSummary,
  goalTarget,
  type LevelInfo,
  level,
  newBadges,
  PointKind,
} from '@tie/shared';
import {
  type AwardMeta,
  type AwardService,
  addDays,
  type Bind,
  batch,
  bool,
  fromJson,
  localDate,
  type Query,
  q,
  safeTimeZone,
  toJson,
} from '@tie/worker-core';
import {
  assistantQuery,
  assistantRef,
  badgeCatalog,
  badgesQuery,
  ENGINE_ONLY_KINDS,
  type LevelTable,
  levelsQuery,
  levelTable,
  MAGGIE_TURNS_PER_SESSION,
  maggieTurnPrefix,
  pointRuleFor,
  pointRulesQuery,
} from './rules';

export interface SummaryOptions {
  /** Server clock override (tests). */
  now?: number;
  /** The session's timezone, when the caller already has it; else users.tz. */
  tz?: string;
}

/** AwardService plus the read side used by GET /api/me/summary. */
export interface GameEngine extends AwardService {
  summary(userId: string, opts?: SummaryOptions): Promise<GameSummary>;
}

/** Longest award key accepted (keys embed ids, dates and norm()ed words). */
export const MAX_AWARD_KEY = 256;
/** A single award never credits more Mic time than this (meta.maggieSec). */
const MAX_MAGGIE_SEC = 3600;

interface UserRow {
  tz: string;
  minutes: number | null;
  styles: string | null;
}

interface StatsRow {
  points: number;
  streak: number;
  last_day: string | null;
}

interface DailyRow {
  local_date: string;
  points: number;
  steps: number;
  cards: number;
  extras: number;
  mic: number;
  maggie_sec: number;
  goal_hit: number;
  missions: string;
}

interface EpisodeRow {
  num: number;
  furthest_step: number | null;
  done_at: number | null;
}

const USER_SQL = `SELECT u.tz, p.minutes, p.styles FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`;
const STATS_SQL = 'SELECT points, streak, last_day FROM user_stats WHERE user_id = ?';
const DAILY_COLS = 'local_date, points, steps, cards, extras, mic, maggie_sec, goal_hit, missions';
const OWNED_SQL = 'SELECT badge_id FROM user_badges WHERE user_id = ?';
const DUE_SQL = 'SELECT COUNT(*) AS n FROM srs_cards WHERE user_id = ? AND due_at <= ?';
const EPISODES_SQL = `SELECT e.num, ep.furthest_step, ep.done_at FROM episodes e
  LEFT JOIN episode_progress ep ON ep.episode_num = e.num AND ep.user_id = ?
  WHERE e.status = 'published' ORDER BY e.num`;
const GOAL_SQL = `UPDATE daily_stats SET goal_hit = 1
  WHERE user_id = ? AND local_date = ? AND goal_hit = 0 AND points >= ? RETURNING local_date`;

function toDaily(row: DailyRow | undefined): DailyStats {
  if (!row) return emptyDaily();
  return {
    points: row.points,
    steps: row.steps,
    cards: row.cards,
    maggieSec: row.maggie_sec,
    extras: row.extras,
    mic: row.mic,
    goal: bool(row.goal_hit),
    missions: fromJson<Record<string, boolean>>(row.missions, {}),
  };
}

/** guide.current().num over the published episodes; 1 before any content is published. */
function currentEpisode(rows: readonly EpisodeRow[]): number {
  if (!rows.length) return 1;
  const epsDone: Record<number, boolean> = {};
  const prog: Record<number, number> = {};
  for (const r of rows) {
    if (r.done_at != null) epsDone[r.num] = true;
    if (r.furthest_step != null) prog[r.num] = r.furthest_step;
  }
  return current(
    { epsDone, prog },
    rows.map((r) => r.num),
  ).num;
}

function styles(row: UserRow): string[] {
  const v = fromJson<unknown>(row.styles, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

const minutesOf = (row: UserRow) => ({ minutes: row.minutes ?? 20 });
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const badgeDef = ({ id, t, s, icon }: BadgeDef): BadgeDef => ({ id, t, s, icon });

function clampSec(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(MAX_MAGGIE_SEC, Math.max(0, n));
}

function levelUp(before: number, after: number, levels: LevelTable): AwardResult['levelUp'] {
  const a = level(after, levels);
  return a.n > level(before, levels).n ? { n: a.n, name: a.name } : null;
}

/**
 * Last known users.tz per user id, per isolate. award() guesses the timezone from it (else the
 * default) so the whole award is one D1 batch; every write in that batch is guarded by the guess,
 * so a wrong or stale guess writes nothing and the award simply runs again with the real timezone.
 */
const tzSeen = new Map<string, string>();
const TZ_SEEN_MAX = 10_000;

function rememberTz(userId: string, tz: string): void {
  if (tzSeen.get(userId) === tz) return;
  if (tzSeen.size >= TZ_SEEN_MAX) {
    const oldest = tzSeen.keys().next().value;
    if (oldest !== undefined) tzSeen.delete(oldest);
  }
  tzSeen.set(userId, tz);
}

/** The smallest string greater than every string starting with `prefix` (range scans on award_key). */
export function prefixEnd(prefix: string): string {
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

/** q() binding only the parameters the SQL uses (?1..?N): D1 refuses extra bindings. */
function qn<Row>(db: D1Database, sql: string, params: readonly Bind[]): Query<Row> {
  let max = 0;
  for (const m of sql.matchAll(/\?(\d+)/g)) max = Math.max(max, Number(m[1]));
  return q<Row>(db, sql, ...params.slice(0, max));
}

// Award SQL. Parameters (one array for every statement, see qn):
//   ?1 user  ?2 key  ?3 kind  ?4 default daily cap  ?5 today  ?6 Mic turn prefix  ?7 turns per session
//   ?8 yesterday  ?9 default points  ?10 guessed tz  ?11 end of the turn prefix range
//   ?12 maggie_sec  ?13 meta  ?14 now
/** The guessed timezone is still the user's: every write below is void otherwise. */
const TZ_OK = 'EXISTS (SELECT 1 FROM users WHERE id = ?1 AND tz = ?10)';
/** point_rules row for the kind, else the code defaults (?4 cap, ?9 points). */
const RULE_CAP = `(CASE WHEN EXISTS (SELECT 1 FROM point_rules WHERE kind = ?3)
  THEN (SELECT daily_cap FROM point_rules WHERE kind = ?3) ELSE ?4 END)`;
const RULE_POINTS = 'COALESCE((SELECT MAX(0, points) FROM point_rules WHERE kind = ?3), ?9)';
/**
 * The ledger insert's own condition (key unused, daily cap, Mic turns per session), so the streak
 * only moves when points land. Every count is an index range: ix_ledger_day for the cap, the
 * UNIQUE(user_id, award_key) index for the per-session prefix.
 */
const WILL_INSERT = `${TZ_OK}
  AND NOT EXISTS (SELECT 1 FROM point_ledger WHERE user_id = ?1 AND award_key = ?2)
  AND (${RULE_CAP} IS NULL OR (SELECT COUNT(*) FROM point_ledger
         WHERE user_id = ?1 AND local_date = ?5 AND kind = ?3) < ${RULE_CAP})
  AND (?6 IS NULL OR (SELECT COUNT(*) FROM point_ledger
         WHERE user_id = ?1 AND award_key >= ?6 AND award_key < ?11) < ?7)`;
const STATS_INIT_SQL = `INSERT OR IGNORE INTO user_stats(user_id) SELECT ?1 WHERE ${TZ_OK}`;
const STREAK_SQL = `UPDATE user_stats SET streak = CASE WHEN last_day = ?8 THEN streak + 1 ELSE 1 END, last_day = ?5
  WHERE user_id = ?1 AND (last_day IS NULL OR last_day < ?5) AND ${WILL_INSERT}`;
const LEDGER_SQL = `INSERT OR IGNORE INTO point_ledger(user_id, award_key, kind, points, local_date, maggie_sec, meta, created_at)
  SELECT ?1, ?2, ?3, ${RULE_POINTS}, ?5, ?12, ?13, ?14 WHERE ${WILL_INSERT} RETURNING points`;
/** goalTarget() in SQL: max(50, (minutes || 20) * 5). */
const GOAL_IN_TX_SQL = `UPDATE daily_stats SET goal_hit = 1
  WHERE user_id = ?1 AND local_date = ?5 AND goal_hit = 0 AND ${TZ_OK}
    AND points >= MAX(50, COALESCE(NULLIF((SELECT minutes FROM profiles WHERE user_id = ?1), 0), 20) * 5)
  RETURNING local_date`;
const AWARD_STATS_SQL = 'SELECT points, streak, last_day, goal_days FROM user_stats WHERE user_id = ?';
const KIND_COUNTS_SQL = 'SELECT kind, n FROM user_kind_counts WHERE user_id = ?';

export function createGameEngine(db: D1Database): GameEngine {
  async function award(userId: string, kind: PointKind, key: string, meta: AwardMeta = {}): Promise<AwardResult> {
    if (!PointKind.safeParse(kind).success) throw new Error(`unknown point kind "${kind}"`);
    if (ENGINE_ONLY_KINDS.has(kind)) throw new Error(`"${kind}" points are awarded by the game engine only`);
    if (!key || key.length > MAX_AWARD_KEY) throw new Error(`invalid award key "${key}"`);
    let tz = tzSeen.get(userId) ?? DEFAULT_TZ;
    // A wrong guess costs one more round trip; a timezone that keeps changing under us is a bug.
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await awardOnce(userId, kind, key, meta, tz);
      if ('result' in out) return out.result;
      tz = out.tz;
    }
    throw new Error('award: the user timezone kept changing');
  }

  /**
   * One D1 batch (one transaction): streak touch, ledger row (triggers → user_stats, daily_stats,
   * user_kind_counts), goal, and the snapshot missions and badges are judged on. A second batch
   * runs only when a mission bonus or a badge is due.
   */
  async function awardOnce(
    userId: string,
    kind: PointKind,
    key: string,
    meta: AwardMeta,
    rawTz: string,
  ): Promise<{ result: AwardResult } | { tz: string }> {
    const { maggieSec, now: nowOverride, ...extra } = meta;
    const now = nowOverride ?? Date.now();
    const turnPrefix = kind === 'maggie_turn' ? maggieTurnPrefix(key) : null;
    const today = localDate(now, safeTimeZone(rawTz));
    const yesterday = addDays(today, -1);
    const fallback = pointRuleFor(kind, []);
    const P: Bind[] = [
      userId,
      key,
      kind,
      fallback.dailyCap,
      today,
      turnPrefix,
      MAGGIE_TURNS_PER_SESSION,
      yesterday,
      fallback.points,
      rawTz,
      turnPrefix ? prefixEnd(turnPrefix) : null,
      clampSec(maggieSec),
      Object.keys(extra).length ? toJson(extra) : null,
      now,
    ];
    const [
      users,
      ruleRows,
      levelRows,
      badgeRows,
      assistants,
      ,
      ,
      inserted,
      goalRows,
      statsRows,
      dayRows,
      kindRows,
      ownedRows,
      dueRows,
      epRows,
    ] = await batch(db, [
      q<UserRow>(db, USER_SQL, userId),
      pointRulesQuery(db, [kind, 'mission']),
      levelsQuery(db),
      badgesQuery(db),
      assistantQuery(db, userId),
      qn<never>(db, STATS_INIT_SQL, P),
      qn<never>(db, STREAK_SQL, P),
      qn<{ points: number }>(db, LEDGER_SQL, P),
      qn<{ local_date: string }>(db, GOAL_IN_TX_SQL, P),
      q<StatsRow & { goal_days: number }>(db, AWARD_STATS_SQL, userId),
      q<DailyRow>(db, `SELECT ${DAILY_COLS} FROM daily_stats WHERE user_id = ? AND local_date = ?`, userId, today),
      q<{ kind: string; n: number }>(db, KIND_COUNTS_SQL, userId),
      q<{ badge_id: string }>(db, OWNED_SQL, userId),
      q<{ n: number }>(db, DUE_SQL, userId, now),
      q<EpisodeRow>(db, EPISODES_SQL, userId),
    ]);
    const user = users[0];
    if (!user) throw new ApiError('not_found');
    rememberTz(userId, user.tz);
    if (user.tz !== rawTz) return { tz: user.tz };

    const missionPts = pointRuleFor('mission', ruleRows).points;
    const levels = levelTable(levelRows);
    const catalog = badgeCatalog(badgeRows);
    const target = goalTarget(minutesOf(user));
    const awarded = inserted.length > 0;
    const points = inserted[0]?.points ?? 0;
    let goalHit = goalRows.length > 0;
    const stats = statsRows[0] ?? { points: 0, streak: 0, last_day: null, goal_days: 0 };
    const daily = toDaily(dayRows[0]);

    // 3. Missions completed now (bonus once a day, keyed mission:{date}:{k}) and badges earned now,
    //    judged on the totals as they will be once the bonuses land.
    const missions = dailyMissions({
      daily,
      due: dueRows[0]?.n ?? 0,
      styles: styles(user),
      currentEp: currentEpisode(epRows),
      assistant: assistantRef(assistants),
      dayOfMonth: dayOfMonth(today),
    });
    const pending = missions.filter((m) => m.done && !daily.missions[m.k]).map((m) => m.k);
    const bonus = pending.length * missionPts;
    const counts: BadgeStats['counts'] = {};
    for (const r of kindRows) counts[r.kind as PointKind] = r.n;
    if (pending.length) counts.mission = (counts.mission ?? 0) + pending.length;
    const bonusHitsGoal = !daily.goal && bonus > 0 && daily.points + bonus >= target;
    const earned = catalog.awardable
      ? newBadges(
          catalog.badges,
          ownedRows.map((r) => r.badge_id),
          {
            counts,
            streak: stats.streak,
            points: stats.points + bonus,
            goalDays: stats.goal_days + (bonusHitsGoal ? 1 : 0),
          },
        )
      : [];

    let total = stats.points;
    let dayPoints = daily.points;
    const missionsDone: string[] = [];
    const freshBadges: BadgeDef[] = [];
    if (pending.length || earned.length) {
      const missionStmts = pending.flatMap((k) => [
        q<{ award_key: string }>(
          db,
          `INSERT OR IGNORE INTO point_ledger(user_id, award_key, kind, points, local_date, created_at)
           VALUES (?, ?, 'mission', ?, ?, ?) RETURNING award_key`,
          userId,
          `mission:${today}:${k}`,
          missionPts,
          today,
          now,
        ),
        q<never>(
          db,
          "UPDATE daily_stats SET missions = json_set(missions, ?, json('true')) WHERE user_id = ? AND local_date = ?",
          `$."${k}"`,
          userId,
          today,
        ),
      ]);
      const badgeStmts = earned.map((b) =>
        q<{ badge_id: string }>(
          db,
          'INSERT OR IGNORE INTO user_badges(user_id, badge_id, earned_at) VALUES (?, ?, ?) RETURNING badge_id',
          userId,
          b.id,
          now,
        ),
      );
      const rows = await batch(db, [
        ...missionStmts,
        ...badgeStmts,
        q<{ local_date: string }>(db, GOAL_SQL, userId, today, target),
        q<{ points: number }>(db, 'SELECT points FROM user_stats WHERE user_id = ?', userId),
        q<{ points: number }>(db, 'SELECT points FROM daily_stats WHERE user_id = ? AND local_date = ?', userId, today),
      ]);
      pending.forEach((k, i) => {
        if ((rows[i * 2]?.length ?? 0) > 0) missionsDone.push(k);
      });
      earned.forEach((b, i) => {
        if ((rows[missionStmts.length + i]?.length ?? 0) > 0) freshBadges.push(badgeDef(b));
      });
      const tail = rows.slice(missionStmts.length + badgeStmts.length) as [
        { local_date: string }[],
        { points: number }[],
        { points: number }[],
      ];
      if (tail[0].length) goalHit = true;
      total = tail[1][0]?.points ?? total;
      dayPoints = tail[2][0]?.points ?? dayPoints;
    }

    const gained = points + missionsDone.length * missionPts;
    return {
      result: {
        awarded,
        kind,
        points,
        total,
        dayPoints,
        levelUp: gained > 0 ? levelUp(total - gained, total, levels) : null,
        goalHit,
        newBadges: freshBadges,
        missionsDone,
      },
    };
  }

  return { award, summary: (userId, opts) => summary(db, userId, opts) };
}

/** game.summary() for GET /api/me/summary: one D1 round trip. */
export async function summary(db: D1Database, userId: string, opts: SummaryOptions = {}): Promise<GameSummary> {
  const now = opts.now ?? Date.now();
  // Every timezone's local date is within a day of the UTC date; read all three, pick after.
  const utc = new Date(now).toISOString().slice(0, 10);
  const dates = [addDays(utc, -1), utc, addDays(utc, 1)];
  const [users, statsRows, dayRows, ownedRows, dueRows, epRows, levelRows, badgeRows, assistants] = await batch(db, [
    q<UserRow>(db, USER_SQL, userId),
    q<StatsRow>(db, STATS_SQL, userId),
    q<DailyRow>(
      db,
      `SELECT ${DAILY_COLS} FROM daily_stats WHERE user_id = ? AND local_date IN (?, ?, ?)`,
      userId,
      ...dates,
    ),
    q<{ badge_id: string }>(db, OWNED_SQL, userId),
    q<{ n: number }>(db, DUE_SQL, userId, now),
    q<EpisodeRow>(db, EPISODES_SQL, userId),
    levelsQuery(db),
    badgesQuery(db),
    assistantQuery(db, userId),
  ]);
  const user = users[0];
  if (!user) throw new ApiError('not_found');
  const today = localDate(now, safeTimeZone(opts.tz ?? user.tz));
  const stats = statsRows[0] ?? { points: 0, streak: 0, last_day: null };
  // A streak whose last day is older than yesterday is already broken (the next award restarts it).
  const live = stats.last_day === today || stats.last_day === addDays(today, -1);
  const daily = toDaily(dayRows.find((d) => d.local_date === today));
  const s = gameSummary({
    game: {
      points: stats.points,
      streak: live ? stats.streak : 0,
      daily: { [today]: daily },
      badges: ownedRows.map((r) => r.badge_id),
    },
    profile: minutesOf(user),
    today,
    badges: badgeCatalog(badgeRows).badges,
    due: dueRows[0]?.n ?? 0,
    styles: styles(user),
    currentEp: currentEpisode(epRows),
    assistant: assistantRef(assistants),
    dayOfMonth: dayOfMonth(today),
  });
  return { ...s, level: summaryLevel(stats.points, levelTable(levelRows)) };
}

/**
 * level() for responses: the shared port keeps the prototype's math (pct < 0 below the first
 * threshold), but admin-edited levels may start above 0 and GameSummary.level.pct is 0..100.
 */
export function summaryLevel(points: number, levels: LevelTable): LevelInfo {
  const l = level(points, levels);
  return { ...l, pct: Math.min(100, Math.max(0, l.pct)) };
}
