// Preview / publish (editor) and releases / rollback (admin). Same pipeline as the seed's publish
// (packages/seed/src/publish.ts), run inside the Worker: read every content table from D1, compile
// with @tie/shared compileContent (Zod-validated snapshots, persona excluded), upload content/{ver}/*
// to R2 (immutable), record content_releases and point app_settings['content.current'] at it.
// tie-app's GET /api/content/manifest follows that pointer, so learners see the release at once.
// Each release also gets releases/{ver}/media.json (the media files it uses, lib/releaseMedia): media
// delete refuses those files, and rollback refuses a release whose files are gone.
import {
  ApiError,
  adminApi,
  type ContentManifest,
  ContentManifest as ContentManifestSchema,
  mediaUrl,
  type PreviewRes,
  type Release,
  SETTINGS,
} from '@tie/shared';
import {
  CONTENT_TABLES,
  type CompiledContent,
  ContentCompileError,
  type ContentRows,
  compileContent,
  contentKey,
  MANIFEST_FILE,
} from '@tie/shared/content/compile';
import { type AppEnv, all, batch, batchRun, fromJson, one, q } from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditStmt, bodyOf, type Ctx, paramsOf, route } from '../lib/http';
import { missingReleaseMedia, writeReleaseIndex } from '../lib/releaseMedia';

const routes = new Hono<AppEnv>();
const C = adminApi.content;
const R = adminApi.releases;

export const CONTENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const JSON_TYPE = 'application/json; charset=utf-8';

export async function readContentRows(db: D1Database): Promise<ContentRows> {
  const results = await batch(
    db,
    CONTENT_TABLES.map((table) => q(db, `SELECT * FROM ${table}`)),
  );
  return Object.fromEntries(CONTENT_TABLES.map((t, i) => [t, results[i] ?? []])) as unknown as ContentRows;
}

interface ReleaseDb {
  id: string;
  version: string;
  manifest: string;
  notes: string | null;
  published_by: string;
  published_at: number;
}

function releaseOf(r: ReleaseDb): Release {
  const manifest = ContentManifestSchema.safeParse(fromJson<unknown>(r.manifest, null));
  return {
    id: r.id,
    version: r.version,
    manifest: manifest.success
      ? manifest.data
      : {
          version: r.version,
          publishedAt: r.published_at,
          files: { catalog: 'catalog.json', episodes: [], ebooks: [], extras: [] },
        },
    notes: r.notes,
    publishedBy: r.published_by,
    publishedAt: r.published_at,
  };
}

