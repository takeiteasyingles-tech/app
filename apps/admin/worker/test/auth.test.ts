// Staff auth: login, the 8h absolute / 30 min idle admin session, invites (StaffPassword ≥ 10),
// password change and logout.
import { adminAccountApi, adminApi, buildPath, DURATIONS } from '@tie/shared';
import { hashToken } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditRows, Client, exec, ins, learner, one, PASSWORD, resetDb, staff } from './helpers';

const A = adminApi.auth;
const TS = 'XXXX.DUMMY.TOKEN.XXXX';

const login = (c: Client, email: string, password: string) =>
  c.json(A.login.path, { json: { email, password, turnstileToken: TS } });

describe('login', () => {
  beforeEach(resetDb);

  it('signs staff in with an 8h tie_adm cookie and returns roles and permissions', async () => {
    const since = Date.now();
    const s = await staff(['editor']);
    const c = new Client();
    const r = await login(c, s.email.toUpperCase(), PASSWORD);
    expect(r.status).toBe(200);
    expect(r.body.user).toEqual({ id: s.id, email: s.email, roles: ['editor'] });
    expect(r.body.permissions).toEqual(['content.edit', 'content.publish', 'media.manage']);
    const cookie = r.res.headers.getSetCookie().find((l) => l.startsWith('tie_adm='));
    expect(cookie).toMatch(/Max-Age=28800/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await c.json(A.me.path)).body.user.id).toBe(s.id);
    expect(await auditRows('admin.auth.login', since)).toHaveLength(1);
  });

  it('refuses wrong passwords, unknown emails and learners with the same answer', async () => {
    const s = await staff(['moderator']);
    const l = await learner({ password: PASSWORD });
    for (const [email, pass] of [
      [s.email, 'errada-123456'],
      ['ninguem@test.local', PASSWORD],
      [l.email, PASSWORD],
    ] as const) {
      const r = await login(new Client(), email, pass);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('invalid_credentials');
    }
  });

  it('refuses suspended staff and locks after 10 failures', async () => {
    const s = await staff(['admin']);
    await exec("UPDATE users SET status = 'suspended' WHERE id = ?", s.id);
    expect((await login(new Client(), s.email, PASSWORD)).body.error.code).toBe('account_suspended');
    await exec("UPDATE users SET status = 'active', failed_logins = 9 WHERE id = ?", s.id);
    expect((await login(new Client(), s.email, 'errada-123456')).body.error.code).toBe('account_locked');
    expect((await login(new Client(), s.email, PASSWORD)).body.error.code).toBe('account_locked');
  });

  it('rate-limits by ip + email', async () => {
    const ip = '10.200.0.1';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await new Client().send(A.login.path, {
        json: { email: 'x@test.local', password: 'y', turnstileToken: TS },
        ip,
      });
      codes.push(r.status);
    }
    expect(codes.at(-1)).toBe(429);
  });
});

