// Names shared by the service worker (sw.ts) and the page-side hooks (register.ts).
export { IDEMPOTENCY_HEADER } from '@tie/shared/constants';

export const CACHE_NAMES = {
  content: 'tie-content-v1',
  manifest: 'tie-content-manifest-v1',
  me: 'tie-api-me-v1',
  media: 'tie-media-v1',
} as const;

/** Response header on writes the SW stored for later (status 202, body {queued:true}). */
export const OUTBOX_HEADER = 'X-Tie-Outbox';

/**
 * Writes that are safe to replay later: idempotent on the server (award keys, upserts) and
 * meaningful without an immediate answer. Auth, AI, uploads and account deletion never queue.
 */
const OUTBOX_PATHS: readonly RegExp[] = [
  /^\/api\/progress\//,
  /^\/api\/ebooks\/\d+\/(download|test\/answers|test\/submit)$/,
  /^\/api\/srs\/cards(\/[\w-]+\/grade)?$/,
  /^\/api\/extras\/[\w-]+\/(seen|dub)$/,
  /^\/api\/extras\/challenge$/,
  /^\/api\/karaoke\/gap$/,
  /^\/api\/game\/event$/,
  /^\/api\/me\/(profile|settings)$/,
];

export const isOutboxPath = (pathname: string): boolean => OUTBOX_PATHS.some((re) => re.test(pathname));

export const MSG = {
  skipWaiting: 'SKIP_WAITING',
  flushOutbox: 'TIE_OUTBOX_FLUSH',
  logout: 'TIE_LOGOUT',
  outboxQueued: 'TIE_OUTBOX_QUEUED',
  outboxReplayed: 'TIE_OUTBOX_REPLAYED',
} as const;

export type SwMessage =
  | { type: typeof MSG.skipWaiting }
  | { type: typeof MSG.flushOutbox }
  | { type: typeof MSG.logout }
  | { type: typeof MSG.outboxQueued; path: string }
  | { type: typeof MSG.outboxReplayed; sent: number; dropped: number; pending: boolean };
