// Publish: read the content tables back from D1 (so admin edits and the config rows the seed only
// inserts once are respected), compile them, upload content/{ver}/* to R2, then record the release
// and point app_settings['content.current'] at it. Same version → same files, nothing re-uploaded.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS } from '@tie/shared/constants';
import {
  CONTENT_TABLES,
  type CompiledContent,
  type ContentRows,
  compileContent,
  contentKey,
  MANIFEST_FILE,
} from '@tie/shared/content/compile';
import { sqlLiteral } from './emitSql';
import { type UploadItem, uploadAll } from './uploadMedia';
import { executeFile, query, type Target } from './wrangler';

export const OUT_DIR = fileURLToPath(new URL('../out/', import.meta.url));
export const CONTENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export async function readContentRows(t: Target): Promise<ContentRows> {
  const sql = CONTENT_TABLES.map((table) => `SELECT * FROM ${table}`).join('; ');
  const results = await query(t, sql);
  if (results.length !== CONTENT_TABLES.length) {
    throw new Error(`publish: expected ${CONTENT_TABLES.length} result sets, got ${results.length}`);
  }
  return Object.fromEntries(CONTENT_TABLES.map((table, i) => [table, results[i] ?? []])) as unknown as ContentRows;
}

/** Writes the compiled files under out/content/{ver}/ and returns them as upload items. */
export function writeCompiled(compiled: CompiledContent, outDir: string = OUT_DIR): UploadItem[] {
  const files: Record<string, string> = { ...compiled.files, [MANIFEST_FILE]: JSON.stringify(compiled.manifest) };
  return Object.entries(files).map(([path, text]) => {
    const file = join(outDir, 'content', compiled.version, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return {
      key: contentKey(compiled.version, path),
      file,
      contentType: 'application/json; charset=utf-8',
      // The manifest carries publishedAt, so it is re-put whenever its text changes.
      sha256: createHash('sha256').update(text).digest('hex'),
      cacheControl: CONTENT_CACHE_CONTROL,
    };
  });
}

export function releaseSql(compiled: CompiledContent, publishedBy: string, notes: string | null, now: number): string {
  const v = compiled.version;
  return [
    `INSERT INTO content_releases(id, version, manifest, notes, published_by, published_at) VALUES(${[
      `rel-${v.slice(0, 16)}`,
      v,
      JSON.stringify(compiled.manifest),
      notes,
      publishedBy,
      compiled.manifest.publishedAt,
    ]
      .map(sqlLiteral)
      .join(', ')}) ON CONFLICT(version) DO NOTHING;`,
    `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(${[
      SETTINGS.contentCurrent,
      v,
      publishedBy,
      now,
    ]
      .map(sqlLiteral)
      .join(
        ', ',
      )}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;`,
  ].join('\n');
}

export interface PublishOptions {
  now?: number;
  publishedBy?: string;
  notes?: string | null;
  log?: (msg: string) => void;
}

export async function publish(t: Target, opts: PublishOptions = {}): Promise<CompiledContent> {
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const rows = await readContentRows(t);
  // An unchanged set keeps its release's publishedAt, so its manifest (and ETag) stay stable.
  const prior = await query<{ published_at: number; version: string }>(
    t,
    'SELECT r.version, r.published_at FROM content_releases r ORDER BY r.published_at DESC',
  );
  let compiled = await compileContent(rows, { publishedAt: now });
  const existing = prior[0]?.find((r) => r.version === compiled.version);
  if (existing) compiled = await compileContent(rows, { publishedAt: existing.published_at });
  log(
    `  version ${compiled.version} (${Object.keys(compiled.files).length} files${existing ? ', already released' : ''})`,
  );

  const items = writeCompiled(compiled);
  const up = await uploadAll(t, items, { log, concurrency: t.mode === 'remote' ? 4 : 1 });
  log(`  r2: ${up.uploaded} uploaded, ${up.skipped} unchanged`);

  const sqlFile = join(OUT_DIR, 'release.sql');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(sqlFile, releaseSql(compiled, opts.publishedBy ?? 'seed', opts.notes ?? 'seed', now));
  await executeFile(t, sqlFile);
  return compiled;
}
