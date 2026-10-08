// Names shared by the service worker (sw.ts) and the page-side hooks (register.ts).
// The queueable paths live in @tie/shared so the Worker's idempotency() covers exactly the same list.
export { IDEMPOTENCY_HEADER, isOutboxPath, OUTBOX_USER_HEADER } from '@tie/shared/constants';

/**
 * Every cache the SW fills. All of them are per user (premium media and content files are gated by
 * plan, state by session), so logout deletes all of them.
 */
export const CACHE_NAMES = {
  content: 'tie-content-v1',
  manifest: 'tie-content-manifest-v1',
  me: 'tie-api-me-v1',
  media: 'tie-media-v1',
} as const;

export const USER_CACHES: readonly string[] = Object.values(CACHE_NAMES);

/** Never cached: the LGPD export holds everything about the user and must not outlive the download. */
export const isUncacheableMePath = (pathname: string): boolean => pathname === '/api/me/export';

/** Response header on writes the SW stored for later (status 202, body {queued:true}). */
export const OUTBOX_HEADER = 'X-Tie-Outbox';

/**
 * What the outbox does with a replayed write's answer: 'sent' (2xx), 'retry' (network/5xx/429: keep
 * it and try later), 'hold' (401: keep it until someone signs in, then replay) or 'drop' (any other
 * 4xx, which replaying cannot fix, including the 409 for a write made for another account).
 */
export function replayOutcome(status: number): 'sent' | 'retry' | 'hold' | 'drop' {
  if (status >= 200 && status < 300) return 'sent';
  if (status >= 500 || status === 429) return 'retry';
  if (status === 401) return 'hold';
  return 'drop';
}

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
