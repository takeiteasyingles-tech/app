import { DURATIONS } from '@tie/shared';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  hashToken,
  isExpired,
  isTokenShape,
  lookupSession,
  newToken,
  revokeUserSessionsQuery,
  rotateSession,
} from '../src/auth/sessions';
import { sha256Hex } from '../src/bytes';
import { FakeD1 } from './helpers/fakeD1';

const T0 = 1_790_000_000_000;

describe('session tokens', () => {
  it('are 32 random bytes as 43 base64url chars', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(t)).toBe(true);
    expect(isTokenShape('short')).toBe(false);
    expect(isTokenShape(undefined)).toBe(false);
    expect(newToken()).not.toBe(t);
  });

  it('stores only the SHA-256 hex of the token', async () => {
    const t = newToken();
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await sha256Hex(t));
    expect(h).not.toContain(t);
  });

  it('known SHA-256 vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('createSession / rotateSession', () => {
  it('inserts the hash (never the token) with the audience TTL', async () => {
    const db = new FakeD1();
    const s = await createSession(db.asD1(), { userId: 'U1', audience: 'app', now: T0, ua: 'x'.repeat(400) });
    expect(s.expiresAt).toBe(T0 + DURATIONS.appSessionMs);
    const insert = db.executed[0];
    expect(insert?.sql).toMatch(/INSERT INTO sessions/);
    expect(insert?.params[0]).toBe(await hashToken(s.token));
    expect(insert?.params).not.toContain(s.token);
    expect(String(insert?.params[7])).toHaveLength(256);

    const admin = await createSession(db.asD1(), { userId: 'U1', audience: 'admin', now: T0 });
    expect(admin.expiresAt).toBe(T0 + DURATIONS.adminSessionAbsoluteMs);
  });

  it('rotation deletes the old hash and inserts a new one in one batch', async () => {
    const db = new FakeD1();
    const s = await rotateSession(db.asD1(), 'oldhash', { userId: 'U1', audience: 'app', now: T0 });
    expect(db.executed.map((e) => e.via)).toEqual(['batch', 'batch']);
    expect(db.executed[0]?.sql).toMatch(/DELETE FROM sessions/);
    expect(db.executed[0]?.params).toEqual(['oldhash']);
    expect(db.executed[1]?.params[0]).toBe(await hashToken(s.token));
  });

  it('revokeUserSessionsQuery can keep the current session', () => {
    const db = new FakeD1();
    const q = revokeUserSessionsQuery(db.asD1(), 'U1', { audience: 'app', exceptTokenHash: 'keep' });
    const stmt = q.stmt as unknown as { sql: string; params: unknown[] };
    expect(stmt.sql).toBe('DELETE FROM sessions WHERE user_id = ? AND audience = ? AND token_hash <> ?');
    expect(stmt.params).toEqual(['U1', 'app', 'keep']);
  });
});

describe('expiry rules', () => {
  it('app sessions only expire at expires_at', () => {
    expect(isExpired('app', { expires_at: T0 + 1, last_seen_at: T0 - 20 * DURATIONS.adminSessionIdleMs }, T0)).toBe(
      false,
    );
    expect(isExpired('app', { expires_at: T0, last_seen_at: T0 }, T0)).toBe(true);
  });

  it('admin sessions also die after 30 min idle', () => {
    const idle = DURATIONS.adminSessionIdleMs;
    expect(isExpired('admin', { expires_at: T0 + 1000, last_seen_at: T0 - idle + 1 }, T0)).toBe(false);
    expect(isExpired('admin', { expires_at: T0 + 1000, last_seen_at: T0 - idle }, T0)).toBe(true);
  });
});

describe('lookupSession', () => {
  const token = 'A'.repeat(43);
  const userRow = (over: Record<string, unknown> = {}) => ({
    user_id: 'U1',
    created_at: T0 - 1000,
    last_seen_at: T0 - 1000,
    expires_at: T0 + DURATIONS.appSessionMs,
    email: 'a@b.co',
    status: 'active',
    tz: 'America/Sao_Paulo',
    name: 'Ana',
    full_name: 'Ana Souza',
    ...over,
  });

  function db(row: Record<string, unknown> | null, roles: string[] = [], plan = true) {
    return new FakeD1((sql) => {
      if (sql.includes('FROM sessions s JOIN users')) return row ? [row] : [];
      if (sql.includes('FROM user_roles')) return roles.map((role) => ({ role }));
      if (sql.includes('FROM plans')) {
        return plan ? [{ id: 'P1', slug: 'gratis', name: 'Grátis', ai_minutes_month: 60, features: '{"x":1}' }] : [];
      }
      return [];
    });
  }

  it('rejects malformed tokens without touching D1', async () => {
    const d = db(userRow());
    expect(await lookupSession(d.asD1(), 'nope', 'app', T0)).toEqual({ ok: false, reason: 'missing' });
    expect(d.executed).toHaveLength(0);
  });

  it('loads user, roles and plan in one batch', async () => {
    const d = db(userRow(), ['editor', 'bogus']);
    const res = await lookupSession(d.asD1(), token, 'app', T0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(d.executed.filter((e) => e.via === 'batch')).toHaveLength(3);
    expect(res.touched).toBe(false);
    expect(res.session).toMatchObject({
      userId: 'U1',
      name: 'Ana',
      fullName: 'Ana Souza',
      roles: ['editor'],
      plan: { slug: 'gratis', aiMinutesMonth: 60, features: { x: 1 } },
      tokenHash: await hashToken(token),
    });
  });

  it('slides app sessions when last_seen is stale', async () => {
    const d = db(userRow({ last_seen_at: T0 - 2 * 60 * 60 * 1000 }));
    const res = await lookupSession(d.asD1(), token, 'app', T0);
    expect(res.ok && res.touched).toBe(true);
    if (res.ok) expect(res.session.expiresAt).toBe(T0 + DURATIONS.appSessionMs);
    expect(d.executed.at(-1)?.sql).toMatch(/UPDATE sessions SET last_seen_at/);
  });

  it('keeps the admin absolute expiry when touching', async () => {
    const abs = T0 + 60_000;
    const d = db(userRow({ last_seen_at: T0 - 5 * 60_000, expires_at: abs }));
    const res = await lookupSession(d.asD1(), token, 'admin', T0);
    expect(res.ok && res.touched).toBe(true);
    if (res.ok) expect(res.session.expiresAt).toBe(abs);
  });

  it('reports expired, suspended and missing sessions', async () => {
    expect(await lookupSession(db(userRow({ expires_at: T0 })).asD1(), token, 'app', T0)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await lookupSession(db(userRow({ status: 'suspended' })).asD1(), token, 'app', T0)).toEqual({
      ok: false,
      reason: 'suspended',
    });
    expect(await lookupSession(db(null).asD1(), token, 'app', T0)).toEqual({ ok: false, reason: 'missing' });
  });
});
