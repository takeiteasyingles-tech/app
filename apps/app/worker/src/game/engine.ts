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
  batch,
  bool,
  fromJson,
  localDate,
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

export function createGameEngine(db: D1Database): GameEngine {
  async function award(userId: string, kind: PointKind, key: string, meta: AwardMeta = {}): Promise<AwardResult> {
    if (!PointKind.safeParse(kind).success) throw new Error(`unknown point kind "${kind}"`);
    if (ENGINE_ONLY_KINDS.has(kind)) throw new Error(`"${kind}" points are awarded by the game engine only`);
    if (!key || key.length > MAX_AWARD_KEY) throw new Error(`invalid award key "${key}"`);
    const { maggieSec, now: nowOverride, ...extra } = meta;
    const now = nowOverride ?? Date.now();
    const turnPrefix = kind === 'maggie_turn' ? maggieTurnPrefix(key) : null;

    // 1. Who, where (timezone) and under which rules.
    const [users, ruleRows, levelRows, badgeRows, assistants] = await batch(db, [
      q<UserRow>(db, USER_SQL, userId),
      pointRulesQuery(db, [kind, 'mission']),
      levelsQuery(db),
      badgesQuery(db),
      assistantQuery(db, userId),
    ]);
    const user = users[0];
    if (!user) throw new ApiError('not_found');
    const today = localDate(now, safeTimeZone(user.tz));
    const yesterday = addDays(today, -1);
    const rule = pointRuleFor(kind, ruleRows);
    const missionPts = pointRuleFor('mission', ruleRows).points;
    const levels = levelTable(levelRows);
    const catalog = badgeCatalog(badgeRows);
    const target = goalTarget(minutesOf(user));

    // 2. One transaction: streak touch, ledger row (trigger → user_stats/daily_stats), goal, then a
    //    snapshot for missions and badges. `willInsert` is the ledger insert's own condition (key not
    //    used yet, daily cap, Mic turns per session), so the streak only moves when points land.
    //    ?1 user ?2 key ?3 kind ?4 daily cap ?5 today ?6 turn prefix ?7 turns per session
    const willInsert = `NOT EXISTS (SELECT 1 FROM point_ledger WHERE user_id = ?1 AND award_key = ?2)
      AND (?4 IS NULL OR (SELECT COUNT(*) FROM point_ledger WHERE user_id = ?1 AND kind = ?3 AND local_date = ?5) < ?4)
      AND (?6 IS NULL OR (SELECT COUNT(*) FROM point_ledger
             WHERE user_id = ?1 AND kind = ?3 AND substr(award_key, 1, length(?6)) = ?6) < ?7)`;
    const condParams = [userId, key, kind, rule.dailyCap, today, turnPrefix, MAGGIE_TURNS_PER_SESSION] as const;
    const [, , inserted, goalRows, statsRows, dayRows, kindRows, goalDayRows, ownedRows, dueRows, epRows] = await batch(
      db,
      [
        q<never>(db, 'INSERT OR IGNORE INTO user_stats(user_id) VALUES (?)', userId),
        q(
          db,
          `UPDATE user_stats SET streak = CASE WHEN last_day = ?8 THEN streak + 1 ELSE 1 END, last_day = ?5
           WHERE user_id = ?1 AND (last_day IS NULL OR last_day < ?5) AND ${willInsert}`,
          ...condParams,
          yesterday,
        ),
        q<{ points: number }>(
          db,
          `INSERT OR IGNORE INTO point_ledger(user_id, award_key, kind, points, local_date, maggie_sec, meta, created_at)
           SELECT ?1, ?2, ?3, ?8, ?5, ?9, ?10, ?11 WHERE ${willInsert} RETURNING points`,
          ...condParams,
          rule.points,
          clampSec(maggieSec),
          Object.keys(extra).length ? toJson(extra) : null,
          now,
        ),
        q<{ local_date: string }>(db, GOAL_SQL, userId, today, target),
        q<StatsRow>(db, STATS_SQL, userId),
        q<DailyRow>(db, `SELECT ${DAILY_COLS} FROM daily_stats WHERE user_id = ? AND local_date = ?`, userId, today),
        q<{ kind: string; n: number }>(
          db,
          'SELECT kind, COUNT(*) AS n FROM point_ledger WHERE user_id = ? GROUP BY kind',
          userId,
        ),
        q<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM daily_stats WHERE user_id = ? AND goal_hit = 1', userId),
        q<{ badge_id: string }>(db, OWNED_SQL, userId),
        q<{ n: number }>(db, DUE_SQL, userId, now),
        q<EpisodeRow>(db, EPISODES_SQL, userId),
      ],
    );
    const awarded = inserted.length > 0;
    const points = awarded ? rule.points : 0;
    let goalHit = goalRows.length > 0;
    const stats = statsRows[0] ?? { points: 0, streak: 0, last_day: null };
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
            goalDays: (goalDayRows[0]?.n ?? 0) + (bonusHitsGoal ? 1 : 0),
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
      awarded,
      kind,
      points,
      total,
      dayPoints,
      levelUp: gained > 0 ? levelUp(total - gained, total, levels) : null,
      goalHit,
      newBadges: freshBadges,
      missionsDone,
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
