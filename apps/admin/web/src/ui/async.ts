// Loading state for screens: one request (useLoad) or a cursor-paginated list (usePaged). Both abort
// on unmount / dependency change, keep the last data while reloading and expose a retry.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export interface Load<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload(): void;
  setData(fn: T | ((prev: T | undefined) => T)): void;
}

export function useLoad<T>(fn: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Load<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fnRef.current(ac.signal).then(
      (d) => {
        if (ac.signal.aborted) return;
        setDataState(() => d);
        setLoading(false);
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => ac.abort();
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((v: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof v === 'function' ? (v as (p: T | undefined) => T)(prev) : v));
  }, []);
  return { data, error, loading, reload, setData };
}

export interface PageRes<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Paged<T> {
  items: T[];
  error: unknown;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  more(): void;
  reload(): void;
  setItems(fn: (prev: T[]) => T[]): void;
}

export function usePaged<T>(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<PageRes<T>>,
  deps: readonly unknown[],
): Paged<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fetchPage);
  fnRef.current = fetchPage;
  const acRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    acRef.current = ac;
    setLoading(true);
    setError(null);
    fnRef.current(undefined, ac.signal).then(
      (p) => {
        if (ac.signal.aborted) return;
        setItemsState(p.items);
        setNext(p.nextCursor);
        setLoading(false);
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => ac.abort();
  }, [...deps, tick]);
  const more = () => {
    if (!next || loadingMore) return;
    const ac = acRef.current;
    if (!ac) return;
    setLoadingMore(true);
    fnRef.current(next, ac.signal).then(
      (p) => {
        if (ac.signal.aborted) return;
        setItemsState((prev) => [...prev, ...p.items]);
        setNext(p.nextCursor);
        setLoadingMore(false);
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e);
        setLoadingMore(false);
      },
    );
  };
  return {
    items,
    error,
    loading,
    loadingMore,
    hasMore: !!next,
    more,
    reload: () => setTick((t) => t + 1),
    setItems: (fn) => setItemsState(fn),
  };
}

/** A click handler that runs once at a time and exposes its busy state. */
export function useBusy(): [boolean, <R>(fn: () => Promise<R>) => Promise<R | undefined>] {
  const [busy, setBusy] = useState(false);
  const ref = useRef(false);
  const run = useCallback(async <R>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (ref.current) return undefined;
    ref.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      ref.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
