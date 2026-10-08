// Brings one slot's environment up (build → seed → fixtures → servers) and down again. Shared by the
// parity CLI and tools/e2e. A per-slot lock keeps two runs from using the same slot at once.
import { join } from 'node:path';
import { buildApp } from './build';
import { type AppName, FROZEN_MS, OUT_ROOT, type Slot, slot as slotOf } from './config';
import { buildFixtureSql, type FixtureSql } from './fixture/sql';
import { type JobSpec, loadFixture } from './fixture/state';
import { acquireLock } from './proc';
import { applyFixtures, seedSlot } from './seedSlot';
import { type StaticServer, servePrototype } from './servePrototype';
import { type DevServer, ensureDevVars, startDevServer } from './wranglerDev';

export interface SlotEnvOptions {
  slot: number;
  app: AppName;
  /** Start the prototype static server too (parity runs). */
  prototype?: boolean;
  skipBuild?: boolean;
  forceSeed?: boolean;
  realClock?: boolean;
  /** One isolated fixture user per capture job (parity runs); see fixture/state.ts jobUser. */
  jobs?: readonly JobSpec[];
  log?: (m: string) => void;
}

export interface SlotEnv {
  slot: Slot;
  app: AppName;
  origin: string;
  protoUrl: string | null;
  fixtures: FixtureSql;
  /** Seconds spent per phase, for the run summary. */
  timings: Record<string, number>;
  close(): Promise<void>;
}

export async function startSlot(o: SlotEnvOptions): Promise<SlotEnv> {
  const log = o.log ?? console.log;
  const sl = slotOf(o.slot);
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Math.round((Date.now() - t0) / 100) / 10;
    }
  };
  const releaseSlot = await acquireLock(join(OUT_ROOT, '.locks', `slot${sl.n}.lock`), {
    timeoutMs: 60 * 60_000,
    // Held for the whole run: only a dead owner pid frees it.
    staleMs: Number.POSITIVE_INFINITY,
    onWait: () => log(`slot ${sl.n} is busy (another run holds it); waiting…`),
  });
  let proto: StaticServer | null = null;
  let dev: DevServer | null = null;
  const close = async () => {
    await dev?.stop().catch(() => {});
    await proto?.close().catch(() => {});
    dev = null;
    proto = null;
    releaseSlot();
  };
  try {
    ensureDevVars('app');
    if (o.app === 'admin') ensureDevVars('admin');
    if (!o.skipBuild) {
      log(`build: ${o.app} → ${sl.distDir(o.app)}`);
      await timed('build', () => buildApp(o.app, sl.distDir(o.app), { tag: `build:s${sl.n}` }));
    }
    await timed('seed', () => seedSlot(sl, { force: o.forceSeed, log }));
    const clockAnchor = Date.now();
    const fixtures = buildFixtureSql(loadFixture(), FROZEN_MS, o.jobs ?? []);
    await timed('fixtures', () => applyFixtures(sl, fixtures, log));
    if (o.prototype) proto = await servePrototype(sl.protoPort);
    log(`wrangler dev (${o.app}) on ${sl.origin}…`);
    dev = await timed('server', () => startDevServer({ app: o.app, slot: sl, realClock: o.realClock, clockAnchor }));
    return {
      slot: sl,
      app: o.app,
      origin: sl.origin,
      protoUrl: proto?.url ?? null,
      fixtures,
      timings,
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}
