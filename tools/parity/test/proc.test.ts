// killAll(): what an interrupt runs before exiting, also mid-build/seed/wrangler-wait.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, killAll, liveChildCount, pidAlive, runNode, sleep } from '../src/proc';

describe('killAll', () => {
  it('kills tracked children (with their tree) and releases held locks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-proc-'));
    try {
      const lock = join(dir, 'x.lock');
      await acquireLock(lock);
      expect(existsSync(lock)).toBe(true);
      // A child that would run for a minute, with a grandchild of its own.
      const script = join(dir, 'long.cjs');
      writeFileSync(
        script,
        "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' }); setTimeout(() => {}, 60000);",
      );
      const run = runNode(script, [], { cwd: dir, tag: null, allowFail: true });
      await sleep(500);
      expect(liveChildCount()).toBe(1);
      killAll();
      const res = await run;
      expect(res.code).not.toBe(0);
      expect(liveChildCount()).toBe(0);
      expect(existsSync(lock)).toBe(false);
      expect(pidAlive(process.pid)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a released lock never deletes a lock file another process took over', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-proc-'));
    try {
      const lock = join(dir, 'y.lock');
      const release = await acquireLock(lock);
      writeFileSync(lock, '999999');
      release();
      expect(readFileSync(lock, 'utf8')).toBe('999999');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
