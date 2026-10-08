/// <reference types="@cloudflare/vitest-plugin/types" />
// Regression tests for the S1 review: atomic lockout, reset limiter, profile rules, idempotent
// onboarding completion, new-account streak, concurrent photo uploads and account route limits.
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { appApi, type PhotoRes, ProfileCompleteRes, type ProfileRes, type SettingsRes, TieState } from '@tie/shared';
import { type Env, FAILED_LOGIN_DECAY_MS, hashToken } from '@tie/worker-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  all,
  buildApp,
  Client,
  freshIp,
  ORIGIN,
  one,
  photoForm,
  pngBytes,
  resetDb,
  signup,
  signupBody,
  testEnv,
} from './helpers';

const A = appApi.auth;
const M = appApi.me;

beforeEach(resetDb);

type ErrBody = { error?: { code: string } };

describe('login lockout under concurrency', () => {
  it('locks after 10 failures even when 30 arrive in parallel from different IPs', async () => {
    const { id } = await signup('race@example.com');
    const wrong = { email: 'race@example.com', password: 'wrong-pass', turnstileToken: 't' };
    const results = await Promise.all(
      Array.from({ length: 30 }, () => new Client().json<ErrBody>(A.login.path, { json: wrong })),
    );
    const codes = results.map((r) => r.body.error?.code);
    expect(codes.every((c) => c === 'invalid_credentials' || c === 'account_locked')).toBe(true);
    // At most 9 failures can be answered before the 10th one locks the account.
    expect(codes.filter((c) => c === 'invalid_credentials').length).toBeLessThanOrEqual(9);
    expect(codes).toContain('account_locked');

    const row = await one<{ locked_until: number | null }>('SELECT locked_until FROM users WHERE id = ?', id);
    expect(row?.locked_until).toBeGreaterThan(Date.now() + 14 * 60_000);
    // The lockout is audited once, by the request that crossed the threshold.
    expect(await all("SELECT id FROM audit_log WHERE action = 'auth.lockout' AND target_id = ?", id)).toHaveLength(1);

    const right = await new Client().json<ErrBody>(A.login.path, {
      json: { ...wrong, password: 'segredo123' },
    });
    expect(right.body.error?.code).toBe('account_locked');
  });

  it('an expired lock restarts the count from 1', async () => {
    const { id } = await signup('again@example.com');
    await testEnv.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?')
      .bind(Date.now() - 1, id)
      .run();
    const r = await new Client().json<ErrBody>(A.login.path, {
      json: { email: 'again@example.com', password: 'wrong-pass', turnstileToken: 't' },
    });
    expect(r.body.error?.code).toBe('invalid_credentials');
    expect(await one('SELECT failed_logins, locked_until FROM users WHERE id = ?', id)).toEqual({
      failed_logins: 1,
      locked_until: null,
    });
  });
});

describe('reset/consume', () => {
  it('limits guesses per IP, whatever the token, and audits nothing for invalid tokens', async () => {
    const c = new Client();
    const ip = freshIp();
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await c.json<ErrBody>(A.resetConsume.path, {
        ip,
        json: { token: `guess-${i}-0123456789abcdefghijklmnopqrstuv`, password: 'nova-senha-1', turnstileToken: 't' },
      });
      codes.push(r.body.error?.code);
    }
    expect(codes.slice(0, 5)).toEqual(Array(5).fill('token_invalid'));
    expect(codes[5]).toBe('rate_limited');
    expect(await all("SELECT id FROM audit_log WHERE action = 'auth.reset_consume'")).toEqual([]);
  });
});

describe('profile rules', () => {
  it('derives the age band from birth, refuses blank birth and names', async () => {
    const { client, id } = await signup('rules@example.com');
    const put = (json: Record<string, unknown>) =>
      client.json<ProfileRes & ErrBody>(M.profile.path, { method: 'PUT', json });

    // A client age is ignored; it always follows birth (1990-05-20 → 35-44).
    let r = await put({ age: '60+' });
    expect(r.status).toBe(200);
    expect(r.body.profile.age).toBe('35-44');
    r = await put({ birth: '2000-01-01', age: '-18' });
    expect(r.body.profile).toMatchObject({ birth: '2000-01-01', age: '25-34' });
    expect(await one('SELECT age_band FROM profiles WHERE user_id = ?', id)).toEqual({ age_band: '25-34' });

    for (const bad of [{ birth: '' }, { name: '' }, { name: '   ' }, { fullName: 'Ana' }, { fullName: '  ' }]) {
      const res = await put(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
    }
    r = await put({ name: '  Bia ', fullName: ' Beatriz  Lima ' });
    expect(r.body.profile).toMatchObject({ name: 'Bia', fullName: 'Beatriz  Lima', birth: '2000-01-01' });
    const st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.user?.name).toBe('Bia');
  });
});

