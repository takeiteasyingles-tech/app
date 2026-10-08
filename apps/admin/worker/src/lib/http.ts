// Route plumbing for /admin-api: every endpoint is registered from its @tie/shared definition, so the
// method, path, permission and rate limit come from one place. Order per request: CSRF and the JSON
// size guard (createApp) → staff session → permission → rate limit → handler, which then validates
// params, query and body (strict admin schemas). Authorization therefore always runs before
// validation: a caller without the permission learns nothing about the body rules.
import { ApiError, can, type EndpointDef, type Permission, primaryRole } from '@tie/shared';
import {
  type AppEnv,
  type AuditEntry,
  auditFor,
  auditQuery,
  type Bind,
  checkRateLimit,
  clientIp,
  hashIp,
  jsonDiff,
  parseOrThrow,
  type Query,
  q,
  requireUser,
  type SessionInfo,
  sessionOf,
  sha256Hex,
} from '@tie/worker-core';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { z } from 'zod';

export type Ctx = Context<AppEnv>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export type Handler = (c: Ctx) => Promise<Response> | Response;

const loadAdminSession = requireUser('admin');
const noop = async () => {};

/** Admin session holding at least one staff role and, when given, the permission. */
export function requireStaff(perm?: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await loadAdminSession(c, noop);
    const s = sessionOf(c);
    if (s.roles.length === 0) throw new ApiError('forbidden');
    if (perm && !can(s.roles, perm)) throw new ApiError('forbidden');
    await next();
  };
}

/** Registers `handler` for the endpoint with its guards (staff + perm + per-user rate limit). */
export function route(app: Hono<AppEnv>, def: EndpointDef, handler: Handler): void {
  const guards: MiddlewareHandler<AppEnv>[] = [];
  if (def.access === 'staff') {
    guards.push(requireStaff(def.perm));
    const binding = def.rateLimit ?? 'RL_API';
    guards.push(async (c, next) => {
      await checkRateLimit(c.env, binding, `adm:${sessionOf(c).userId}`);
      await next();
    });
  }
  app.on(def.method, [def.path], ...guards, async (c: Ctx) => handler(c));
}

/** The staff session of the current request (route() guarantees it for staff endpoints). */
export const actor = (c: Ctx): SessionInfo => sessionOf(c);

export function paramsOf<S extends z.ZodType>(c: Ctx, schema: S): z.output<S> {
  return parseOrThrow(schema, c.req.param());
}

export function queryOf<S extends z.ZodType>(c: Ctx, schema: S): z.output<S> {
  return parseOrThrow(schema, c.req.query());
}

async function rawBody(c: Ctx): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('bad_request', 'JSON inválido.');
  }
}

/** Parses the JSON body against a strict admin schema; an empty body reads as {}. */
export async function bodyOf<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  return parseOrThrow(schema, await rawBody(c));
}

/**
 * For partial updates (PUT with a patch schema): the parsed body plus the keys the request actually
 * sent. zod `.default()` survives `.partial()`, so a parsed patch can carry defaulted keys the
 * client never sent; callers merge only `sent` keys so absent fields keep their stored values.
 */
export async function patchOf<S extends z.ZodType>(
  c: Ctx,
  schema: S,
): Promise<{ body: z.output<S>; sent: ReadonlySet<string> }> {
  const raw = await rawBody(c);
  const body = parseOrThrow(schema, raw);
  const sent = new Set(isObj(raw) ? Object.keys(raw).filter((k) => raw[k] !== undefined) : []);
  return { body, sent };
}

/** validation_failed with one issue (same envelope as the zod validators). */
export function invalid(path: string, message: string, code = 'invalid'): ApiError {
  return new ApiError('validation_failed', message, { issues: [{ path, code, message }] });
}

// ---------- Audit diffs ----------

/** Below worker-core's 32,000-char cap, past which it would keep only {truncated, size}. */
export const AUDIT_DIFF_MAX = 30_000;
/** Size budget for one field's element-level detail before it falls back to hashes. */
const FIELD_DETAIL_MAX = 8_000;
const EXCERPT = 160;

const sizeOf = (v: unknown): number => JSON.stringify(v ?? null).length;

/** Size and hash of a value: enough to prove what it was without storing it. */
async function fingerprint(v: unknown): Promise<{ size: number; sha256: string } | null> {
  if (v === undefined || v === null) return null;
  const text = JSON.stringify(v);
  return { size: text.length, sha256: await sha256Hex(text) };
}

/** Where two strings first differ, with a short excerpt of each side. */
function firstDifference(a: string, b: string): { at: number; from: string; to: string } {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - 20);
  return { at: i, from: a.slice(start, start + EXCERPT), to: b.slice(start, start + EXCERPT) };
}

