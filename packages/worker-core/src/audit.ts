import { primaryRole } from '@tie/shared';
import type { Context } from 'hono';
import { sha256Hex } from './bytes';
import { type Query, q } from './db';
import type { AppEnv } from './env';
import { clientIp } from './ratelimit';

// audit_log is append-only (triggers reject UPDATE/DELETE). IPs are stored as a salted SHA-256 so
// the log can correlate actions from one address without keeping the address itself.

// Whole-key match on secret field names (password, newPassword, pass_hash, token, token_hash,
// turnstileToken, secret, salt) so passScore / pass_score / passed stay readable.
const REDACT_KEY = /^(?:\w*password|pass_?hash|\w*token(?:_?hash)?|\w*secret|\w*salt)$/i;
const MAX_DIFF_CHARS = 32_000;

export async function hashIp(ip: string, salt: string): Promise<string> {
  return (await sha256Hex(`${salt}|${ip}`)).slice(0, 32);
}

export type DiffEntry = { from: unknown; to: unknown };
export type JsonDiff = Record<string, DiffEntry>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function redact(key: string, v: unknown): unknown {
  if (v === undefined) return null;
  return REDACT_KEY.test(key) ? '[redacted]' : v;
}

/**
 * Top-level changed fields as {field:{from,to}}; missing side is null (create/delete).
 * Non-object values diff under the key "value". Secret-looking fields are redacted.
 */
export function jsonDiff(before: unknown, after: unknown): JsonDiff {
  if (!isPlainObject(before) && !isPlainObject(after)) {
    return JSON.stringify(before) === JSON.stringify(after)
      ? {}
      : { value: { from: before ?? null, to: after ?? null } };
  }
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  const out: JsonDiff = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    out[key] = { from: redact(key, a[key]), to: redact(key, b[key]) };
  }
  return out;
}

function serializeDiff(diff: unknown): string | null {
  if (diff === undefined || diff === null) return null;
  const text = JSON.stringify(diff);
  return text.length > MAX_DIFF_CHARS ? JSON.stringify({ truncated: true, size: text.length }) : text;
}

export interface AuditEntry {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Either an explicit diff, or before/after to diff. */
  diff?: unknown;
  before?: unknown;
  after?: unknown;
}

export interface AuditRow extends AuditEntry {
  at: number;
  actorUserId: string | null;
  actorRole: string | null;
  ipHash: string | null;
  ua: string | null;
}

export function auditQuery(db: D1Database, row: AuditRow): Query<never> {
  const diff = row.diff !== undefined ? row.diff : jsonDiff(row.before, row.after);
  return q<never>(
    db,
    `INSERT INTO audit_log(at, actor_user_id, actor_role, action, target_type, target_id, ip_hash, ua, diff)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.at,
    row.actorUserId,
    row.actorRole,
    row.action,
    row.targetType ?? null,
    row.targetId ?? null,
    row.ipHash,
    row.ua ? row.ua.slice(0, 256) : null,
    serializeDiff(diff),
  );
}

/** Audit statement for the current request's actor, to batch with the mutation it records. */
export async function auditFor(c: Context<AppEnv>, entry: AuditEntry, now: number = Date.now()): Promise<Query<never>> {
  const s = c.get('session');
  return auditQuery(c.env.DB, {
    ...entry,
    at: now,
    actorUserId: s?.userId ?? null,
    actorRole: s ? primaryRole(s.roles) : null,
    ipHash: await hashIp(clientIp(c), c.env.IP_HASH_SALT),
    ua: c.req.header('User-Agent') ?? null,
  });
}

/** Writes one audit row for the current request's actor. */
export async function audit(c: Context<AppEnv>, entry: AuditEntry): Promise<void> {
  const { stmt } = await auditFor(c, entry);
  await stmt.run();
}