describe('onboarding completion', () => {
  it('is idempotent: a second call keeps the user settings and streak; reminders are sorted', async () => {
    const { client } = await signup('onb@example.com');
    const fresh = TieState.parse((await client.json(M.state.path)).body);
    expect(fresh.game).toMatchObject({ streak: 1, lastDay: '' }); // like freshState()/store.fresh()

    await client.json(M.profile.path, {
      method: 'PUT',
      json: { diffs: ['listening'], reminders: ['20:00', '07:30'] },
    });
    const first = await client.json<ProfileCompleteRes>(M.profileComplete.path, { method: 'POST' });
    ProfileCompleteRes.parse(first.body);
    expect(first.body.settings.slow).toBe(true);
    expect(first.body.profile.reminders).toEqual(['07:30', '20:00']);

    const patched = await client.json<SettingsRes>(M.settings.path, { method: 'PATCH', json: { slow: false } });
    expect(patched.body.settings.slow).toBe(false);

    const second = await client.json<ProfileCompleteRes>(M.profileComplete.path, { method: 'POST' });
    expect(second.body.settings.slow).toBe(false);
    const st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.settings.slow).toBe(false);
    expect(st.profile?.reminders).toEqual(['07:30', '20:00']);
    expect(st.game.streak).toBe(1);
  });

  it('a broken streak shows 1 in both the state and the summary', async () => {
    const { client, id } = await signup('broken@example.com');
    await testEnv.DB.prepare("UPDATE user_stats SET streak = 5, last_day = '2020-01-01' WHERE user_id = ?")
      .bind(id)
      .run();
    const st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.game).toMatchObject({ streak: 1, lastDay: '2020-01-01' });
    const sum = await client.json<{ streak: number }>(M.summary.path);
    expect(sum.body.streak).toBe(1);
  });
});

