import { signal } from '@preact/signals';
import { type ComponentType, h } from 'preact';
import { useEffect } from 'preact/hooks';

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
    // A failed chunk (deploy rolled, offline) surfaces to the shell's error boundary.
    if (failure && !comp) throw failure;
    return comp ? h(comp, props) : null;
  }

  return Object.assign(Lazy, { preload, loaded: () => comp !== null });
}
