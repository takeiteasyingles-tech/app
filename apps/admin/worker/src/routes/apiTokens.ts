// /admin-api/api-tokens (spec 07, feature D): API tokens that let an AI agent (Claude) use the MCP
// endpoint (routes/mcp.ts) as the admin who created them. Only sha256(token) and a short display
// prefix are stored; the plaintext is answered once by create and never logged or audited. A token
// can only carry scopes whose permission (SCOPE_PERMISSION) its creator holds, and lib/agent checks
// the creator's current roles again on every MCP call.
import {
  API_TOKEN_DISPLAY_LEN,
  ApiError,
  type ApiTokenRow,
  ApiTokenScope,
  adminApiTokensApi,
  apiToken,
  can,
  DURATIONS,
  newId,
  SCOPE_PERMISSION,
} from '@tie/shared';
import { type AppEnv, all, batchRun, DAY, fromJson, one, q, sha256Hex } from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditStmt, bodyOf, paramsOf, route } from '../lib/http';

const routes = new Hono<AppEnv>();
const T = adminApiTokensApi;

interface TokenDb {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string;
  created_by: string;
  email: string | null;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  revoked_by: string | null;
}

const SELECT = `SELECT t.id, t.name, t.token_prefix, t.scopes, t.created_by, u.email, t.created_at, t.last_used_at,
  t.expires_at, t.revoked_at, t.revoked_by FROM api_tokens t LEFT JOIN users u ON u.id = t.created_by`;

const rowOf = (r: TokenDb): ApiTokenRow => ({
  id: r.id,
  name: r.name,
  prefix: r.token_prefix,
  scopes: fromJson<unknown[]>(r.scopes, []).flatMap((s) => {
    const p = ApiTokenScope.safeParse(s);
    return p.success ? [p.data] : [];
  }),
  createdBy: r.created_by,
  createdByEmail: r.email,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
});

const load = async (db: D1Database, id: string): Promise<ApiTokenRow | null> => {
  const r = await one<TokenDb>(db, `${SELECT} WHERE t.id = ?`, id);
  return r ? rowOf(r) : null;
};

route(routes, T.list, async (c) => {
  const rows = await all<TokenDb>(c.env.DB, `${SELECT} ORDER BY t.created_at DESC, t.id DESC LIMIT 500`);
  return c.json({ items: rows.map(rowOf) });
});

route(routes, T.create, async (c) => {
  const body = await bodyOf(c, T.create.body);
  const me = actor(c);
  const denied = body.scopes.filter((s) => !can(me.roles, SCOPE_PERMISSION[s]));
  if (denied.length) {
    throw new ApiError('forbidden', `Seu papel não pode dar o escopo ${denied.join(', ')}.`);
  }
  const db = c.env.DB;
  const now = Date.now();
  const id = newId();
  const token = apiToken();
  const prefix = token.slice(0, API_TOKEN_DISPLAY_LEN);
  const expiresAt =
    body.expiresInDays === null
      ? null
      : now + (body.expiresInDays !== undefined ? body.expiresInDays * DAY : DURATIONS.apiTokenDefaultMs);
  await batchRun(db, [
    q(
      db,
      `INSERT INTO api_tokens(id, name, token_hash, token_prefix, created_by, scopes, created_at, expires_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      body.name,
      await sha256Hex(token),
      prefix,
      me.userId,
      JSON.stringify(body.scopes),
      now,
      expiresAt,
    ),
    // The plaintext never reaches the log: only what the list shows.
    await auditStmt(
      c,
      {
        action: 'api_token.create',
        targetType: 'api_token',
        targetId: id,
        after: { name: body.name, prefix, scopes: body.scopes, expiresAt },
      },
      now,
    ),
  ]);
  const item = await load(db, id);
  return c.json({ item, token }, 201);
});

route(routes, T.revoke, async (c) => {
  const { id } = paramsOf(c, T.revoke.params);
  const db = c.env.DB;
  const current = await load(db, id);
  if (!current) throw new ApiError('not_found');
  if (current.revokedAt !== null) return c.json({ item: current });
  const now = Date.now();
  await batchRun(db, [
    q(
      db,
      'UPDATE api_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL',
      now,
      actor(c).userId,
      id,
    ),
    await auditStmt(
      c,
      {
        action: 'api_token.revoke',
        targetType: 'api_token',
        targetId: id,
        diff: { name: current.name, prefix: current.prefix, revokedAt: { from: null, to: now } },
      },
      now,
    ),
  ]);
  return c.json({ item: await load(db, id) });
});

export default routes;
