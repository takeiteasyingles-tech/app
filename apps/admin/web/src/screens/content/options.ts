// The onboarding option lists (formats, genres, themes…) as select options and suggestions for the
// content editors, loaded once per page view.
import { adminContentApi, type OptionListRow } from '@tie/shared/contracts/admin';
import { useEffect, useState } from 'preact/hooks';
import { call } from '../../api';

let cache: Promise<OptionListRow[]> | null = null;

export function loadOptionRows(): Promise<OptionListRow[]> {
  cache ??= call(adminContentApi.optionLists.list).then(
    (r) => r.items,
    (e: unknown) => {
      cache = null;
      throw e;
    },
  );
  return cache;
}

export function forgetOptionRows(): void {
  cache = null;
}

export interface Options {
  formats: (readonly [string, string])[];
  genres: string[];
  themes: string[];
  ready: boolean;
}

const EMPTY: Options = { formats: [], genres: [], themes: [], ready: false };

export function useOptions(): Options {
  const [o, setO] = useState<Options>(EMPTY);
  useEffect(() => {
    let alive = true;
    loadOptionRows().then(
      (rows) => {
        if (!alive) return;
        const of = (k: string) => rows.filter((r) => r.listKey === k).sort((a, b) => a.sort - b.sort);
        setO({
          formats: of('formats').map((r) => [r.itemKey, r.label] as const),
          genres: [...new Set(of('genres').map((r) => r.itemKey))],
          themes: of('themes').map((r) => r.itemKey),
          ready: true,
        });
      },
      () => alive && setO({ ...EMPTY, ready: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return o;
}
