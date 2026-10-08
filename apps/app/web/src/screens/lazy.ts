import { type ComponentType, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export type LazyComponent<P> = ComponentType<P> & {
  /** Starts (or reuses) the chunk download; resolves when the component is ready. */
  preload(): Promise<void>;
  loaded(): boolean;
};

/**
 * Minimal lazy(): the screen's chunk loads on first render (or preload) and the component renders
 * nothing until then. Lighter than preact/compat's lazy + Suspense, which the shell does not need.
 */
export function lazy<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyComponent<P> {
  let comp: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  let failure: unknown = null;

  const preload = (): Promise<void> => {
    pending ??= load().then(
      (m) => {
        comp = m.default;
        failure = null;
      },
      (err: unknown) => {
        failure = err;
        pending = null;
      },
    );
    return pending;
  };

  function Lazy(props: P) {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (comp) return;
      let alive = true;
      void preload().then(() => alive && rerender((n) => n + 1));
      return () => {
        alive = false;
      };
    }, []);
    // A failed chunk (deploy rolled, offline) surfaces to the shell's error boundary.
    if (failure && !comp) throw failure;
    return comp ? h(comp, props) : null;
  }

  return Object.assign(Lazy, { preload, loaded: () => comp !== null });
}
