// PROD (spec 05 "Screen stays on; scene in fullscreen"): device-screen helpers the prototype did not have.
// - Wake lock: while a lesson, a song, an Extra scene, the Desafio or the Mic is open, the screen does not
//   dim or lock (Screen Wake Lock API; re-taken when the tab comes back, since the browser drops it on hide).
// - Fullscreen: the Take a Look scene opens in fullscreen when it starts playing (iPhone: the native player).
import { effect } from '@preact/signals';
import { type RouteName, route } from '../router';

/** Screens where the learner listens or watches for minutes without touching the screen. */
const AWAKE_SCREENS: ReadonlySet<RouteName> = new Set<RouteName>([
  'player',
  'extraPlay',
  'musica',
  'desafio',
  'maggie',
]);

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let wanted = false;
let sentinel: WakeLockSentinelLike | null = null;
let asking = false;

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null;
}

async function acquire(): Promise<void> {
  const api = wakeLockApi();
  if (!api || !wanted || asking || (sentinel && !sentinel.released) || document.visibilityState !== 'visible') return;
  asking = true;
  try {
    const s = await api.request('screen');
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
    });
    sentinel = s;
    // Left the screen while the request was in flight.
    if (!wanted) void release();
  } catch {
    // Refused (battery saver, no permission policy): the screen just follows the system timeout.
  } finally {
    asking = false;
  }
}

async function release(): Promise<void> {
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) await s.release().catch(() => {});
}

/** Sets whether the screen should stay on. */
export function keepScreenOn(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else void release();
}

/** Keeps the screen on while the route is one of AWAKE_SCREENS. Call once at start-up. */
export function startScreenWake(): void {
  if (!wakeLockApi()) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
  effect(() => {
    keepScreenOn(AWAKE_SCREENS.has(route.value.name));
  });
}

type FsVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitRequestFullscreen?: () => void;
};
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

let entering = false;

function inFullscreen(v: FsVideo): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement || v.webkitDisplayingFullscreen);
}

/**
 * Puts the video in fullscreen. Call it from the tap that starts the video (browsers only allow it
 * from a user gesture); a call while it is already fullscreen, or still getting there, does nothing.
 */
export function enterVideoFullscreen(video: HTMLVideoElement | null): void {
  const v = video as FsVideo | null;
  if (!v || entering || inFullscreen(v)) return;
  try {
    if (typeof v.requestFullscreen === 'function') {
      entering = true;
      v.requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          // Phones: a scene is wide, so turn to landscape where the browser lets a page ask for it.
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          void o?.lock?.('landscape').catch(() => {});
        })
        .catch(() => v.webkitEnterFullscreen?.())
        .finally(() => {
          entering = false;
        });
      return;
    }
    if (typeof v.webkitRequestFullscreen === 'function') v.webkitRequestFullscreen();
    // iPhone: only the native video player goes fullscreen.
    else v.webkitEnterFullscreen?.();
  } catch {
    entering = false;
  }
}

/** Leaves fullscreen when this video holds it (the scene ended: the step's next part is on the page). */
export function exitVideoFullscreen(video: HTMLVideoElement | null): void {
  const v = video as FsVideo | null;
  if (!v) return;
  const d = document as FsDocument;
  try {
    const o = screen.orientation as ScreenOrientation & { unlock?: () => void };
    o?.unlock?.();
  } catch {
    // No orientation lock to undo.
  }
  if (d.fullscreenElement === v) void d.exitFullscreen().catch(() => {});
  else if (d.webkitFullscreenElement === v) d.webkitExitFullscreen?.();
  else if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen?.();
}
