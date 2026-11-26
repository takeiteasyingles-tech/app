// screens/lazy.ts: a screen chunk a deploy removed reloads the page once, never in a loop.
import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, reloadForNewBuild } from '../src/screens/lazy';

function env(over: Partial<{ online: boolean; now: number }> = {}) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  return { online: true, storage, reload: vi.fn(), now: 1_000_000, ...over, store };
}

describe('reloadForNewBuild', () => {
  it('reloads once, then lets the error show while the guard lasts', () => {
    const e = env();
    expect(reloadForNewBuild(e)).toBe(true);
    expect(e.reload).toHaveBeenCalledTimes(1);
    expect(e.store.get(CHUNK_RELOAD_KEY)).toBe('1000000');
    expect(reloadForNewBuild({ ...e, now: 1_030_000 })).toBe(false);
    expect(e.reload).toHaveBeenCalledTimes(1);
    // A later deploy in the same tab gets its own reload.
    expect(reloadForNewBuild({ ...e, now: 1_100_000 })).toBe(true);
  });

  it('never reloads offline or without storage', () => {
    const off = env({ online: false });
    expect(reloadForNewBuild(off)).toBe(false);
    expect(off.reload).not.toHaveBeenCalled();
    const blocked = { ...env(), storage: null };
    expect(reloadForNewBuild(blocked)).toBe(false);
    expect(blocked.reload).not.toHaveBeenCalled();
  });
});
