// /admin-api/content/*: CRUD for every content table (lib/entities specs), the content_blobs and the
// onboarding option lists. Editors write here; nothing reaches learners until a publish compiles the
// tables into a new snapshot. Every body is a strict schema from @tie/shared (unknown keys fail),
// then the server checks what a schema cannot: media ids exist and are the right kind, parents and
// references exist, cross-field rules, and user data that would be lost blocks a delete (409 in_use).
import {
  ApiError,
  adminApi,
  Bilingual,
  type BLOB_KEYS,
  type BlobRow,
  can,
  FocusCard,
  IdString,
  MicModeCard,
  type OptionListRow,
  PersonalizeMaps,
  PronPhrase,
  ScriptLine,
  Shelf,
  SrsGrade,
} from '@tie/shared';
import { type AppEnv, all, batch, batchRun, fromJson, one, type Query, q, toJson } from '@tie/worker-core';
import { Hono } from 'hono';
import { z } from 'zod';
import { ENTITIES, type Entity, fromRow, type Issue, type Item, mediaRefs, TEXT_ID_RE, toCol } from '../lib/entities';
import { actor, auditStmt, bodyOf, type Ctx, isConstraint, paramsOf, queryOf, route } from '../lib/http';
import { blobMediaPaths, mediaIssues } from '../lib/mediaRefs';

const routes = new Hono<AppEnv>();

function failIssues(issues: Issue[]): never {
  throw new ApiError('validation_failed', issues[0]?.message, { issues });
}

// ---------- Generic entity CRUD ----------

