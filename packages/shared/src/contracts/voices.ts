import { z } from 'zod';
import { ELEVEN_MODELS, ELEVEN_SAMPLE_MAX_BYTES, ELEVEN_SAMPLE_MIME } from '../constants';
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
} as const;
