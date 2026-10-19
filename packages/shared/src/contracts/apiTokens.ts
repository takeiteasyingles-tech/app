import { z } from 'zod';
import type { Permission } from '../authz';
import { LIMITS } from '../constants';
import { IdParams, Timestamp } from './common';
import { endpoint } from './http';

// API tokens for agents (spec 07, feature D): what an AI agent (Claude) presents to the MCP endpoint
// of tie-admin as `Authorization: Bearer tie_pat_…`. Only sha256(token) is stored; the plaintext is
// returned once, by create. A token acts as its creator: each call needs the scope AND the creator's
// CURRENT roles must hold the matching permission (a demoted or deleted creator disables it).

/**
 * content.read: list/get tools and preview_release. content.edit: the update and draft tools.
 * No scope can publish: humans publish in the admin.
 */
export const API_TOKEN_SCOPES = ['content.read', 'content.edit'] as const;
export const ApiTokenScope = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof ApiTokenScope>;

/** Permission the creator must still hold for a scope to work. */
export const SCOPE_PERMISSION: Readonly<Record<ApiTokenScope, Permission>> = {
  'content.read': 'content.edit',
  'content.edit': 'content.edit',
};

export const ApiTokenRow = z.object({
  id: z.string(),
  name: z.string(),
  /** First API_TOKEN_DISPLAY_LEN characters of the plaintext ('tie_pat_AbCd'). */
  prefix: z.string(),
  scopes: z.array(ApiTokenScope),
  createdBy: z.string(),
  createdByEmail: z.string().nullable(),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
  expiresAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  revokedBy: z.string().nullable(),
});
export type ApiTokenRow = z.infer<typeof ApiTokenRow>;

/** expiresInDays null = never expires (explicit choice); absent = DURATIONS.apiTokenDefaultMs. */
export const CreateApiTokenBody = z.strictObject({
  name: z.string().trim().min(1).max(LIMITS.apiTokenNameMax),
  scopes: z
    .array(ApiTokenScope)
    .min(1)
    .max(API_TOKEN_SCOPES.length)
    .refine((s) => new Set(s).size === s.length, 'Escopo repetido.'),
  expiresInDays: z.int().min(1).max(LIMITS.apiTokenDaysMax).nullable().optional(),
});
export type CreateApiTokenBody = z.infer<typeof CreateApiTokenBody>;

export const CreateApiTokenRes = z.object({
  item: ApiTokenRow,
  /** The plaintext token. Shown once; never stored or logged. */
  token: z.string(),
});
export type CreateApiTokenRes = z.infer<typeof CreateApiTokenRes>;

export const adminApiTokensApi = {
  /** Every token (revoked and expired included), newest first. */
  list: endpoint({
    method: 'GET',
    path: '/admin-api/api-tokens',
    access: 'staff',
    perm: 'api_tokens.manage',
    res: z.object({ items: z.array(ApiTokenRow) }),
  }),
  /** Scopes the creator cannot use (SCOPE_PERMISSION) are refused with 403. */
  create: endpoint({
    method: 'POST',
    path: '/admin-api/api-tokens',
    access: 'staff',
    perm: 'api_tokens.manage',
    body: CreateApiTokenBody,
    res: CreateApiTokenRes,
  }),
  /** Idempotent: revoking a revoked token answers it as is. */
  revoke: endpoint({
    method: 'DELETE',
    path: '/admin-api/api-tokens/:id',
    access: 'staff',
    perm: 'api_tokens.manage',
    params: IdParams,
    res: z.object({ item: ApiTokenRow }),
  }),
} as const;
