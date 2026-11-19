// PROD: the device screen while the learner watches or speaks. A wake lock keeps the phone from
// dimming on the screens where nobody touches it for a while (video, karaoke, the Mic), and the
// player's video can go fullscreen in landscape. Both are best-effort: unsupported browsers and
// refused requests change nothing.
import { effect } from '@preact/signals';
import { type RouteName, route } from '../router';

/** Routes that keep the screen on (video, songs, the challenge and the Mic). */
const AWAKE_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>(['player', 'extraPlay', 'musica', 'desafio', 'maggie']);

let wanted = false;
let lock: WakeLockSentinel | null = null;
let requesting = false;

function wakeLockApi(): WakeLock | null {
  return typeof navigator === 'undefined' ? null : (navigator.wakeLock ?? null);
}

async function acquire(): Promise<void> {
  const api = wakeLockApi();
  if (!api || !wanted || requesting || (lock && !lock.released) || document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    const s = await api.request('screen');
    s.addEventListener('release', () => {
      if (lock === s) lock = null;
    });
    lock = s;
    // The route changed while the request was pending.
    if (!wanted) void release();
  } catch {
    // Refused (battery saver, not visible): the screen just dims as usual.
  } finally {
    requesting = false;
  }
}

async function release(): Promise<void> {
  const s = lock;
  lock = null;
  if (s && !s.released) await s.release().catch(() => {});
}

function setAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else void release();
}

/**
 * Keeps the screen on while the route is one of AWAKE_ROUTES. The browser drops the lock when the
 * page is hidden, so it is taken again when the page comes back.
 */
export function startWakeLock(): void {
  if (!wakeLockApi()) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
  effect(() => {
    setAwake(AWAKE_ROUTES.has(route.value.name));
  });
}

/** iOS Safari's prefixed fullscreen (the <video> element itself goes fullscreen there). */
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}
interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

let entering = false;

function isFullscreen(el: FullscreenElement): boolean {
  const d = document as FullscreenDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement || el.webkitDisplayingFullscreen);
}

/** Puts `el` fullscreen (hiding the browser UI) and, where allowed, locks the phone in landscape. */
export function enterFullscreen(el: HTMLElement | null | undefined): void {
  const e = el as FullscreenElement | null | undefined;
  if (!e || entering || isFullscreen(e)) return;
  try {
    if (typeof e.requestFullscreen === 'function') {
      entering = true;
      e.requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          // lock() is missing from some lib.dom versions and rejects on desktop.
          (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
            ?.lock?.('landscape')
            .catch(() => {});
        })
        .catch(() => e.webkitEnterFullscreen?.())
        .finally(() => {
          entering = false;
        });
      return;
    }
    if (typeof e.webkitRequestFullscreen === 'function') e.webkitRequestFullscreen();
    else e.webkitEnterFullscreen?.();
  } catch {
    entering = false;
  }
}

/** Leaves fullscreen if `el` is the fullscreen element, and unlocks the orientation. */
export function exitFullscreen(el: HTMLElement | null | undefined): void {
  const e = el as FullscreenElement | null | undefined;
  if (!e) return;
  const d = document as FullscreenDocument;
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Not supported.
  }
  if (d.fullscreenElement === e) d.exitFullscreen().catch(() => {});
  else if (d.webkitFullscreenElement === e) d.webkitExitFullscreen?.();
  else if (e.webkitDisplayingFullscreen) e.webkitExitFullscreen?.();
}