describe('concurrent photo uploads', () => {
  it('leave exactly one active upload, the one the profile points to, and one R2 object', async () => {
    const { client, id } = await signup('twin@example.com');
    const [a, b] = await Promise.all([
      client.json<PhotoRes>(M.photoUpload.path, { body: photoForm(pngBytes(32, 32)) }),
      client.json<PhotoRes>(M.photoUpload.path, { body: photoForm(pngBytes(48, 48)) }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const active = await all<{ id: string }>(
      "SELECT id FROM uploads WHERE user_id = ? AND kind = 'photo' AND status = 'active'",
      id,
    );
    expect(active).toHaveLength(1);
    expect(await one('SELECT photo_upload FROM profiles WHERE user_id = ?', id)).toEqual({
      photo_upload: active[0]?.id,
    });
    expect((await testEnv.MEDIA.list({ prefix: `users/${id}/` })).objects).toHaveLength(1);
    expect(
      await all("SELECT id FROM moderation_items WHERE subject_user_id = ? AND status = 'pending'", id),
    ).toHaveLength(1);
  });
});

describe('spec 06 auth minors', () => {
  it('signup checks Turnstile before the duplicate email (no enumeration without Turnstile)', async () => {
    await signup('taken@example.com');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    try {
      const failing = { ...testEnv, TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' } as Env;
      const ctx = createExecutionContext();
      const res = await buildApp().fetch(
        new Request(`${ORIGIN}${A.signup.path}`, {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            'Sec-Fetch-Site': 'same-origin',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': freshIp(),
          },
          body: JSON.stringify(signupBody('taken@example.com')),
        }),
        failing,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(((await res.json()) as ErrBody).error?.code).toBe('turnstile_failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('failed logins older than the decay window stop counting', async () => {
    const { id } = await signup('decay@example.com');
    await testEnv.DB.prepare('UPDATE users SET failed_logins = 9, failed_at = ? WHERE id = ?')
      .bind(Date.now() - FAILED_LOGIN_DECAY_MS - 1000, id)
      .run();
    const wrong = { email: 'decay@example.com', password: 'wrong-pass', turnstileToken: 't' };
    const r = await new Client().json<ErrBody>(A.login.path, { json: wrong });
    expect(r.body.error?.code).toBe('invalid_credentials');
    expect(await one('SELECT failed_logins, locked_until FROM users WHERE id = ?', id)).toEqual({
      failed_logins: 1,
      locked_until: null,
    });
    // Recent failures still add up to the lock.
    await testEnv.DB.prepare('UPDATE users SET failed_logins = 9, failed_at = ? WHERE id = ?')
      .bind(Date.now(), id)
      .run();
    expect((await new Client().json<ErrBody>(A.login.path, { json: wrong })).body.error?.code).toBe('account_locked');
  });

  it('two consumers of one reset token in the same millisecond: exactly one wins', async () => {
    const { id } = await signup('twin-reset@example.com');
    const token = 'reset-token-0123456789abcdefghijklmnopqrstuvwxyz';
    await testEnv.DB.prepare(
      "INSERT INTO one_time_tokens(token_hash, user_id, kind, expires_at) VALUES(?, ?, 'reset', ?)",
    )
      .bind(await hashToken(token), id, Date.now() + 60_000)
      .run();
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = () => frozen;
    const passwords = ['senha-um-111', 'senha-dois-222'];
    let winner = -1;
    try {
      const results = await Promise.all(
        passwords.map((password) =>
          new Client().json<ErrBody & { ok?: boolean }>(A.resetConsume.path, {
            json: { token, password, turnstileToken: 't' },
          }),
        ),
      );
      expect(results.map((r) => r.body.ok === true).filter(Boolean)).toHaveLength(1);
      expect(results.map((r) => r.body.error?.code).filter(Boolean)).toEqual(['token_invalid']);
      expect(await all("SELECT id FROM audit_log WHERE action = 'auth.reset_consume'")).toHaveLength(1);
      winner = results.findIndex((r) => r.body.ok === true);
    } finally {
      Date.now = realNow;
    }
    // The loser wrote nothing: the password is the winner's.
    const login = (password: string) =>
      new Client().json<ErrBody>(A.login.path, {
        json: { email: 'twin-reset@example.com', password, turnstileToken: 't' },
      });
    expect((await login(passwords[1 - winner] as string)).body.error?.code).toBe('invalid_credentials');
    expect((await login(passwords[winner] as string)).status).toBe(200);
  });

  it('"Zerar progresso" keeps Mic sessions with a pending moderation item', async () => {
    const { client, id } = await signup('evidence@example.com');
    const now = Date.now();
    const db = testEnv.DB;
    await db.batch([
      db
        .prepare(
          `INSERT INTO mic_sessions(id, user_id, assistant_key, mode, started_at, billed_until, status, flagged)
           VALUES ('E-pending', ?1, 'margaret', 'livre', ?2, ?2, 'ended', 1),
                  ('E-decided', ?1, 'margaret', 'livre', ?2, ?2, 'ended', 1),
                  ('E-plain', ?1, 'margaret', 'livre', ?2, ?2, 'ended', 0)`,
        )
        .bind(id, now),
      db
        .prepare(
          `INSERT INTO moderation_items(id, kind, subject_user_id, ref_type, ref_id, status, created_at)
           VALUES ('MP', 'transcript', ?1, 'mic_turn', 'E-pending:0', 'pending', ?2),
                  ('MD', 'transcript', ?1, 'mic_turn', 'E-decided:0', 'dismissed', ?2)`,
        )
        .bind(id, now),
    ]);
    const r = await client.send(M.resetProgress.path, { method: 'POST', json: { confirm: true } });
    expect(r.status).toBe(200);
    expect(await all('SELECT id FROM mic_sessions WHERE user_id = ? ORDER BY id', id)).toEqual([{ id: 'E-pending' }]);
  });
});

describe('account route limits', () => {
  it('rate limits the export per user', async () => {
    const { client } = await signup('exp@example.com');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await client.send(M.export.path)).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
