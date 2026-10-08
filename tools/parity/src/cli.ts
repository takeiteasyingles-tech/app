// npm run parity -- --slot <N> --routes <ids|all> --viewports mobile,desktop --seed <s> [--app app|admin]
//                   [--shots-only] [--skip-build] [--force-seed] [--real-clock] [--workers <n>]
// Builds, seeds, applies the fixture, starts the slot's servers, captures, writes the blind pairs (or
// plain shots), stops the servers and prints where the pairs are.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from '@playwright/test';
import { COOKIES } from '@tie/shared/constants';
import { type ShotResult, shoot } from './capture';
import { type AppName, isViewport, runDirs, runIdOf, type ViewportName } from './config';
import { launchBrowser } from './determinism';
import { type JobSpec, jobTag, loadFixture, storageOf } from './fixture/state';
import { type KeyEntry, writePair } from './pair';
import { killAll } from './proc';
import { adminRoutes, appRoutes, hashOf, type RouteDef, selectRoutes } from './routes';
import { writeRunOutputs } from './runOutputs';
import { type SlotEnv, startSlot } from './slot';

interface Args {
  slot: number;
  routes: string;
  viewports: ViewportName[];
  seed: string;
  app: AppName;
  shotsOnly: boolean;
  skipBuild: boolean;
  forceSeed: boolean;
  realClock: boolean;
  workers: number;
}

