// prototipo/assets/** → media rows. Keys are content-addressed (media/{sha8}/{relpath}), so a changed
// file gets a new key (immutable caching stays correct) while its media id, derived from the path,
// stays stable for every content row that references it.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { MediaRowDb } from '@tie/shared/content/compile';
import { PROTO_DIR } from '../loadPrototype';
import { ids } from './ids';

export interface MediaFile {
  /** Path under prototipo/assets with forward slashes: 'img/gen/bg/home.webp'. */
  rel: string;
  abs: string;
  id: string;
  r2Key: string;
  sha256: string;
  bytes: number;
  mime: string;
  kind: 'image' | 'audio' | 'video' | 'pdf';
}

const TYPES: Record<string, { mime: string; kind: MediaFile['kind'] }> = {
  '.webp': { mime: 'image/webp', kind: 'image' },
  '.png': { mime: 'image/png', kind: 'image' },
  '.jpg': { mime: 'image/jpeg', kind: 'image' },
  '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.svg': { mime: 'image/svg+xml', kind: 'image' },
  '.mp3': { mime: 'audio/mpeg', kind: 'audio' },
  '.m4a': { mime: 'audio/mp4', kind: 'audio' },
  '.wav': { mime: 'audio/wav', kind: 'audio' },
  '.mp4': { mime: 'video/mp4', kind: 'video' },
  '.webm': { mime: 'video/webm', kind: 'video' },
  '.pdf': { mime: 'application/pdf', kind: 'pdf' },
};

/** temp/ (raw renders), personagens/ (character bibles) and archives never ship. */
export function isExcluded(rel: string): boolean {
  const parts = rel.split('/');
  return (
    parts.includes('temp') ||
    parts.includes('personagens') ||
    /\.zip$/i.test(rel) ||
    parts.some((p) => p.startsWith('.'))
  );
}

export const ASSETS_DIR = join(PROTO_DIR, 'assets');

function walk(dir: string, base: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (isExcluded(rel)) continue;
    if (e.isDirectory()) walk(join(dir, e.name), rel, out);
    else out.push(rel);
  }
}

export const r2KeyFor = (rel: string, sha256: string): string => `media/${sha256.slice(0, 8)}/${rel}`;

/** Every shippable asset, sorted by path. Unknown extensions fail the seed. */
export function scanMedia(root: string = ASSETS_DIR): MediaFile[] {
  const rels: string[] = [];
  walk(root, '', rels);
  return rels.sort().map((rel) => {
    const abs = join(root, rel);
    const type = TYPES[extname(rel).toLowerCase()];
    if (!type) throw new Error(`media: unsupported file type ${rel}`);
    const buf = readFileSync(abs);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    return {
      rel,
      abs,
      id: ids.media(rel),
      r2Key: r2KeyFor(rel, sha256),
      sha256,
      bytes: statSync(abs).size,
      mime: type.mime,
      kind: type.kind,
    };
  });
}

export function mediaRow(f: MediaFile, now: number): MediaRowDb {
  return {
    id: f.id,
    r2_key: f.r2Key,
    kind: f.kind,
    mime: f.mime,
    bytes: f.bytes,
    sha256: f.sha256,
    width: null,
    height: null,
    duration_ms: null,
    source_path: `prototipo/assets/${f.rel}`,
    created_at: now,
  };
}

/** Resolves prototype 'assets/...' references to media ids; unknown references fail the seed. */
export class MediaIndex {
  private readonly byRel: Map<string, MediaFile>;
  constructor(readonly files: MediaFile[]) {
    this.byRel = new Map(files.map((f) => [f.rel, f]));
  }
  /** 'assets/img/gen/bg/home.webp' (or '' / null / undefined → null). */
  id(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const rel = ref.replace(/^\.?\/?assets\//, '');
    const f = this.byRel.get(rel);
    if (!f) throw new Error(`media: prototype references ${ref}, which is not in prototipo/assets`);
    return f.id;
  }
  has(ref: string): boolean {
    return this.byRel.has(ref.replace(/^\.?\/?assets\//, ''));
  }
  /** Files whose path starts with `prefix` (under assets/). */
  under(prefix: string): MediaFile[] {
    const p = prefix.replace(/^assets\//, '');
    return this.files.filter((f) => f.rel.startsWith(p));
  }
}
