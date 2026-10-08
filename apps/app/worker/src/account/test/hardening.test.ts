/// <reference types="@cloudflare/vitest-plugin/types" />
// Regression tests for the S1 review: atomic lockout, reset limiter, profile rules, idempotent
// onboarding completion, new-account streak, concurrent photo uploads and account route limits.
import { appApi, type PhotoRes, ProfileCompleteRes, type ProfileRes, type SettingsRes, TieState } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, Client, freshIp, one, photoForm, pngBytes, resetDb, signup, testEnv } from './helpers';

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

describe('account route limits', () => {
  it('rate limits the export per user', async () => {
    const { client } = await signup('exp@example.com');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await client.send(M.export.path)).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