function args(): Args {
  const { values } = parseArgs({
    options: {
      slot: { type: 'string' },
      routes: { type: 'string', default: 'all' },
      viewports: { type: 'string', default: 'mobile,desktop' },
      seed: { type: 'string' },
      app: { type: 'string', default: 'app' },
      'shots-only': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      'force-seed': { type: 'boolean', default: false },
      'real-clock': { type: 'boolean', default: false },
      workers: { type: 'string', default: '3' },
    },
  });
  const usage =
    'usage: npm run parity -- --slot <N> --routes <ids|all> --viewports mobile,desktop --seed <s> [--app app|admin] [--shots-only]';
  if (values.slot === undefined) throw new Error(`--slot is required\n${usage}`);
  const app = values.app as AppName;
  if (app !== 'app' && app !== 'admin') throw new Error(`--app must be app or admin\n${usage}`);
  const shotsOnly = values['shots-only'] || app === 'admin';
  const seed = values.seed ?? (shotsOnly ? 'shots' : '');
  if (!seed) throw new Error(`--seed is required for blind pairs\n${usage}`);
  const viewports = values.viewports
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const bad = viewports.filter((v) => !isViewport(v));
  if (bad.length || !viewports.length) throw new Error(`--viewports: unknown ${bad.join(', ')} (mobile, desktop)`);
  return {
    slot: Number(values.slot),
    routes: values.routes,
    viewports: viewports as ViewportName[],
    seed,
    app,
    shotsOnly,
    skipBuild: values['skip-build'],
    forceSeed: values['force-seed'],
    realClock: values['real-clock'],
    workers: Math.max(1, Math.min(8, Number(values.workers) || 3)),
  };
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

interface Job {
  route: RouteDef;
  viewport: ViewportName;
  /** Per-job fixture user tag (null: signed out, or admin shots). */
  tag: string | null;
}

/** The job's user (own D1 rows + session) and what both sides load: cookie, localStorage, hash. */
function jobInputs(env: SlotEnv, job: Job) {
  if (env.app === 'admin') {
    const staff = job.route.staff ?? 'super_admin';
    const who = staff === 'editor' ? env.fixtures.editor : staff === 'super_admin' ? env.fixtures.admin : null;
    if (staff === 'editor' && !who) throw new Error('no editor fixture in this slot');
    return {
      cookie: who ? { name: COOKIES.admin, value: who.token } : null,
      state: null,
      hash: job.route.hash,
      userId: null,
    };
  }
  if (!job.tag) return { cookie: null, state: null, hash: job.route.hash, userId: null };
  const u = env.fixtures.jobs[job.tag];
  if (!u) throw new Error(`no fixture user for job ${job.tag}`);
  return {
    // Plain-HTTP localhost: the cookie name has no __Host- prefix.
    cookie: { name: COOKIES.app, value: u.token },
    state: u.state,
    hash: hashOf(job.route, u.state),
    userId: u.userId,
  };
}

async function main() {
  const a = args();
  const runId = runIdOf(a.slot, a.seed);
  const dirs = runDirs(runId);
  const fixture = loadFixture();
  const routes = a.app === 'admin' ? adminRoutes(a.routes) : selectRoutes(appRoutes(fixture), a.routes);

  const t0 = Date.now();
  let env: SlotEnv | null = null;
  let browser: Browser | null = null;
  const cleanup = async () => {
    await browser?.close().catch(() => {});
    browser = null;
    await env?.close();
    env = null;
  };
  const onSignal = () => {
    console.log('\ninterrupted: stopping the slot (build/seed/wrangler children included)…');
    // Synchronous first: kills every child we started (also mid-build, mid-seed or while waiting for
    // wrangler) and frees our locks, so nothing keeps writing after we exit.
    killAll();
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const jobs: Job[] = routes.flatMap((route) =>
    a.viewports.map((viewport) => ({
      route,
      viewport,
      tag: a.app === 'app' && route.user !== 'none' ? jobTag(route.id, viewport) : null,
    })),
  );
  const jobSpecs: JobSpec[] = jobs.flatMap((j) =>
    j.tag && j.route.user !== 'none' ? [{ tag: j.tag, user: j.route.user, onbStep: j.route.onbStep }] : [],
  );
  const keyPairs: Record<string, KeyEntry> = {};
  const shotsIndex: {
    route: string;
    hash: string;
    viewport: string;
    file: string;
    finalUrl: string;
    contentHeight: number;
    errors: string[];
  }[] = [];
  try {
    env = await startSlot({
      slot: a.slot,
      app: a.app,
      prototype: !a.shotsOnly,
      skipBuild: a.skipBuild,
      forceSeed: a.forceSeed,
      realClock: a.realClock,
      jobs: jobSpecs,
    });
    const e = env;
    // Only now, holding the slot lock: a second run with the same runId waits instead of deleting the
    // first run's output while it is being written.
    rmSync(dirs.run, { recursive: true, force: true });
    if (!a.shotsOnly) rmSync(dirs.key, { recursive: true, force: true });
    browser = await launchBrowser();
    const b = browser;
    console.log(`capturing ${jobs.length} ${a.shotsOnly ? 'shots' : 'pairs'} (${a.workers} at a time)…`);
    let done = 0;
    await pool(jobs, a.workers, async (job) => {
      const { route, viewport } = job;
      const inp = jobInputs(e, job);
      const appShot = shoot(b, { side: 'app', origin: e.origin, route, hash: inp.hash, viewport, cookie: inp.cookie });
      if (a.shotsOnly) {
        const shot = await appShot;
        mkdirSync(dirs.shots, { recursive: true });
        const file = `${route.id}-${viewport}.png`;
        writeFileSync(join(dirs.shots, file), shot.png);
        shotsIndex.push({
          route: route.id,
          hash: inp.hash,
          viewport,
          file,
          finalUrl: shot.finalUrl,
          contentHeight: shot.contentHeight,
          errors: shot.errors,
        });
      } else {
        const protoShot = shoot(b, {
          side: 'prototype',
          origin: e.protoUrl as string,
          route,
          hash: inp.hash,
          viewport,
          storage: storageOf(inp.state),
        });
        const [p, ap] = (await Promise.all([protoShot, appShot])) as [ShotResult, ShotResult];
        const { pairId, entry } = writePair(
          dirs,
          a.seed,
          { id: route.id, hash: inp.hash },
          viewport,
          { prototype: p, app: ap },
          { userId: inp.userId },
        );
        keyPairs[pairId] = entry;
      }
      done++;
      console.log(`  [${done}/${jobs.length}] ${route.id} ${viewport}`);
    });
    // Written while the slot lock is still held: a second run with the same runId (waiting on the
    // lock) starts by deleting this run's output, so it must not get the lock before key.json /
    // index.json exist (spec 06 "Parity harness").
    shotsIndex.sort((x, y) => x.file.localeCompare(y.file));
    writeRunOutputs(a.shotsOnly, dirs, {
      index: { runId, app: a.app, shots: shotsIndex },
      key: {
        runId,
        seed: a.seed,
        slot: a.slot,
        createdAt: new Date().toISOString(),
        pairsDir: dirs.pairs,
        pairs: keyPairs,
      },
    });
  } finally {
    await cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  if (a.shotsOnly) {
    console.log(`\nservers stopped. ${shotsIndex.length} shots in ${secs} s`);
    console.log(`shots: ${dirs.shots}`);
    for (const s of shotsIndex)
      console.log(`  ${s.file.padEnd(40)} #/${s.hash}${s.errors.length ? `  (${s.errors.length} errors)` : ''}`);
    return;
  }
  const list = Object.entries(keyPairs).sort(
    ([, x], [, y]) => x.route.localeCompare(y.route) || x.viewport.localeCompare(y.viewport),
  );
  console.log(`\nservers stopped. ${list.length} pairs in ${secs} s (run ${runId})`);
  console.log(`pairs: ${dirs.pairs}`);
  for (const [pairId, x] of list) console.log(`  ${pairId}  ${x.route.padEnd(18)} ${x.viewport}`);
  console.log(`key (never show to critics): ${dirs.key}`);
}

main().catch((err) => {
  killAll();
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
