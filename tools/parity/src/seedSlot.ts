// Seeds a slot's local database (`npm run seed -- --local --persist-to .wrangler/parity-slot<N>`), skipped
// when the slot was already seeded from the same inputs, then applies the fixture users. Seeding is
// serialized across slots with a lock: the seed package writes its SQL and compiled files to one shared
// packages/seed/out dir.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { D1_NAME, targetFlags } from '@tie/seed/wrangler';
import { APP_DIRS, OUT_ROOT, PROTO_DIR, REPO_ROOT, type Slot } from './config';
import type { FixtureSql } from './fixture/sql';
import { acquireLock, binOf, npmCli, runNode } from './proc';

/** Files whose change makes a previously seeded slot stale. */
const HASH_DIRS = [
  'packages/seed/src',
  'packages/seed/prompts',
  'packages/db/migrations',
  'packages/shared/src/content',
  'packages/shared/src/domain',
];
const PROTO_HASH_DIRS = ['js', 'css'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** sha256 over the seed inputs: seed/db/shared sources and prototype js/css by content, assets by size+mtime. */
export function seedInputsHash(): string {
  const h = createHash('sha256');
  const files = [
    ...HASH_DIRS.flatMap((d) => walk(join(REPO_ROOT, d))),
    ...PROTO_HASH_DIRS.flatMap((d) => walk(join(PROTO_DIR, d))),
  ].sort();
  for (const f of files) {
    h.update(relative(REPO_ROOT, f));
    h.update(readFileSync(f));
  }
  for (const f of walk(join(PROTO_DIR, 'assets')).sort()) {
    const st = statSync(f);
    h.update(`${relative(REPO_ROOT, f)}:${st.size}:${Math.floor(st.mtimeMs)}`);
  }
  return h.digest('hex');
}

const markerFile = (sl: Slot) => join(OUT_ROOT, 'slots', `slot${sl.n}`, 'seed.json');
/** Miniflare keeps D1 here; no dir means the persist dir was wiped. */
const d1Dir = (sl: Slot) => join(sl.persistAbs, 'v3', 'd1');

export async function seedSlot(
  sl: Slot,
  opts: { force?: boolean; log?: (m: string) => void } = {},
): Promise<'seeded' | 'skipped'> {
  const log = opts.log ?? console.log;
  const hash = seedInputsHash();
  const marker = markerFile(sl);
  const fresh = () => {
    try {
      const m = JSON.parse(readFileSync(marker, 'utf8')) as { hash?: string };
      return m.hash === hash && existsSync(d1Dir(sl)) && existsSync(join(sl.persistAbs, 'v3', 'r2'));
    } catch {
      return false;
    }
  };
  if (!opts.force && fresh()) {
    log(`seed: slot ${sl.n} already seeded with the same inputs (${hash.slice(0, 12)}), skipping`);
    return 'skipped';
  }
  const release = await acquireLock(join(OUT_ROOT, '.locks', 'seed.lock'), {
    onWait: () => log('seed: another slot is seeding; waiting for the seed lock…'),
  });
  try {
    if (!opts.force && fresh()) return 'skipped';
    log(`seed: npm run seed -- --local --persist-to ${sl.persistRel}`);
    const t0 = Date.now();
    await runNode(npmCli(), ['run', 'seed', '--', '--local', '--persist-to', sl.persistRel], {
      cwd: REPO_ROOT,
      tag: `seed:s${sl.n}`,
    });
    mkdirSync(join(OUT_ROOT, 'slots', `slot${sl.n}`), { recursive: true });
    writeFileSync(
      marker,
      `${JSON.stringify({ hash, at: new Date().toISOString(), persistTo: sl.persistRel }, null, 2)}\n`,
    );
    log(`seed: done in ${Math.round((Date.now() - t0) / 1000)} s`);
    return 'seeded';
  } finally {
    release();
  }
}

/** Writes and applies the fixture SQL (fixture users + super_admin) to the slot database. */
export async function applyFixtures(sl: Slot, fx: FixtureSql, log: (m: string) => void = console.log): Promise<void> {
  const dir = join(OUT_ROOT, 'slots', `slot${sl.n}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fixtures.sql');
  writeFileSync(file, fx.sql);
  // Same command as @tie/seed's executeFile, but through runNode so an interrupt kills it too.
  const flags = targetFlags({ mode: 'local', persistTo: sl.persistAbs });
  await runNode(
    binOf('wrangler', join('bin', 'wrangler.js')),
    ['d1', 'execute', D1_NAME, ...flags, '--file', file, '--yes'],
    {
      cwd: APP_DIRS.app,
      env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
      tag: null,
    },
  );
  const jobs = Object.keys(fx.jobs).length;
  log(
    `fixtures: ${fx.users.map((u) => u.key).join(', ')}${jobs ? ` + ${jobs} per-route users` : ''} + super_admin applied`,
  );
}
