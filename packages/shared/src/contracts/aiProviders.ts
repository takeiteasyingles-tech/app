import { z } from 'zod';
import { Timestamp } from './common';
import { endpoint } from './http';

// PROD (spec 05 "Paid AI providers"): Configurações → App → Provedores de IA (tie-admin, permission
// settings.manage). The Claude (Anthropic) and OpenAI API keys, sealed in app_settings like the
// ElevenLabs key and write-only: only their last 4 characters ever come back, and the audit log carries
// only those. Both Workers read them through worker-core's aiRunner, falling back to the
// ANTHROPIC_API_KEY / OPENAI_API_KEY secrets. Which model runs where stays in the ai.model.* settings.

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

const ApiKey = z.string().trim().min(20).max(300);

export const AiProvidersBody = z.strictObject({
  /** A new key; null removes the stored one; absent keeps it. */
  anthropic: ApiKey.nullable().optional(),
  openai: ApiKey.nullable().optional(),
});
export type AiProvidersBody = z.infer<typeof AiProvidersBody>;

export const AiProviderTestBody = z.strictObject({ provider: AiProviderEnum });

export const AiProviderTestRes = z.object({
  ok: z.boolean(),
  /** The models the key can use (ids without the provider prefix), when it worked. */
  models: z.array(z.string()),
  /** Why it did not work (pt-BR), when it did not. */
  error: z.string().nullable(),
});
export type AiProviderTestRes = z.infer<typeof AiProviderTestRes>;

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
} as const;