function parsePk(e: Entity, raw: string): string | number {
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

async function loadRows(c: Ctx, e: Entity, where: string, ...binds: (string | number)[]): Promise<Item[]> {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM ${e.table}${where ? ` WHERE ${where}` : ''} ORDER BY ${e.orderBy}`,
    ...binds,
  );
  const items = rows.map((r) => withStamps(e, fromRow(e, r), r));
  if (e.virtual) {
    const v = e.virtual;
    const ids = items.map((i) => i[e.pk.key] as string | number);
    const extra = await v.load(c.env.DB, ids);
    for (const it of items) it[v.key] = extra.get(it[e.pk.key] as string | number) ?? v.empty;
  }
  return items;
}

async function loadOne(c: Ctx, e: Entity, id: string | number): Promise<Item | null> {
  const [item] = await loadRows(c, e, `${e.pk.col} = ?`, id);
  return item ?? null;
}

/** The editable part of an item (what the strict create schema describes). */
function editable(e: Entity, item: Item): Item {
  const out: Item = {};
  for (const fd of e.fields) out[fd.key] = item[fd.key];
  if (e.virtual) out[e.virtual.key] = item[e.virtual.key];
  return out;
}

async function checkItem(c: Ctx, e: Entity, item: Item): Promise<void> {
  const db = c.env.DB;
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

function writeError(err: unknown): never {
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

function stampCols(c: Ctx, e: Entity, now: number): { cols: string[]; vals: (string | number | null)[] } {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  if (e.stamp?.updatedAt) {
    cols.push('updated_at');
    vals.push(now);
  }
  if (e.stamp?.updatedBy) {
    cols.push('updated_by');
    vals.push(actor(c).userId);
  }
  return { cols, vals };
}

function mountEntity(e: Entity): void {
  const api = e.api;
  const auditName = (op: string) => `content.${e.name}.${op}`;

  route(routes, api.list, async (c) => {
    const { parent } = queryOf(c, api.list.query) as { parent?: string };
    if (parent !== undefined && e.parent) {
      const value = e.parent.table === 'episodes' || e.parent.table === 'ebooks' ? Number(parent) : parent;
      if (typeof value === 'number' && !Number.isInteger(value)) return c.json({ items: [] });
      const parentCol = e.fields.find((fd) => fd.key === e.parent?.key)?.col ?? e.parent.key;
      return c.json({ items: await loadRows(c, e, `${parentCol} = ?`, value) });
    }
    return c.json({ items: await loadRows(c, e, '') });
  });

  route(routes, api.get, async (c) => {
    const { id } = paramsOf(c, api.get.params) as { id: string };
    const item = await loadOne(c, e, parsePk(e, id));
    if (!item) throw new ApiError('not_found');
    return c.json({ item });
  });

  route(routes, api.create, async (c) => {
    const body = (await bodyOf(c, api.create.body)) as Item;
    const db = c.env.DB;
    const now = Date.now();
    // Spec 05 note #1: a persona sent with a new assistant needs the ai.persona permission.
    const persona = typeof body.persona === 'string' ? body.persona : undefined;
    if (persona !== undefined && !can(actor(c).roles, 'ai.persona')) {
      throw new ApiError('forbidden', 'Só admins definem a persona da assistente.');
    }
    let item = editable(e, body);
    item = e.normalize ? e.normalize(item) : item;
    await checkItem(c, e, item);
    const id = item[e.pk.key] as string | number;

    const stamp = stampCols(c, e, now);
    const cols = [...e.fields.map((fd) => fd.col), ...stamp.cols];
    const vals = [...e.fields.map((fd) => toCol(fd, item[fd.key])), ...stamp.vals];
    if (e.name === 'assistants') {
      cols.push('persona');
      vals.push(persona ?? '');
    }
    const stmts: Query<unknown>[] = [
      q(db, `INSERT INTO ${e.table}(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`, ...vals),
    ];
    if (e.virtual) stmts.push(...e.virtual.writes(db, id, item[e.virtual.key]));
    stmts.push(
      await auditStmt(
        c,
        {
          action: auditName('create'),
          targetType: e.target,
          targetId: String(id),
          after: persona !== undefined ? { ...item, persona: '[set]' } : item,
        },
        now,
      ),
    );
    try {
      await batchRun(db, stmts);
    } catch (err) {
      writeError(err);
    }
    return c.json({ item: await loadOne(c, e, id) }, 201);
  });

  route(routes, api.update, async (c) => {
    const { id: rawId } = paramsOf(c, api.update.params) as { id: string };
    const id = parsePk(e, rawId);
    const patch = (await bodyOf(c, api.update.body)) as Item;
    const db = c.env.DB;
    const now = Date.now();
    const current = await loadOne(c, e, id);
    if (!current) throw new ApiError('not_found');
    if (patch[e.pk.key] !== undefined && patch[e.pk.key] !== id) {
      failIssues([{ path: e.pk.key, code: 'immutable', message: 'O identificador não muda. Crie um item novo.' }]);
    }
    const before = editable(e, current);
    let next: Item = { ...before };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
    // The merged item must still be a valid full row (strict create schema minus server-only keys).
    const full = api.create.body.safeParse(next);
    if (!full.success) {
      throw new ApiError('validation_failed', undefined, {
        issues: full.error.issues
          .slice(0, 20)
          .map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message })),
      });
    }
    next = editable(e, full.data as Item);
    next = e.normalize ? e.normalize(next) : next;
    await checkItem(c, e, next);

    const stamp = stampCols(c, e, now);
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
      await auditStmt(
        c,
        { action: auditName('update'), targetType: e.target, targetId: String(id), before, after: next },
        now,
      ),
    );
    try {
      await batchRun(db, stmts);
    } catch (err) {
      writeError(err);
    }
    return c.json({ item: await loadOne(c, e, id) });
  });

  route(routes, api.remove, async (c) => {
    const { id: rawId } = paramsOf(c, api.remove.params) as { id: string };
    const id = parsePk(e, rawId);
    const db = c.env.DB;
    const now = Date.now();
    const current = await loadOne(c, e, id);
    if (!current) throw new ApiError('not_found');
    if (e.inUse?.length) {
      const counts = await batch(
        db,
        e.inUse.map((u) => q<{ n: number }>(db, u.sql, id)),
      );
      const uses = e.inUse
        .map((u, i) => ({ label: u.label, count: counts[i]?.[0]?.n ?? 0 }))
        .filter((u) => u.count > 0);
      if (uses.length) {
        throw new ApiError(
          'in_use',
          `Ainda em uso: ${uses.map((u) => `${u.count} ${u.label}`).join(', ')}. Edite ou despublique em vez de excluir.`,
          { uses },
        );
      }
    }
    try {
      await batchRun(db, [
        q(db, `DELETE FROM ${e.table} WHERE ${e.pk.col} = ?`, id),
        await auditStmt(
          c,
          { action: auditName('delete'), targetType: e.target, targetId: String(id), before: editable(e, current) },
          now,
        ),
      ]);
    } catch (err) {
      if (isConstraint(err, 'FOREIGN KEY')) throw new ApiError('in_use', 'Outro conteúdo ainda aponta para este item.');
      throw err;
    }
    return c.json({ ok: true as const });
  });
}

// ---------- Blobs ----------

const strict = <T extends z.ZodRawShape>(o: z.ZodObject<T>) => z.strictObject(o.shape);
const NumKey = z.string().regex(/^[1-9]\d{0,8}$/);

/** content_blobs.json per key, matching what compile.ts reads into catalog.json / the snapshots. */
export const BLOB_SCHEMAS: Record<(typeof BLOB_KEYS)[number], z.ZodType> = {
  focus: z.record(z.string().min(1).max(60), strict(FocusCard)),
  personalize: z.strictObject({
    formatWord: PersonalizeMaps.shape.formatWord,
    formatTheme: PersonalizeMaps.shape.formatTheme,
  }),
  extras_shelves: z.array(strict(Shelf)),
  srs_grades: z.array(strict(SrsGrade)).length(4),
  mic_modes: z.array(strict(MicModeCard)),
  mic_openers: z
    .record(z.string().min(1).max(60), strict(Bilingual))
    .refine((v) => '_' in v, { message: 'Inclua a abertura padrão "_".' }),
  mic_follow: z.array(z.strictObject(ScriptLine.shape)),
  mic_pron: z.array(z.strictObject({ ...PronPhrase.shape, id: PronPhrase.shape.id.optional() })),
  mic_help: z.array(strict(Bilingual)),
  ebook_teasers: z.record(NumKey, z.strictObject({ title: z.string(), sub: z.string() })),
  scene_images: z.strictObject({ default: IdString.nullable(), episodes: z.record(NumKey, IdString) }),
  ui_images: z.record(z.string().regex(/^[\w./-]{1,80}$/), IdString),
  onboarding_meta: z.strictObject({ remindMax: z.int().min(1).max(24) }),
};

interface BlobDb {
  key: string;
  json: string;
  updated_at: number;
  updated_by: string | null;
}

const blobRow = (r: BlobDb): BlobRow => ({
  key: r.key,
  json: fromJson<unknown>(r.json, null),
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const B = adminApi.content.blobs;

route(routes, B.list, async (c) => {
  const rows = await all<BlobDb>(c.env.DB, 'SELECT key, json, updated_at, updated_by FROM content_blobs ORDER BY key');
  return c.json({ items: rows.map(blobRow) });
});

route(routes, B.get, async (c) => {
  const { key } = paramsOf(c, B.get.params);
  const row = await one<BlobDb>(
    c.env.DB,
    'SELECT key, json, updated_at, updated_by FROM content_blobs WHERE key = ?',
    key,
  );
  if (!row) throw new ApiError('not_found');
  return c.json({ item: blobRow(row) });
});

route(routes, B.put, async (c) => {
  const { key } = paramsOf(c, B.put.params);
  const body = await bodyOf(c, B.put.body);
  const parsed = BLOB_SCHEMAS[key].safeParse(body.json);
  if (!parsed.success) {
    throw new ApiError('validation_failed', undefined, {
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => ({ path: ['json', ...i.path.map(String)].join('.'), code: i.code, message: i.message })),
    });
  }
  const json = parsed.data;
  const media = blobMediaPaths(key, json).map((m) => ({ id: m.id, path: `json.${m.path}`, kinds: ['image'] as const }));
  const issues = await mediaIssues(c.env.DB, media);
  if (issues.length) failIssues(issues);

  const db = c.env.DB;
  const now = Date.now();
  const before = await one<BlobDb>(
    db,
    'SELECT key, json, updated_at, updated_by FROM content_blobs WHERE key = ?',
    key,
  );
  await batchRun(db, [
    q(
      db,
      `INSERT INTO content_blobs(key, json, updated_at, updated_by) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      key,
      toJson(json),
      now,
      actor(c).userId,
    ),
    await auditStmt(
      c,
      {
        action: 'content.blobs.put',
        targetType: 'content_blob',
        targetId: key,
        diff: { json: { from: before ? fromJson<unknown>(before.json, null) : null, to: json } },
      },
      now,
    ),
  ]);
  const row = await one<BlobDb>(db, 'SELECT key, json, updated_at, updated_by FROM content_blobs WHERE key = ?', key);
  return c.json({ item: blobRow(row as BlobDb) });
});

