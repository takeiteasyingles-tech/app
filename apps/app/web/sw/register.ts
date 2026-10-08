// Page-side service worker hooks for the shell (spec 04 §5). The shell calls registerServiceWorker()
// once in production builds and shows its own "Nova versão disponível" prompt from onNeedRefresh;
// calling the `apply` it receives activates the waiting worker and reloads once it takes control.
//
//   import { registerServiceWorker, clearUserCaches } from '../sw/register';
//   if (import.meta.env.PROD) registerServiceWorker({ onNeedRefresh: (apply) => showPrompt(apply) });
//   // on logout: await clearUserCaches();
import { Workbox } from 'workbox-window';
import { CACHE_NAMES, MSG, OUTBOX_HEADER, type SwMessage } from './protocol';

export { OUTBOX_HEADER };

export interface ServiceWorkerHooks {
  /** A new version is installed and waiting; call `apply()` to switch to it (the page reloads). */
  onNeedRefresh?: (apply: () => void) => void;
  /** First install finished: the shell works offline from now on. */
  onOfflineReady?: () => void;
  /** An offline write was stored in the outbox. */
  onOutboxQueued?: (path: string) => void;
  /** Queued writes were replayed (refresh /api/me/state when sent > 0). */
  onOutboxReplayed?: (info: { sent: number; dropped: number; pending: boolean }) => void;
}

let wb: Workbox | null = null;

export function registerServiceWorker(hooks: ServiceWorkerHooks = {}, url = '/sw.js'): Workbox | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (wb) return wb;
  const w = new Workbox(url, { scope: '/' });
  wb = w;

  const apply = () => {
    w.addEventListener('controlling', () => window.location.reload());
    w.messageSkipWaiting();
  };
  w.addEventListener('waiting', () => {
    if (hooks.onNeedRefresh) hooks.onNeedRefresh(apply);
  });
  w.addEventListener('installed', (event) => {
    if (!event.isUpdate) hooks.onOfflineReady?.();
  });
  w.addEventListener('message', (event) => {
    const data = event.data as SwMessage | undefined;
    if (data?.type === MSG.outboxQueued) hooks.onOutboxQueued?.(data.path);
    if (data?.type === MSG.outboxReplayed) hooks.onOutboxReplayed?.(data);
  });
  // Replays left in the outbox also flush when the connection comes back (browsers without Background Sync).
  window.addEventListener('online', () => flushOutbox());
  // Registration can fail (private mode, blocked service workers in automated browsers): the app
  // simply runs without the offline layer instead of raising an unhandled rejection.
  w.register().catch(() => {});
  return w;
}

/** Asks the SW to replay queued writes now. */
export function flushOutbox(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: MSG.flushOutbox } satisfies SwMessage);
}

/** Logout: drop per-user caches (state, summary, manifest) and pending writes. */
export async function clearUserCaches(): Promise<void> {
  navigator.serviceWorker?.controller?.postMessage({ type: MSG.logout } satisfies SwMessage);
  if (typeof caches !== 'undefined') {
    await Promise.all([caches.delete(CACHE_NAMES.me), caches.delete(CACHE_NAMES.manifest)]);
  }
}

/** True when a response was stored by the outbox instead of reaching the server. */
export const wasQueued = (res: Response): boolean => res.status === 202 && res.headers.get(OUTBOX_HEADER) === 'queued';
