// Published content (the prototype's TIE.data): GET /api/content/manifest, then the immutable
// versioned files catalog.json, ep/{n}.json, ebook/{n}.json and extra/{id}.json. Each file is
// fetched once per version and shared by every screen; the catalog is also a signal, so chrome that
// depends on it (levels, assistant voices, avatar images) re-renders when it lands.
import { computed, effect, signal, untracked } from '@preact/signals';
import type { Catalog, ContentManifest, Ebook, Episode, Extra } from '@tie/shared/content/schema';
import { contentApi, contentFileUrl } from '@tie/shared/contracts/content';
import { useEffect, useState } from 'preact/hooks';
import { call } from '../api';
import { levels } from './game';
import { state } from './state';

export const manifest = signal<ContentManifest | null>(null);
export const catalog = signal<Catalog | null>(null);

let manifestP: Promise<ContentManifest> | null = null;
const files = new Map<string, Promise<unknown>>();

/** The current content version: the manifest's (fetched once per page load). */
export function loadManifest(): Promise<ContentManifest> {
  manifestP ??= call(contentApi.manifest).then(
    (m) => {
      manifest.value = m;
      return m;
    },
    (err: unknown) => {
      manifestP = null;
      throw err;
    },
  );
  return manifestP;
}

async function version(): Promise<string> {
  return state.value.contentVersion ?? (await loadManifest()).version;
}

/** One versioned content file, fetched once and shared (a failure is not cached). */
function loadFile<T>(file: string): Promise<T> {
  return version().then((ver) => {
    const url = contentFileUrl(ver, file);
    let p = files.get(url) as Promise<T> | undefined;
    if (!p) {
      p = call(contentApi.file, { params: { ver, file } }) as Promise<T>;
      files.set(url, p);
      p.catch(() => files.delete(url));
    }
    return p;
  });
}

/** catalog.json (TIE.data constants + catalog lists). Also feeds the levels table and the signal. */
export function loadCatalog(): Promise<Catalog> {
  return loadFile<Catalog>('catalog.json').then((c) => {
    if (catalog.value !== c) {
      catalog.value = c;
      if (c.game?.levels?.length) levels.value = c.game.levels.map((l) => [l.min, l.name] as const);
    }
    return c;
  });
}

export const loadEpisode = (num: number): Promise<Episode> => loadFile<Episode>(`ep/${num}.json`);
export const loadEbook = (num: number): Promise<Ebook> => loadFile<Ebook>(`ebook/${num}.json`);
export const loadExtra = (id: string): Promise<Extra> => loadFile<Extra>(`extra/${id}.json`);

export interface ContentState<T> {
  data: T | null;
  error: unknown;
}

/**
 * Loads content for a screen: `const { data } = useContent(() => loadEpisode(n), [n])`. The file
 * promise is shared, so a second screen asking for the same file resolves on the next microtask.
 * Re-runs when `deps` change.
 */
export function useContent<T>(load: () => Promise<T>, deps: readonly unknown[]): ContentState<T> {
  const [st, setSt] = useState<ContentState<T>>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setSt({ data, error: null }),
      (error: unknown) => alive && setSt({ data: null, error }),
    );
    return () => {
      alive = false;
    };
  }, deps);
  return st;
}

/** Drops cached content (sign out, or a new content version announced by /api/me/state). */
export function resetContent(): void {
  manifestP = null;
  files.clear();
  manifest.value = null;
  catalog.value = null;
}

// Signed in → fetch the catalog right away (every screen and the voice need it); signed out → drop
// the cached content (it is per-plan and the device may be shared).
const userId = computed(() => state.value.user?.id ?? null);
effect(() => {
  const id = userId.value;
  untracked(() => {
    if (id) void loadCatalog().catch(() => {});
    else if (catalog.value || manifest.value) resetContent();
  });
});

/** catalog.images['avatar/user-N'] etc.; undefined until the catalog is loaded. */
export const catalogImage = (key: string): string | undefined => catalog.value?.images?.[key];
