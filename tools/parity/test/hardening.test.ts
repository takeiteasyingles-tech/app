// Spec 06 "Parity harness" (and the local dev config the harness copies): lock handling, the slot's
// .dev.vars, the fixture ledger, the concluido-1 user and the wrangler `local` environments.
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_DIRS, FROZEN_MS } from '../src/config';
import { seededDb } from '../src/fixture/ownership';
import { buildFixtureSql } from '../src/fixture/sql';
import { loadFixture, rawState } from '../src/fixture/state';
import { parseJsonc } from '../src/jsonc';
import { acquireLock, TAKEOVER_STALE_MS } from '../src/proc';
import { appRoutes } from '../src/routes';
import { writeRunOutputs } from '../src/runOutputs';
import { slotDevVars } from '../src/wranglerDev';

const base = loadFixture();
const DEAD_PID = '2147483646';

describe('slot lock takeover', () => {
  it('takes over a lock whose owner is dead', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-lock-'));
    try {
      const lock = join(dir, 's.lock');
      writeFileSync(lock, DEAD_PID);
      const release = await acquireLock(lock, { timeoutMs: 5_000 });
      expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
      expect(existsSync(`${lock}.takeover`)).toBe(false);
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('waits while another process is taking over, and clears a side lock left by a crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-lock-'));
    try {
      const lock = join(dir, 's.lock');
      writeFileSync(lock, DEAD_PID);
      writeFileSync(`${lock}.takeover`, '');
      // A live takeover in progress: the stale lock is left alone until it ends.
      await expect(acquireLock(lock, { timeoutMs: 1_200 })).rejects.toThrow(/timed out/);
      expect(readFileSync(lock, 'utf8')).toBe(DEAD_PID);
      // The side lock is from a crashed process (old): it is cleared and the takeover proceeds.
      const old = (Date.now() - TAKEOVER_STALE_MS - 5_000) / 1000;
      utimesSync(`${lock}.takeover`, old, old);
      const release = await acquireLock(lock, { timeoutMs: 5_000 });
      expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run outputs', () => {
  it('writes key.json (pairs) or shots/index.json (shots-only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-out-'));
    try {
      const dirs = { key: join(dir, 'key'), shots: join(dir, 'shots') };
      const key = { runId: 'r', seed: 's', slot: 1, createdAt: 'now', pairsDir: 'p', pairs: {} };
      const index = { runId: 'r', app: 'app', shots: [{ file: 'b.png' }, { file: 'a.png' }] };
      expect(writeRunOutputs(false, dirs, { key, index })).toBe(join(dirs.key, 'key.json'));
      expect(JSON.parse(readFileSync(join(dirs.key, 'key.json'), 'utf8'))).toEqual(key);
      writeRunOutputs(true, dirs, { key, index });
      const written = JSON.parse(readFileSync(join(dirs.shots, 'index.json'), 'utf8'));
      expect(written.shots.map((s: { file: string }) => s.file)).toEqual(['a.png', 'b.png']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the CLI writes them before it releases the slot lock', () => {
    const cli = readFileSync(join(APP_DIRS.app, '..', '..', 'tools', 'parity', 'src', 'cli.ts'), 'utf8');
    const write = cli.indexOf('writeRunOutputs(');
    const cleanup = cli.indexOf('await cleanup();', cli.indexOf('} finally {', write - 2000));
    expect(write).toBeGreaterThan(0);
    expect(write).toBeLessThan(cleanup);
  });
});

describe('slot .dev.vars', () => {
  it('forces APP_ORIGIN to the slot and COOKIE_PREFIX to empty, keeping the rest', () => {
    const out = slotDevVars('APP_ORIGIN=http://x\nTURNSTILE_SECRET=abc\n', 'http://localhost:8201');
    expect(out).toBe('APP_ORIGIN=http://localhost:8201\nTURNSTILE_SECRET=abc\nCOOKIE_PREFIX=""\n');
    expect(slotDevVars('COOKIE_PREFIX=__Host-\r\nX=1', 'http://l')).toBe(
      'COOKIE_PREFIX=""\nX=1\nAPP_ORIGIN=http://l\n',
    );
  });
});

describe('fixture', () => {
  it("the ledger adds up to the state's points (mission bonuses included)", () => {
    const db = seededDb();
    try {
      db.exec(buildFixtureSql(base, FROZEN_MS, []).sql);
      const sum = db.prepare("SELECT SUM(points) AS n FROM point_ledger WHERE user_id = 'U_PARITY'").get() as {
        n: number;
      };
      expect(sum.n).toBe(base.game.points);
      expect(base.game.points).toBe(340);
      const missions = db
        .prepare("SELECT n FROM user_kind_counts WHERE user_id = 'U_PARITY' AND kind = 'mission'")
        .get() as { n: number };
      const done = Object.values(base.game.daily as Record<string, { missions: Record<string, boolean> }>).reduce(
        (a, d) => a + Object.values(d.missions).filter(Boolean).length,
        0,
      );
      expect(missions.n).toBe(done);
      // Per day too: each day's ledger rows add up to that day's points.
      const days = db
        .prepare(
          "SELECT local_date AS d, SUM(points) AS n FROM point_ledger WHERE user_id = 'U_PARITY' GROUP BY local_date",
        )
        .all() as { d: string; n: number }[];
      for (const { d, n } of days) expect(n, d).toBe(base.game.daily[d]?.points);
    } finally {
      db.close();
    }
  });

  it('concluido-1 is captured as a user who finished episode 1', () => {
    const route = appRoutes(base).find((r) => r.id === 'concluido-1');
    expect(route?.user).toBe('ep1-done');
    const s = rawState('ep1-done', base);
    expect(s.epsDone[1]).toBe(true);
    expect(s.prog[1]).toBe(10);
    // The main fixture itself is still mid-episode (the other routes rely on it).
    expect(base.epsDone?.[1]).toBeFalsy();
  });
});

describe('wrangler `local` environments (dev without the remote-only AI binding)', () => {
  type Cfg = Record<string, unknown> & { env?: Record<string, Record<string, unknown>> };
  for (const app of ['app', 'admin'] as const) {
    it(`${app}: env.local repeats every binding except ai`, () => {
      const cfg = parseJsonc<Cfg>(readFileSync(join(APP_DIRS[app], 'wrangler.jsonc'), 'utf8'));
      const local = cfg.env?.local;
      expect(local).toBeTruthy();
      expect(cfg.ai).toBeTruthy();
      expect(local?.ai).toBeUndefined();
      for (const k of ['d1_databases', 'r2_buckets', 'ratelimits', 'vars']) expect(local?.[k], k).toEqual(cfg[k]);
      const pkg = JSON.parse(readFileSync(join(APP_DIRS[app], 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts.dev).toMatch(/--env local/);
    });
  }

  it('app: the retention cron is scheduled', () => {
    const cfg = parseJsonc<{ triggers?: { crons?: string[] } }>(
      readFileSync(join(APP_DIRS.app, 'wrangler.jsonc'), 'utf8'),
    );
    expect(cfg.triggers?.crons?.length).toBeGreaterThan(0);
  });
});
