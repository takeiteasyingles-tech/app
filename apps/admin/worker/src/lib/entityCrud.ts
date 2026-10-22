// The entity CRUD core behind /admin-api/content/* (routes/content.ts) and the MCP tools
// (lib/mcpTools.ts): loading rows in API shape, the server-side checks (ids, cross-field rules,
// parents, references, media), the merge-and-revalidate update and the D1 error mapping. Both callers
// share it so an agent's edit passes exactly the checks of a staff edit and writes the same audit
// action. Who writes (the stamp's updated_by and the audit actor) comes from a Writer.
import { ApiError } from '@tie/shared';
import { type AuditEntry, all, batch, batchRun, type Query, q } from '@tie/worker-core';
import { ENTITIES, type Entity, fromRow, type Issue, type Item, mediaRefs, TEXT_ID_RE, toCol } from './entities';
import { actor, auditStmt, type Ctx, isConstraint } from './http';
import { mediaIssues } from './mediaRefs';

/** Who a content write is recorded as: the stamp's updated_by and the audit row of the batch. */
export interface Writer {
  userId: string;
  audit(entry: AuditEntry, now: number): Promise<Query<never>>;
}

/** The signed-in staff member (admin UI routes). */
export const staffWriter = (c: Ctx): Writer => ({
  userId: actor(c).userId,
  audit: (entry, now) => auditStmt(c, entry, now),
});

/** The entity spec registered under `name` ('episodes', 'seasons'…). */
export function entityNamed(name: string): Entity {
  const e = ENTITIES.find((x) => x.name === name);
  if (!e) throw new Error(`unknown entity ${name}`);
  return e;
}

export function failIssues(issues: Issue[]): never {
  throw new ApiError('validation_failed', issues[0]?.message, { issues });
}

export function parsePk(e: Entity, raw: string): string | number {
  if (e.numericPk) {
    if (!/^[1-9]\d{0,8}$/.test(raw)) throw new ApiError('not_found');
    return Number(raw);
  }
  if (!TEXT_ID_RE.test(raw)) throw new ApiError('not_found');
  return raw;
}

function withStamps(e: Entity, item: Item, row: Record<string, unknown>): Item {
  const out = { ...item };
  if (e.stamp?.updatedAt) out.updatedAt = row.updated_at;
  if (e.stamp?.updatedBy) out.updatedBy = row.updated_by ?? null;
  return out;
}

