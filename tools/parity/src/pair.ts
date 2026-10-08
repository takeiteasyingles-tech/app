// Blind pairs. pairId = sha1(route + viewport).slice(0, 10); which side is A comes from
// HMAC-SHA256(seed, pairId)[0] & 1. The critic's dir gets only A.png, B.png and meta.json
// {route, viewport}; who is who, the pixelmatch diff % and the diff PNGs go to the key dir only.
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Side } from './determinism';

export const pairIdOf = (route: string, viewport: string) =>
  createHash('sha1')
    .update(route + viewport)
    .digest('hex')
    .slice(0, 10);

/** true → A is the app, B the prototype. */
export const swapOf = (seed: string, pairId: string) =>
  ((createHmac('sha256', seed).update(pairId).digest()[0] as number) & 1) === 1;

export interface SideShot {
  png: Buffer;
  finalUrl: string;
  errors: string[];
  placeholder: boolean;
  /** CSS-px height the page was grown to before the full-page shot. */
  contentHeight?: number;
  capped?: boolean;
}

export interface KeyEntry {
  route: string;
  hash: string;
  viewport: string;
  /** The app-side fixture user of this job (null: signed out). */
  userId?: string | null;
  A: Side;
  B: Side;
  diffPct: number;
  diffPng: string;
  size: { prototype: [number, number]; app: [number, number] };
  prototype: Omit<SideShot, 'png'>;
  app: Omit<SideShot, 'png'>;
}

export interface Key {
  runId: string;
  seed: string;
  slot: number;
  createdAt: string;
  pairsDir: string;
  pairs: Record<string, KeyEntry>;
}

const PAD = [255, 0, 255, 255] as const;

/** Pads an image to w×h with opaque magenta, so a height difference counts as a difference. */
function padTo(img: PNG, w: number, h: number): Buffer {
  if (img.width === w && img.height === h) return img.data;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < out.length; i += 4) out.set(PAD, i);
  for (let y = 0; y < img.height; y++) {
    img.data.copy(out, y * w * 4, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return out;
}

export function diff(
  a: Buffer,
  b: Buffer,
): { pct: number; png: Buffer; sizeA: [number, number]; sizeB: [number, number] } {
  const ia = PNG.sync.read(a);
  const ib = PNG.sync.read(b);
  const w = Math.max(ia.width, ib.width);
  const h = Math.max(ia.height, ib.height);
  const out = new PNG({ width: w, height: h });
  const n = pixelmatch(padTo(ia, w, h), padTo(ib, w, h), out.data, w, h, { threshold: 0.1, includeAA: false });
  return {
    pct: Math.round((n / (w * h)) * 10_000) / 100,
    png: PNG.sync.write(out),
    sizeA: [ia.width, ia.height],
    sizeB: [ib.width, ib.height],
  };
}

export function writePair(
  dirs: { pairs: string; key: string },
  seed: string,
  route: { id: string; hash: string },
  viewport: string,
  shots: { prototype: SideShot; app: SideShot },
  extra: { userId?: string | null } = {},
): { pairId: string; entry: KeyEntry } {
  const pairId = pairIdOf(route.id, viewport);
  const swap = swapOf(seed, pairId);
  const A: Side = swap ? 'app' : 'prototype';
  const B: Side = swap ? 'prototype' : 'app';
  const dir = join(dirs.pairs, pairId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'A.png'), shots[A].png);
  writeFileSync(join(dir, 'B.png'), shots[B].png);
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify({ route: route.id, viewport }, null, 2)}\n`);

  const d = diff(shots.prototype.png, shots.app.png);
  const diffDir = join(dirs.key, 'diff');
  mkdirSync(diffDir, { recursive: true });
  const diffPng = join('diff', `${pairId}.png`);
  writeFileSync(join(dirs.key, diffPng), d.png);
  const strip = ({ png: _png, ...rest }: SideShot) => rest;
  return {
    pairId,
    entry: {
      route: route.id,
      hash: route.hash,
      viewport,
      ...(extra.userId !== undefined ? { userId: extra.userId } : {}),
      A,
      B,
      diffPct: d.pct,
      diffPng: diffPng.split('\\').join('/'),
      size: { prototype: d.sizeA, app: d.sizeB },
      prototype: strip(shots.prototype),
      app: strip(shots.app),
    },
  };
}
