import { adminApi } from './admin';
import { aiApi } from './ai';
import { authApi } from './auth';
import { contentApi } from './content';
import { ebookApi } from './ebook';
import { extrasApi } from './extras';
import { gameApi } from './game';
import { meApi } from './me';
import { micApi } from './mic';
import { progressApi } from './progress';
import { reportsApi } from './reports';
import { srsApi } from './srs';

export * from './admin';
export * from './ai';
export * from './auth';
export * from './common';
export * from './content';
export * from './ebook';
export * from './extras';
export * from './game';
export * from './http';
export * from './me';
export * from './mic';
export * from './progress';
export * from './reports';
export * from './srs';

/** Student API (tie-app): /api/* and /m/*. */
export const appApi = {
  ai: aiApi,
  auth: authApi,
  me: meApi,
  content: contentApi,
  progress: progressApi,
  ebook: ebookApi,
  srs: srsApi,
  extras: extrasApi,
  game: gameApi,
  mic: micApi,
  reports: reportsApi,
} as const;

export { adminApi };
