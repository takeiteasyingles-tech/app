// S9 Content: GET /api/content/manifest and GET /api/content/v/:ver/:file (spec 04 §3 "Content snapshots").
// - The manifest names the current version (app_settings['content.current'] → content_releases); it is
//   no-cache with an ETag, so clients revalidate it on every start.
// - Versioned files are immutable: served through the Cache API with R2 (content/{ver}/{file}) as the
//   fallback. Premium extras answer 403 plan_required unless the plan has the premium_extras feature.
// Also exports the ContentService implementation (server-side readers: summary, gating, AI context);
// the integration step registers `contentServiceFactory` in createApp({services}).
import {
  appApi,
  type Catalog,
  CONTENT_FILES,
  ContentFileParams,
  type ContentManifest,
  type Ebook,
  type Episode,
  type Extra,
  PLAN_FEATURES,
  SETTINGS,
} from '@tie/shared';
import { contentKey, MANIFEST_FILE } from '@tie/shared/content/compile';
import {
  type AppEnv,
  type ContentService,
  type Env,
  etagMatches,
  fail,
  HOUR,
  issueMediaCookie,
  one,
  rateLimit,
  readMediaCookie,
  requireUser,
  type ServiceFactory,
  sessionOf,
  vParam,
} from '@tie/worker-core';
import { type Context, Hono } from 'hono';

const routes = new Hono<AppEnv>();
const api = appApi.content;

export const IMMUTABLE = 'private, max-age=31536000, immutable';
const JSON_TYPE = 'application/json; charset=utf-8';
/** Synthetic origin for Cache API keys (never fetched; the cache is per data center). */
const CACHE_ORIGIN = 'https://tie-content.internal';
/** Re-issue tie_m when it is missing, foreign or has less than this left (it lives 12h). */
const MEDIA_REFRESH_MS = 6 * HOUR;

// ---------- Readers (shared by the routes and ContentService) ----------

interface CurrentRow {
  version: string;
  manifest: string | null;
}

/** Current version + manifest text, or null before the first publish. */
export async function readCurrent(
  env: Pick<Env, 'DB' | 'MEDIA'>,
): Promise<{ version: string; manifest: string } | null> {
  const row = await one<CurrentRow>(
    env.DB,
    `SELECT s.value AS version, r.manifest FROM app_settings s
     LEFT JOIN content_releases r ON r.version = s.value WHERE s.key = ?`,
    SETTINGS.contentCurrent,
  );
  if (!row?.version) return null;
  if (row.manifest) return { version: row.version, manifest: row.manifest };
  // Release row missing (manual pointer): the manifest also lives next to the files.
  const obj = await env.MEDIA.get(contentKey(row.version, MANIFEST_FILE));
  return obj ? { version: row.version, manifest: await obj.text() } : null;
}

function cacheApi(): Cache | null {
  try {
    return typeof caches !== 'undefined' ? caches.default : null;
  } catch {
    return null;
  }
}

/** Text of content/{ver}/{file}: Cache API first, then R2 (and fill the cache). null when absent. */
export async function readContentFile(env: Pick<Env, 'MEDIA'>, ver: string, file: string): Promise<string | null> {
  const cache = cacheApi();
  const key = new Request(`${CACHE_ORIGIN}/${ver}/${file}`);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.text();
    } catch {
      // Cache API unavailable here (e.g. workers.dev); R2 below.
    }
  }
  const obj = await env.MEDIA.get(contentKey(ver, file));
  if (!obj) return null;
  const text = await obj.text();
  if (cache) {
    try {
      await cache.put(
        key,
        new Response(text, {
          headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'public, max-age=31536000, immutable' },
        }),
      );
    } catch {
      // best effort
    }
  }
  return text;
}

const hasFeature = (features: Record<string, unknown> | undefined, key: string): boolean => !!features?.[key];

async function refreshMediaCookie(c: Context<AppEnv>, userId: string): Promise<void> {
  const now = Date.now();
  const media = await readMediaCookie(c);
  if (!media || media.userId !== userId || media.expiresAt - now < MEDIA_REFRESH_MS) {
    await issueMediaCookie(c, userId, now);
  }
}

// ---------- Routes ----------

