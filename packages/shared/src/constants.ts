// Limits and fixed names shared by client and Workers. Anything an admin can tune lives in D1 instead.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const LIMITS = {
  // Spec 01 and the prototype copy ("Mínimo de 6 caracteres"): signup, reset, password change.
  passwordMin: 6,
  passwordMax: 128,
  emailMax: 254,
  nameMax: 80,
  fullNameMax: 120,
  freeTextMax: 500,
  goalsMax: 3,
  remindersMax: 5,
  photoMaxBytes: 2 * 1024 * 1024,
  photoSize: 256,
  mediaMaxBytes: 60 * 1024 * 1024,
  tutorTextMax: 500,
  ttsTextMax: 400,
  pronounceAudioB64Max: 700_000,
  pronounceMaxSecs: 15,
  micHistoryTurns: 12,
  micSessionsKept: 12,
  micMaxTurns: 9,
  micTurnAwardsPerSession: 20,
  micEndTurnsMax: 60,
  srsCardsBatchMax: 50,
  gameLogMax: 400,
  pageSizeDefault: 50,
  pageSizeMax: 200,
} as const;

export const DURATIONS = {
  appSessionMs: 30 * DAY,
  adminSessionAbsoluteMs: 8 * HOUR,
  adminSessionIdleMs: 30 * MIN,
  mediaTokenMs: 12 * HOUR,
  resetTokenMs: 24 * HOUR,
  inviteTokenMs: 7 * DAY,
  lockoutMs: 15 * MIN,
  tutorBillCapS: 120,
} as const;

export const LOCKOUT_FAILED_LOGINS = 10;
export const PBKDF2_ITERATIONS = 100_000;

export const COOKIES = {
  app: 'tie_s',
  admin: 'tie_adm',
  media: 'tie_m',
  /** Prepended in production (COOKIE_PREFIX var); empty on plain-HTTP localhost. */
  securePrefix: '__Host-',
} as const;

/** Header the offline outbox sends so replayed writes are applied once. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * The signed-in user id a queueable write was made for. A write the outbox kept while the session
 * was gone (401) and replays after someone else signs in on the device is refused (409), never
 * applied to the new account.
 */
export const OUTBOX_USER_HEADER = 'X-Tie-User';

/**
 * Writes the service worker may queue offline and replay later (spec 04 §5). Each one is meaningful
 * without an immediate answer, and the server applies each Idempotency-Key once (worker-core
 * idempotency()), so a replay of a write that did land is answered from the stored response.
 * Auth, AI, uploads, reports and account deletion never queue.
 */
export const OUTBOX_PATHS: readonly RegExp[] = [
  /^\/api\/progress\//,
  /^\/api\/ebooks\/\d+\/(download|test\/answers|test\/submit)$/,
  /^\/api\/srs\/cards(\/[\w-]+\/grade)?$/,
  /^\/api\/extras\/[\w-]+\/(seen|dub)$/,
  /^\/api\/extras\/challenge$/,
  /^\/api\/karaoke\/gap$/,
  /^\/api\/game\/event$/,
  /^\/api\/me\/(profile|settings)$/,
];

export const isOutboxPath = (pathname: string): boolean => OUTBOX_PATHS.some((re) => re.test(pathname));

export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MEDIA_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'video/mp4',
  'video/webm',
  'application/pdf',
] as const;

export const DEFAULT_TZ = 'America/Sao_Paulo';
export const DEFAULT_ASSISTANT = 'margaret';
export const DEFAULT_TERMS_VERSION = '2026-10';

/** Feature flags (feature_flags.key) the code reads. */
export const FLAGS = {
  aiEnabled: 'ai.enabled',
  freeSteps: 'dev.free_steps',
  storeRecordings: 'mic.store_recordings',
} as const;

/** ai_prompts.key values the AI routes read (seeded from packages/seed/prompts/*.md). */
export const AI_PROMPT_KEYS = {
  tutor: 'tutor_system',
  report: 'report_system',
} as const;

/** plans.features keys the code reads (truthy = the plan has it). */
export const PLAN_FEATURES = {
  /** Extras with premium=1 (content file extra/{id}.json answers 403 plan_required without it). */
  premiumExtras: 'premium_extras',
  hd: 'hd',
} as const;

/** app_settings keys the code reads. */
export const SETTINGS = {
  contentCurrent: 'content.current',
  retentionTranscriptsDays: 'retention.transcripts_days',
  termsVersion: 'terms.version',
  modelTutor: 'ai.model.tutor',
  modelTutorFallback: 'ai.model.tutor_fallback',
  modelAsr: 'ai.model.asr',
  modelTts: 'ai.model.tts',
  modelGuard: 'ai.model.guard',
} as const;

export const DEFAULT_MODELS = {
  tutor: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  tutorFallback: '@cf/meta/llama-3.1-8b-instruct-fast',
  asr: '@cf/openai/whisper-large-v3-turbo',
  tts: '@cf/deepgram/aura-1',
  guard: '@cf/meta/llama-guard-3-8b',
} as const;

/** Deepgram Aura speakers per assistant; /api/tts only accepts these. */
export const TTS_SPEAKERS: Readonly<Record<string, string>> = {
  margaret: 'asteria',
  robert: 'orion',
  rebecca: 'luna',
  zach: 'arcas',
  barbara: 'athena',
};
