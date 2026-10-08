// /admin-api/plans: plan CRUD (admin). There is no billing; a plan is an AI-minute quota plus feature
// flags. Exactly one active plan is the default (new signups get it); "delete" (and an update to
// active:false) deactivates and is refused (409 in_use) while users are assigned or for the default plan.
import { ApiError, adminApi, newId, type Ok, type Plan, type PlanPatch } from '@tie/shared';
import { type AppEnv, all, batchRun, one, type Query, q, toJson } from '@tie/worker-core';
import { Hono } from 'hono';
import { auditStmt, bodyOf, type Ctx, isConstraint, paramsOf, patchOf, route } from '../lib/http';
import { PLAN_COLS, type PlanRowDb, planFromRow } from '../lib/rows';

const routes = new Hono<AppEnv>();
const api = adminApi.plans;

async function planById(db: D1Database, id: string): Promise<Plan | null> {
  const row = await one<PlanRowDb>(db, `SELECT ${PLAN_COLS} FROM plans WHERE id = ?`, id);
  return row ? planFromRow(row) : null;
}

const slugTaken = () =>
  new ApiError('conflict', 'Já existe um plano com este slug.', {
    issues: [{ path: 'slug', code: 'taken', message: 'Slug em uso.' }],
  });

route(routes, api.list, async (c) => {
  const rows = await all<PlanRowDb & { users: number }>(
    c.env.DB,
    `SELECT ${PLAN_COLS}, (SELECT COUNT(*) FROM user_plans up WHERE up.plan_id = plans.id) AS users
     FROM plans ORDER BY is_default DESC, active DESC, ai_minutes_month, name`,
  );
  return c.json({ items: rows.map((r) => ({ ...planFromRow(r), users: r.users })) });
});

/** Statements that make `id` the only default plan. */
const makeDefault = (db: D1Database, id: string, now: number): Query<never>[] => [
  q<never>(db, 'UPDATE plans SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id <> ?', now, id),
  q<never>(db, 'UPDATE plans SET is_default = 1, updated_at = ? WHERE id = ?', now, id),
];

function checkDefaultActive(next: { isDefault: boolean; active: boolean }): void {
  if (next.isDefault && !next.active) {
    throw new ApiError('validation_failed', 'O plano padrão precisa estar ativo.', {
      issues: [{ path: 'active', code: 'default_inactive', message: 'O plano padrão precisa estar ativo.' }],
    });
  }
}

route(routes, api.create, async (c) => {
  const body = await bodyOf(c, api.create.body);
  checkDefaultActive(body);
  const db = c.env.DB;
  const now = Date.now();
  const id = newId(now);
  const stmts: Query<unknown>[] = [
    q(
      db,
      `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id,
      body.slug,
      body.name,
      body.aiMinutesMonth,
      toJson(body.features),
      body.active,
      now,
      now,
    ),
  ];
  if (body.isDefault) stmts.push(...makeDefault(db, id, now));
  stmts.push(await auditStmt(c, { action: 'plans.create', targetType: 'plan', targetId: id, after: body }, now));
  try {
    await batchRun(db, stmts);
  } catch (err) {
    if (isConstraint(err, 'UNIQUE')) throw slugTaken();
    throw err;
  }
  return c.json({ plan: await planById(db, id) }, 201);
});

/** 409 in_use while users are assigned to the plan. */
async function assertUnassigned(db: D1Database, id: string): Promise<void> {
  const users = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM user_plans WHERE plan_id = ?', id);
  if ((users?.n ?? 0) > 0) {
    throw new ApiError('in_use', `${users?.n} pessoa(s) ainda usam este plano. Mude o plano delas antes.`, {
      users: users?.n,
    });
  }
}

async function existing(c: Ctx, id: string): Promise<Plan> {
  const plan = await planById(c.env.DB, id);
  if (!plan) throw new ApiError('not_found');
  return plan;
}

route(routes, api.update, async (c) => {
  const { id } = paramsOf(c, api.update.params);
  // PlanPatch is PlanInput.partial(), whose .default()s (features {}, isDefault false, active true)
  // still fill absent keys: only the keys the request sent may change the stored plan.
  const { body: patch, sent } = await patchOf(c, api.update.body);
  const pick = <K extends keyof PlanPatch>(k: K, fallback: Plan[K]): Plan[K] =>
    sent.has(k) && patch[k] !== undefined ? (patch[k] as Plan[K]) : fallback;
  const db = c.env.DB;
  const now = Date.now();
  const before = await existing(c, id);
  const next = {
    slug: pick('slug', before.slug),
    name: pick('name', before.name),
    aiMinutesMonth: pick('aiMinutesMonth', before.aiMinutesMonth),
    features: pick('features', before.features),
    isDefault: pick('isDefault', before.isDefault),
    active: pick('active', before.active),
  };
  checkDefaultActive(next);
  if (before.isDefault && !next.isDefault) {
    // Signups always need a plan: the default moves by making another plan the default.
    throw new ApiError('validation_failed', 'Para trocar o plano padrão, marque outro plano como padrão.', {
      issues: [{ path: 'isDefault', code: 'default_required', message: 'Marque outro plano como padrão.' }],
    });
  }
  // Deactivating here follows the same rule as DELETE: never while someone is assigned to the plan
  // (they would silently fall back to the default quota).
  if (before.active && !next.active) await assertUnassigned(db, id);
  const stmts: Query<unknown>[] = [
    q(
      db,
      `UPDATE plans SET slug = ?, name = ?, ai_minutes_month = ?, features = ?, active = ?, updated_at = ? WHERE id = ?`,
      next.slug,
      next.name,
      next.aiMinutesMonth,
      toJson(next.features),
      next.active,
      now,
      id,
    ),
  ];
  if (next.isDefault && !before.isDefault) stmts.push(...makeDefault(db, id, now));
  const { createdAt: _c, updatedAt: _u, id: _i, ...beforeEditable } = before;
  stmts.push(
    await auditStmt(
      c,
      { action: 'plans.update', targetType: 'plan', targetId: id, before: beforeEditable, after: next },
      now,
    ),
  );
  try {
    await batchRun(db, stmts);
  } catch (err) {
    if (isConstraint(err, 'UNIQUE')) throw slugTaken();
    throw err;
  }
  return c.json({ plan: await planById(db, id) });
});

route(routes, api.remove, async (c) => {
  const { id } = paramsOf(c, api.remove.params);
  const db = c.env.DB;
  const now = Date.now();
  const before = await existing(c, id);
  if (before.isDefault) throw new ApiError('in_use', 'O plano padrão não pode ser desativado.');
  await assertUnassigned(db, id);
  await batchRun(db, [
    q(db, 'UPDATE plans SET active = 0, updated_at = ? WHERE id = ?', now, id),
    await auditStmt(
      c,
      {
        action: 'plans.deactivate',
        targetType: 'plan',
        targetId: id,
        diff: { active: { from: before.active, to: false } },
      },
      now,
    ),
  ]);
  return c.json({ ok: true } satisfies Ok);
});

export default routes;