// ---------- Option lists ----------

/** Lists compile.ts reads into catalog.onboarding, with the `extra` each one carries. */
const LIST_EXTRA: Record<string, z.ZodType | null> = {
  onb_steps: z.strictObject({ h: z.string(), skip: z.boolean().optional() }),
  ages: null,
  occup: null,
  areas: null,
  levels: z.strictObject({ season: z.int().positive(), cefr: z.string().max(10) }),
  goals: null,
  deadlines: null,
  history: null,
  fails: null,
  formats: null,
  genres: null,
  themes: null,
  diffs: null,
  styles: null,
  company: null,
  feedback: null,
  days: null,
  minutes: null,
  motives: null,
};

interface OptionDb {
  list_key: string;
  scope: string;
  item_key: string;
  sort: number;
  label: string;
  sub: string | null;
  icon: string | null;
  img_media: string | null;
  extra: string | null;
}

const optionRow = (r: OptionDb): OptionListRow => ({
  listKey: r.list_key,
  scope: r.scope,
  itemKey: r.item_key,
  sort: r.sort,
  label: r.label,
  sub: r.sub,
  icon: r.icon,
  imgMedia: r.img_media,
  extra: fromJson<unknown>(r.extra, null),
});

const O = adminApi.content.optionLists;
const OPTION_SELECT = 'SELECT list_key, scope, item_key, sort, label, sub, icon, img_media, extra FROM option_lists';

