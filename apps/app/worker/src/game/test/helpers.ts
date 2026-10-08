/// <reference types="@cloudflare/vitest-plugin/types" />
import type { D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { BADGES } from '@tie/shared';

export const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
export const db = testEnv.DB;

/** Noon in São Paulo (UTC-3) on the given date. */
export const spNoon = (date: string): number => Date.parse(`${date}T15:00:00Z`);

export async function exec(sql: string, ...params: unknown[]): Promise<void> {
  await db
    .prepare(sql)
    .bind(...params)
    .run();
}

export async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return res.results;
}

const T0 = Date.parse('2026-09-01T00:00:00Z');

/** Empties every table the engine reads or writes and creates user U1 (São Paulo, 10 min/day → goal 50). */
export async function reset(opts: { tz?: string; minutes?: number; styles?: string[] } = {}): Promise<void> {
  await db.batch(
    [
      'DELETE FROM sessions',
      'DELETE FROM point_ledger',
      'DELETE FROM daily_stats',
      'DELETE FROM user_stats',
      'DELETE FROM user_badges',
      'DELETE FROM srs_cards',
      'DELETE FROM episode_progress',
      'DELETE FROM profiles',
      'DELETE FROM users',
      'DELETE FROM badges',
      'DELETE FROM point_rules',
      'DELETE FROM levels',
      'DELETE FROM album_tracks',
      'DELETE FROM albums',
      'DELETE FROM episodes',
      'DELETE FROM assistants',
    ].map((sql) => db.prepare(sql)),
  );
  await exec(
    "INSERT INTO users(id, email, tz, created_at) VALUES('U1', 'ana@example.com', ?, ?)",
    opts.tz ?? 'America/Sao_Paulo',
    T0,
  );
  await exec(
    "INSERT INTO profiles(user_id, name, minutes, styles, updated_at) VALUES('U1', 'Ana', ?, ?, ?)",
    opts.minutes ?? 10,
    JSON.stringify(opts.styles ?? []),
    T0,
  );
}

/** The 14 prototype badges as the seed writes them. */
export async function seedBadges(): Promise<void> {
  await db.batch(
    BADGES.map((b, i) =>
      db
        .prepare('INSERT INTO badges(id, title, sub, icon, rule, sort) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(b.id, b.t, b.s, b.icon, JSON.stringify(b.rule), i),
    ),
  );
}

export async function seedEpisodes(nums: number[]): Promise<void> {
  await db.batch(
    nums.map((n) =>
      db
        .prepare("INSERT INTO episodes(num, title, status, updated_at) VALUES (?, ?, 'published', ?)")
        .bind(n, `Ep ${n}`, T0),
    ),
  );
}
