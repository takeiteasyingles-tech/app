import { z } from 'zod';
import { ELEVEN_MODELS, ELEVEN_SAMPLE_MAX_BYTES, ELEVEN_SAMPLE_MIME } from '../constants';
import { ELEVEN_AGENT_ID_RE } from '../content/schema';
import { Timestamp } from './common';
import { endpoint } from './http';

// Configurações → Vozes (tie-admin, permission settings.manage): the ElevenLabs API key (sealed in
// app_settings, write-only: only its last 4 characters ever come back), the model and the cloned voice of
// each assistant. tie-app's /api/tts reads the same settings (worker-core services/eleven.ts), falling
// back to the ELEVENLABS_* env vars. Every change is audited without the key.

export const ElevenModelEnum = z.enum(ELEVEN_MODELS);
const VoiceId = z.string().regex(/^[A-Za-z0-9]{8,40}$/, 'ID de voz inválido.');
const AssistantKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const VoiceSettings = z.object({
  /** An API key is stored (in the admin settings or, as a fallback, in the Worker's env). */
  keySet: z.boolean(),
  /** Last 4 characters of the stored key, null without one. */
  keyHint: z.string().nullable(),
  /** 'settings' = typed in the admin; 'env' = the Worker secret ELEVENLABS_API_KEY. */
  keySource: z.enum(['settings', 'env']).nullable(),
  model: ElevenModelEnum,
  voices: z.record(z.string(), z.string()),
  assistants: z.array(z.object({ key: z.string(), name: z.string() })),
  updatedAt: Timestamp.nullable(),
  updatedBy: z.string().nullable(),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const VoiceSettingsBody = z.strictObject({
  /** A new key; null removes the stored one; absent keeps it. */
  apiKey: z.string().trim().min(20).max(200).nullable().optional(),
  model: ElevenModelEnum.optional(),
  /** Per assistant: a voice id, or null to go back to the Workers AI voice. Absent assistants keep theirs. */
  voices: z.record(AssistantKey, VoiceId.nullable()).optional(),
});
export type VoiceSettingsBody = z.infer<typeof VoiceSettingsBody>;

export const VoiceTestBody = z.strictObject({
  assistantKey: AssistantKey,
  text: z.string().trim().min(1).max(300).optional(),
});

/** A voice of the ElevenLabs account (cloned, premade or added from the Voice Library). */
export const ElevenVoice = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  gender: z.string().nullable(),
  accent: z.string().nullable(),
  description: z.string().nullable(),
});
export type ElevenVoice = z.infer<typeof ElevenVoice>;

/** A Voice Library voice; `sampleUrl` is its public sample, played through `librarySample`. */
export const LibraryVoice = ElevenVoice.extend({
  ownerId: z.string(),
  language: z.string().nullable(),
  sampleUrl: z.string().nullable(),
});
export type LibraryVoice = z.infer<typeof LibraryVoice>;

export const LibraryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  gender: z.enum(['male', 'female']).optional(),
});

export const LibraryAddBody = z.strictObject({
  ownerId: z.string().regex(/^[A-Za-z0-9]{8,100}$/),
  voiceId: VoiceId,
  name: z.string().trim().min(1).max(100),
});

export const VoicePreviewBody = z.strictObject({
  voiceId: VoiceId,
  text: z.string().trim().min(1).max(300).optional(),
});

/**
 * PROD (spec 05 "Mic avatar per assistant"): an ElevenLabs agent as the stored key sees it, so the
 * assistant editor can tell whether tie-app will be able to start conversations with it.
 */
export const ElevenAgentInfo = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string().nullable(),
  llm: z.string().nullable(),
  voiceId: z.string().nullable(),
  firstMessage: z.string().nullable(),
  /** "Enable authentication": only signed URLs (what tie-app uses) can start a conversation. */
  authEnabled: z.boolean(),
  /** Hard cap of one conversation, in seconds (null = the platform default). */
  maxDurationS: z.int().nullable(),
  /** Dynamic variables the agent's prompt expects (tie-app fills student_name and student_level). */
  variables: z.array(z.string()),
});
export type ElevenAgentInfo = z.infer<typeof ElevenAgentInfo>;

export const adminVoicesApi = {
  get: endpoint({
    method: 'GET',
    path: '/admin-api/voices',
    access: 'staff',
    perm: 'settings.manage',
    res: z.object({ settings: VoiceSettings }),
  }),
  put: endpoint({
    method: 'PUT',
    path: '/admin-api/voices',
    access: 'staff',
    perm: 'settings.manage',
    body: VoiceSettingsBody,
    res: z.object({ settings: VoiceSettings }),
  }),
  /** Multipart: field "file" (the voice sample) and field "assistantKey". Saves the new voice for it. */
  clone: endpoint({
    method: 'POST',
    path: '/admin-api/voices/clone',
    access: 'staff',
    perm: 'settings.manage',
    multipart: { field: 'file', maxBytes: ELEVEN_SAMPLE_MAX_BYTES, mime: ELEVEN_SAMPLE_MIME },
    res: z.object({ voiceId: z.string(), settings: VoiceSettings }),
    rateLimit: 'RL_UPLOAD',
  }),
  /** The assistant's voice reading a short line (audio/mpeg), with the stored key and model. */
  test: endpoint({
    method: 'POST',
    path: '/admin-api/voices/test',
    access: 'staff',
    perm: 'settings.manage',
    body: VoiceTestBody,
    res: 'binary',
    rateLimit: 'RL_AI',
  }),
  // PROD (spec 05 "Lesson voices"): pickers of the episode editor (content.edit), with the stored key.
  /** Every voice of the ElevenLabs account. */
  account: endpoint({
    method: 'GET',
    path: '/admin-api/voices/eleven',
    access: 'staff',
    perm: 'content.edit',
    res: z.object({ voices: z.array(ElevenVoice) }),
  }),
  /** Voice Library search (English voices). */
  library: endpoint({
    method: 'GET',
    path: '/admin-api/voices/library',
    access: 'staff',
    perm: 'content.edit',
    query: LibraryQuery,
    res: z.object({ voices: z.array(LibraryVoice) }),
  }),
  /** Adds a Voice Library voice to the account, so lessons can use it. Audited. */
  libraryAdd: endpoint({
    method: 'POST',
    path: '/admin-api/voices/library',
    access: 'staff',
    perm: 'content.edit',
    body: LibraryAddBody,
    res: z.object({ voice: ElevenVoice }),
  }),
  /** A Voice Library sample (audio/mpeg), fetched from ElevenLabs' public storage only. */
  librarySample: endpoint({
    method: 'GET',
    path: '/admin-api/voices/library/sample',
    access: 'staff',
    perm: 'content.edit',
    query: z.object({ url: z.string().url().max(600) }),
    res: 'binary',
  }),
  /** An ElevenLabs agent read with the stored key (assistant editor, "Verificar agente"). */
  agent: endpoint({
    method: 'GET',
    path: '/admin-api/voices/agent',
    access: 'staff',
    perm: 'content.edit',
    query: z.object({ id: z.string().regex(ELEVEN_AGENT_ID_RE) }),
    res: z.object({ agent: ElevenAgentInfo }),
    rateLimit: 'RL_AI',
  }),
  /** Any account voice reading a short line (audio/mpeg). */
  preview: endpoint({
    method: 'POST',
    path: '/admin-api/voices/preview',
    access: 'staff',
    perm: 'content.edit',
    body: VoicePreviewBody,
    res: 'binary',
    rateLimit: 'RL_AI',
  }),
} as const;
