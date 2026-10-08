// Child processes (Windows-safe), process-tree kill, HTTP readiness and a cross-process file lock.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { APP_DIRS } from './config';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Every child process and lock this process owns, so an interrupt (Ctrl+C during build, seed, fixture
// apply or the wrangler readiness wait) can kill the whole tree and free the locks before exiting.
const liveChildren = new Set<ChildProcess>();
const heldLocks = new Set<() => void>();

/** Registers a child for killAll(); it unregisters itself when it exits. */
export function track<T extends ChildProcess>(child: T): T {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  child.once('error', () => liveChildren.delete(child));
  return child;
}

/** Kills every tracked child (with its descendants) and releases every lock held by this process. */
export function killAll(): void {
  for (const c of [...liveChildren]) killTree(c);
  liveChildren.clear();
  for (const release of [...heldLocks]) release();
  heldLocks.clear();
}

/** Number of tracked live children (tests / diagnostics). */
export const liveChildCount = () => liveChildren.size;

export interface RunOpts {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Prefix for streamed output lines; null keeps the output quiet (still captured). */
  tag?: string | null;
  allowFail?: boolean;
}

export interface RunResult {
  code: number;
  out: string;
}

/** Runs `node <script> ...args` to completion, streaming tagged output. */
export function runNode(script: string, args: string[], opts: RunOpts): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = track(
      spawn(process.execPath, [script, ...args], {
        cwd: opts.cwd,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
    let out = '';
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      out += s;
      if (opts.tag !== null) for (const line of s.split(/\r?\n/)) if (line.trim()) console.log(`[${opts.tag}] ${line}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      const res = { code: code ?? 1, out };
      if (res.code !== 0 && !opts.allowFail)
        reject(new Error(`${script} ${args.join(' ')} exited ${res.code}\n${out.slice(-4000)}`));
      else resolve(res);
    });
  });
}

/** `npm ...` without a shell: through npm-cli.js (npm_execpath when run by npm, else next to node). */
export function npmCli(): string {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/.test(fromEnv)) return fromEnv;
  const guess = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return guess;
}

/** Resolves an installed package's bin script (e.g. wrangler/bin/wrangler.js) from apps/app. */
export function binOf(pkg: string, rel: string): string {
  const require = createRequire(join(APP_DIRS.app, 'package.json'));
  return join(dirname(require.resolve(`${pkg}/package.json`)), rel);
}

/** Kills a process and all of its children (wrangler → workerd, esbuild). */
export function killTree(child: ChildProcess | number | undefined): void {
  const pid = typeof child === 'number' ? child : child?.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls `url` until it answers (any HTTP status) or the deadline passes. */
export async function waitForHttp(url: string, timeoutMs: number, isDead?: () => string | null): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const dead = isDead?.();
    if (dead) throw new Error(dead);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await res.arrayBuffer();
      return;
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url} (${last})`);
}

/** True when nothing listens on 127.0.0.1:port (and ::1:port). */
export async function portFree(port: number): Promise<boolean> {
  const { createServer } = await import('node:net');
  const tryHost = (host: string) =>
    new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'));
      srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
    });
  return (await tryHost('127.0.0.1')) && (await tryHost('::1'));
}

/** True when the lock's owner is dead or the lock is older than staleMs; false if it vanished. */
function lockIsStale(file: string, staleMs = 30 * 60_000): boolean {
  try {
    const pid = Number(readFileSync(file, 'utf8'));
    const age = Date.now() - statSync(file).mtimeMs;
    return !pid || !pidAlive(pid) || age > staleMs;
  } catch {
    return false; // vanished between calls: retry
  }
}

/** A takeover side lock older than this was left by a crash and is cleared. */
export const TAKEOVER_STALE_MS = 30_000;

/**
 * Removes a stale lock, serialized through a short-lived side lock (`<file>.takeover`) and re-checking
 * staleness while holding it. Without it, two waiters that both saw the dead owner could both delete
 * and recreate the lock: the second delete would remove the first one's fresh lock, and both would
 * believe they hold it. True when this call held the side lock (the caller retries its O_EXCL create
 * at once); false while another process is taking over (the caller waits).
 */
function takeOver(file: string, stillStale: () => boolean): boolean {
  const side = `${file}.takeover`;
  let fd: number;
  try {
    fd = openSync(side, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    try {
      if (Date.now() - statSync(side).mtimeMs > TAKEOVER_STALE_MS) rmSync(side, { force: true });
    } catch {
      // gone already
    }
    return false;
  }
  try {
    closeSync(fd);
    if (stillStale()) rmSync(file, { force: true });
  } finally {
    rmSync(side, { force: true });
  }
  return true;
}

/**
 * Exclusive lock through an O_EXCL file holding the owner pid. A lock whose owner is dead (or older
 * than staleMs) is taken over (takeOver). Returns the release function.
 */
export async function acquireLock(
  file: string,
  opts: { timeoutMs?: number; staleMs?: number; onWait?: () => void } = {},
) {
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let warned = false;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        heldLocks.delete(release);
        // Only remove the file while it is still ours (never another process's lock taken after ours).
        try {
          if (Number(readFileSync(file, 'utf8')) === process.pid) rmSync(file, { force: true });
        } catch {
          // already gone
        }
      };
      heldLocks.add(release);
      return release;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // Retry at once after our own takeover; while someone else's runs, wait like for a live lock.
    if (lockIsStale(file, opts.staleMs) && takeOver(file, () => lockIsStale(file, opts.staleMs))) continue;
    if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${file}`);
    if (!warned) {
      opts.onWait?.();
      warned = true;
    }
    await sleep(1000);
  }
}
