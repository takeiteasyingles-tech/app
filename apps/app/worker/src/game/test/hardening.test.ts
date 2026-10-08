// Spec 06 "Game engine": one D1 round trip per award (no ledger scans), counters kept by triggers,
// and default daily caps for the server-verified kinds that repeat.
import { beforeEach, describe, expect, it } from 'vitest';
import { createGameEngine, prefixEnd } from '../engine';
import { SERVER_DAILY_CAPS } from '../rules';
import { all, db, exec, one, reset, seedBadges, spNoon } from './helpers';

const D1 = '2026-10-01';
const D2 = '2026-10-02';

/** The test D1 with a counter on round trips (batch, first, all, run). */
function countingDb(): { db: D1Database; trips: () => number } {
  let n = 0;
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, recv) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          return (...args: unknown[]) => {
            n++;
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop, recv) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => {
          n++;
          return target.batch(stmts);
        };
      }
      return Reflect.get(target, prop, recv);
    },
  });
  return { db: proxy, trips: () => n };
}

beforeEach(async () => {
  await reset();
});

describe('award round trips', () => {
  it('takes a single D1 batch when no mission bonus or badge is due', async () => {
    const c = countingDb();
    const engine = createGameEngine(c.db);
    // First award of the day completes the "step" mission (second batch); warm up with it.
    await engine.award('U1', 'step', 'step:1:1', { now: spNoon(D1) });
    const before = c.trips();
    const res = await engine.award('U1', 'ex_right', 'ex:item-1', { now: spNoon(D1) });
    expect(res.awarded).toBe(true);
    expect(c.trips() - before).toBe(1);
  });

  it('retries with the real timezone when the guess is wrong, writing nothing for the guess', async () => {
    await exec("UPDATE users SET tz = 'Asia/Tokyo' WHERE id = 'U1'");
    const engine = createGameEngine(db);
    // 23:30 UTC on Oct 1 is already Oct 2 in Tokyo.
    const now = Date.parse(`${D1}T23:30:00Z`);
    await engine.award('U1', 'ex_right', 'ex:a', { now });
    const rows = await all<{ local_date: string }>('SELECT local_date FROM point_ledger WHERE user_id = ?', 'U1');
    expect(rows.map((r) => r.local_date)).toEqual([D2]);
    expect(await all('SELECT local_date FROM daily_stats WHERE user_id = ?', 'U1')).toEqual([{ local_date: D2 }]);
  });
});

describe('counters', () => {
  it('user_kind_counts and goal_days follow the ledger and daily_stats, also on delete', async () => {
    await seedBadges();
    const engine = createGameEngine(db);
    // 6 × 5 + step 10 + "step" mission 15 = 55 ≥ the 50-point goal.
    for (let i = 0; i < 6; i++) await engine.award('U1', 'ex_right', `ex:${i}`, { now: spNoon(D1) });
    await engine.award('U1', 'step', 'step:1:1', { now: spNoon(D1) });
    const counts = await all<{ kind: string; n: number }>(
      'SELECT kind, n FROM user_kind_counts WHERE user_id = ? ORDER BY kind',
      'U1',
    );
    const ledger = await all<{ kind: string; n: number }>(
      'SELECT kind, COUNT(*) AS n FROM point_ledger WHERE user_id = ? GROUP BY kind ORDER BY kind',
      'U1',
    );
    expect(counts).toEqual(ledger);
    const goalDays = await one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM daily_stats WHERE user_id = ? AND goal_hit = 1',
      'U1',
    );
    expect(
      (await one<{ goal_days: number }>('SELECT goal_days FROM user_stats WHERE user_id = ?', 'U1'))?.goal_days,
    ).toBe(goalDays?.n);
    expect(goalDays?.n).toBe(1);

    await exec('DELETE FROM point_ledger WHERE user_id = ?', 'U1');
    await exec('DELETE FROM daily_stats WHERE user_id = ?', 'U1');
    expect(await all('SELECT kind FROM user_kind_counts WHERE user_id = ? AND n > 0', 'U1')).toEqual([]);
    expect(await one('SELECT goal_days FROM user_stats WHERE user_id = ?', 'U1')).toEqual({ goal_days: 0 });
  });
});

describe('default daily caps', () => {
  it('caps card points per local day when point_rules has no row', async () => {
    const engine = createGameEngine(db);
    const cap = SERVER_DAILY_CAPS.card ?? 0;
    expect(cap).toBeGreaterThan(0);
    let awarded = 0;
    for (let i = 0; i < cap + 3; i++) {
      if ((await engine.award('U1', 'card', `card:c${i}:${D1}`, { now: spNoon(D1) })).awarded) awarded++;
    }
    expect(awarded).toBe(cap);
    expect((await engine.award('U1', 'card', `card:c0:${D2}`, { now: spNoon(D2) })).awarded).toBe(true);
  });

  it('a point_rules row wins over the default (NULL = uncapped on purpose)', async () => {
    await exec("INSERT INTO point_rules(kind, points, daily_cap) VALUES('maggie_session', 30, 2)");
    const engine = createGameEngine(db);
    const got = [];
    for (let i = 0; i < 4; i++)
      got.push((await engine.award('U1', 'maggie_session', `msess:S${i}`, { now: spNoon(D1) })).awarded);
    expect(got).toEqual([true, true, false, false]);
  });
});

describe('prefixEnd', () => {
  it('bounds every key with the prefix and nothing else', () => {
    const p = 'mturn:S1:';
    const end = prefixEnd(p);
    for (const k of ['mturn:S1:0', 'mturn:S1:19', 'mturn:S1:999']) expect(k >= p && k < end).toBe(true);
    for (const k of ['mturn:S10:1', 'mturn:S2:0', 'mturn:S1']) expect(k >= p && k < end).toBe(false);
  });
});
