// Authorization matrix: every staff endpoint of the admin contract is routed, refuses anonymous
// callers (401) and answers 403 exactly for the roles that lack its permission. Then the
// role-specific rules on top of the permission table (grant/suspend hierarchy, persona, self).
import { adminAccountApi, adminApi, buildPath, can, type EndpointDef, listEndpoints, type Role } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, Client, learner, resetDb, seedContent, staff } from './helpers';

const SAMPLE: Record<string, string> = {
  id: 'nao-existe',
  role: 'editor',
  key: 'focus',
  listKey: 'goals',
  token: 'x'.repeat(43),
};

function pathOf(e: EndpointDef): string {
  const names = [...e.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1] as string);
  return buildPath(e.path, Object.fromEntries(names.map((n) => [n, SAMPLE[n] ?? 'x'])));
}

const STAFF = listEndpoints(adminApi).filter((e) => e.access === 'staff');
const ROLES: Role[] = ['moderator', 'editor', 'admin', 'super_admin'];

async function call(client: Client, e: EndpointDef) {
  const opts = e.method === 'GET' ? {} : { method: e.method, json: {} };
  return client.send(pathOf(e), opts);
}

describe('authz matrix', () => {
  beforeEach(resetDb);

  it('covers the whole admin contract', () => {
    expect(STAFF.length).toBeGreaterThanOrEqual(60);
  });

  it('answers 401 to every staff endpoint without a session', async () => {
    const anon = new Client();
    for (const e of [...STAFF, ...listEndpoints(adminAccountApi)]) {
      const res = await call(anon, e);
      expect(res.status, `${e.method} ${e.path}`).toBe(401);
    }
  });

  it('answers 403 exactly when the role lacks the permission', async () => {
    const accounts: Record<string, Account> = {};
    for (const r of ROLES) accounts[r] = await staff([r]);
    for (const e of STAFF) {
      for (const r of ROLES) {
        const res = await call((accounts[r] as Account).client, e);
        const allowed = !e.perm || can([r], e.perm);
        const label = `${r} ${e.method} ${e.path} → ${res.status}`;
        if (allowed) expect(res.status, label).not.toBe(403);
        else expect(res.status, label).toBe(403);
        // Never a crash or an unrouted path.
        expect(res.status, label).not.toBe(500);
        if (allowed && res.status === 404) {
          const body = (await res.json()) as { error: { code: string } };
          expect(body.error.code, label).toBe('not_found');
        }
      }
    }
  }, 120_000);

  it('refuses a learner (no staff role) holding an admin session', async () => {
    const nobody = await staff([]);
    const r = await nobody.client.send(adminApi.users.list.path);
    expect(r.status).toBe(403);
    expect((await nobody.client.send(adminApi.auth.me.path)).status).toBe(403);
  });
});

