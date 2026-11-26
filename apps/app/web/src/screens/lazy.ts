import { signal } from '@preact/signals';
import { type ComponentType, h } from 'preact';
import { useEffect } from 'preact/hooks';

/** sessionStorage key: when this tab last reloaded for a screen chunk that was gone. */
export const CHUNK_RELOAD_KEY = 'tie.chunkReload';
/** One such reload per tab in this window, so a chunk that is really broken shows the error card. */
const CHUNK_RELOAD_MS = 60_000;

interface ReloadEnv {
  online: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
  now: number;
}

function browserEnv(): ReloadEnv {
  let storage: Storage | null = null;
  try {
    storage = sessionStorage;
  } catch {
    // Storage blocked: no reload loop guard, so no reload.
  }
  return { online: navigator.onLine, storage, reload: () => location.reload(), now: Date.now() };
}

/**
 * A screen chunk that failed while online is most likely a build that a deploy replaced: the page still
 * runs the old build, whose chunk names the server no longer has (it answers the SPA's HTML). Reloading
 * once loads the new build. Returns true when the page is reloading.
 */
export function reloadForNewBuild(env: ReloadEnv = browserEnv()): boolean {
  if (!env.online || !env.storage) return false;
  try {
    const last = Number(env.storage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (env.now - last < CHUNK_RELOAD_MS) return false;
    env.storage.setItem(CHUNK_RELOAD_KEY, String(env.now));
  } catch {
    return false;
  }
  env.reload();
  return true;
}

export type LazyComponent<P> = ComponentType<P> & {
  /** Starts (or reuses) the chunk download; resolves when the component is ready. */
  preload(): Promise<void>;
  loaded(): boolean;
};

/**
 * Minimal lazy(): the screen's chunk loads on first render (or preload) and the component renders
 * nothing until then. Lighter than preact/compat's lazy + Suspense, which the shell does not need.
 *
 * Every mounted wrapper reads `settled` during render, so it re-renders when the chunk resolves (or
 * fails) whenever that happens: before or after its effects ran, or while another instance that was
 * since unmounted was the one waiting on the download. A per-instance effect + setState missed the
 * resolution when it landed between the first render and the effect, and the view stayed empty.
 */
export function lazy<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyComponent<P> {
  let comp: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  let failure: unknown = null;
  /** Bumped when the download settles; read in render so @preact/signals re-renders the wrappers. */
  const settled = signal(0);

  const preload = (): Promise<void> => {
    pending ??= load().then(
      (m) => {
        comp = m.default;
        failure = null;
        settled.value++;
      },
      (err: unknown) => {
        // A deploy replaced the build: the page reloads (and keeps rendering nothing until then).
        if (reloadForNewBuild()) return;
        failure = err;
        pending = null;
        settled.value++;
      },
    );
    return pending;
  };

  function Lazy(props: P) {
    void settled.value;
    // Starting the download from render is safe (preload is idempotent); the effect retries after a
    // failure once the wrapper mounts again.
    if (!comp && !failure) void preload();
    useEffect(() => {
      if (!comp) void preload();
    }, []);
    // A failed chunk that the reload could not fix (offline, or it failed again) surfaces to the shell's
    // error boundary.
    if (failure && !comp) throw failure;
    return comp ? h(comp, props) : null;
  }

  return Object.assign(Lazy, { preload, loaded: () => comp !== null });
}
