// Media baked into published snapshots. compileContent turns media ids into '/m/<r2_key>' URLs, so a
// release keeps pointing at its files after the D1 rows move on. Every retained release can become
// current again (rollback), so a file one of them uses is "in use" just like a D1 reference.
// The keys of each release are indexed once in R2 (releases/{ver}/media.json, written at publish,
// or rebuilt from the snapshot files the first time an older release is asked about); a release is
// immutable, so its index never goes stale.
import { MEDIA_PREFIX, SETTINGS } from '@tie/shared';
import { contentKey, MANIFEST_FILE } from '@tie/shared/content/compile';
import { all, fromJson, one } from '@tie/worker-core';
import type { MediaRef } from './mediaRefs';

const INDEX_TYPE = 'application/json; charset=utf-8';
const PARALLEL = 8;

/** R2 key of a release's media index (outside content/, so the app never serves it). */
export const releaseIndexKey = (version: string): string => `releases/${version}/media.json`;

/** Every '/m/<key>' JSON string value in `texts` → the r2 keys, sorted and unique. */
export function mediaKeysIn(texts: Iterable<string>): string[] {
  const prefix = JSON.stringify(MEDIA_PREFIX)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`"${prefix}((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const keys = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      try {
        const key = JSON.parse(`"${m[1] ?? ''}"`) as string;
        if (key) keys.add(key);
      } catch {
        // not a JSON string literal: ignore
      }
    }
  }
  return [...keys].sort();
}

/** Writes the index of a release from its compiled files (publish). */
export async function writeReleaseIndex(
  bucket: R2Bucket,
  version: string,
  files: Record<string, string>,
): Promise<string[]> {
  const keys = mediaKeysIn(Object.values(files));
  await bucket.put(releaseIndexKey(version), JSON.stringify({ version, keys }), {
    httpMetadata: { contentType: INDEX_TYPE },
  });
  return keys;
}

/**
 * Media keys a release uses; null when its snapshot is gone from R2 (it cannot become current, and
 * rollback refuses it). Reads the index, or rebuilds it from content/{ver}/* and stores it.
 */
export async function releaseMediaKeys(bucket: R2Bucket, version: string): Promise<string[] | null> {
  const idx = await bucket.get(releaseIndexKey(version));
  if (idx) {
    const v = fromJson<{ version?: unknown; keys?: unknown } | null>(await idx.text(), null);
    if (v && v.version === version && Array.isArray(v.keys) && v.keys.every((k) => typeof k === 'string')) {
      return v.keys as string[];
    }
  }
  if (!(await bucket.head(contentKey(version, MANIFEST_FILE)))) return null;
  const prefix = contentKey(version, '');
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) if (o.key !== contentKey(version, MANIFEST_FILE)) names.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const files: Record<string, string> = {};
  for (let i = 0; i < names.length; i += PARALLEL) {
    await Promise.all(
      names.slice(i, i + PARALLEL).map(async (key) => {
        const obj = await bucket.get(key);
        if (obj) files[key] = await obj.text();
      }),
    );
  }
  return writeReleaseIndex(bucket, version, files);
}

/** Versions a learner can be served: the current one and every retained release (rollback). */
async function liveVersions(db: D1Database): Promise<{ version: string; current: boolean }[]> {
  const [cur, rows] = await Promise.all([
    one<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', SETTINGS.contentCurrent),
    all<{ version: string }>(db, 'SELECT version FROM content_releases ORDER BY published_at DESC, id DESC'),
  ]);
  const out = rows.map((r) => ({ version: r.version, current: r.version === cur?.value }));
  if (cur?.value && !out.some((r) => r.current)) out.unshift({ version: cur.value, current: true });
  return out;
}

/** Releases whose snapshot uses the file at `r2Key` (column 'current' for the live one). */
export async function releaseMediaRefs(db: D1Database, bucket: R2Bucket, r2Key: string): Promise<MediaRef[]> {
  const key = r2Key.replace(/^\/+/, '');
  const versions = await liveVersions(db);
  const out: MediaRef[] = [];
  for (let i = 0; i < versions.length; i += PARALLEL) {
    const chunk = versions.slice(i, i + PARALLEL);
    const keys = await Promise.all(chunk.map((v) => releaseMediaKeys(bucket, v.version)));
    chunk.forEach((v, j) => {
      if (keys[j]?.includes(key)) {
        out.push({ table: 'content_releases', id: v.version, column: v.current ? 'current' : 'release' });
      }
    });
  }
  return out;
}

/** Media keys of a release with no media row any more (null when the snapshot itself is gone). */
export async function missingReleaseMedia(db: D1Database, bucket: R2Bucket, version: string): Promise<string[] | null> {
  const keys = await releaseMediaKeys(bucket, version);
  if (!keys) return null;
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const rows = await all<{ r2_key: string }>(
      db,
      `SELECT r2_key FROM media WHERE r2_key IN (${chunk.map(() => '?').join(', ')})`,
      ...chunk,
    );
    for (const r of rows) found.add(r.r2_key);
  }
  return keys.filter((k) => !found.has(k));
}
