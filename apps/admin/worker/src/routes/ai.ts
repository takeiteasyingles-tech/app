// AI configuration and gamification rules (admin only): assistant personas (never in a snapshot,
// read live by the tutor), the ai_prompts templates (versioned, optimistic concurrency) and the
// point rules / levels / badges (compiled into catalog.json on the next publish; the game engine
// also reads point_rules live).
import {
  AI_PROMPT_KEYS,
  ApiError,
  adminApi,
  BadgeRule,
  type Gamification,
  POINT_KINDS,
  type PromptRow,
} from '@tie/shared';
import { type AppEnv, all, batch, batchRun, fromJson, one, type Query, q } from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditIf, auditStmt, bodyOf, invalid, paramsOf, route } from '../lib/http';

const routes = new Hono<AppEnv>();
const api = adminApi.ai;

// ---------- Persona ----------

route(routes, api.persona, async (c) => {
  const { key } = paramsOf(c, api.persona.params);
  const row = await one<{ key: string; persona: string }>(
    c.env.DB,
    'SELECT key, persona FROM assistants WHERE key = ?',
    key,
  );
  if (!row) throw new ApiError('not_found');
  return c.json({ key: row.key, persona: row.persona });
});

route(routes, api.setPersona, async (c) => {
  const { key } = paramsOf(c, api.setPersona.params);
  const body = await bodyOf(c, api.setPersona.body);
  const db = c.env.DB;
  const now = Date.now();
  const before = await one<{ persona: string }>(db, 'SELECT persona FROM assistants WHERE key = ?', key);
  if (!before) throw new ApiError('not_found');
  await batchRun(db, [
    q(db, 'UPDATE assistants SET persona = ? WHERE key = ?', body.persona, key),
    await auditStmt(
      c,
      {
        action: 'ai.persona',
        targetType: 'assistant',
        targetId: key,
        diff: { persona: { from: before.persona, to: body.persona } },
      },
      now,
    ),
  ]);
  return c.json({ key, persona: body.persona });
});

// ---------- Prompts ----------

/** Templates the Workers read (seeded from packages/seed/prompts/*.md). */
export const PROMPT_KEYS: readonly string[] = [...Object.values(AI_PROMPT_KEYS), 'recap_system', 'guard'];

interface PromptDb {
  key: string;
  template: string;
  version: number;
  updated_by: string | null;
  updated_at: number;
}