describe('admin session', () => {
  beforeEach(resetDb);

  it('dies after 30 minutes idle and after 8 hours in all', async () => {
    const s = await staff(['moderator']);
    expect((await s.client.send(A.me.path)).status).toBe(200);
    await exec(
      'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?',
      Date.now() - DURATIONS.adminSessionIdleMs - 1000,
      s.tokenHash,
    );
    const idle = await s.client.json(A.me.path);
    expect(idle.status).toBe(401);
    expect(idle.body.error.code).toBe('session_expired');

    const t = await staff(['moderator']);
    await exec('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() - 1, t.tokenHash);
    expect((await t.client.json(A.me.path)).body.error.code).toBe('session_expired');
  });

  it('is not an app session: a student cookie does not open the admin API', async () => {
    const l = await learner();
    const c = new Client();
    c.cookies.set('tie_s', l.appToken);
    c.cookies.set('tie_adm', l.appToken);
    expect((await c.send(A.me.path)).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const s = await staff(['editor']);
    expect((await s.client.json(A.logout.path, { method: 'POST' })).body).toEqual({ ok: true });
    expect(await one('SELECT 1 FROM sessions WHERE token_hash = ?', s.tokenHash)).toBeNull();
    expect((await s.client.send(A.me.path)).status).toBe(401);
  });

  it('password change needs the current password, ≥10 chars, and rotates every session', async () => {
    const s = await staff(['editor']);
    const other = new Client();
    await login(other, s.email, PASSWORD);
    const path = adminAccountApi.password.path;
    expect(
      (await s.client.json(path, { json: { currentPassword: 'errada', newPassword: 'nova-senha-123' } })).status,
    ).toBe(401);
    expect((await s.client.json(path, { json: { currentPassword: PASSWORD, newPassword: 'curta123' } })).status).toBe(
      400,
    );
    const ok = await s.client.json(path, { json: { currentPassword: PASSWORD, newPassword: 'nova-senha-123' } });
    expect(ok.status).toBe(200);
    expect((await s.client.send(A.me.path)).status).toBe(200);
    expect((await other.send(A.me.path)).status).toBe(401);
    expect((await login(new Client(), s.email, 'nova-senha-123')).status).toBe(200);
  });
});

describe('invites', () => {
  beforeEach(resetDb);

  const tokenOf = (url: string) => url.split('/#/convite/')[1] as string;

  it('creates a staff account from an invite (password ≥ 10) and signs it in', async () => {
    const since = Date.now();
    const admin = await staff(['admin']);
    const inv = await admin.client.json(adminApi.users.invite.path, {
      json: { email: 'Nova@Test.local', role: 'editor' },
    });
    expect(inv.status).toBe(200);
    expect(inv.body.url).toMatch(/^http:\/\/localhost\/#\/convite\/[\w-]{43}$/);
    const token = tokenOf(inv.body.url);
    // Only the hash is stored.
    expect(await one('SELECT 1 FROM one_time_tokens WHERE token_hash = ?', token)).toBeNull();
    expect(await one('SELECT 1 FROM one_time_tokens WHERE token_hash = ?', await hashToken(token))).not.toBeNull();

    const info = await new Client().json(buildPath(A.inviteInfo.path, { token }));
    expect(info.body).toMatchObject({ email: 'nova@test.local', role: 'editor' });

    const c = new Client();
    const short = await c.json(A.inviteAccept.path, { json: { token, password: '123456789', turnstileToken: TS } });
    expect(short.status).toBe(400);
    const ok = await c.json(A.inviteAccept.path, { json: { token, password: 'senha-nova-10', turnstileToken: TS } });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: 'nova@test.local', roles: ['editor'] });
    expect((await c.json(A.me.path)).body.user.roles).toEqual(['editor']);
    const again = await new Client().json(A.inviteAccept.path, {
      json: { token, password: 'senha-nova-10', turnstileToken: TS },
    });
    expect(again.body.error.code).toBe('token_invalid');
    // Written in the claim's batch: exactly one row, by the new account, none for the lost replay.
    expect(await auditRows('admin.auth.invite_accept', since)).toEqual([
      expect.objectContaining({ actor_user_id: ok.body.user.id, actor_role: 'editor', target_id: ok.body.user.id }),
    ]);
    expect((await login(new Client(), 'nova@test.local', 'senha-nova-10')).status).toBe(200);
  });

  it('turns a learner with a password into staff by a role grant, never by an invite', async () => {
    const admin = await staff(['admin']);
    const l = await learner({ password: 'antiga-123' });
    const inv = await admin.client.json(adminApi.users.invite.path, { json: { email: l.email, role: 'moderator' } });
    expect(inv.status).toBe(409);
    expect(await one("SELECT 1 FROM one_time_tokens WHERE kind = 'admin_invite'")).toBeNull();
    const grant = buildPath(adminApi.users.grantRole.path, { id: l.id, role: 'moderator' });
    expect((await admin.client.json(grant, { method: 'PUT' })).body).toEqual({ roles: ['moderator'] });
    // Their own password opens the panel; their app session is untouched.
    expect((await login(new Client(), l.email, 'antiga-123')).status).toBe(200);
    expect(await one("SELECT 1 FROM sessions WHERE user_id = ? AND audience = 'app'", l.id)).not.toBeNull();
  });

  it('sets the password of an invited account that has none and ends its old sessions', async () => {
    const admin = await staff(['admin']);
    const l = await learner();
    const inv = await admin.client.json(adminApi.users.invite.path, { json: { email: l.email, role: 'moderator' } });
    expect(inv.status).toBe(200);
    const ok = await new Client().json(A.inviteAccept.path, {
      json: { token: tokenOf(inv.body.url), password: 'senha-nova-10', turnstileToken: TS },
    });
    expect(ok.body.user).toMatchObject({ id: l.id, roles: ['moderator'] });
    expect(await one("SELECT 1 FROM sessions WHERE user_id = ? AND audience = 'app'", l.id)).toBeNull();
  });

  const accept = (token: string) =>
    new Client().json(A.inviteAccept.path, { json: { token, password: 'senha-nova-10', turnstileToken: TS } });

  it('never lets an invite claim an account the creator cannot manage (stale or forged token)', async () => {
    const admin = await staff(['admin']);
    const boss = await staff(['super_admin']);
    // A token bound to the super_admin, as the old /invites handed out (the takeover PoC).
    const token = 'c'.repeat(43);
    await ins('one_time_tokens', {
      token_hash: await hashToken(token),
      user_id: boss.id,
      kind: 'admin_invite',
      email: boss.email,
      role: 'editor',
      created_by: admin.id,
      expires_at: Date.now() + 60_000,
    });
    expect((await new Client().json(buildPath(A.inviteInfo.path, { token }))).body.error.code).toBe('token_invalid');
    expect((await accept(token)).body.error.code).toBe('token_invalid');
    expect((await boss.client.send(A.me.path)).status).toBe(200);
    expect((await login(new Client(), boss.email, PASSWORD)).status).toBe(200);
    expect(
      (await one<{ roles: string }>('SELECT group_concat(role) AS roles FROM user_roles WHERE user_id = ?', boss.id))
        ?.roles,
    ).toBe('super_admin');
  });

  it('voids an invite whose target was promoted beyond the creator after it was made', async () => {
    const admin = await staff(['admin']);
    const l = await learner();
    const inv = await admin.client.json(adminApi.users.invite.path, { json: { email: l.email, role: 'editor' } });
    expect(inv.status).toBe(200);
    await ins('user_roles', { user_id: l.id, role: 'admin', granted_by: null, granted_at: Date.now() });
    expect((await accept(tokenOf(inv.body.url))).body.error.code).toBe('token_invalid');
    expect(
      (await one<{ pass_hash: string | null }>('SELECT pass_hash FROM users WHERE id = ?', l.id))?.pass_hash,
    ).toBeNull();
  });

  it('voids an invite whose email was registered with a password after it was made', async () => {
    const admin = await staff(['admin']);
    const inv = await admin.client.json(adminApi.users.invite.path, {
      json: { email: 'depois@test.local', role: 'editor' },
    });
    const l = await learner({ email: 'depois@test.local', password: 'senha-dela-1' });
    expect((await accept(tokenOf(inv.body.url))).body.error.code).toBe('token_invalid');
    expect(await one('SELECT 1 FROM user_roles WHERE user_id = ?', l.id)).toBeNull();
    expect((await login(new Client(), l.email, 'senha-dela-1')).status).toBe(401);
    expect(await one("SELECT 1 FROM sessions WHERE user_id = ? AND audience = 'app'", l.id)).not.toBeNull();
  });

  it('voids an invite whose creator was suspended', async () => {
    const admin = await staff(['admin']);
    const inv = await admin.client.json(adminApi.users.invite.path, {
      json: { email: 'k@test.local', role: 'editor' },
    });
    await exec("UPDATE users SET status = 'suspended' WHERE id = ?", admin.id);
    expect((await accept(tokenOf(inv.body.url))).body.error.code).toBe('token_invalid');
  });

  it('accepts the bootstrap super_admin invite (no creator)', async () => {
    const id = 'SUPER';
    await ins('users', {
      id,
      email: 'diego.perez@digitalsolvers.com',
      pass_hash: null,
      status: 'active',
      created_at: 1,
    });
    await ins('user_roles', { user_id: id, role: 'super_admin', granted_at: 1 });
    const token = 'b'.repeat(43);
    await ins('one_time_tokens', {
      token_hash: await hashToken(token),
      user_id: id,
      kind: 'admin_invite',
      email: 'diego.perez@digitalsolvers.com',
      role: 'super_admin',
      created_by: null,
      expires_at: Date.now() + 60_000,
    });
    const ok = await new Client().json(A.inviteAccept.path, {
      json: { token, password: 'senha-chefe-10', turnstileToken: TS },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.roles).toEqual(['super_admin']);
    expect(
      (
        await one<{ actor_role: string }>(
          "SELECT actor_role FROM audit_log WHERE action = 'admin.auth.invite_accept' AND actor_user_id = ? ORDER BY id DESC",
          id,
        )
      )?.actor_role,
    ).toBe('super_admin');
    expect(ok.body.permissions).toContain('roles.grant_admin');
  });

  it('voids an invite whose creator lost the authority to grant the role', async () => {
    const admin = await staff(['admin']);
    const inv = await admin.client.json(adminApi.users.invite.path, {
      json: { email: 'z@test.local', role: 'editor' },
    });
    await exec("DELETE FROM user_roles WHERE user_id = ? AND role = 'admin'", admin.id);
    const r = await new Client().json(A.inviteAccept.path, {
      json: { token: tokenOf(inv.body.url), password: 'senha-nova-10', turnstileToken: TS },
    });
    expect(r.body.error.code).toBe('token_invalid');
  });

  it('rejects expired and unknown tokens', async () => {
    const admin = await staff(['admin']);
    const inv = await admin.client.json(adminApi.users.invite.path, {
      json: { email: 'w@test.local', role: 'editor' },
    });
    await exec("UPDATE one_time_tokens SET expires_at = 1 WHERE kind = 'admin_invite'");
    const token = tokenOf(inv.body.url);
    expect((await new Client().json(buildPath(A.inviteInfo.path, { token }))).body.error.code).toBe('token_invalid');
    expect((await new Client().json(buildPath(A.inviteInfo.path, { token: 'q'.repeat(43) }))).status).toBe(400);
  });
});
