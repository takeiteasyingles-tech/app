/// <reference types="@cloudflare/vitest-plugin/types" />
import { AuthConfig, appApi, MeSummary, ProfileCompleteRes, ProfileRes, TieState } from '@tie/shared';
import { hashToken } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, Client, exec, freshIp, one, resetDb, signup, signupBody } from './helpers';

const A = appApi.auth;
const M = appApi.me;

beforeEach(resetDb);

describe('signup → state → profile → logout → login', () => {
  it('runs the whole account lifecycle', async () => {
    const client = new Client();
    const reg = await client.json<{ user: { id: string; email: string; name: string } }>(A.signup.path, {
      json: signupBody('Ana@Example.com ', { tz: 'Europe/Lisbon' }),
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'ana@example.com', name: 'Ana', fullName: 'Ana Souza' });
    expect(client.cookies.has('tie_s')).toBe(true);
    expect(client.cookies.has('tie_m')).toBe(true);
    const uid = reg.body.user.id;

    const user = await one<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', uid);
    expect(user).toMatchObject({ tz: 'Europe/Lisbon', terms_version: '2026-10', status: 'active' });
    expect(String(user?.pass_hash)).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await one('SELECT plan_id FROM user_plans WHERE user_id = ?', uid)).toEqual({ plan_id: 'P0' });
    expect(await one('SELECT user_id FROM user_settings WHERE user_id = ?', uid)).not.toBeNull();
    expect(await one('SELECT user_id FROM user_stats WHERE user_id = ?', uid)).not.toBeNull();
    expect(await one('SELECT age_band, onb_step FROM profiles WHERE user_id = ?', uid)).toEqual({
      age_band: '35-44',
      onb_step: 2,
    });
    expect(
      await one("SELECT action FROM audit_log WHERE action = 'auth.signup' AND actor_user_id = ?", uid),
    ).not.toBeNull();

    // State: onboarding in progress.
    let st = await client.json<TieState>(M.state.path);
    expect(st.status).toBe(200);
    const state = TieState.parse(st.body);
    expect(state.user).toEqual({ id: uid, email: 'ana@example.com', name: 'Ana', fullName: 'Ana Souza' });
    expect(state.profile).toBeNull();
    expect(state.onbStep).toBe(2);
    expect(state.draft).toMatchObject({
      fullName: 'Ana Souza',
      name: 'Ana',
      birth: '1990-05-20',
      email: 'ana@example.com',
    });
    expect(state.plan?.slug).toBe('gratis');
    expect(state.maggie).toMatchObject({ limitSec: 3600, secLeft: 3600, sessions: [] });
    expect(state.tz).toBe('Europe/Lisbon');
    expect(state.flags).toEqual({ 'dev.free_steps': false });
    expect(state.settings).toMatchObject({ free: false, phone: false, ts: 1, sound: true });

    // Profile: partial wizard update; unknown keys are stripped.
    const pr = await client.json<ProfileRes>(M.profile.path, {
      method: 'PUT',
      json: {
        goals: ['viagem', 'series'],
        formats: ['series'],
        diffs: ['listening'],
        minutes: 10,
        onbStep: 4,
        bogus: 1,
      },
    });
    expect(pr.status).toBe(200);
    ProfileRes.parse(pr.body);
    expect(pr.body).toMatchObject({ onbStep: 4, completed: false });
    expect(pr.body.profile).toMatchObject({
      goals: ['viagem', 'series'],
      formats: ['series'],
      minutes: 10,
      name: 'Ana',
    });
    // onb_step never goes backwards.
    const back = await client.json<ProfileRes>(M.profile.path, { method: 'PUT', json: { onbStep: 3 } });
    expect(back.body.onbStep).toBe(4);
    // Invalid values are rejected.
    const bad = await client.json<{ error: { code: string } }>(M.profile.path, { method: 'PUT', json: { minutes: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    const young = await client.json<{ error: { code: string } }>(M.profile.path, {
      method: 'PUT',
      json: { birth: '2025-01-01' },
    });
    expect(young.body.error.code).toBe('validation_failed');

    const done = await client.json<ProfileCompleteRes>(M.profileComplete.path, { method: 'POST' });
    expect(done.status).toBe(200);
    ProfileCompleteRes.parse(done.body);
    expect(done.body.settings.slow).toBe(true); // listening → 0.75× speed

    st = await client.json<TieState>(M.state.path);
    const after = TieState.parse(st.body);
    expect(after.profile?.goals).toEqual(['viagem', 'series']);
    expect(after.onbStep).toBe(7);
    expect(after.game.streak).toBe(1);
    expect(after.game.lastDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const sum = await client.json<MeSummary>(M.summary.path);
    expect(sum.status).toBe(200);
    const summary = MeSummary.parse(sum.body);
    expect(summary.goal.target).toBe(50);
    expect(summary.quota).toMatchObject({ limitS: 3600, usedS: 0, leftS: 3600 });
    expect(summary.plan?.slug).toBe('gratis');
    expect(summary.missions[0]?.k).toBe('step');

    // Logout kills the session server-side too.
    const oldCookie = client.cookies.get('tie_s');
    const out = await client.json(A.logout.path, { method: 'POST' });
    expect(out.status).toBe(200);
    expect(client.cookies.has('tie_s')).toBe(false);
    expect(client.cookies.has('tie_m')).toBe(false);
    expect((await client.json(M.state.path)).status).toBe(401);
    const replay = new Client();
    replay.cookies.set('tie_s', oldCookie ?? '');
    expect((await replay.json(M.state.path)).status).toBe(401);

    // Login: wrong password and unknown email give the same generic error.
    const wrong = await client.json<{ error: { code: string } }>(A.login.path, {
      json: { email: 'ana@example.com', password: 'nope-nope', turnstileToken: 't' },
    });
    const unknown = await client.json<{ error: { code: string } }>(A.login.path, {
      json: { email: 'ghost@example.com', password: 'nope-nope', turnstileToken: 't' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);

    const ok = await client.json<{ user: { id: string; name: string } }>(A.login.path, {
      json: { email: 'ANA@example.com', password: 'segredo123', turnstileToken: 't' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: uid, name: 'Ana' });
    expect(client.cookies.has('tie_m')).toBe(true);
    expect((await client.json(M.state.path)).status).toBe(200);
    expect(await one('SELECT failed_logins, locked_until FROM users WHERE id = ?', uid)).toEqual({
      failed_logins: 0,
      locked_until: null,
    });
  });

  it('rejects a duplicate email, a bad tz falls back to São Paulo, and the age rule applies', async () => {
    const { id } = await signup('dup@example.com', { tz: 'Not/AZone' });
    expect(await one('SELECT tz FROM users WHERE id = ?', id)).toEqual({ tz: 'America/Sao_Paulo' });
    const again = await new Client().json<{ error: { code: string } }>(A.signup.path, {
      json: signupBody('DUP@example.com'),
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('email_taken');

    const kid = await new Client().json<{ error: { code: string } }>(A.signup.path, {
      json: signupBody('kid@example.com', { birth: '2024-01-01' }),
    });
    expect(kid.body.error.code).toBe('validation_failed');
    const terms = await new Client().json<{ error: { code: string } }>(A.signup.path, {
      json: signupBody('old@example.com', { termsVersion: '2020-01' }),
    });
    expect(terms.body.error.code).toBe('validation_failed');
    const noTerms = await new Client().json(A.signup.path, {
      json: signupBody('x@example.com', { acceptTerms: false }),
    });
    expect(noTerms.status).toBe(400);
  });

  it('serves the public auth config', async () => {
    const r = await new Client().json<AuthConfig>(A.config.path);
    expect(AuthConfig.parse(r.body)).toEqual({
      turnstileSiteKey: '1x00000000000000000000AA',
      termsVersion: '2026-10',
      passwordMin: 6,
    });
  });
});

describe('login lockout and rate limit', () => {
  it('locks the account for 15 minutes after 10 failures', async () => {
    const { id } = await signup('lock@example.com');
    const c = new Client();
    const attempt = (password: string) =>
      c.json<{ error?: { code: string } }>(A.login.path, {
        json: { email: 'lock@example.com', password, turnstileToken: 't' },
      });

    for (let i = 1; i <= 9; i++) {
      const r = await attempt('wrong-pass');
      expect(r.body.error?.code).toBe('invalid_credentials');
    }
    const tenth = await attempt('wrong-pass');
    expect(tenth.status).toBe(423);
    expect(tenth.body.error?.code).toBe('account_locked');

    // Even the right password is refused while locked.
    const locked = await attempt('segredo123');
    expect(locked.body.error?.code).toBe('account_locked');
    const row = await one<{ locked_until: number }>('SELECT locked_until FROM users WHERE id = ?', id);
    expect(row?.locked_until).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(
      await one("SELECT action FROM audit_log WHERE action = 'auth.lockout' AND target_id = ?", id),
    ).not.toBeNull();

    // When the window passes, the right password works and the counter resets.
    await exec('UPDATE users SET locked_until = ? WHERE id = ?', Date.now() - 1, id);
    const ok = await attempt('segredo123');
    expect(ok.status).toBe(200);
    expect(await one('SELECT failed_logins, locked_until FROM users WHERE id = ?', id)).toEqual({
      failed_logins: 0,
      locked_until: null,
    });
  });

  it('applies RL_AUTH per ip+email', async () => {
    await signup('rl@example.com');
    const c = new Client();
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await c.send(A.login.path, {
        ip,
        json: { email: 'rl@example.com', password: 'wrong-pass', turnstileToken: 't' },
      });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.at(-1)).toBe(429);
    // Another email from the same IP has its own bucket.
    const other = await c.send(A.login.path, {
      ip,
      json: { email: 'other@example.com', password: 'wrong-pass', turnstileToken: 't' },
    });
    expect(other.status).toBe(401);
  });
});

describe('CSRF', () => {
  it('rejects cross-site and malformed state-changing requests', async () => {
    const { client, id } = await signup('csrf@example.com');
    const login = { email: 'csrf@example.com', password: 'segredo123', turnstileToken: 't' };

    const evil = await client.json<{ error: { code: string } }>(A.login.path, {
      json: login,
      headers: { Origin: 'https://evil.example' },
    });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('csrf_failed');

    const noOrigin = await client.json<{ error: { code: string } }>(A.login.path, { json: login, noOrigin: true });
    expect(noOrigin.body.error.code).toBe('csrf_failed');

    const crossSite = await client.json<{ error: { code: string } }>(A.login.path, {
      json: login,
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(crossSite.body.error.code).toBe('csrf_failed');

    const form = await client.json<{ error: { code: string } }>(A.login.path, {
      body: 'email=csrf%40example.com',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(415);

    // A forged profile write with a valid cookie changes nothing.
    const forged = await client.send(M.profile.path, {
      method: 'PUT',
      json: { name: 'Hacked' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(forged.status).toBe(403);
    expect(await one('SELECT name FROM profiles WHERE user_id = ?', id)).toEqual({ name: 'Ana' });

    // Multipart is only accepted on the photo route.
    const fd = new FormData();
    fd.append('name', 'x');
    const mp = await client.send(M.profile.path, { method: 'PUT', body: fd });
    expect(mp.status).toBe(415);
  });
});

describe('password reset and change', () => {
  it('consumes an admin-issued reset token once and revokes sessions', async () => {
    const { client, id } = await signup('reset@example.com');
    const token = 'reset-token-0123456789abcdefghijklmnop';
    await exec(
      "INSERT INTO one_time_tokens(token_hash, user_id, kind, expires_at) VALUES(?, ?, 'reset', ?)",
      await hashToken(token),
      id,
      Date.now() + 3_600_000,
    );
    const r = await new Client().json(A.resetConsume.path, {
      json: { token, password: 'nova-senha-1', turnstileToken: 't' },
    });
    expect(r.status).toBe(200);
    expect((await client.json(M.state.path)).status).toBe(401);
    const again = await new Client().json<{ error: { code: string } }>(A.resetConsume.path, {
      json: { token, password: 'outra-senha', turnstileToken: 't' },
    });
    expect(again.body.error.code).toBe('token_invalid');
    const login = await new Client().json(A.login.path, {
      json: { email: 'reset@example.com', password: 'nova-senha-1', turnstileToken: 't' },
    });
    expect(login.status).toBe(200);
  });

  it('changes the password, keeps this device and revokes the others', async () => {
    const { client: phone, id } = await signup('pw@example.com');
    const laptop = new Client();
    await laptop.json(A.login.path, { json: { email: 'pw@example.com', password: 'segredo123', turnstileToken: 't' } });
    expect((await laptop.json(M.state.path)).status).toBe(200);

    const wrong = await phone.json<{ error: { code: string } }>(A.changePassword.path, {
      json: { currentPassword: 'nope', newPassword: 'novinha-123' },
    });
    expect(wrong.body.error.code).toBe('invalid_credentials');

    const before = phone.cookies.get('tie_s');
    const ok = await phone.json(A.changePassword.path, {
      json: { currentPassword: 'segredo123', newPassword: 'novinha-123' },
    });
    expect(ok.status).toBe(200);
    expect(phone.cookies.get('tie_s')).not.toBe(before);
    expect((await phone.json(M.state.path)).status).toBe(200);
    expect((await laptop.json(M.state.path)).status).toBe(401);
    expect(await all('SELECT token_hash FROM sessions WHERE user_id = ?', id)).toHaveLength(1);
  });
});