const promptRow = (r: PromptDb): PromptRow => ({
  key: r.key,
  template: r.template,
  version: r.version,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

route(routes, api.prompts, async (c) => {
  const rows = await all<PromptDb>(
    c.env.DB,
    'SELECT key, template, version, updated_by, updated_at FROM ai_prompts ORDER BY key',
  );
  return c.json({ items: rows.map(promptRow) });
});

route(routes, api.setPrompt, async (c) => {
  const { key } = paramsOf(c, api.setPrompt.params);
  const body = await bodyOf(c, api.setPrompt.body);
  const db = c.env.DB;
  const now = Date.now();
  const before = await one<PromptDb>(
    db,
    'SELECT key, template, version, updated_by, updated_at FROM ai_prompts WHERE key = ?',
    key,
  );
  if (!before && !PROMPT_KEYS.includes(key)) {
    throw invalid('key', `Prompt desconhecido. Use: ${PROMPT_KEYS.join(', ')}.`, 'unknown');
  }
  const expected = body.expectedVersion ?? before?.version ?? 0;
  if ((before?.version ?? 0) !== expected) {
    throw new ApiError('conflict', undefined, { currentVersion: before?.version ?? 0 });
  }
  // The version guard is repeated in SQL so two concurrent saves cannot both win; the audit row is in
  // the same batch and is written only when this save is the one that produced version expected + 1.
  const userId = actor(c).userId;
  const [res] = await batchRun(db, [
    q(
      db,
      `INSERT INTO ai_prompts(key, template, version, updated_by, updated_at) VALUES(?1, ?2, 1, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET template = excluded.template, version = ai_prompts.version + 1,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at
       WHERE ai_prompts.version = ?5`,
      key,
      body.template,
      userId,
      now,
      expected,
    ),
    await auditIf(
      c,
      {
        action: 'ai.prompt',
        targetType: 'ai_prompt',
        targetId: key,
        diff: {
          template: { from: before?.template ?? null, to: body.template },
          version: { from: before?.version ?? 0, to: expected + 1 },
        },
      },
      now,
      'EXISTS (SELECT 1 FROM ai_prompts WHERE key = ? AND version = ? AND updated_by = ? AND updated_at = ?)',
      [key, expected + 1, userId, now],
    ),
  ]);
  if (!res?.changes) throw new ApiError('conflict');
  const row = await one<PromptDb>(
    db,
    'SELECT key, template, version, updated_by, updated_at FROM ai_prompts WHERE key = ?',
    key,
  );
  return c.json({ item: promptRow(row as PromptDb) });
});

// ---------- Gamification ----------

async function readGamification(db: D1Database): Promise<Gamification> {
  const [rules, levels, badges] = await batch(db, [
    q<{ kind: string; points: number; daily_cap: number | null; verifiable: number }>(
      db,
      'SELECT kind, points, daily_cap, verifiable FROM point_rules ORDER BY kind',
    ),
    q<{ n: number; min_points: number; name: string }>(db, 'SELECT n, min_points, name FROM levels ORDER BY n'),
    q<{ id: string; title: string; sub: string; icon: string; rule: string; sort: number }>(
      db,
      'SELECT id, title, sub, icon, rule, sort FROM badges ORDER BY sort, id',
    ),
  ]);
  return {
    pointRules: rules
      .filter((r) => (POINT_KINDS as readonly string[]).includes(r.kind))
      .map((r) => ({
        kind: r.kind as Gamification['pointRules'][number]['kind'],
        points: r.points,
        dailyCap: r.daily_cap,
        verifiable: r.verifiable === 1,
      })),
    levels: levels.map((l) => ({ n: l.n, minPoints: l.min_points, name: l.name })),
    badges: badges.flatMap((b) => {
      const rule = BadgeRule.safeParse(fromJson<unknown>(b.rule, null));
      return rule.success
        ? [{ id: b.id, title: b.title, sub: b.sub, icon: b.icon, rule: rule.data, sort: b.sort }]
        : [];
    }),
  };
}

route(routes, api.gamification, async (c) => c.json(await readGamification(c.env.DB)));

route(routes, api.setGamification, async (c) => {
  const body = await bodyOf(c, api.setGamification.body);
  const db = c.env.DB;
  const now = Date.now();

  // Rules the schema cannot express: one rule per kind, levels form a ladder from 1 / 0 points,
  // badge ids are unique.
  const kinds = body.pointRules.map((r) => r.kind);
  const dupKind = kinds.find((k, i) => kinds.indexOf(k) !== i);
  if (dupKind) throw invalid('pointRules', `Regra repetida para "${dupKind}".`, 'duplicate');
  const levels = [...body.levels].sort((a, b) => a.n - b.n);
  levels.forEach((l, i) => {
    if (l.n !== i + 1) throw invalid(`levels.${i}.n`, 'Os níveis são numerados 1, 2, 3… sem buracos.', 'sequence');
    const prev = levels[i - 1];
    if (i === 0 && l.minPoints !== 0) throw invalid('levels.0.minPoints', 'O nível 1 começa em 0 pontos.', 'start');
    if (prev && l.minPoints <= prev.minPoints) {
      throw invalid(`levels.${i}.minPoints`, 'Cada nível pede mais pontos que o anterior.', 'order');
    }
  });
  const ids = body.badges.map((b) => b.id);
  const dupBadge = ids.find((k, i) => ids.indexOf(k) !== i);
  if (dupBadge) throw invalid('badges', `Medalha repetida: "${dupBadge}".`, 'duplicate');

  const before = await readGamification(db);
  const removed = before.badges.map((b) => b.id).filter((id) => !ids.includes(id));
  if (removed.length) {
    const earned = await all<{ badge_id: string; n: number }>(
      db,
      `SELECT badge_id, COUNT(*) AS n FROM user_badges WHERE badge_id IN (${removed.map(() => '?').join(', ')}) GROUP BY badge_id`,
      ...removed,
    );
    if (earned.length) {
      throw new ApiError(
        'in_use',
        `Medalhas já conquistadas não podem sair: ${earned.map((e) => `${e.badge_id} (${e.n})`).join(', ')}.`,
        { badges: earned },
      );
    }
  }

  const stmts: Query<unknown>[] = [
    q(db, 'DELETE FROM point_rules'),
    ...body.pointRules.map((r) =>
      q(
        db,
        'INSERT INTO point_rules(kind, points, daily_cap, verifiable) VALUES(?, ?, ?, ?)',
        r.kind,
        r.points,
        r.dailyCap,
        r.verifiable,
      ),
    ),
    q(db, 'DELETE FROM levels'),
    ...levels.map((l) => q(db, 'INSERT INTO levels(n, min_points, name) VALUES(?, ?, ?)', l.n, l.minPoints, l.name)),
    ...(removed.length
      ? [q(db, `DELETE FROM badges WHERE id IN (${removed.map(() => '?').join(', ')})`, ...removed)]
      : []),
    ...body.badges.map((b) =>
      q(
        db,
        `INSERT INTO badges(id, title, sub, icon, rule, sort) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, sub = excluded.sub, icon = excluded.icon,
           rule = excluded.rule, sort = excluded.sort`,
        b.id,
        b.title,
        b.sub,
        b.icon,
        JSON.stringify(b.rule),
        b.sort,
      ),
    ),
  ];
  const after: Gamification = { pointRules: body.pointRules, levels, badges: body.badges };
  stmts.push(
    await auditStmt(c, { action: 'game.rules', targetType: 'gamification', targetId: null, before, after }, now),
  );
  await batchRun(db, stmts);
  return c.json(await readGamification(db));
});

export default routes;