/** A large {from,to} (or any large value) reduced to what changed, or to fingerprints. */
async function summarizeField(v: unknown): Promise<unknown> {
  const pair = isObj(v) && 'from' in v && 'to' in v && Object.keys(v).length === 2 ? v : null;
  if (!pair) return { compacted: true, ...(await fingerprint(v)) };
  const { from, to } = pair;
  const base = { compacted: true, from: await fingerprint(from), to: await fingerprint(to) };
  if (Array.isArray(from) && Array.isArray(to)) {
    // Element-level: only the changed positions (lyrics, dialog, option lists…).
    const items: Record<string, { from: unknown; to: unknown }> = {};
    for (let i = 0; i < Math.max(from.length, to.length); i++) {
      if (JSON.stringify(from[i]) !== JSON.stringify(to[i])) items[i] = { from: from[i] ?? null, to: to[i] ?? null };
    }
    const detail = { lengths: { from: from.length, to: to.length }, items };
    if (sizeOf(detail) <= FIELD_DETAIL_MAX) return { ...base, ...detail };
    return { ...base, lengths: detail.lengths, changedIndexes: Object.keys(items).map(Number).slice(0, 500) };
  }
  if (isObj(from) && isObj(to)) {
    // Key-level: the changed keys with their sides (each still bounded).
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(
      (k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]),
    );
    const changes: Record<string, unknown> = {};
    for (const k of keys) {
      const change = { from: from[k] ?? null, to: to[k] ?? null };
      changes[k] = sizeOf(change) <= FIELD_DETAIL_MAX / 4 ? change : await summarizeField(change);
    }
    if (sizeOf(changes) <= FIELD_DETAIL_MAX) return { ...base, changes };
    return { ...base, changedKeys: keys.slice(0, 500) };
  }
  if (typeof from === 'string' && typeof to === 'string')
    return { ...base, firstDifference: firstDifference(from, to) };
  return base;
}

/**
 * Keeps an audit diff under AUDIT_DIFF_MAX: the largest fields are reduced first (changed elements,
 * changed keys, or size + sha256 of each side), so a large edit is still recorded field by field
 * instead of as a bare {truncated:true}.
 */
export async function compactDiff(diff: unknown): Promise<unknown> {
  if (diff === undefined || diff === null || sizeOf(diff) <= AUDIT_DIFF_MAX) return diff;
  if (!isObj(diff)) return summarizeField(diff);
  const out: Record<string, unknown> = { ...diff };
  const bySize = Object.keys(out).sort((a, b) => sizeOf(out[b]) - sizeOf(out[a]));
  for (const key of bySize) {
    if (sizeOf(out) <= AUDIT_DIFF_MAX) break;
    out[key] = await summarizeField(out[key]);
  }
  return out;
}

/** The entry with its diff computed (before/after → jsonDiff) and compacted. */
async function compactEntry<E extends AuditEntry>(entry: E): Promise<E> {
  const { before, after, ...rest } = entry;
  const diff = entry.diff !== undefined ? entry.diff : jsonDiff(before, after);
  return { ...rest, diff: await compactDiff(diff) } as E;
}

/** Audit statement for the signed-in staff member, to batch with the mutation it records. */
export async function auditStmt(c: Ctx, entry: AuditEntry, now: number): Promise<Query<never>> {
  return auditFor(c, await compactEntry(entry), now);
}

/**
 * Audit statement that writes only when `cond` (SQL over `condBinds`) holds at execution time: for
 * batches whose mutation is guarded by a claim, so a request that lost the race records nothing.
 * `as` names the actor explicitly when there is no session yet (invite accept).
 */
export async function auditIf(
  c: Ctx,
  entry: { action: string; targetType: string; targetId: string; diff: unknown },
  now: number,
  cond: string,
  condBinds: Bind[],
  as?: { userId: string | null; role: string | null },
): Promise<Query<never>> {
  const s = c.get('session');
  return q<never>(
    c.env.DB,
    `INSERT INTO audit_log(at, actor_user_id, actor_role, action, target_type, target_id, ip_hash, ua, diff)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${cond}`,
    now,
    as ? as.userId : (s?.userId ?? null),
    as ? as.role : s ? primaryRole(s.roles) : null,
    entry.action,
    entry.targetType,
    entry.targetId,
    await hashIp(clientIp(c), c.env.IP_HASH_SALT),
    (c.req.header('User-Agent') ?? '').slice(0, 256) || null,
    JSON.stringify((await compactDiff(entry.diff)) ?? null),
    ...condBinds,
  );
}

/** Audit statement with an explicit actor (login, invite accept: no session yet). */
export async function auditAs(
  c: Ctx,
  actorUserId: string | null,
  actorRole: string | null,
  entry: AuditEntry,
  now: number,
): Promise<Query<never>> {
  return auditQuery(c.env.DB, {
    ...(await compactEntry(entry)),
    at: now,
    actorUserId,
    actorRole,
    ipHash: await hashIp(clientIp(c), c.env.IP_HASH_SALT),
    ua: c.req.header('User-Agent') ?? null,
  });
}

/** True for a D1 constraint error of the given kind (messages are "UNIQUE constraint failed: …"). */
export function isConstraint(err: unknown, kind: 'UNIQUE' | 'FOREIGN KEY' | 'CHECK' | 'NOT NULL'): boolean {
  return err instanceof Error && err.message.includes(`${kind} constraint failed`);
}

/** Escapes LIKE wildcards; pair with `ESCAPE '\\'`. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
