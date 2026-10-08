// Puts prototype media into R2 (tie-media) under content-addressed keys, skipping objects already
// uploaded to the same target (.seed-uploaded.json). A local target whose persist dir was wiped
// ignores the cache, so a fresh `--persist-to` always gets every object.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MediaFile } from './transform/media';
import { localR2Dir, r2Put, type Target, targetLabel } from './wrangler';

export const CACHE_FILE = fileURLToPath(new URL('../.seed-uploaded.json', import.meta.url));

/** Content media is immutable: its key changes whenever the bytes do. */
export const MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable';

type CacheData = Record<string, Record<string, string>>;

export class UploadCache {
  private data: CacheData;
  constructor(
    readonly target: Target,
    private readonly file: string = CACHE_FILE,
  ) {
    let data: CacheData = {};
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as CacheData;
    } catch {
      // first run or unreadable cache: upload everything
    }
    const r2 = localR2Dir(target);
    if (r2 && !existsSync(r2)) delete data[targetLabel(target)];
    this.data = data;
  }
  private get bucket(): Record<string, string> {
    const label = targetLabel(this.target);
    this.data[label] ??= {};
    return this.data[label] as Record<string, string>;
  }
  has(key: string, sha256: string): boolean {
    return this.bucket[key] === sha256;
  }
  mark(key: string, sha256: string): void {
    this.bucket[key] = sha256;
    writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}

export interface UploadItem {
  key: string;
  file: string;
  contentType: string;
  sha256: string;
  cacheControl?: string;
}

export async function uploadAll(
  t: Target,
  items: readonly UploadItem[],
  opts: { cache?: UploadCache; concurrency?: number; log?: (msg: string) => void } = {},
): Promise<{ uploaded: number; skipped: number }> {
  const cache = opts.cache ?? new UploadCache(t);
  const log = opts.log ?? (() => {});
  const todo = items.filter((i) => !cache.has(i.key, i.sha256));
  let next = 0;
  let done = 0;
  // Local Miniflare storage is one SQLite file per bucket: keep writers few to avoid SQLITE_BUSY.
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 1, todo.length)) }, async () => {
    while (next < todo.length) {
      const item = todo[next++] as UploadItem;
      let attempt = 0;
      for (;;) {
        try {
          await r2Put(t, item.key, item.file, item.contentType, item.cacheControl);
          break;
        } catch (err) {
          if (++attempt >= 3) throw err;
        }
      }
      cache.mark(item.key, item.sha256);
      done++;
      log(`  r2 put ${item.key} (${done}/${todo.length})`);
    }
  });
  await Promise.all(workers);
  return { uploaded: todo.length, skipped: items.length - todo.length };
}

export function mediaUploadItems(files: readonly MediaFile[]): UploadItem[] {
  return files.map((f) => ({
    key: f.r2Key,
    file: f.abs,
    contentType: f.mime,
    sha256: f.sha256,
    cacheControl: MEDIA_CACHE_CONTROL,
  }));
}

/** Upload every prototype asset (media rows are written by the content SQL). */
export function uploadMedia(t: Target, files: readonly MediaFile[], log?: (msg: string) => void) {
  return uploadAll(t, mediaUploadItems(files), { log, concurrency: t.mode === 'remote' ? 4 : 1 });
}
