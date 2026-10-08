// Users (search, detail, suspend, delete, plan, reset link, progress reset), Mic transcripts with
// audited reads, and plans CRUD.
import { adminApi, buildPath } from '@tie/shared';
import { hashToken } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, all, auditRows, exec, ins, learner, one, resetDb, staff, testEnv } from './helpers';

const U = adminApi.users;
const id$ = (path: string, id: string) => buildPath(path, { id });

describe('users', () => {
  let admin: Account;
  let moderator: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
    moderator = await staff(['moderator']);
  });

  it('searches, filters and pages', async () => {
    const a = await learner({ email: 'ana.souza@test.local', name: 'Ana' });
    await learner({ email: 'bruno@test.local', name: 'Bruno' });
    await learner({ email: 'carla@test.local', name: 'Carla_x' });
    const byName = await moderator.client.json(`${U.list.path}?q=bruno`);
    expect(byName.body.items.map((u: { email: string }) => u.email)).toEqual(['bruno@test.local']);
    // LIKE wildcards are literal.
    expect((await moderator.client.json(`${U.list.path}?q=_x`)).body.items).toHaveLength(1);
    const row = (await moderator.client.json(`${U.list.path}?q=${a.id}`)).body.items[0];
    expect(row).toMatchObject({ id: a.id, name: 'Ana', status: 'active', roles: [], planSlug: 'gratis', points: 120 });
    const staffOnly = await moderator.client.json(`${U.list.path}?role=admin`);
    expect(staffOnly.body.items.map((u: { id: string }) => u.id)).toEqual([admin.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await moderator.client.json(
        `${U.list.path}?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.body.items.map((u) => u.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await moderator.client.send(`${U.list.path}?cursor=lixo`)).status).toBe(400);
  });

  it('shows the detail with plan, quota, photo and counts', async () => {
    const l = await learner();
    await exec("UPDATE user_plans SET plan_id = 'P1', expires_at = ? WHERE user_id = ?", Date.now() + 86_400_000, l.id);
    const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    await ins('ai_usage_monthly', { user_id: l.id, period, seconds_used: 90 });
    await ins('uploads', {
      id: 'up1',
      user_id: l.id,
      kind: 'photo',
      r2_key: `users/${l.id}/photo-up1.png`,
      mime: 'image/png',
      bytes: 1,
      sha256: 'x',
      created_at: 1,
    });
    await exec("UPDATE profiles SET photo_upload = 'up1' WHERE user_id = ?", l.id);
    await ins('mic_sessions', {
      id: 'ms1',
      user_id: l.id,
      assistant_key: 'margaret',
      mode: 'livre',
      started_at: 1,
      billed_until: 1,
    });
    const r = await moderator.client.json(id$(U.get.path, l.id));
    expect(r.status).toBe(200);
    expect(r.body.plan.plan.slug).toBe('premium');
    expect(r.body.quota).toEqual({ period, limitS: 36_000, usedS: 90, leftS: 35_910 });
    expect(r.body.photo).toEqual({ uploadId: 'up1', url: `/m/users/${l.id}/photo-up1.png`, status: 'active' });
    expect(r.body.micSessions).toBe(1);
    expect(r.body.stats).toEqual({ points: 120, streak: 2, lastDay: null });
    expect((await moderator.client.send(id$(U.get.path, 'nope'))).status).toBe(404);
  });

  it('suspends (ending every session) and reactivates', async () => {
    const since = Date.now();
    const l = await learner();
    const r = await moderator.client.json(id$(U.suspend.path, l.id), { json: { suspended: true, reason: 'spam' } });
    expect(r.body).toEqual({ status: 'suspended' });
    expect(await one('SELECT 1 FROM sessions WHERE user_id = ?', l.id)).toBeNull();
    const [audit] = await auditRows('users.suspend', since);
    expect(JSON.parse(audit?.diff ?? '{}')).toEqual({ status: { from: 'active', to: 'suspended' }, reason: 'spam' });
    expect(
      (await moderator.client.json(id$(U.suspend.path, l.id), { json: { suspended: false, reason: 'ok' } })).body,
    ).toEqual({
      status: 'active',
    });
    expect((await moderator.client.send(id$(U.suspend.path, l.id), { json: { suspended: true } })).status).toBe(400);
  });

  it('deletes a learner with everything they own (admin)', async () => {
    const l = await learner();
    await ins('uploads', {
      id: 'up1',
      user_id: l.id,
      kind: 'photo',
      r2_key: `users/${l.id}/p.png`,
      mime: 'image/png',
      bytes: 1,
      sha256: 'x',
      created_at: 1,
    });
    await testEnv.MEDIA.put(`users/${l.id}/p.png`, 'x');
    expect(
      (await moderator.client.send(id$(U.remove.path, l.id), { method: 'DELETE', json: { reason: 'pedido' } })).status,
    ).toBe(403);
    const r = await admin.client.json(id$(U.remove.path, l.id), { method: 'DELETE', json: { reason: 'pedido LGPD' } });
    expect(r.body).toEqual({ ok: true });
    expect(await one('SELECT 1 FROM users WHERE id = ?', l.id)).toBeNull();
    expect(await one('SELECT 1 FROM profiles WHERE user_id = ?', l.id)).toBeNull();
    expect((await testEnv.MEDIA.list({ prefix: `users/${l.id}/` })).objects).toHaveLength(0);
  });

  it('assigns active plans only, with a future expiry', async () => {
    const l = await learner();
    const put = (json: unknown) => admin.client.json(id$(U.assignPlan.path, l.id), { method: 'PUT', json });
    expect((await put({ planId: 'P1', expiresAt: null })).body).toEqual({ planId: 'P1', expiresAt: null });
    expect(
      await one<{ plan_id: string; assigned_by: string }>(
        'SELECT plan_id, assigned_by FROM user_plans WHERE user_id = ?',
        l.id,
      ),
    ).toEqual({
      plan_id: 'P1',
      assigned_by: admin.id,
    });
    expect((await put({ planId: 'P1', expiresAt: 1 })).status).toBe(400);
    expect((await put({ planId: 'nope', expiresAt: null })).status).toBe(400);
    await exec("UPDATE plans SET active = 0 WHERE id = 'P1'");
    expect((await put({ planId: 'P1', expiresAt: null })).status).toBe(400);
  });

  it('assigns plans only on accounts the actor manages, never on their own', async () => {
    const assign = (who: Account, id: string) =>
      who.client.send(id$(U.assignPlan.path, id), { method: 'PUT', json: { planId: 'P1', expiresAt: null } });
    const boss = await staff(['super_admin']);
    const peer = await staff(['admin']);
    expect((await assign(admin, admin.id)).status).toBe(403);
    expect((await assign(admin, boss.id)).status).toBe(403);
    expect((await assign(admin, peer.id)).status).toBe(403);
    expect(await one('SELECT 1 FROM user_plans WHERE user_id IN (?, ?, ?)', admin.id, boss.id, peer.id)).toBeNull();
    expect((await assign(admin, moderator.id)).status).toBe(200);
    expect((await assign(boss, peer.id)).status).toBe(200);
  });

  it('issues a one-time reset link to the student app and voids the previous one', async () => {
    const l = await learner();
    const r1 = await admin.client.json(id$(U.resetLink.path, l.id), { method: 'POST' });
    expect(r1.body.url).toMatch(/^http:\/\/localhost\/#\/entrar\?reset=[\w-]{43}$/);
    const t1 = r1.body.url.split('reset=')[1];
    const r2 = await admin.client.json(id$(U.resetLink.path, l.id), { method: 'POST' });
    const t2 = r2.body.url.split('reset=')[1];
    expect(await one('SELECT 1 FROM one_time_tokens WHERE token_hash = ?', await hashToken(t1))).toBeNull();
    expect(await one('SELECT kind FROM one_time_tokens WHERE token_hash = ?', await hashToken(t2))).toEqual({
      kind: 'reset',
    });
    // The student origin comes from app_settings when set.
    await ins('app_settings', { key: 'app.origin', value: 'https://tie-app.example.dev', updated_at: 1 });
    const r3 = await admin.client.json(id$(U.resetLink.path, l.id), { method: 'POST' });
    expect(r3.body.url.startsWith('https://tie-app.example.dev/#/entrar?reset=')).toBe(true);
  });

  it('resets progress but keeps flagged Mic sessions (moderation evidence)', async () => {
    const l = await learner();
    await ins('mic_sessions', {
      id: 'keep',
      user_id: l.id,
      assistant_key: 'margaret',
      mode: 'livre',
      started_at: 1,
      billed_until: 1,
      flagged: 1,
    });
    await ins('mic_sessions', {
      id: 'drop',
      user_id: l.id,
      assistant_key: 'margaret',
      mode: 'livre',
      started_at: 2,
      billed_until: 2,
    });
    await ins('srs_cards', {
      id: 'c1',
      user_id: l.id,
      norm_key: 'hi',
      en: 'hi',
      pt: 'oi',
      source: 'x',
      due_at: 1,
      created_at: 1,
    });
    const r = await admin.client.json(id$(U.progressReset.path, l.id), { json: { reason: 'pedido do aluno' } });
    expect(r.body).toEqual({ ok: true });
    expect(await all('SELECT id FROM mic_sessions WHERE user_id = ?', l.id)).toEqual([{ id: 'keep' }]);
    expect(await one('SELECT 1 FROM srs_cards WHERE user_id = ?', l.id)).toBeNull();
    expect(await one<{ points: number }>('SELECT points FROM user_stats WHERE user_id = ?', l.id)).toEqual({
      points: 0,
    });
  });

  it('lists and reads Mic transcripts, auditing every read', async () => {
    const since = Date.now();
    const l = await learner();
    await ins('mic_sessions', {
      id: 'ms1',
      user_id: l.id,
      assistant_key: 'margaret',
      mode: 'missao',
      mission_key: 'gente',
      started_at: 10,
      billed_until: 10,
      flagged: 1,
      report: {
        summary_pt: 'Bom',
        strengths: ['ritmo'],
        fixes: [],
        pron: [],
        words: [],
        next_goal_pt: 'x',
        source: 'demo',
      },
    });
    await ins('mic_turns', { session_id: 'ms1', idx: 0, who: 'her', en: 'Hi!', pt: 'Oi!', created_at: 10 });
    await ins('mic_turns', {
      session_id: 'ms1',
      idx: 1,
      who: 'me',
      en: 'I have 24 years',
      feedback: {
        status: 'ajuste',
        original: 'I have 24 years',
        corrected: 'I’m 24',
        explain_pt: 'idade',
        cat: 'to be',
      },
      words: [{ en: 'age', pt: 'idade' }],
      created_at: 11,
    });
    const list = await moderator.client.json(`${U.micSessions.path}?flagged=1&userId=${l.id}`);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: 'ms1',
        userEmail: l.email,
        mode: 'missao',
        mission: 'gente',
        turns: 2,
        flagged: true,
      }),
    ]);
    const one_ = await moderator.client.json(id$(U.micSession.path, 'ms1'));
    expect(one_.body.session.report).toMatchObject({ summary_pt: 'Bom', strengths: ['ritmo'] });
    expect(one_.body.session.turnsList).toHaveLength(2);
    expect(one_.body.session.turnsList[1].feedback.corrected).toBe('I’m 24');
    expect(one_.body.session.turnsList[1].words).toEqual([{ en: 'age', pt: 'idade' }]);
    const reads = await auditRows('transcripts.read', since);
    expect(reads).toEqual([expect.objectContaining({ actor_user_id: moderator.id, target_id: 'ms1' })]);
    expect(await auditRows('transcripts.list', since)).toHaveLength(1);
    expect((await moderator.client.send(id$(U.micSession.path, 'nope'))).status).toBe(404);
  });
});

describe('plans', () => {
  let admin: Account;
  const P = adminApi.plans;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });

  it('creates plans, moves the default and refuses duplicate slugs', async () => {
    const created = await admin.client.json(P.create.path, {
      json: { slug: 'escola', name: 'Escola', aiMinutesMonth: 300, features: { hd: true }, isDefault: true },
    });
    expect(created.status).toBe(201);
    expect(created.body.plan).toMatchObject({ slug: 'escola', isDefault: true, active: true, features: { hd: true } });
    const list = await admin.client.json(P.list.path);
    expect(
      list.body.items.filter((p: { isDefault: boolean }) => p.isDefault).map((p: { slug: string }) => p.slug),
    ).toEqual(['escola']);
    expect(
      (await admin.client.send(P.create.path, { json: { slug: 'escola', name: 'X', aiMinutesMonth: 1 } })).status,
    ).toBe(409);
    const bad = await admin.client.send(P.create.path, {
      json: { slug: 'y', name: 'Y', aiMinutesMonth: 1, isDefault: true, active: false },
    });
    expect(bad.status).toBe(400);
  });

  it('updates, protects the default and deactivates only unused plans', async () => {
    const upd = await admin.client.json(id$(P.update.path, 'P1'), { method: 'PUT', json: { aiMinutesMonth: 900 } });
    expect(upd.body.plan.aiMinutesMonth).toBe(900);
    expect(
      (await admin.client.send(id$(P.update.path, 'P0'), { method: 'PUT', json: { isDefault: false } })).status,
    ).toBe(400);
    expect((await admin.client.json(id$(P.remove.path, 'P0'), { method: 'DELETE' })).body.error.code).toBe('in_use');
    const l = await learner();
    await exec("UPDATE user_plans SET plan_id = 'P1' WHERE user_id = ?", l.id);
    expect((await admin.client.json(id$(P.remove.path, 'P1'), { method: 'DELETE' })).body.error.code).toBe('in_use');
    // The update path follows the same rule (no silent fall back to the default quota) …
    const off = await admin.client.json(id$(P.update.path, 'P1'), { method: 'PUT', json: { active: false } });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('in_use');
    // … while other edits of a plan in use still go through.
    expect(
      (await admin.client.json(id$(P.update.path, 'P1'), { method: 'PUT', json: { name: 'Premium+' } })).status,
    ).toBe(200);
    await exec("UPDATE user_plans SET plan_id = 'P0' WHERE user_id = ?", l.id);
    expect((await admin.client.json(id$(P.remove.path, 'P1'), { method: 'DELETE' })).body).toEqual({ ok: true });
    expect(await one<{ active: number }>("SELECT active FROM plans WHERE id = 'P1'")).toEqual({ active: 0 });
    const users = (await admin.client.json(P.list.path)).body.items.find((p: { id: string }) => p.id === 'P0');
    // `users` counts effective plans: the learner assigned to P0 plus every account without an
    // assignment, which falls back to the default (P0), staff included.
    const total = await one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE status <> 'deleted'");
    expect(total?.n).toBeGreaterThan(1);
    expect(users.users).toBe(total?.n);
  });

  it('changes only the keys a partial update sends', async () => {
    const since = Date.now();
    const put = (id: string, json: unknown) => admin.client.json(id$(P.update.path, id), { method: 'PUT', json });
    // PlanInput's defaults (features {}, isDefault false, active true) must not leak into a patch.
    const named = await put('P1', { name: 'Premium 2' });
    expect(named.status).toBe(200);
    expect(named.body.plan).toMatchObject({ name: 'Premium 2', features: { premium_extras: true }, active: true });
    expect(await one("SELECT features FROM plans WHERE id = 'P1'")).toEqual({ features: '{"premium_extras":true}' });
    // An inactive plan stays inactive when another field changes.
    await exec("UPDATE plans SET active = 0 WHERE id = 'P1'");
    expect((await put('P1', { aiMinutesMonth: 700 })).body.plan).toMatchObject({ aiMinutesMonth: 700, active: false });
    // A minutes-only edit of the default plan keeps it the default.
    const def = await put('P0', { aiMinutesMonth: 90 });
    expect(def.status).toBe(200);
    expect(def.body.plan).toMatchObject({ aiMinutesMonth: 90, isDefault: true, active: true });
    // Sent keys still apply, including an explicit empty features map.
    await exec("UPDATE plans SET active = 1 WHERE id = 'P1'");
    expect((await put('P1', { features: {} })).body.plan.features).toEqual({});
    const diffs = (await auditRows('plans.update', since)).map((r) => JSON.parse(r.diff ?? 'null'));
    expect(diffs[0]).toEqual({ name: { from: 'Premium', to: 'Premium 2' } });
  });
});
