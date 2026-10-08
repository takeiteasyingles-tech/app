// Page side of the offline outbox (spec 04 §5). The service worker (web/sw/sw.ts) stores writes that
// fail on the network and carry an Idempotency-Key (the store adds one to every queueable write) and
// replays them later. When a replay lands, the points and progress it earned only exist on the
// server, so the state is pulled again. A new app version waiting to activate is applied when the
// app goes to the background, never in the middle of a lesson.
import { meApi } from '@tie/shared/contracts/me';
import { call } from '../api';
import { set, state } from '../store/state';

let started = false;

/** Re-reads /api/me/state and applies it without touching the load status (no blank screen). */
export async function refreshState(): Promise<void> {
  try {
    const s = await call(meApi.state);
    if (!state.value.user || state.value.user.id !== s.user?.id) return;
    set({ ...s, settings: { ...s.settings, phone: state.value.settings.phone } });
  } catch {
    // Still offline: the next replay or load brings it.
  }
}

/** Registers the service worker (production builds only) and wires the outbox notifications. */
export function startOutbox(): void {
  if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;
  void import('../../sw/register').then(({ registerServiceWorker }) => {
    let pendingUpdate: (() => void) | null = null;
    registerServiceWorker({
      onNeedRefresh(apply) {
        pendingUpdate = apply;
      },
      onOutboxReplayed({ sent }) {
        if (sent > 0) void refreshState();
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && pendingUpdate) {
        const apply = pendingUpdate;
        pendingUpdate = null;
        apply();
      }
    });
  });
}

/**
 * After a login: writes the outbox kept while the session was gone (401) go out now. Writes made for
 * another account are refused by the server (409) and dropped.
 */
export function flushAfterLogin(): void {
  if (!started) return;
  void import('../../sw/register').then(({ flushOutbox }) => flushOutbox());
}

/** Logout: per-user caches and pending writes must not outlive the session on a shared device. */
export async function clearOfflineData(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const { clearUserCaches } = await import('../../sw/register');
  await clearUserCaches();
}
