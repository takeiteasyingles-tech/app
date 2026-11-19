import { z } from 'zod';
import { AI_MODEL_ID_RE } from '../constants';
import { Timestamp } from './common';
import { endpoint } from './http';

// PROD (spec 05 "Paid AI providers"): API keys of the paid AI providers (tie-admin, Configurações →
// App → Provedores de IA). Keys are sealed in app_settings (SETTINGS.aiKeyAnthropic / aiKeyOpenai)
// and never returned; a model id 'anthropic:…' / 'openai:…' (AI_MODEL_ID_RE) then runs on that provider.

export const AiProviderEnum = z.enum(['anthropic', 'openai']);
export type AiProviderName = z.infer<typeof AiProviderEnum>;

export const AiProviderKey = z.object({
  provider: AiProviderEnum,
  keySet: z.boolean(),
  /** Last 4 characters of the stored key, null without one. */
  keyHint: z.string().nullable(),
  /** 'settings' = typed in the admin; 'env' = the Worker secret. */
  keySource: z.enum(['settings', 'env']).nullable(),
  updatedAt: Timestamp.nullable(),
  updatedBy: z.string().nullable(),
});
export type AiProviderKey = z.infer<typeof AiProviderKey>;

export const AiProvidersRes = z.object({ providers: z.array(AiProviderKey) });
export type AiProvidersRes = z.infer<typeof AiProvidersRes>;

const ApiKey = z.string().trim().min(20).max(300);

export const AiProvidersBody = z.strictObject({
  /** A new key; null removes the stored one; absent keeps it. */
  anthropic: ApiKey.nullable().optional(),
  openai: ApiKey.nullable().optional(),
});
export type AiProvidersBody = z.infer<typeof AiProvidersBody>;

export const AiProviderTestBody = z.strictObject({ provider: AiProviderEnum });
export type AiProviderTestBody = z.infer<typeof AiProviderTestBody>;

export const AiProviderTestRes = z.object({
  ok: z.boolean(),
  /** The models the key can use (ids without the provider prefix), when it worked. */
  models: z.array(z.string()),
  /** Why it did not work (pt-BR), when it did not. */
  error: z.string().nullable(),
});
export type AiProviderTestRes = z.infer<typeof AiProviderTestRes>;

export const AiSpeedBody = z.strictObject({
  model: z.string().regex(AI_MODEL_ID_RE, 'Modelo inválido.'),
});
export type AiSpeedBody = z.infer<typeof AiSpeedBody>;

export const AiSpeedRes = z.object({
  model: z.string(),
  ok: z.boolean(),
  /** How long a short Mic-like turn took, in ms (also when it failed). */
  ms: z.number().int().nonnegative(),
  /** Why it failed (pt-BR), when it did. */
  error: z.string().nullable(),
});
export type AiSpeedRes = z.infer<typeof AiSpeedRes>;

export const adminAiProvidersApi = {
  get: endpoint({
    method: 'GET',
    path: '/admin-api/ai-providers',
    access: 'staff',
    perm: 'settings.manage',
    res: AiProvidersRes,
  }),
  put: endpoint({
    method: 'PUT',
    path: '/admin-api/ai-providers',
    access: 'staff',
    perm: 'settings.manage',
    body: AiProvidersBody,
    res: AiProvidersRes,
  }),
  /** Lists the models the stored key can use (checks the key with the provider). */
  test: endpoint({
    method: 'POST',
    path: '/admin-api/ai-providers/test',
    access: 'staff',
    perm: 'settings.manage',
    body: AiProviderTestBody,
    res: AiProviderTestRes,
    rateLimit: 'RL_AI',
  }),
  /** Times one short Mic-like turn on a model (Configurações → App → "Medir velocidade"). */
  speed: endpoint({
    method: 'POST',
    path: '/admin-api/ai-providers/speed',
    access: 'staff',
    perm: 'settings.manage',
    body: AiSpeedBody,
    res: AiSpeedRes,
    rateLimit: 'RL_AI',
  }),
} as const;
