/// <reference lib="webworker" />
// tie-app service worker (vite-plugin-pwa injectManifest, spec 04 §5 "Service worker").
// - Shell: precached (self.__WB_MANIFEST); navigations fall back to the precached index.html.
// - /api/content/v/*: CacheFirst (versioned, immutable snapshots).
// - /api/content/manifest and GET /api/me*: NetworkFirst with a 3 s timeout (offline start).
// - /m/media/*: CacheFirst + RangeRequestsPlugin + Expiration (60 entries / 30 days, purge on quota).
//   User uploads (/m/users/*) are never cached (moderation can remove them).
// - Offline outbox: non-GET /api/* writes that carry an Idempotency-Key and fail on the network are
//   stored in IndexedDB (workbox-background-sync) and replayed by Background Sync (or on the next SW
//   start / an explicit flush), with the same Idempotency-Key, so the server applies them once.
//   The page gets 202 {queued:true} with X-Tie-Outbox: queued.
// - Updates wait for the page: the shell shows a prompt and posts SKIP_WAITING (see register.ts).
import { Queue } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { CACHE_NAMES, IDEMPOTENCY_HEADER, isOutboxPath, MSG, OUTBOX_HEADER, type SwMessage } from './protocol';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// ---------- Shell ----------

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/m\//, /^\/sw\.js$/, /^\/manifest\.webmanifest$/],
  }),
);

// ---------- Runtime caches ----------

const sameOrigin = (url: URL) => url.origin === self.location.origin;

registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && url.pathname.startsWith('/api/content/v/'),
  new CacheFirst({
    cacheName: CACHE_NAMES.content,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 200, purgeOnQuotaError: true }),
    ],
  }),
);

const networkFirst3s = (cacheName: string) =>
  new NetworkFirst({
    cacheName,
    networkTimeoutSeconds: 3,
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  });

registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && url.pathname === '/api/content/manifest',
  networkFirst3s(CACHE_NAMES.manifest),
);

registerRoute(
  ({ url, request }) =>
    sameOrigin(url) && request.method === 'GET' && (url.pathname === '/api/me' || url.pathname.startsWith('/api/me/')),
  networkFirst3s(CACHE_NAMES.me),
);

registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && url.pathname.startsWith('/m/media/'),
  new CacheFirst({
    cacheName: CACHE_NAMES.media,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new RangeRequestsPlugin(),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

// ---------- Offline outbox ----------

async function notify(message: SwMessage): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

let replaying: Promise<void> | null = null;

/** Replays queued writes in order. Network failure → keep and retry later; 4xx → drop (replay cannot fix it). */
async function replay(queue: Queue): Promise<void> {
  let sent = 0;
  let dropped = 0;
  for (;;) {
    const entry = await queue.shiftRequest();
    if (!entry) break;
    let res: Response;
    try {
      res = await fetch(entry.request.clone());
    } catch (err) {
      await queue.unshiftRequest(entry);
      await notify({ type: MSG.outboxReplayed, sent, dropped, pending: true });
      throw err;
    }
    if (res.status >= 500 || res.status === 429) {
      await queue.unshiftRequest(entry);
      await notify({ type: MSG.outboxReplayed, sent, dropped, pending: true });
      throw new Error(`outbox replay deferred: HTTP ${res.status}`);
    }
    if (res.ok) sent++;
    else dropped++;
  }
  if (sent || dropped) await notify({ type: MSG.outboxReplayed, sent, dropped, pending: false });
}

/** One replay at a time (Background Sync, SW start and page flushes can overlap). */
function startReplay(queue: Queue): Promise<void> {
  if (!replaying) {
    replaying = replay(queue).finally(() => {
      replaying = null;
    });
  }
  return replaying;
}

const outbox = new Queue('tie-outbox', {
  maxRetentionTime: 7 * 24 * 60,
  onSync: ({ queue }) => startReplay(queue),
});

const OUTBOX_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
for (const method of OUTBOX_METHODS) {
  registerRoute(
    ({ url, request }) => sameOrigin(url) && isOutboxPath(url.pathname) && request.headers.has(IDEMPOTENCY_HEADER),
    async ({ request }) => {
      const copy = request.clone();
      try {
        return await fetch(request);
      } catch {
        await outbox.pushRequest({ request: copy, timestamp: Date.now() });
        await notify({ type: MSG.outboxQueued, path: new URL(copy.url).pathname });
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json', [OUTBOX_HEADER]: 'queued' },
        });
      }
    },
    method,
  );
}

// ---------- Messages from the page ----------

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as SwMessage | undefined;
  if (!data || typeof data !== 'object') return;
  if (data.type === MSG.skipWaiting) {
    void self.skipWaiting();
  } else if (data.type === MSG.flushOutbox) {
    event.waitUntil(startReplay(outbox).catch(() => {}));
  } else if (data.type === MSG.logout) {
    // Per-user data must not outlive the session on a shared device.
    event.waitUntil(
      (async () => {
        await Promise.all([caches.delete(CACHE_NAMES.me), caches.delete(CACHE_NAMES.manifest)]);
        while (await outbox.shiftRequest()) {
          // drain
        }
      })(),
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
