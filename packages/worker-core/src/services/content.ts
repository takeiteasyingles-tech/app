import type { Catalog, ContentManifest, Ebook, Episode, Extra } from '@tie/shared';
import { NotImplementedError } from '../errors';

/**
 * Published content snapshots (slice S9): app_settings['content.current'] names the version,
 * files live in R2 under content/{ver}/ and are cached via the Cache API. Server-side readers
 * (progress gating, grading, AI context) use this instead of querying content tables.
 */
export interface ContentService {
  /** Current manifest, or null before the first publish. */
  current(): Promise<ContentManifest | null>;
  catalog(): Promise<Catalog>;
  /** null when the episode is not published. */
  episode(num: number): Promise<Episode | null>;
  ebook(num: number): Promise<Ebook | null>;
  extra(id: string): Promise<Extra | null>;
}

const notImplemented = (what: string) => Promise.reject(new NotImplementedError(`ContentService.${what} (slice S9)`));

export const contentServiceStub: ContentService = {
  current: () => notImplemented('current'),
  catalog: () => notImplemented('catalog'),
  episode: () => notImplemented('episode'),
  ebook: () => notImplemented('ebook'),
  extra: () => notImplemented('extra'),
};
