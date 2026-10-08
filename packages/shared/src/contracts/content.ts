import { z } from 'zod';
import { Catalog, CONTENT_FILES, ContentManifest, Ebook, Episode, Extra } from '../content/schema';
import { buildPath, endpoint } from './http';

export const ContentFileParams = z.object({
  ver: z.string().regex(/^[0-9a-f]{8,64}$/),
  file: z.string().regex(/^(catalog\.json|ep\/\d+\.json|ebook\/\d+\.json|extra\/[\w-]+\.json)$/),
});
export type ContentFileParams = z.infer<typeof ContentFileParams>;

/** R2 media is served under /m/<r2 key> (Range, ETag; content needs the tie_m cookie). */
export const MEDIA_PREFIX = '/m/';
export const mediaUrl = (r2Key: string): string => MEDIA_PREFIX + r2Key.replace(/^\/+/, '');

export const contentApi = {
  /** no-cache + ETag. */
  manifest: endpoint({ method: 'GET', path: '/api/content/manifest', access: 'user', res: ContentManifest }),
  /**
   * Immutable, versioned JSON (Cache API, R2 fallback). Validate with contentFileSchema(file);
   * premium extras answer 403 plan_required for plans without the feature.
   */
  file: endpoint({
    method: 'GET',
    path: '/api/content/v/:ver/:file{.+}',
    access: 'user',
    params: ContentFileParams,
    res: z.unknown(),
  }),
  /**
   * R2 media with Range/ETag. Content media needs the signed tie_m cookie (12h); user uploads are
   * served only to their owner or to staff. Handled before the JSON API middleware.
   */
  media: endpoint({ method: 'GET', path: '/m/*', access: 'public', res: 'binary' }),
} as const;

export const contentFileUrl = (ver: string, file: string): string => buildPath(contentApi.file.path, { ver, file });

export const catalogUrl = (ver: string) => contentFileUrl(ver, CONTENT_FILES.catalog);
export const episodeUrl = (ver: string, num: number) => contentFileUrl(ver, CONTENT_FILES.episode(num));
export const ebookUrl = (ver: string, num: number) => contentFileUrl(ver, CONTENT_FILES.ebook(num));
export const extraUrl = (ver: string, id: string) => contentFileUrl(ver, CONTENT_FILES.extra(id));

/** Schema for a content file name. */
export function contentFileSchema(file: string): z.ZodType<Catalog | Episode | Ebook | Extra> {
  if (file === CONTENT_FILES.catalog) return Catalog;
  if (file.startsWith('ep/')) return Episode;
  if (file.startsWith('ebook/')) return Ebook;
  if (file.startsWith('extra/')) return Extra;
  throw new Error(`unknown content file: ${file}`);
}