export async function loadRows(
  db: D1Database,
  e: Entity,
  where: string,
  ...binds: (string | number)[]
): Promise<Item[]> {
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT * FROM ${e.table}${where ? ` WHERE ${where}` : ''} ORDER BY ${e.orderBy}`,
    ...binds,
  );
  const items = rows.map((r) => withStamps(e, fromRow(e, r), r));
  if (e.virtual) {
    const v = e.virtual;
    const ids = items.map((i) => i[e.pk.key] as string | number);
    const extra = await v.load(db, ids);
    for (const it of items) it[v.key] = extra.get(it[e.pk.key] as string | number) ?? v.empty;
  }
  return items;
}

export async function loadOne(db: D1Database, e: Entity, id: string | number): Promise<Item | null> {
  const [item] = await loadRows(db, e, `${e.pk.col} = ?`, id);
  return item ?? null;
}

/** The editable part of an item (what the strict create schema describes). */
export function editable(e: Entity, item: Item): Item {
  const out: Item = {};
  for (const fd of e.fields) out[fd.key] = item[fd.key];
  if (e.virtual) out[e.virtual.key] = item[e.virtual.key];
  return out;
}

/** Server-side checks a schema cannot express: id shape, cross-field rules, parent, refs, media. */
export async function checkItem(db: D1Database, e: Entity, item: Item): Promise<void> {
  const issues: Issue[] = [];
  const pk = item[e.pk.key];
  if (!e.numericPk && (typeof pk !== 'string' || !TEXT_ID_RE.test(pk))) {
    issues.push({ path: e.pk.key, code: 'invalid_id', message: 'Use só letras, números, - e _ (até 80).' });
  }
  if (e.numericPk && (typeof pk !== 'number' || pk < 1 || pk > 999_999_999)) {
    issues.push({ path: e.pk.key, code: 'invalid_id', message: 'Número inválido.' });
  }
  issues.push(...(e.check?.(item) ?? []));
  const lookups: { path: string; label: string; query: Query<{ n: number }> }[] = [];
  if (e.parent) {
    const v = item[e.parent.key];
    lookups.push({
      path: e.parent.key,
      label: e.parent.table,
      query: q(db, `SELECT COUNT(*) AS n FROM ${e.parent.table} WHERE ${e.parent.col} = ?`, v as string | number),
    });
  }
  for (const r of e.refs ?? []) {
    const v = item[r.key];
    if (v == null) continue;
    lookups.push({
      path: r.key,
      label: r.label,
      query: q(db, `SELECT COUNT(*) AS n FROM ${r.table} WHERE ${r.col} = ?`, v as string | number),
    });
  }
  if (lookups.length) {
    const res = await batch(
      db,
      lookups.map((l) => l.query),
    );
    lookups.forEach((l, i) => {
      if (!res[i]?.[0]?.n)
        issues.push({
          path: l.path,
          code: 'unknown_ref',
          message: `Não encontrei ${l.label} "${String(item[l.path])}".`,
        });
    });
  }
  issues.push(...(await mediaIssues(db, mediaRefs(e, item))));
  if (issues.length) failIssues(issues);
}

export function writeError(err: unknown): never {
  if (isConstraint(err, 'UNIQUE')) throw new ApiError('conflict', 'Já existe um item com este identificador.');
  if (isConstraint(err, 'FOREIGN KEY')) {
    throw new ApiError('validation_failed', 'Uma referência deste item não existe.', {
      issues: [{ path: '', code: 'foreign_key', message: 'Referência inexistente.' }],
    });
  }
  if (isConstraint(err, 'CHECK') || isConstraint(err, 'NOT NULL')) {
    throw new ApiError('validation_failed', undefined, {
      issues: [{ path: '', code: 'constraint', message: 'Valor fora das regras da tabela.' }],
    });
  }
  throw err;
}

export function stampCols(
  e: Entity,
  userId: string,
  now: number,
): { cols: string[]; vals: (string | number | null)[] } {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  if (e.stamp?.updatedAt) {
    cols.push('updated_at');
    vals.push(now);
  }
  if (e.stamp?.updatedBy) {
    cols.push('updated_by');
    vals.push(userId);
  }
  return { cols, vals };
}

export interface UpdateOptions {
  /** Optimistic concurrency (MCP update_* tools): the row's updatedAt the caller read. */
  expectedUpdatedAt?: number;
}

/**
 * PUT semantics of every entity: `patch` (already parsed by the entity's update schema) is merged
 * over the stored row, the merge must still pass the strict create schema and checkItem(), then one
 * batch writes the row, its virtual state and the audit entry `content.<name>.update`.
 */
export async function updateEntity(
  db: D1Database,
  e: Entity,
  id: string | number,
  patch: Item,
  writer: Writer,
  opts: UpdateOptions = {},
): Promise<Item> {
  const now = Date.now();
  const current = await loadOne(db, e, id);
  if (!current) throw new ApiError('not_found');
  if (opts.expectedUpdatedAt !== undefined && e.stamp?.updatedAt && current.updatedAt !== opts.expectedUpdatedAt) {
    throw new ApiError('conflict', 'Este item mudou depois da sua leitura. Leia de novo e refaça a edição.', {
      updatedAt: current.updatedAt,
    });
  }
  if (patch[e.pk.key] !== undefined && patch[e.pk.key] !== id) {
    failIssues([{ path: e.pk.key, code: 'immutable', message: 'O identificador não muda. Crie um item novo.' }]);
  }
  const before = editable(e, current);
  let next: Item = { ...before };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  // The merged item must still be a valid full row (strict create schema minus server-only keys).
  const full = e.api.create.body.safeParse(next);
  if (!full.success) {
    throw new ApiError('validation_failed', undefined, {
      issues: full.error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message })),
    });
  }
  next = editable(e, full.data as Item);
  next = e.normalize ? e.normalize(next) : next;
  await checkItem(db, e, next);

  const stamp = stampCols(e, writer.userId, now);
  const sets = [
    ...e.fields.filter((fd) => fd !== e.pk).map((fd) => `${fd.col} = ?`),
    ...stamp.cols.map((col) => `${col} = ?`),
  ];
  const vals = [...e.fields.filter((fd) => fd !== e.pk).map((fd) => toCol(fd, next[fd.key])), ...stamp.vals];
  const stmts: Query<unknown>[] = [
    q(db, `UPDATE ${e.table} SET ${sets.join(', ')} WHERE ${e.pk.col} = ?`, ...vals, id),
  ];
  if (e.virtual && patch[e.virtual.key] !== undefined) stmts.push(...e.virtual.writes(db, id, next[e.virtual.key]));
  stmts.push(
    await writer.audit(
      { action: `content.${e.name}.update`, targetType: e.target, targetId: String(id), before, after: next },
      now,
    ),
  );
  try {
    await batchRun(db, stmts);
  } catch (err) {
    writeError(err);
  }
  return (await loadOne(db, e, id)) as Item;
}
