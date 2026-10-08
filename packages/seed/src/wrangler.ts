// Thin wrapper over the wrangler CLI, run from apps/app (its wrangler.jsonc names the D1 database,
// the R2 bucket and the migrations dir). `--local` writes into a Miniflare persist dir, `--remote`
// into the real account. Wrangler is started through `node <wrangler.js>` (no npx/shell quoting).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const APP_DIR = join(REPO_ROOT, 'apps', 'app');
export const D1_NAME = 'tie-db';
export const R2_BUCKET = 'tie-media';

export type Target = { mode: 'local'; persistTo: string | null } | { mode: 'remote' };

/** Relative --persist-to paths resolve from apps/app, exactly like `wrangler dev --persist-to` run there. */
export function resolvePersist(p: string | null | undefined): string | null {
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(APP_DIR, p);
}

export const targetLabel = (t: Target): string =>
  t.mode === 'remote' ? 'remote' : `local:${t.persistTo ?? join(APP_DIR, '.wrangler', 'state')}`;

/** Where Miniflare keeps R2 objects for a local target (to detect a wiped persist dir). */
export const localR2Dir = (t: Target): string | null =>
  t.mode === 'local' ? join(t.persistTo ?? join(APP_DIR, '.wrangler', 'state'), 'v3', 'r2') : null;

export function targetFlags(t: Target): string[] {
  if (t.mode === 'remote') return ['--remote'];
  return t.persistTo ? ['--local', '--persist-to', t.persistTo] : ['--local'];
}

function wranglerBin(): string {
  const require = createRequire(join(APP_DIR, 'package.json'));
  const pkg = require.resolve('wrangler/package.json');
  const bin = join(pkg, '..', 'bin', 'wrangler.js');
  if (!existsSync(bin)) throw new Error(`wrangler binary not found at ${bin}`);
  return bin;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function wrangler(args: string[], opts: { quiet?: boolean; allowFail?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wranglerBin(), ...args], {
      cwd: APP_DIR,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const res = { code: code ?? 1, stdout, stderr };
      if (res.code !== 0 && !opts.allowFail) {
        reject(new Error(`wrangler ${args.slice(0, 4).join(' ')} failed (${res.code}):\n${stderr || stdout}`));
        return;
      }
      if (!opts.quiet && res.code !== 0) process.stderr.write(stderr);
      resolvePromise(res);
    });
  });
}

export async function applyMigrations(t: Target): Promise<void> {
  await wrangler(['d1', 'migrations', 'apply', D1_NAME, ...targetFlags(t)]);
}

export async function executeFile(t: Target, file: string): Promise<void> {
  await wrangler(['d1', 'execute', D1_NAME, ...targetFlags(t), '--file', file, '--yes']);
}

/** Runs one or more `;`-separated statements and returns each statement's result rows. */
export async function query<T = Record<string, unknown>>(t: Target, sql: string): Promise<T[][]> {
  const res = await wrangler(['d1', 'execute', D1_NAME, ...targetFlags(t), '--json', '--command', sql], {
    quiet: true,
  });
  const start = res.stdout.indexOf('[');
  if (start < 0) throw new Error(`wrangler d1 execute --json returned no JSON:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.slice(start)) as { results?: T[]; success?: boolean }[];
  return parsed.map((r) => r.results ?? []);
}

export async function r2Put(t: Target, key: string, file: string, contentType: string, cacheControl?: string) {
  await wrangler([
    'r2',
    'object',
    'put',
    `${R2_BUCKET}/${key}`,
    '--file',
    file,
    '--content-type',
    contentType,
    ...(cacheControl ? ['--cache-control', cacheControl] : []),
    ...targetFlags(t),
  ]);
}