route(routes, O.list, async (c) => {
  const rows = await all<OptionDb>(c.env.DB, `${OPTION_SELECT} ORDER BY list_key, scope, sort, item_key`);
  return c.json({ items: rows.map(optionRow) });
});

route(routes, O.put, async (c) => {
  const { listKey } = paramsOf(c, O.put.params);
  const body = await bodyOf(c, O.put.body);
  // Own keys only: `in` would also accept inherited names ('constructor', '__proto__').
  if (!Object.hasOwn(LIST_EXTRA, listKey)) {
    failIssues([
      { path: 'listKey', code: 'unknown', message: `Lista desconhecida. Use: ${Object.keys(LIST_EXTRA).join(', ')}.` },
    ]);
  }
  const extraSchema = LIST_EXTRA[listKey] ?? null;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  body.items.forEach((it, i) => {
    const at = (k: string) => `items.${i}.${k}`;
    const id = `${it.scope}\u0000${it.itemKey}`;
    if (seen.has(id)) issues.push({ path: at('itemKey'), code: 'duplicate', message: `"${it.itemKey}" repetido.` });
    seen.add(id);
    if (listKey === 'genres' ? !it.scope : it.scope !== '') {
      issues.push({
        path: at('scope'),
        code: 'scope',
        message: listKey === 'genres' ? 'Gêneros pedem o formato no scope.' : 'Só a lista de gêneros usa scope.',
      });
    }
    if (listKey === 'minutes' && !/^[1-9]\d{0,2}$/.test(it.itemKey)) {
      issues.push({ path: at('itemKey'), code: 'number', message: 'Minutos: a chave é o número de minutos.' });
    }
    if (extraSchema) {
      const r = extraSchema.safeParse(it.extra);
      if (!r.success)
        issues.push({ path: at('extra'), code: 'extra', message: r.error.issues[0]?.message ?? 'extra inválido' });
    } else if (it.extra !== null && it.extra !== undefined) {
      issues.push({ path: at('extra'), code: 'extra', message: 'Esta lista não usa extra.' });
    }
  });
  if (listKey === 'days' && body.items.length !== 7) {
    issues.push({ path: 'items', code: 'length', message: 'A lista de dias tem exatamente 7 itens.' });
  }
  issues.push(
    ...(await mediaIssues(
      c.env.DB,
      body.items.flatMap((it, i) =>
        it.imgMedia ? [{ id: it.imgMedia, path: `items.${i}.imgMedia`, kinds: ['image'] as const }] : [],
      ),
    )),
  );
  if (issues.length) failIssues(issues);

  const db = c.env.DB;
  const now = Date.now();
  const before = await all<OptionDb>(db, `${OPTION_SELECT} WHERE list_key = ? ORDER BY scope, sort, item_key`, listKey);
  await batchRun(db, [
    q(db, 'DELETE FROM option_lists WHERE list_key = ?', listKey),
    ...body.items.map((it) =>
      q(
        db,
        `INSERT INTO option_lists(list_key, scope, item_key, sort, label, sub, icon, img_media, extra)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        listKey,
        it.scope,
        it.itemKey,
        it.sort,
        it.label,
        it.sub,
        it.icon,
        it.imgMedia,
        it.extra == null ? null : toJson(it.extra),
      ),
    ),
    await auditStmt(
      c,
      {
        action: 'content.option_lists.put',
        targetType: 'option_list',
        targetId: listKey,
        diff: { items: { from: before.map(optionRow), to: body.items } },
      },
      now,
    ),
  ]);
  const rows = await all<OptionDb>(db, `${OPTION_SELECT} WHERE list_key = ? ORDER BY scope, sort, item_key`, listKey);
  return c.json({ items: rows.map(optionRow) });
});

// Literal paths (blobs, option-lists) are registered above, before the per-entity `/:id` routes.
for (const e of ENTITIES) mountEntity(e);

export default routes;