const currentVersion = async (db: D1Database): Promise<string | null> =>
  (await one<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', SETTINGS.contentCurrent))?.value ??
  null;

/** Compiles the D1 content; an unchanged set keeps its earlier release's publishedAt (stable manifest/ETag). */
async function compileNow(db: D1Database, now: number): Promise<CompiledContent> {
  const rows = await readContentRows(db);
  let compiled = await compileContent(rows, { publishedAt: now });
  const prior = await one<{ published_at: number }>(
    db,
    'SELECT published_at FROM content_releases WHERE version = ?',
    compiled.version,
  );
  if (prior) compiled = await compileContent(rows, { publishedAt: prior.published_at });
  return compiled;
}

const fileText = async (bucket: R2Bucket, ver: string, file: string): Promise<string | null> => {
  const obj = await bucket.get(contentKey(ver, file));
  return obj ? obj.text() : null;
};

/** Neutral catalog text: the version stamp changes with any edit, so it is left out of the diff. */
function catalogBody(text: string | null): string | null {
  if (text === null) return null;
  const v = fromJson<Record<string, unknown> | null>(text, null);
  return v ? JSON.stringify({ ...v, version: '' }) : text;
}

/** Files of `next` whose text differs from the current release (plus files it drops). */
async function changedFiles(c: Ctx, next: CompiledContent): Promise<string[]> {
  const cur = await currentVersion(c.env.DB);
  if (!cur) return Object.keys(next.files);
  if (cur === next.version) return [];
  const manifestText = await fileText(c.env.MEDIA, cur, MANIFEST_FILE);
  const curManifest = ContentManifestSchema.safeParse(fromJson<unknown>(manifestText, null));
  const curFiles = new Set<string>(
    curManifest.success
      ? [
          curManifest.data.files.catalog,
          ...curManifest.data.files.episodes.map((n) => `ep/${n}.json`),
          ...curManifest.data.files.ebooks.map((n) => `ebook/${n}.json`),
          ...curManifest.data.files.extras.map((id) => `extra/${id}.json`),
        ]
      : [],
  );
  const out: string[] = [];
  const paths = Object.keys(next.files);
  const texts = await Promise.all(paths.map((p) => (curFiles.has(p) ? fileText(c.env.MEDIA, cur, p) : null)));
  paths.forEach((p, i) => {
    const before = texts[i] ?? null;
    const same =
      p === 'catalog.json' ? catalogBody(before) === catalogBody(next.files[p] ?? null) : before === next.files[p];
    if (!same) out.push(p);
  });
  for (const p of curFiles) if (!(p in next.files)) out.push(p);
  return out.sort();
}

const EMPTY_MANIFEST = (now: number): ContentManifest => ({
  version: '',
  publishedAt: now,
  files: { catalog: 'catalog.json', episodes: [], ebooks: [], extras: [] },
});

route(routes, C.preview, async (c) => {
  const now = Date.now();
  try {
    const compiled = await compileNow(c.env.DB, now);
    const out: PreviewRes = {
      version: compiled.version,
      manifest: compiled.manifest,
      changed: await changedFiles(c, compiled),
      errors: [],
    };
    return c.json(out);
  } catch (err) {
    if (!(err instanceof ContentCompileError)) throw err;
    const out: PreviewRes = {
      version: '',
      manifest: EMPTY_MANIFEST(now),
      changed: [],
      errors: err.issues.slice(0, 200),
    };
    return c.json(out);
  }
});

/** Uploads content/{ver}/* (manifest last, so its presence means the set is complete). */
async function uploadRelease(bucket: R2Bucket, compiled: CompiledContent): Promise<void> {
  const ver = compiled.version;
  if (await bucket.head(contentKey(ver, MANIFEST_FILE))) return;
  const put = (file: string, text: string) =>
    bucket.put(contentKey(ver, file), text, {
      httpMetadata: { contentType: JSON_TYPE, cacheControl: CONTENT_CACHE_CONTROL },
    });
  const entries = Object.entries(compiled.files);
  for (let i = 0; i < entries.length; i += 8) {
    await Promise.all(entries.slice(i, i + 8).map(([file, text]) => put(file, text)));
  }
  await put(MANIFEST_FILE, JSON.stringify(compiled.manifest));
}

const releaseId = (version: string) => `rel-${version.slice(0, 16)}`;

route(routes, C.publish, async (c) => {
  const body = await bodyOf(c, C.publish.body);
  const db = c.env.DB;
  const now = Date.now();
  let compiled: CompiledContent;
  try {
    compiled = await compileNow(db, now);
  } catch (err) {
    if (err instanceof ContentCompileError) {
      throw new ApiError('validation_failed', 'O conteúdo tem erros. Rode a prévia e corrija antes de publicar.', {
        issues: err.issues
          .slice(0, 50)
          .map((i) => ({ path: `${i.file}${i.path ? `#${i.path}` : ''}`, code: 'compile', message: i.message })),
      });
    }
    throw err;
  }
  const previous = await currentVersion(db);
  await uploadRelease(c.env.MEDIA, compiled);
  // Media the snapshot uses, so a file stays undeletable while this release can be served.
  await writeReleaseIndex(c.env.MEDIA, compiled.version, compiled.files);
  const ver = compiled.version;
  await batchRun(db, [
    q(
      db,
      `INSERT INTO content_releases(id, version, manifest, notes, published_by, published_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(version) DO NOTHING`,
      releaseId(ver),
      ver,
      JSON.stringify(compiled.manifest),
      body.notes ?? null,
      actor(c).userId,
      compiled.manifest.publishedAt,
    ),
    q(
      db,
      `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      SETTINGS.contentCurrent,
      ver,
      actor(c).userId,
      now,
    ),
    await auditStmt(
      c,
      {
        action: 'content.publish',
        targetType: 'content_release',
        targetId: ver,
        diff: {
          current: { from: previous, to: ver },
          files: Object.keys(compiled.files).length,
          notes: body.notes ?? null,
        },
      },
      now,
    ),
  ]);
  const row = await one<ReleaseDb>(db, 'SELECT * FROM content_releases WHERE version = ?', ver);
  return c.json({ release: releaseOf(row as ReleaseDb) });
});

route(routes, R.list, async (c) => {
  const db = c.env.DB;
  const [rows, cur] = await Promise.all([
    all<ReleaseDb>(db, 'SELECT * FROM content_releases ORDER BY published_at DESC, id DESC LIMIT 200'),
    currentVersion(db),
  ]);
  return c.json({ items: rows.map(releaseOf), current: cur });
});

route(routes, R.rollback, async (c) => {
  const { id } = paramsOf(c, R.rollback.params);
  const db = c.env.DB;
  const now = Date.now();
  const rel = await one<ReleaseDb>(db, 'SELECT * FROM content_releases WHERE id = ?', id);
  if (!rel) throw new ApiError('not_found');
  // The snapshot must still be complete in R2 (the manifest is written last).
  if (!(await c.env.MEDIA.head(contentKey(rel.version, MANIFEST_FILE)))) {
    throw new ApiError('conflict', 'Os arquivos desta versão não estão mais no armazenamento.');
  }
  // … and so must every media file it points at (learners would get 404s otherwise).
  const missing = await missingReleaseMedia(db, c.env.MEDIA, rel.version);
  if (missing === null) throw new ApiError('conflict', 'Os arquivos desta versão não estão mais no armazenamento.');
  if (missing.length) {
    throw new ApiError('conflict', `Esta versão usa ${missing.length} arquivo(s) de mídia que já foram apagados.`, {
      missingMedia: missing.slice(0, 50).map((k) => mediaUrl(k)),
    });
  }
  const previous = await currentVersion(db);
  await batchRun(db, [
    q(
      db,
      `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      SETTINGS.contentCurrent,
      rel.version,
      actor(c).userId,
      now,
    ),
    await auditStmt(
      c,
      {
        action: 'content.rollback',
        targetType: 'content_release',
        targetId: rel.version,
        diff: { current: { from: previous, to: rel.version } },
      },
      now,
    ),
  ]);
  return c.json({ current: rel.version });
});

export default routes;