routes.get(api.manifest.path, requireUser(), rateLimit('RL_API'), async (c) => {
  const s = sessionOf(c);
  const cur = await readCurrent(c.env);
  if (!cur) throw fail('content_unavailable');
  // Content media URLs in the snapshot need tie_m; keep it fresh for clients that start here.
  await refreshMediaCookie(c, s.userId);
  const etag = `"m-${cur.version}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
  if (etagMatches(c.req.header('If-None-Match'), etag)) return c.body(null, 304, headers);
  return c.body(cur.manifest, 200, { ...headers, 'Content-Type': JSON_TYPE });
});

routes.get(api.file.path, requireUser(), rateLimit('RL_API'), vParam(ContentFileParams), async (c) => {
  const s = sessionOf(c);
  const { ver, file } = c.req.valid('param');
  const text = await readContentFile(c.env, ver, file);
  if (text === null) throw fail('not_found');
  if (file.startsWith('extra/') && !hasFeature(s.plan?.features, PLAN_FEATURES.premiumExtras)) {
    let premium = false;
    try {
      premium = (JSON.parse(text) as { premium?: unknown }).premium === true;
    } catch {
      throw fail('internal');
    }
    // Old versions stay readable by hash: an extra that was free in `ver` but is premium now must
    // not stay reachable through the old URL, so the current catalog is checked as well.
    if (!premium) {
      const content = c.get('services').content;
      const cur = await content.current();
      if (cur && cur.version !== ver) {
        const id = file.slice('extra/'.length).replace(/\.json$/, '');
        premium = (await content.catalog()).extras.some((x) => x.id === id && x.premium);
      }
    }
    if (premium) throw fail('plan_required');
  }
  const etag = `"${ver}:${file}"`;
  const headers = { ETag: etag, 'Cache-Control': IMMUTABLE };
  if (etagMatches(c.req.header('If-None-Match'), etag)) return c.body(null, 304, headers);
  return c.body(text, 200, { ...headers, 'Content-Type': JSON_TYPE });
});

// ---------- ContentService ----------

/** Parsed files per isolate; versions are immutable, so entries never go stale. */
const parsed = new Map<string, unknown>();
const PARSED_MAX = 64;

/** Parsed (shared, never handed out directly) content file; see createContentService. */
async function sharedParsedFile<T>(env: Pick<Env, 'MEDIA'>, ver: string, file: string): Promise<T | null> {
  const k = `${ver}/${file}`;
  if (parsed.has(k)) return parsed.get(k) as T;
  const text = await readContentFile(env, ver, file);
  if (text === null) return null;
  const value = JSON.parse(text) as T;
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value as string);
  parsed.set(k, value);
  return value;
}

/**
 * ContentService for one request. The parsed files are shared by every request of the isolate, so
 * each service instance hands out its own deep copy (made once per file per request): a consumer
 * that sorts or filters in place cannot leak into other requests or users.
 */
export function createContentService(env: Pick<Env, 'DB' | 'MEDIA'>): ContentService {
  const copies = new Map<string, unknown>();
  const parsedFile = async <T>(ver: string, file: string): Promise<T | null> => {
    const k = `${ver}/${file}`;
    if (copies.has(k)) return copies.get(k) as T;
    const shared = await sharedParsedFile<T>(env, ver, file);
    const own = shared === null ? null : structuredClone(shared);
    copies.set(k, own);
    return own;
  };
  let current: Promise<ContentManifest | null> | null = null;
  const manifest = () => {
    current ??= readCurrent(env).then((cur) => (cur ? (JSON.parse(cur.manifest) as ContentManifest) : null));
    return current;
  };
  const need = async (): Promise<ContentManifest> => {
    const m = await manifest();
    if (!m) throw fail('content_unavailable');
    return m;
  };
  return {
    current: manifest,
    async catalog() {
      const m = await need();
      const cat = await parsedFile<Catalog>(m.version, CONTENT_FILES.catalog);
      if (!cat) throw fail('content_unavailable');
      return cat;
    },
    async episode(num) {
      const m = await need();
      return m.files.episodes.includes(num) ? parsedFile<Episode>(m.version, CONTENT_FILES.episode(num)) : null;
    },
    async ebook(num) {
      const m = await need();
      return m.files.ebooks.includes(num) ? parsedFile<Ebook>(m.version, CONTENT_FILES.ebook(num)) : null;
    },
    async extra(id) {
      const m = await need();
      return m.files.extras.includes(id) ? parsedFile<Extra>(m.version, CONTENT_FILES.extra(id)) : null;
    },
  };
}

/** Register with createApp({ services: { content: contentServiceFactory } }). */
export const contentServiceFactory: ServiceFactory<'content'> = (env) => createContentService(env);

export default routes;
