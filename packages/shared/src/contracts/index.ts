import { adminApi } from './admin';
import { aiApi } from './ai';
import { authApi } from './auth';
import { certificatesApi } from './certificates';
import { contentApi } from './content';
import { ebookApi } from './ebook';
import { extrasApi } from './extras';
import { feedbackApi } from './feedback';
import { gameApi } from './game';
import { meApi } from './me';
import { micApi } from './mic';
import { progressApi } from './progress';
import { reportsApi } from './reports';
import { seasonsApi } from './seasonTest';
import { srsApi } from './srs';

export * from './admin';
export * from './ai';
export * from './apiTokens';
export * from './auth';
export * from './certificates';
export * from './common';
export * from './content';
export * from './ebook';
export * from './extras';
export * from './feedback';
export * from './game';
export * from './http';
export * from './mcp';
export * from './me';
export * from './mic';
export * from './progress';
export * from './reports';
export * from './seasonTest';
export * from './srs';
export * from './stats';

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
  // v1 (spec 07)
  seasons: seasonsApi,
  certificates: certificatesApi,
  feedback: feedbackApi,
} as const;

export { adminApi };
