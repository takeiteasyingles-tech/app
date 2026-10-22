// API-token authentication for agents (spec 07, feature D): the MCP endpoint reads
// `Authorization: Bearer tie_pat_…`, hashes it and looks the token up in api_tokens. A token acts as
// its creator and never beyond the creator's CURRENT roles: a revoked or expired token, a creator who
// is no longer active, or one whose roles no longer hold any of the token's scope permissions all
// fail the same way (401). Cookies are never read or set here.
import {
  API_TOKEN_PREFIX,
  type ApiTokenScope,
  ApiTokenScope as ApiTokenScopeSchema,
  AUDIT_AGENT_ROLE,
  can,
  type McpToolName,
  type Role,
  Role as RoleSchema,
  SCOPE_PERMISSION,
} from '@tie/shared';
import { fromJson, jsonDiff, MINUTE, one, run, sha256Hex } from '@tie/worker-core';
import type { Writer } from './entityCrud';
import { auditAs, type Ctx } from './http';

export interface AgentToken {
  id: string;
  name: string;
  /** The staff member the token acts as (audit actor_user_id, updated_by stamps). */
  createdBy: string;
  scopes: ApiTokenScope[];
  /** The creator's roles right now. */
  roles: Role[];
}

const BEARER_RE = /^Bearer\s+(\S+)$/i;
const TOKEN_RE = new RegExp(`^${API_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

interface TokenDb {
  id: string;
  name: string;
  created_by: string;
  scopes: string;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  status: string;
  roles: string | null;
}

/** The token a scope needs is held AND the creator's current roles still allow it. */
export function tokenCan(token: AgentToken, scope: ApiTokenScope): boolean {
  return token.scopes.includes(scope) && can(token.roles, SCOPE_PERMISSION[scope]);
}

/** The live token of this request, or null (missing, malformed, unknown, revoked, expired, powerless). */
export async function authenticateAgent(c: Ctx, now = Date.now()): Promise<AgentToken | null> {
  const m = BEARER_RE.exec(c.req.header('Authorization')?.trim() ?? '');
  const plain = m?.[1];
  if (!plain || !TOKEN_RE.test(plain)) return null;
  const db = c.env.DB;
  const row = await one<TokenDb>(
    db,
    `SELECT t.id, t.name, t.created_by, t.scopes, t.expires_at, t.revoked_at, t.last_used_at, u.status,
            (SELECT json_group_array(r.role) FROM user_roles r WHERE r.user_id = t.created_by) AS roles
       FROM api_tokens t JOIN users u ON u.id = t.created_by
      WHERE t.token_hash = ?`,
    await sha256Hex(plain),
  );
  if (!row || row.revoked_at !== null || row.status !== 'active') return null;
  if (row.expires_at !== null && row.expires_at <= now) return null;
  const scopes = fromJson<unknown[]>(row.scopes, []).flatMap((s) => {
    const r = ApiTokenScopeSchema.safeParse(s);
    return r.success ? [r.data] : [];
  });
  const roles = fromJson<unknown[]>(row.roles, []).flatMap((s) => {
    const r = RoleSchema.safeParse(s);
    return r.success ? [r.data] : [];
  });
  const token: AgentToken = { id: row.id, name: row.name, createdBy: row.created_by, scopes, roles };
  if (!scopes.some((s) => tokenCan(token, s))) return null;
  // At most one write a minute per token (the list shows "last used").
  if (row.last_used_at === null || now - row.last_used_at >= MINUTE) {
    await run(
      db,
      'UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)',
      now,
      row.id,
      now - MINUTE,
    );
  }
  return token;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Writes made by an agent: stamped as the token's creator and audited with actor_role 'agent' and
 * the token in the diff (`_agent: {tokenId, tokenName, tool}`), under the same action names as the
 * admin UI's writes.
 */
export function agentWriter(c: Ctx, token: AgentToken, tool: McpToolName): Writer {
  return {
    userId: token.createdBy,
    audit: (entry, now) => {
      const diff = entry.diff !== undefined ? entry.diff : jsonDiff(entry.before, entry.after);
      const agent = { tokenId: token.id, tokenName: token.name, tool };
      return auditAs(
        c,
        token.createdBy,
        AUDIT_AGENT_ROLE,
        {
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          diff: isObj(diff) ? { ...diff, _agent: agent } : { value: diff ?? null, _agent: agent },
        },
        now,
      );
    },
  };
}
