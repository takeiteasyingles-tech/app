// Audit log, flags, settings, stats, prompts and gamification rules.
import { adminApi, buildPath } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { startOfLocalMonth } from '../src/routes/ops';
import { type Account, all, exec, ins, learner, one, resetDb, seedContent, staff } from './helpers';

const O = adminApi.ops;
const AI = adminApi.ai;

describe('audit log', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });

  it('is append-only and filters by action prefix, target and actor, newest first', async () => {
    const since = Date.now();
    for (const slug of ['a1', 'a2', 'a3']) {
      await admin.client.json(adminApi.plans.create.path, { json: { slug, name: slug, aiMinutesMonth: 1 } });
    }
    const page1 = await admin.client.json(`${O.audit.path}?action=plans.&actor=${admin.id}&from=${since}&limit=2`);
    expect(page1.body.items.map((e: { action: string }) => e.action)).toEqual(['plans.create', 'plans.create']);
    expect(page1.body.items[0].diff.slug).toEqual({ from: null, to: 'a3' });
    expect(page1.body.items[0].ipHash).toMatch(/^[0-9a-f]{32}$/);
    const page2 = await admin.client.json(
      `${O.audit.path}?action=plans.&actor=${admin.id}&from=${since}&limit=2&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    const target = page2.body.items[0].targetId;
    const byTarget = await admin.client.json(`${O.audit.path}?targetType=plan&targetId=${target}`);
    expect(byTarget.body.items).toHaveLength(1);
    await expect(exec('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});

describe('flags and settings', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });

  it('sets flags with validated rules', async () => {
    const path = buildPath(O.setFlag.path, { key: 'ai.enabled' });
    const r = await admin.client.json(path, {
      method: 'PUT',
      json: { enabled: true, rolloutPct: 25, rules: { plans: ['premium'] } },
    });
    expect(r.body.item).toMatchObject({
      key: 'ai.enabled',
      enabled: true,
      rolloutPct: 25,
      rules: { plans: ['premium'] },
      updatedBy: admin.id,
    });
    expect(
      (await admin.client.send(path, { method: 'PUT', json: { enabled: true, rules: { emails: ['x'] } } })).status,
    ).toBe(400);
    expect(
      (
        await admin.client.send(buildPath(O.setFlag.path, { key: 'Bad Key' }), {
          method: 'PUT',
          json: { enabled: true },
        })
      ).status,
    ).toBe(400);
    expect((await admin.client.json(O.flags.path)).body.items).toHaveLength(1);
  });

  it('keeps the stored rollout and rules when a flag update omits them', async () => {
    const path = buildPath(O.setFlag.path, { key: 'mic.beta' });
    const put = (json: unknown) => admin.client.json(path, { method: 'PUT', json });
    // A new flag takes the defaults (100%, no rules).
    expect((await put({ enabled: true })).body.item).toMatchObject({ enabled: true, rolloutPct: 100, rules: null });
    await put({ enabled: true, rolloutPct: 30, rules: { roles: ['editor'] } });
    // Turning it off touches only `enabled`.
    expect((await put({ enabled: false })).body.item).toMatchObject({
      enabled: false,
      rolloutPct: 30,
      rules: { roles: ['editor'] },
    });
    // Explicit values (including rules: null) still replace the stored ones.
    expect((await put({ enabled: true, rules: null })).body.item).toMatchObject({
      enabled: true,
      rolloutPct: 30,
      rules: null,
    });
  });

  it('sets only known settings, each with its rule; content.current is off limits', async () => {
    const put = (key: string, value: string) =>
      admin.client.json(buildPath(O.setSetting.path, { key }), { method: 'PUT', json: { value } });
    expect((await put('retention.transcripts_days', '90')).body.item).toMatchObject({
      key: 'retention.transcripts_days',
      value: '90',
    });
    expect((await put('retention.transcripts_days', '0')).status).toBe(400);
    expect((await put('ai.model.tutor', '@cf/meta/llama-3.3-70b-instruct-fp8-fast')).status).toBe(200);
    expect((await put('ai.model.tutor', 'gpt-4')).status).toBe(400);
    expect((await put('app.origin', 'https://tie-app.example.dev')).status).toBe(200);
    expect((await put('app.origin', 'https://tie-app.example.dev/x')).status).toBe(400);
    expect((await put('content.current', 'abc')).body.error.details.issues[0].code).toBe('managed');
    expect((await put('whatever', 'x')).status).toBe(400);
    expect((await admin.client.json(O.settings.path)).body.items.map((s: { key: string }) => s.key)).toEqual([
      'ai.model.tutor',
      'app.origin',
      'retention.transcripts_days',
    ]);
  });
});

describe('stats', () => {
  it('counts learners, activity, AI use and the moderation backlog', async () => {
    await resetDb();
    const admin = await staff(['admin']);
    const a = await learner();
    const b = await learner();
    await exec("UPDATE users SET status = 'suspended' WHERE id = ?", b.id);
    await exec('UPDATE users SET last_login_at = NULL, created_at = 1 WHERE id = ?', b.id);
    await exec('DELETE FROM sessions WHERE user_id = ?', b.id);
    const now = Date.now();
    // AI time comes from the events of the São Paulo month (a refunded call has 0 s), not from
    // ai_usage_monthly, whose periods follow each learner's own timezone.
    const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    await ins('ai_usage_monthly', { user_id: a.id, period, seconds_used: 9999 });
    for (const [seconds, ok] of [
      [60, 1],
      [40, 1],
      [25, 1],
      [0, 0],
    ]) {
      await ins('ai_usage_events', { user_id: a.id, kind: 'tutor', seconds, ok, created_at: now - 1000 });
    }
    await ins('ai_usage_events', { user_id: a.id, kind: 'tutor', seconds: 500, ok: 1, created_at: 1 });
    await ins('moderation_items', { id: 'm1', kind: 'report', created_at: 1 });
    const r = await admin.client.json(O.stats.path);
    expect(r.status).toBe(200);
    expect(r.body.users).toEqual({ total: 2, activeToday: 1, active7d: 1, active30d: 1, new7d: 1, suspended: 1 });
    expect(r.body.ai).toEqual({
      secondsThisMonth: 125,
      minutesThisMonth: 3,
      calls24h: 4,
      errors24h: 1,
      failureRate24h: 0.25,
    });
    expect(r.body.moderation).toEqual({ pending: 1, flaggedSessions: 0 });
    expect(r.body.content).toEqual({ current: null, publishedAt: null });
  });

  it('starts the month at local midnight on the 1st', () => {
    const tz = 'America/Sao_Paulo';
    expect(startOfLocalMonth(Date.UTC(2026, 2, 15, 12), tz)).toBe(Date.UTC(2026, 2, 1, 3));
    // 1 April 01:00 UTC is still 31 March in São Paulo.
    expect(startOfLocalMonth(Date.UTC(2026, 3, 1, 1), tz)).toBe(Date.UTC(2026, 2, 1, 3));
    expect(startOfLocalMonth(Date.UTC(2026, 3, 1, 3), tz)).toBe(Date.UTC(2026, 3, 1, 3));
  });
});

describe('AI configuration', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    admin = await staff(['admin']);
  });

  it('sets a persona and audits the change', async () => {
    const path = buildPath(AI.setPersona.path, { key: 'margaret' });
    const r = await admin.client.json(path, { method: 'PUT', json: { persona: 'Warm, curious, patient.' } });
    expect(r.body).toEqual({ key: 'margaret', persona: 'Warm, curious, patient.' });
    expect(
      (
        await admin.client.send(buildPath(AI.setPersona.path, { key: 'nope' }), {
          method: 'PUT',
          json: { persona: 'x' },
        })
      ).status,
    ).toBe(404);
  });

  it('versions prompts and refuses stale writes', async () => {
    const path = buildPath(AI.setPrompt.path, { key: 'tutor_system' });
    const v1 = await admin.client.json(path, { method: 'PUT', json: { template: 'You are {{assistant_name}}.' } });
    expect(v1.body.item).toMatchObject({ key: 'tutor_system', version: 1, updatedBy: admin.id });
    const v2 = await admin.client.json(path, { method: 'PUT', json: { template: 'v2', expectedVersion: 1 } });
    expect(v2.body.item.version).toBe(2);
    const stale = await admin.client.json(path, { method: 'PUT', json: { template: 'v3', expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({ currentVersion: 2 });
    // One audit row per saved version (written in the save's own batch), none for the stale write.
    const audits = await all<{ diff: string }>(
      "SELECT diff FROM audit_log WHERE action = 'ai.prompt' AND target_id = 'tutor_system' AND actor_user_id = ? ORDER BY id",
      admin.id,
    );
    expect(audits.map((a) => JSON.parse(a.diff).version)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
    expect(
      (
        await admin.client.send(buildPath(AI.setPrompt.path, { key: 'made_up' }), {
          method: 'PUT',
          json: { template: 'x' },
        })
      ).status,
    ).toBe(400);
    expect((await admin.client.json(AI.prompts.path)).body.items).toHaveLength(1);
  });

  it('replaces gamification rules with ladder and badge checks', async () => {
    const current = (await admin.client.json(AI.gamification.path)).body;
    expect(current.levels).toEqual([{ n: 1, minPoints: 0, name: 'Iniciante' }]);
    const next = {
      pointRules: [
        { kind: 'step', points: 15, dailyCap: null, verifiable: true },
        { kind: 'word', points: 3, dailyCap: 20, verifiable: false },
      ],
      levels: [
        { n: 2, minPoints: 100, name: 'Curioso' },
        { n: 1, minPoints: 0, name: 'Iniciante' },
      ],
      badges: [
        {
          id: 'streak-3',
          title: 'Três dias',
          sub: 'Sequência de 3',
          icon: 'fire',
          rule: { type: 'streak', min: 3 },
          sort: 1,
        },
      ],
    };
    const put = (json: unknown) => admin.client.json(AI.setGamification.path, { method: 'PUT', json });
    const ok = await put(next);
    expect(ok.status).toBe(200);
    expect(ok.body.levels.map((l: { n: number }) => l.n)).toEqual([1, 2]);
    expect(ok.body.badges.map((b: { id: string }) => b.id)).toEqual(['streak-3']);
    expect(await one("SELECT points FROM point_rules WHERE kind = 'step'")).toEqual({ points: 15 });

    expect((await put({ ...next, levels: [{ n: 1, minPoints: 10, name: 'x' }] })).status).toBe(400);
    expect(
      (
        await put({
          ...next,
          levels: [
            { n: 1, minPoints: 0, name: 'x' },
            { n: 3, minPoints: 5, name: 'y' },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await put({ ...next, pointRules: [next.pointRules[0], next.pointRules[0]] })).status).toBe(400);
    expect((await put({ ...next, badges: [{ ...next.badges[0], rule: { type: 'magic' } }] })).status).toBe(400);

    // A badge someone earned cannot be dropped.
    const l = await learner();
    await ins('user_badges', { user_id: l.id, badge_id: 'streak-3', earned_at: 1 });
    const dropped = await put({ ...next, badges: [] });
    expect(dropped.status).toBe(409);
    expect(dropped.body.error.code).toBe('in_use');
  });
});