describe('role rules', () => {
  let admin: Account;
  let superAdmin: Account;
  let editor: Account;
  let moderator: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
    superAdmin = await staff(['super_admin']);
    editor = await staff(['editor']);
    moderator = await staff(['moderator']);
  });

  const rolePath = (id: string, role: string) => buildPath(adminApi.users.grantRole.path, { id, role });

  it('admin grants editor/moderator but not admin; super_admin grants admin; nobody grants super_admin', async () => {
    const u = await learner();
    expect((await admin.client.json(rolePath(u.id, 'editor'), { method: 'PUT' })).body).toEqual({ roles: ['editor'] });
    expect((await admin.client.send(rolePath(u.id, 'admin'), { method: 'PUT' })).status).toBe(403);
    expect((await superAdmin.client.json(rolePath(u.id, 'admin'), { method: 'PUT' })).body).toEqual({
      roles: ['admin', 'editor'],
    });
    expect((await superAdmin.client.send(rolePath(u.id, 'super_admin'), { method: 'PUT' })).status).toBe(403);
    // Revoking follows the same rule.
    expect((await admin.client.send(rolePath(u.id, 'admin'), { method: 'DELETE' })).status).toBe(403);
    expect((await superAdmin.client.json(rolePath(u.id, 'admin'), { method: 'DELETE' })).body).toEqual({
      roles: ['editor'],
    });
  });

  it('nobody changes their own roles or suspends themselves', async () => {
    expect((await superAdmin.client.send(rolePath(superAdmin.id, 'editor'), { method: 'PUT' })).status).toBe(403);
    const suspend = buildPath(adminApi.users.suspend.path, { id: moderator.id });
    expect((await moderator.client.send(suspend, { json: { suspended: true, reason: 'x' } })).status).toBe(403);
  });

  it('account actions on staff need authority over all their roles', async () => {
    const suspend = (id: string) => buildPath(adminApi.users.suspend.path, { id });
    const body = { json: { suspended: true, reason: 'teste' } };
    // A moderator cannot suspend an editor (only admins grant editor) …
    expect((await moderator.client.send(suspend(editor.id), body)).status).toBe(403);
    // … an admin can, but not another admin or the super_admin.
    expect((await admin.client.json(suspend(editor.id), body)).body).toEqual({ status: 'suspended' });
    const admin2 = await staff(['admin']);
    expect((await admin.client.send(suspend(admin2.id), body)).status).toBe(403);
    expect((await admin.client.send(suspend(superAdmin.id), body)).status).toBe(403);
    expect((await superAdmin.client.json(suspend(admin2.id), body)).status).toBe(200);
    // Reset links follow the same rule.
    const link = (id: string) => buildPath(adminApi.users.resetLink.path, { id });
    expect((await admin.client.send(link(superAdmin.id), { method: 'POST' })).status).toBe(403);
  });

  it('role changes and progress resets on staff need authority over all their roles', async () => {
    const admin2 = await staff(['admin', 'editor']);
    // An admin neither grants to nor revokes from another admin or the super_admin …
    expect((await admin.client.send(rolePath(admin2.id, 'editor'), { method: 'DELETE' })).status).toBe(403);
    expect((await admin.client.send(rolePath(admin2.id, 'moderator'), { method: 'PUT' })).status).toBe(403);
    expect((await admin.client.send(rolePath(superAdmin.id, 'editor'), { method: 'PUT' })).status).toBe(403);
    // … the super_admin does.
    expect((await superAdmin.client.json(rolePath(admin2.id, 'editor'), { method: 'DELETE' })).body).toEqual({
      roles: ['admin'],
    });
    const reset = (id: string) => buildPath(adminApi.users.progressReset.path, { id });
    const body = { json: { reason: 'teste de reset' } };
    expect((await admin.client.send(reset(superAdmin.id), body)).status).toBe(403);
    expect((await admin.client.send(reset(admin2.id), body)).status).toBe(403);
    expect((await admin.client.send(reset(editor.id), body)).status).toBe(200);
    // Their own learner progress is theirs to reset.
    expect((await admin.client.send(reset(admin.id), body)).status).toBe(200);
  });

  it('an invite never reaches an account the inviter cannot manage, nor one with a password', async () => {
    const inv = adminApi.users.invite.path;
    const admin2 = await staff(['admin']);
    const send = (a: Account, email: string, role = 'editor') => a.client.json(inv, { json: { email, role } });
    // The PoC: an admin inviting the super_admin's (or another admin's) email.
    expect((await send(admin, superAdmin.email)).status).toBe(403);
    expect((await send(admin, admin2.email, 'moderator')).status).toBe(403);
    // Not even the super_admin claims an account that has its own password: the role is granted instead.
    const l = await learner({ password: 'senha-dela-1' });
    const taken = await send(superAdmin, l.email, 'admin');
    expect(taken.status).toBe(409);
    expect(taken.body.error.details.userId).toBe(l.id);
    expect((await send(admin, editor.email, 'moderator')).status).toBe(409);
  });

  it('editor cannot touch users; moderator cannot edit content', async () => {
    const u = await learner();
    expect((await editor.client.send(adminApi.users.list.path)).status).toBe(403);
    expect((await editor.client.send(buildPath(adminApi.users.get.path, { id: u.id }))).status).toBe(403);
    expect((await moderator.client.send(adminApi.content.episodes.list.path)).status).toBe(403);
    expect((await moderator.client.send(adminApi.content.publish.path, { json: {} })).status).toBe(403);
    expect((await moderator.client.json(adminApi.users.list.path)).status).toBe(200);
  });

  it('persona, prompts and game rules are admin-only; an editor creates assistants without a persona', async () => {
    await seedContent();
    const persona = buildPath(adminApi.ai.persona.path, { key: 'margaret' });
    expect((await editor.client.send(persona)).status).toBe(403);
    expect((await admin.client.json(persona)).body).toEqual({
      key: 'margaret',
      persona: 'SECRET-PERSONA warm and elegant',
    });
    const listed = await editor.client.json(adminApi.content.assistants.list.path);
    expect(JSON.stringify(listed.body)).not.toContain('SECRET-PERSONA');

    const robert = {
      key: 'robert',
      name: 'Robert',
      fullName: 'Robert Woods',
      art: 'o',
      age: 50,
      aka: ['Rob'],
      role: null,
      tag: null,
      style: null,
      helloEn: 'Hi',
      helloPt: 'Oi',
      voice: { gender: 'male', pitch: 1, rate: 1 },
      ttsSpeaker: 'orion',
      posterMedia: null,
      thumbMedia: null,
      clips: { idle: 'm-clip' },
      sort: 1,
      active: true,
    };
    const path = adminApi.content.assistants.create.path;
    expect((await editor.client.send(path, { json: { ...robert, persona: 'Calm.' } })).status).toBe(403);
    const created = await editor.client.json(path, { json: robert });
    expect(created.status).toBe(201);
    expect(created.body.item.clips).toEqual({ idle: 'm-clip' });
    // Stored as '' (NOT NULL column) until an admin sets it.
    const p = await admin.client.json(buildPath(adminApi.ai.persona.path, { key: 'robert' }));
    expect(p.body.persona).toBe('');
    const withPersona = await admin.client.json(path, { json: { ...robert, key: 'zach', persona: 'Funny.' } });
    expect(withPersona.status).toBe(201);
    // Editing the persona through the content update is not possible (strict body).
    const upd = await admin.client.send(buildPath(adminApi.content.assistants.update.path, { id: 'zach' }), {
      method: 'PUT',
      json: { persona: 'x' },
    });
    expect(upd.status).toBe(400);
  });

  it('admin invites editors; only the super_admin invites admins', async () => {
    const inv = adminApi.users.invite.path;
    expect((await admin.client.send(inv, { json: { email: 'novo@test.local', role: 'admin' } })).status).toBe(403);
    expect((await admin.client.json(inv, { json: { email: 'novo@test.local', role: 'editor' } })).status).toBe(200);
    expect((await superAdmin.client.json(inv, { json: { email: 'chefe@test.local', role: 'admin' } })).status).toBe(
      200,
    );
    expect((await superAdmin.client.send(inv, { json: { email: 'x@test.local', role: 'super_admin' } })).status).toBe(
      400,
    );
    expect((await editor.client.send(inv, { json: { email: 'y@test.local', role: 'moderator' } })).status).toBe(403);
  });

  it('revoking the last staff role ends the admin sessions of the account', async () => {
    const res = await admin.client.json(rolePath(editor.id, 'editor'), { method: 'DELETE' });
    expect(res.body).toEqual({ roles: [] });
    expect((await editor.client.send(adminApi.auth.me.path)).status).toBe(401);
  });
});
