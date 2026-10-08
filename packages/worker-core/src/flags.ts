import { all, fromJson } from './db';

// feature_flags, cached per isolate for 30s. An admin change therefore reaches every isolate within
// 30s; the isolate that served the admin write calls invalidateFlags() to see it immediately.

export const FLAGS_TTL_MS = 30_000;

/**
 * Optional targeting in feature_flags.rules. A subject matching any allowlist gets the flag
 * (when enabled) regardless of rollout_pct.
 */
export interface FlagRules {
  users?: string[];
  plans?: string[];
  roles?: string[];
}

export interface Flag {
  key: string;
  enabled: boolean;
  rolloutPct: number;
  rules: FlagRules | null;
}

export interface FlagSubject {
  userId?: string | null;
  planSlug?: string | null;
  roles?: readonly string[];
}

interface FlagRow {
  key: string;
  enabled: number;
  rollout_pct: number;
  rules: string | null;
}

let cache: { at: number; flags: Map<string, Flag> } | null = null;
let inflight: Promise<Map<string, Flag>> | null = null;

export function invalidateFlags(): void {
  cache = null;
}

export async function loadFlags(db: D1Database, now: number = Date.now()): Promise<Map<string, Flag>> {
  if (cache && now - cache.at < FLAGS_TTL_MS) return cache.flags;
  inflight ??= all<FlagRow>(db, 'SELECT key, enabled, rollout_pct, rules FROM feature_flags')
    .then((rows) => {
      const flags = new Map<string, Flag>(
        rows.map((r) => [
          r.key,
          {
            key: r.key,
            enabled: r.enabled === 1,
            rolloutPct: r.rollout_pct,
            rules: fromJson<FlagRules | null>(r.rules, null),
          },
        ]),
      );
      cache = { at: now, flags };
      return flags;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** FNV-1a → 0..99, stable per (flag, user) so a user's rollout bucket never flips. */
export function rolloutBucket(flagKey: string, userId: string): number {
  let h = 0x811c9dc5;
  const s = `${flagKey}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

function listed(list: readonly string[] | undefined, value: string | null | undefined): boolean {
  return !!value && Array.isArray(list) && list.includes(value);
}

/** Pure evaluation of one flag for a subject. */
export function evaluateFlag(flag: Flag | undefined, subject: FlagSubject = {}): boolean {
  if (!flag?.enabled) return false;
  const r = flag.rules;
  if (r) {
    if (listed(r.users, subject.userId) || listed(r.plans, subject.planSlug)) return true;
    if (subject.roles?.some((role) => listed(r.roles, role))) return true;
  }
  if (flag.rolloutPct >= 100) return true;
  if (flag.rolloutPct <= 0 || !subject.userId) return false;
  return rolloutBucket(flag.key, subject.userId) < flag.rolloutPct;
}

export async function isEnabled(db: D1Database, key: string, subject: FlagSubject = {}): Promise<boolean> {
  return evaluateFlag((await loadFlags(db)).get(key), subject);
}

/** Every flag evaluated for a subject (TieState.flags). */
export async function evaluateAll(db: D1Database, subject: FlagSubject = {}): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const [key, flag] of await loadFlags(db)) out[key] = evaluateFlag(flag, subject);
  return out;
}
