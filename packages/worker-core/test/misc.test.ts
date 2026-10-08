import { describe, expect, it } from 'vitest';
import { hashIp, jsonDiff } from '../src/audit';
import { TURNSTILE_TEST_SECRET, verifyTurnstile } from '../src/auth/turnstile';
import { batch, fromJson, q } from '../src/db';
import { evaluateFlag, type Flag, rolloutBucket } from '../src/flags';
import { addDays, daysBetween, localDate, period, safeTimeZone } from '../src/time';
import { FakeD1 } from './helpers/fakeD1';

describe('time', () => {
  // 2026-09-15T02:30:00Z is still the 14th in São Paulo (UTC-3).
  const t = Date.parse('2026-09-15T02:30:00Z');

  it('formats local dates in the user timezone', () => {
    expect(localDate(t, 'America/Sao_Paulo')).toBe('2026-09-14');
    expect(localDate(t, 'UTC')).toBe('2026-09-15');
    expect(localDate(t, 'Not/AZone')).toBe('2026-09-14');
    expect(period(t, 'America/Sao_Paulo')).toBe('2026-09');
    expect(safeTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('does calendar math on YYYY-MM-DD', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-09-14', '2026-09-16')).toBe(2);
  });
});

describe('audit', () => {
  it('diffs top-level fields and redacts secrets', () => {
    expect(jsonDiff({ a: 1, b: 2, pass_hash: 'x' }, { a: 1, b: 3, pass_hash: 'y', c: [1] })).toEqual({
      b: { from: 2, to: 3 },
      pass_hash: { from: '[redacted]', to: '[redacted]' },
      c: { from: null, to: [1] },
    });
    expect(jsonDiff(undefined, { title: 'Ep' })).toEqual({ title: { from: null, to: 'Ep' } });
    expect(
      jsonDiff(
        { passScore: 7, pass_score: 7, passed: false, password: 'a', token_hash: 'a', tokenHash: 'a', salt: 'a' },
        { passScore: 8, pass_score: 8, passed: true, password: 'b', token_hash: 'b', tokenHash: 'b', salt: 'b' },
      ),
    ).toEqual({
      passScore: { from: 7, to: 8 },
      pass_score: { from: 7, to: 8 },
      passed: { from: false, to: true },
      password: { from: '[redacted]', to: '[redacted]' },
      token_hash: { from: '[redacted]', to: '[redacted]' },
      tokenHash: { from: '[redacted]', to: '[redacted]' },
      salt: { from: '[redacted]', to: '[redacted]' },
    });
    expect(jsonDiff([1], [1])).toEqual({});
    expect(jsonDiff('a', 'b')).toEqual({ value: { from: 'a', to: 'b' } });
  });

  it('hashes IPs with the salt', async () => {
    const a = await hashIp('1.2.3.4', 'salt-a');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashIp('1.2.3.4', 'salt-b')).not.toBe(a);
    expect(await hashIp('1.2.3.4', 'salt-a')).toBe(a);
  });
});

describe('flags', () => {
  const flag = (over: Partial<Flag> = {}): Flag => ({ key: 'f', enabled: true, rolloutPct: 100, rules: null, ...over });

  it('evaluates enabled, rollout and allowlists', () => {
    expect(evaluateFlag(undefined)).toBe(false);
    expect(evaluateFlag(flag({ enabled: false }))).toBe(false);
    expect(evaluateFlag(flag())).toBe(true);
    expect(evaluateFlag(flag({ rolloutPct: 0 }), { userId: 'U' })).toBe(false);
    expect(evaluateFlag(flag({ rolloutPct: 50 }))).toBe(false);
    expect(evaluateFlag(flag({ rolloutPct: 0, rules: { users: ['U'] } }), { userId: 'U' })).toBe(true);
    expect(evaluateFlag(flag({ rolloutPct: 0, rules: { roles: ['admin'] } }), { roles: ['admin'] })).toBe(true);
    expect(evaluateFlag(flag({ rolloutPct: 0, rules: { plans: ['premium'] } }), { planSlug: 'gratis' })).toBe(false);
  });

  it('buckets users stably and roughly uniformly', () => {
    expect(rolloutBucket('f', 'U1')).toBe(rolloutBucket('f', 'U1'));
    let inHalf = 0;
    for (let i = 0; i < 2000; i++) if (rolloutBucket('f', `user-${i}`) < 50) inHalf++;
    expect(inHalf).toBeGreaterThan(850);
    expect(inHalf).toBeLessThan(1150);
  });
});

describe('db helpers', () => {
  it('normalizes binds and returns typed batch rows', async () => {
    const d = new FakeD1((sql) => (sql.startsWith('SELECT 1') ? [{ one: 1 }] : [{ two: 'x' }]));
    const db = d.asD1();
    const [a, b] = await batch(db, [
      q<{ one: number }>(db, 'SELECT 1', true, undefined),
      q<{ two: string }>(db, 'SELECT 2'),
    ]);
    expect(a[0]?.one).toBe(1);
    expect(b[0]?.two).toBe('x');
    expect(d.executed[0]?.params).toEqual([1, null]);
    expect(fromJson('{bad', 7)).toBe(7);
    expect(fromJson<number[]>('[1]', [])).toEqual([1]);
  });
});

describe('turnstile', () => {
  const env = { TURNSTILE_SECRET: 'real-secret', APP_ORIGIN: 'https://tie.example' };
  const reply = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  it('passes the dev test secret on localhost without network', async () => {
    const local = { TURNSTILE_SECRET: TURNSTILE_TEST_SECRET, APP_ORIGIN: 'http://localhost:8787' };
    const fetcher = (() => {
      throw new Error('no network');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile(local, 'XXXX.DUMMY.TOKEN.XXXX', { action: 'login', fetcher })).toEqual({ ok: true });
    expect((await verifyTurnstile(local, '', { fetcher })).ok).toBe(false);
  });

  it('checks success and action', async () => {
    expect(
      await verifyTurnstile(env, 't', { action: 'login', fetcher: reply({ success: true, action: 'login' }) }),
    ).toEqual({
      ok: true,
    });
    expect(
      (await verifyTurnstile(env, 't', { action: 'login', fetcher: reply({ success: true, action: 'signup' }) })).ok,
    ).toBe(false);
    expect((await verifyTurnstile(env, 't', { fetcher: reply({ success: false, 'error-codes': ['bad'] }) })).ok).toBe(
      false,
    );
  });

  it('sends remoteip and treats network errors as failure', async () => {
    let sent: FormData | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    await verifyTurnstile(env, 't', { ip: '9.9.9.9', fetcher });
    expect((sent as FormData | null)?.get('remoteip')).toBe('9.9.9.9');
    const broken = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile(env, 't', { fetcher: broken })).toEqual({ ok: false, reason: 'network-error' });
  });
});
