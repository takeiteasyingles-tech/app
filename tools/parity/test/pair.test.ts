import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { diff, type Key, pairIdOf, type SideShot, swapOf, writePair } from '../src/pair';
import { parseVote, reveal } from '../src/reveal';

const png = (w: number, h: number, rgb: [number, number, number]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([...rgb, 255], i);
  return PNG.sync.write(p);
};
const shot = (buf: Buffer): SideShot => ({ png: buf, finalUrl: 'http://x/#/r', errors: [], placeholder: false });

const tmp: string[] = [];
const tempDirs = () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-test-'));
  tmp.push(root);
  return { pairs: join(root, 'run', 'pairs'), key: join(root, 'run-key') };
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('pair ids and swap', () => {
  it('pairId is sha1(route + viewport) truncated to 10 hex chars', () => {
    const want = createHash('sha1').update('iniciomobile').digest('hex').slice(0, 10);
    expect(pairIdOf('inicio', 'mobile')).toBe(want);
    expect(pairIdOf('inicio', 'mobile')).toMatch(/^[0-9a-f]{10}$/);
    expect(pairIdOf('inicio', 'desktop')).not.toBe(pairIdOf('inicio', 'mobile'));
  });

  it('swap is the low bit of HMAC-SHA256(seed, pairId)[0]', () => {
    for (const seed of ['abc', 'critic-7', 'x']) {
      for (const id of ['0123456789', pairIdOf('entrar', 'desktop'), pairIdOf('perfil', 'mobile')]) {
        const first = createHmac('sha256', seed).update(id).digest()[0] as number;
        expect(swapOf(seed, id)).toBe((first & 1) === 1);
      }
    }
  });

  it('different seeds give different A/B assignments across many pairs', () => {
    const ids = Array.from({ length: 40 }, (_, i) => pairIdOf(`r${i}`, 'mobile'));
    const a = ids.map((id) => swapOf('seed-1', id));
    const b = ids.map((id) => swapOf('seed-2', id));
    expect(a).not.toEqual(b);
    expect(a.some(Boolean) && a.some((x) => !x)).toBe(true);
  });
});

describe('writePair', () => {
  const route = { id: 'inicio', hash: 'inicio' };
  const proto = png(4, 4, [255, 0, 0]);
  const app = png(4, 6, [0, 0, 255]);

  for (const seed of ['seed-a', 'seed-b', 'seed-c', 'seed-d']) {
    it(`maps A/B from the swap bit and keeps the key out of the pair dir (${seed})`, () => {
      const dirs = tempDirs();
      const { pairId, entry } = writePair(dirs, seed, route, 'mobile', { prototype: shot(proto), app: shot(app) });
      expect(pairId).toBe(pairIdOf('inicio', 'mobile'));
      const swap = swapOf(seed, pairId);
      expect(entry.A).toBe(swap ? 'app' : 'prototype');
      expect(entry.B).toBe(swap ? 'prototype' : 'app');

      const dir = join(dirs.pairs, pairId);
      expect(readdirSync(dir).sort()).toEqual(['A.png', 'B.png', 'meta.json']);
      expect(readFileSync(join(dir, 'A.png')).equals(swap ? app : proto)).toBe(true);
      expect(readFileSync(join(dir, 'B.png')).equals(swap ? proto : app)).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).toEqual({ route: 'inicio', viewport: 'mobile' });

      // The diff lives in the key dir only; nothing under pairs/ reveals sides.
      expect(existsSync(join(dirs.key, entry.diffPng))).toBe(true);
      expect(readdirSync(dirs.pairs)).toEqual([pairId]);
      expect(entry.size).toEqual({ prototype: [4, 4], app: [4, 6] });
      expect(entry.diffPct).toBe(100);
    });
  }
});

describe('diff', () => {
  it('identical images are 0%, a height difference counts as different pixels', () => {
    const a = png(10, 10, [10, 20, 30]);
    expect(diff(a, a).pct).toBe(0);
    const taller = png(10, 20, [10, 20, 30]);
    expect(diff(a, taller).pct).toBe(50);
  });
});

describe('reveal', () => {
  const key: Key = {
    runId: 'slot9-x',
    seed: 'x',
    slot: 9,
    createdAt: '',
    pairsDir: '',
    pairs: {
      p1: {
        route: 'a',
        hash: 'a',
        viewport: 'mobile',
        A: 'app',
        B: 'prototype',
        diffPct: 1,
        diffPng: '',
        size: { prototype: [1, 1], app: [1, 1] },
        prototype: { finalUrl: '', errors: [], placeholder: false },
        app: { finalUrl: '', errors: [], placeholder: false },
      },
      p2: {
        route: 'b',
        hash: 'b',
        viewport: 'mobile',
        A: 'prototype',
        B: 'app',
        diffPct: 2,
        diffPng: '',
        size: { prototype: [1, 1], app: [1, 1] },
        prototype: { finalUrl: '', errors: [], placeholder: false },
        app: { finalUrl: '', errors: [], placeholder: false },
      },
      p3: {
        route: 'c',
        hash: 'c',
        viewport: 'desktop',
        A: 'prototype',
        B: 'app',
        diffPct: 3,
        diffPng: '',
        size: { prototype: [1, 1], app: [1, 1] },
        prototype: { finalUrl: '', errors: [], placeholder: false },
        app: { finalUrl: '', errors: [], placeholder: false },
      },
      p4: {
        route: 'd',
        hash: 'd',
        viewport: 'desktop',
        A: 'app',
        B: 'prototype',
        diffPct: 4,
        diffPng: '',
        size: { prototype: [1, 1], app: [1, 1] },
        prototype: { finalUrl: '', errors: [], placeholder: false },
        app: { finalUrl: '', errors: [], placeholder: false },
      },
    },
  };

  it('maps A/B votes to the side behind them, tie to tie, missing to no-vote', () => {
    const { rows, unknown, invalid } = reveal(key, { p1: 'A', p2: 'A', p3: ' TIE ', zz: 'B' });
    const by = Object.fromEntries(rows.map((r) => [r.pairId, r]));
    expect(by.p1?.winner).toBe('app');
    expect(by.p2?.winner).toBe('prototype');
    expect(by.p3?.winner).toBe('tie');
    expect(by.p4?.winner).toBe('no-vote');
    expect(by.p4?.diffPct).toBe(4);
    expect(unknown).toEqual(['zz']);
    expect(invalid).toEqual([]);
  });

  it('B votes pick the B side', () => {
    const { rows } = reveal(key, { p1: 'B', p2: 'B' });
    const by = Object.fromEntries(rows.map((r) => [r.pairId, r.winner]));
    expect(by).toMatchObject({ p1: 'prototype', p2: 'app' });
  });

  it('reports invalid vote values instead of silently dropping them', () => {
    const { rows, invalid } = reveal(key, { p1: 'x', p2: 'a', p3: 3, p4: 'B' });
    expect(invalid).toEqual([
      { pairId: 'p1', value: 'x' },
      { pairId: 'p2', value: 'a' },
      { pairId: 'p3', value: 3 },
    ]);
    expect(rows.filter((r) => r.winner === 'no-vote').map((r) => r.pairId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('parseVote', () => {
    expect(parseVote('A')).toBe('A');
    expect(parseVote(' B ')).toBe('B');
    expect(parseVote('Tie')).toBe('tie');
    expect(parseVote('b')).toBeNull();
    expect(parseVote(undefined)).toBeNull();
  });
});
