// Gamification rules as stored in D1 (point_rules, levels, badges, assistants), with the prototype
// constants from @tie/shared as fallbacks so a fresh database still scores like the prototype.
import {
  type AssistantRef,
  BADGES,
  type Badge,
  BadgeRule,
  LEVELS,
  POINTS,
  type PointKind,
  SOFT_EVENT_KINDS,
  type SoftEventKind,
} from '@tie/shared';
import { fromJson, type Query, q } from '@tie/worker-core';

/** Award sources the engine must never accept from callers (it awards them itself). */
export const ENGINE_ONLY_KINDS: ReadonlySet<PointKind> = new Set<PointKind>(['mission']);

/**
 * Daily caps for the client-attested kinds when point_rules has no row for them. A row with
 * daily_cap NULL means the admin removed the cap on purpose, so these apply only to a missing row.
 */
export const DEFAULT_DAILY_CAPS: Readonly<Record<SoftEventKind, number>> = { song: 20, quiz_hit: 60, word: 40 };

/**
 * Daily caps for server-verified kinds that can still repeat many times a day (spec 06 "Game
 * engine"): Mic turns and sessions (S7's own rolling-24 h bounds stay on top), and reviewed cards
 * (new manual cards are due at once, so without a cap they would be a points farm). The seed
 * writes the same numbers into point_rules; like the soft caps, they apply only to a missing row.
 */
export const SERVER_DAILY_CAPS: Readonly<Partial<Record<PointKind, number>>> = {
  maggie_turn: 100,
  maggie_session: 8,
  card: 100,
};

/** Mic turns that earn maggie_turn points per session (spec 04 §2 award keys). */
export const MAGGIE_TURNS_PER_SESSION = 20;

/** `mturn:{sessionId}:{idx}` → the per-session prefix `mturn:{sessionId}:`. */
const MTURN_RE = /^(mturn:[^:]+:)\d+$/;

export function maggieTurnPrefix(key: string): string {
  const m = MTURN_RE.exec(key);
  if (!m?.[1]) throw new Error(`maggie_turn key must look like mturn:{sessionId}:{idx}, got "${key}"`);
  return m[1];
}

export interface PointRule {
  points: number;
  /** Max ledger rows of this kind per local day; null = uncapped. */
  dailyCap: number | null;
}

interface PointRuleRow {
  kind: string;
  points: number;
  daily_cap: number | null;
}

export function pointRulesQuery(db: D1Database, kinds: readonly PointKind[]): Query<PointRuleRow> {
  return q<PointRuleRow>(
    db,
    `SELECT kind, points, daily_cap FROM point_rules WHERE kind IN (${kinds.map(() => '?').join(',')})`,
    ...kinds,
  );
}

export function pointRuleFor(kind: PointKind, rows: readonly PointRuleRow[]): PointRule {
  const row = rows.find((r) => r.kind === kind);
  if (row) return { points: Math.max(0, row.points), dailyCap: row.daily_cap };
  const softCap = (SOFT_EVENT_KINDS as readonly string[]).includes(kind)
    ? DEFAULT_DAILY_CAPS[kind as SoftEventKind]
    : null;
  return { points: POINTS[kind], dailyCap: softCap ?? SERVER_DAILY_CAPS[kind] ?? null };
}

interface LevelRow {
  min_points: number;
  name: string;
}

export type LevelTable = readonly (readonly [number, string])[];

export function levelsQuery(db: D1Database): Query<LevelRow> {
  return q<LevelRow>(db, 'SELECT min_points, name FROM levels ORDER BY min_points');
}

export function levelTable(rows: readonly LevelRow[]): LevelTable {
  return rows.length ? rows.map((r) => [r.min_points, r.name] as const) : LEVELS;
}

interface BadgeRow {
  id: string;
  title: string;
  sub: string;
  icon: string;
  rule: string;
}

export interface BadgeCatalog {
  badges: readonly Badge[];
  /** False when the badges table is empty: rows can't be awarded (user_badges has an FK to it). */
  awardable: boolean;
}

export function badgesQuery(db: D1Database): Query<BadgeRow> {
  return q<BadgeRow>(db, 'SELECT id, title, sub, icon, rule FROM badges ORDER BY sort, id');
}

export function badgeCatalog(rows: readonly BadgeRow[]): BadgeCatalog {
  if (!rows.length) return { badges: BADGES, awardable: false };
  const badges: Badge[] = [];
  for (const r of rows) {
    const rule = BadgeRule.safeParse(fromJson<unknown>(r.rule, null));
    if (!rule.success) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'badge rule is invalid; badge skipped', badge: r.id }));
      continue;
    }
    badges.push({ id: r.id, t: r.title, s: r.sub, icon: r.icon, rule: rule.data });
  }
  return { badges, awardable: true };
}

interface AssistantRow {
  key: string;
  name: string;
  art: string;
}

/** Fallback when the assistants table is empty (fresh DB): the prototype's default, Maggie. */
const MAGGIE: AssistantRef = { k: 'margaret', name: 'Maggie', art: 'a' };

/** The user's chosen assistant when it is active, else the first one by sort (TIE.assist.get fallback). */
export function assistantQuery(db: D1Database, userId: string): Query<AssistantRow> {
  return q<AssistantRow>(
    db,
    `SELECT key, name, art FROM assistants WHERE active = 1
     ORDER BY CASE WHEN key = (SELECT assistant_key FROM profiles WHERE user_id = ?) THEN 0 ELSE 1 END, sort
     LIMIT 1`,
    userId,
  );
}

export function assistantRef(rows: readonly AssistantRow[]): AssistantRef {
  const r = rows[0];
  return r ? { k: r.key, name: r.name, art: r.art === 'o' ? 'o' : 'a' } : MAGGIE;
}
