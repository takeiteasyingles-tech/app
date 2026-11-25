// Backups (Operação → Backup, contracts/backups.ts, migration 0010). A backup is every row of the
// chosen tables, dumped as JSON ({columns, rows[][]} per table), gzipped and stored in R2 under
// backups/{id}.json.gz; the backups table indexes them. Used by routes/backups.ts (staff), the MCP
// create_backup tool (agents) and the hourly cron (index.ts scheduled → runScheduledBackup).
//
// Restore only ever touches the course content tables (RESTORABLE_TABLES) and leaves the draft
// there: learners see nothing until a release is published. It runs in ONE D1 batch (one transaction):
//   1. PRAGMA defer_foreign_keys, so parents and children may land in any order inside the batch;
//   2. per table, parents first, an UPSERT of the backup's rows read from a bound JSON chunk
//      (INSERT … SELECT … FROM json_each(?) ON CONFLICT DO UPDATE): never DELETE + INSERT, which
//      would fire ON DELETE CASCADE into learner answers;
//   3. when removeNew, per table, children first, a DELETE of the rows the backup does not have,
//      limited to rows nothing else points at (any FK from any table), so learner progress, answers
//      and ratings are never lost; those rows are reported as kept. Media rows are never deleted.
// A content backup of the current state is taken first (kind pre_restore): restoring it undoes.
import {
  ApiError,
  BACKUP,
  BACKUP_EXCLUDED_TABLES,
  BACKUP_R2_PREFIX,
  type BackupConfig,
  BackupConfig as BackupConfigSchema,
  type BackupKind,
  type BackupRow,
  type BackupScope,
  DEFAULT_BACKUP_CONFIG,
  newId,
  type RestoreResult,
  SETTINGS,
} from '@tie/shared';
import { CONTENT_TABLES } from '@tie/shared/content/compile';
import { type AuditEntry, all, auditQuery, fromJson, one, type Query, q } from '@tie/worker-core';

/** Tables a restore puts back: the publish pipeline's tables plus the season test questions. */
export const RESTORABLE_TABLES: readonly string[] = [...CONTENT_TABLES, 'season_test_questions'];
/** Restore never deletes these (an R2 file may still exist for a row the backup lacks). */
const NEVER_DELETE = new Set(['media']);

/** Who a backup action is recorded as (staff session, agent token or the cron). */
export interface BackupActor {
  userId: string | null;
  audit(entry: AuditEntry, now: number): Promise<Query<never>>;
}

/** audit_log.actor_role of the cron's writes. */
const SYSTEM_ROLE = 'system';

/** The cron: no user, actor_role 'system'. */
export const systemActor = (db: D1Database): BackupActor => ({
  userId: null,
  audit: async (entry, now) =>
    auditQuery(db, { ...entry, at: now, actorUserId: null, actorRole: SYSTEM_ROLE, ipHash: null, ua: null }),
});

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
}

// ---------- Index rows ----------

interface BackupDb {
  id: string;
  kind: BackupKind;
  scope: BackupScope;
  status: 'ok' | 'failed';
  r2_key: string | null;
  size_bytes: number;
  tables: number;
  rows: number;
  note: string | null;
  error: string | null;
  created_by: string | null;
  created_at: number;
  restored_at: number | null;
}

const backupRow = (r: BackupDb): BackupRow => ({
  id: r.id,
  kind: r.kind,
  scope: r.scope,
  status: r.status,
  sizeBytes: r.size_bytes,
  tables: r.tables,
  rows: r.rows,
  note: r.note,
  error: r.error,
  createdBy: r.created_by,
  createdAt: r.created_at,
  restoredAt: r.restored_at,
});

export async function listBackups(db: D1Database): Promise<BackupRow[]> {
  const rows = await all<BackupDb>(db, 'SELECT * FROM backups ORDER BY created_at DESC, id DESC LIMIT 500');
  return rows.map(backupRow);
}

export async function loadBackup(db: D1Database, id: string): Promise<BackupDb | null> {
  return one<BackupDb>(db, 'SELECT * FROM backups WHERE id = ?', id);
}

// ---------- Schema introspection ----------

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ident = (name: string): string => {
  if (!NAME_RE.test(name)) throw new Error(`unsafe identifier ${name}`);
  return `"${name}"`;
};

async function tableNames(db: D1Database): Promise<string[]> {
  const rows = await all<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name`,
  );
  return rows.map((r) => r.name).filter((n) => NAME_RE.test(n) && !BACKUP_EXCLUDED_TABLES.includes(n));
}

interface ColumnInfo {
  name: string;
  /** 0 = not part of the primary key, else its 1-based position. */
  pk: number;
}

async function columnsOf(db: D1Database, table: string): Promise<ColumnInfo[]> {
  return all<ColumnInfo>(db, `PRAGMA table_info(${ident(table)})`);
}

interface ForeignKey {
  /** The referencing table. */
  from: string;
  fromCol: string;
  /** The referenced table and column. */
  to: string;
  toCol: string;
}

async function foreignKeys(db: D1Database, tables: readonly string[]): Promise<ForeignKey[]> {
  const out: ForeignKey[] = [];
  for (const t of tables) {
    const rows = await all<{ table: string; from: string; to: string | null }>(
      db,
      `PRAGMA foreign_key_list(${ident(t)})`,
    );
    for (const r of rows) {
      // `to` is null when the FK names the parent's primary key implicitly.
      out.push({ from: t, fromCol: r.from, to: r.table, toCol: r.to ?? '' });
    }
  }
  return out;
}

/** Parents before children (FKs between the given tables); a cycle keeps the input order. */
function topoOrder(tables: readonly string[], fks: readonly ForeignKey[]): string[] {
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const fk of fks) if (set.has(fk.from) && set.has(fk.to) && fk.from !== fk.to) deps.get(fk.from)?.add(fk.to);
  const out: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (done.has(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const d of deps.get(t) ?? []) visit(d);
    visiting.delete(t);
    done.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t);
  return out;
}

// ---------- Dump format ----------

interface TableDump {
  columns: string[];
  rows: unknown[][];
}

interface BackupFile {
  format: typeof BACKUP.formatName;
  version: number;
  scope: BackupScope;
  createdAt: number;
  /** Applied migration names, to tell which schema the rows follow. */
  migrations: string[];
  tables: Record<string, TableDump>;
}

async function dumpTable(db: D1Database, table: string): Promise<TableDump> {
  const columns = (await columnsOf(db, table)).map((c) => c.name);
  const rows: unknown[][] = [];
  for (let offset = 0; ; offset += BACKUP.pageRows) {
    const page = await all<Record<string, unknown>>(
      db,
      `SELECT * FROM ${ident(table)} ORDER BY rowid LIMIT ? OFFSET ?`,
      BACKUP.pageRows,
      offset,
    );
    for (const r of page) rows.push(columns.map((c) => r[c] ?? null));
    if (page.length < BACKUP.pageRows) break;
  }
  return { columns, rows };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(body: ReadableStream): Promise<string> {
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
}

// ---------- Create ----------

export interface CreateOptions {
  kind: BackupKind;
  scope: BackupScope;
  note?: string | null;
  actor: BackupActor;
  /** created_at (the cron passes its scheduled time); defaults to now. */
  at?: number;
}

/**
 * Dumps the scope's tables to R2 and records the backup (and its audit row) in one batch. A failure
 * is recorded as a 'failed' row (so the schedule shows it) and rethrown.
 */
export async function createBackup(env: Bindings, opts: CreateOptions): Promise<BackupRow> {
  const db = env.DB;
  const now = opts.at ?? Date.now();
  const id = newId(now);
  const key = `${BACKUP_R2_PREFIX}${id}.json.gz`;
  const note = opts.note?.trim() ? opts.note.trim().slice(0, BACKUP.noteMax) : null;
  try {
    const all_ = await tableNames(db);
    const restorable = new Set(RESTORABLE_TABLES);
    const tables = opts.scope === 'content' ? all_.filter((t) => restorable.has(t)) : all_;
    const file: BackupFile = {
      format: BACKUP.formatName,
      version: BACKUP.formatVersion,
      scope: opts.scope,
      createdAt: now,
      migrations: await appliedMigrations(db),
      tables: {},
    };
    let rows = 0;
    for (const t of tables) {
      const d = await dumpTable(db, t);
      file.tables[t] = d;
      rows += d.rows.length;
    }
    const bytes = await gzip(JSON.stringify(file));
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { scope: opts.scope, kind: opts.kind },
    });
    const row: BackupDb = {
      id,
      kind: opts.kind,
      scope: opts.scope,
      status: 'ok',
      r2_key: key,
      size_bytes: bytes.byteLength,
      tables: tables.length,
      rows,
      note,
      error: null,
      created_by: opts.actor.userId,
      created_at: now,
      restored_at: null,
    };
    await db.batch([
      insertRow(db, row).stmt,
      (
        await opts.actor.audit(
          {
            action: 'backup.create',
            targetType: 'backup',
            targetId: id,
            diff: { kind: row.kind, scope: row.scope, tables: row.tables, rows: row.rows, bytes: row.size_bytes, note },
          },
          now,
        )
      ).stmt,
    ]);
    return backupRow(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg: 'backup failed', id, kind: opts.kind, error: message }));
    await env.MEDIA.delete(key).catch(() => undefined);
    await db.batch([
      insertRow(db, {
        id,
        kind: opts.kind,
        scope: opts.scope,
        status: 'failed',
        r2_key: null,
        size_bytes: 0,
        tables: 0,
        rows: 0,
        note,
        error: message.slice(0, 500),
        created_by: opts.actor.userId,
        created_at: now,
        restored_at: null,
      }).stmt,
      (
        await opts.actor.audit(
          { action: 'backup.create', targetType: 'backup', targetId: id, diff: { kind: opts.kind, failed: message } },
          now,
        )
      ).stmt,
    ]);
    throw new ApiError('internal', 'Não consegui gerar o backup. Tente de novo em alguns minutos.');
  }
}

const insertRow = (db: D1Database, r: BackupDb): Query<never> =>
  q<never>(
    db,
    `INSERT INTO backups(id, kind, scope, status, r2_key, size_bytes, tables, rows, note, error, created_by, created_at, restored_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.kind,
    r.scope,
    r.status,
    r.r2_key,
    r.size_bytes,
    r.tables,
    r.rows,
    r.note,
    r.error,
    r.created_by,
    r.created_at,
    r.restored_at,
  );

async function appliedMigrations(db: D1Database): Promise<string[]> {
  try {
    return (await all<{ name: string }>(db, 'SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name);
  } catch {
    return []; // no migrations table (tests that apply the schema another way)
  }
}

// ---------- Read / delete ----------

/** The backup file as stored (gzip), or null when it is gone from R2. */
export async function backupObject(env: Bindings, row: BackupDb): Promise<R2ObjectBody | null> {
  return row.r2_key ? env.MEDIA.get(row.r2_key) : null;
}

export async function deleteBackup(env: Bindings, id: string, actor: BackupActor): Promise<void> {
  const db = env.DB;
  const row = await loadBackup(db, id);
  if (!row) throw new ApiError('not_found', 'Backup não encontrado.');
  const now = Date.now();
  await db.batch([
    q(db, 'DELETE FROM backups WHERE id = ?', id).stmt,
    (
      await actor.audit(
        {
          action: 'backup.delete',
          targetType: 'backup',
          targetId: id,
          before: { kind: row.kind, scope: row.scope, createdAt: row.created_at, rows: row.rows },
        },
        now,
      )
    ).stmt,
  ]);
  if (row.r2_key) await env.MEDIA.delete(row.r2_key);
}

// ---------- Restore ----------

async function readFile(env: Bindings, row: BackupDb): Promise<BackupFile> {
  if (row.status !== 'ok') throw new ApiError('conflict', 'Este backup falhou e não tem arquivo para restaurar.');
  const obj = await backupObject(env, row);
  if (!obj) throw new ApiError('conflict', 'O arquivo deste backup não está mais no armazenamento.');
  const file = fromJson<BackupFile | null>(await gunzip(obj.body), null);
  if (!file || file.format !== BACKUP.formatName || typeof file.tables !== 'object') {
    throw new ApiError('conflict', 'O arquivo deste backup está corrompido ou num formato desconhecido.');
  }
  return file;
}

/** dd/mm/yyyy hh:mm in São Paulo time (UTC-3, no DST since 2019), for notes shown in the panel. */
function localStamp(ms: number): string {
  const d = new Date(ms - 3 * 60 * 60 * 1000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

/** JSON array chunks of at most BACKUP.restoreChunkBytes each. */
function chunks(items: readonly unknown[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let size = 2;
  for (const it of items) {
    const s = JSON.stringify(it);
    if (cur.length && size + s.length + 1 > BACKUP.restoreChunkBytes) {
      out.push(`[${cur.join(',')}]`);
      cur = [];
      size = 2;
    }
    cur.push(s);
    size += s.length + 1;
  }
  if (cur.length) out.push(`[${cur.join(',')}]`);
  return out;
}

interface TablePlan {
  table: string;
  cols: string[];
  pkCols: string[];
  /** Rows reduced to `cols`, in that order. */
  rows: unknown[][];
  keys: unknown[][];
}

/** `j.value` element i of a JSON array row (json_each over the bound chunk). */
const at = (i: number) => `json_extract(j.value, '$[${i}]')`;

function upserts(db: D1Database, p: TablePlan): Query<unknown>[] {
  const colList = p.cols.map(ident).join(', ');
  const select = p.cols.map((_, i) => at(i)).join(', ');
  const nonPk = p.cols.filter((c) => !p.pkCols.includes(c));
  const onConflict = nonPk.length
    ? `DO UPDATE SET ${nonPk.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
    : 'DO NOTHING';
  const sql = `INSERT INTO ${ident(p.table)}(${colList}) SELECT ${select} FROM json_each(?) j WHERE true
    ON CONFLICT(${p.pkCols.map(ident).join(', ')}) ${onConflict}`;
  return chunks(p.rows).map((json) => q(db, sql, json));
}

/** Rows of `table` whose key is not in the bound JSON array of backup keys. */
const notInBackup = (p: TablePlan) =>
  `NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE ${p.pkCols
    .map((c, i) => `${at(i)} = ${ident(p.table)}.${ident(c)}`)
    .join(' AND ')})`;

/** Nothing (content or learner data, any table) points at this row. */
function unreferenced(p: TablePlan, fks: readonly ForeignKey[]): string {
  const refs = fks.filter((fk) => fk.to === p.table);
  return refs
    .map((fk) => {
      const toCol = fk.toCol || p.pkCols[0] || 'rowid';
      return `NOT EXISTS (SELECT 1 FROM ${ident(fk.from)} r WHERE r.${ident(fk.fromCol)} = ${ident(p.table)}.${ident(toCol)})`;
    })
    .join(' AND ');
}

export async function restoreBackup(
  env: Bindings,
  id: string,
  opts: { removeNew: boolean; actor: BackupActor },
): Promise<RestoreResult> {
  const db = env.DB;
  const row = await loadBackup(db, id);
  if (!row) throw new ApiError('not_found', 'Backup não encontrado.');
  const file = await readFile(env, row);

  const present = new Set(await tableNames(db));
  const tables = RESTORABLE_TABLES.filter((t) => present.has(t) && file.tables[t]);
  if (!tables.length) throw new ApiError('conflict', 'Este backup não tem tabelas de conteúdo para restaurar.');
  const fks = await foreignKeys(db, [...present]);
  const order = topoOrder(tables, fks);

  const plans: TablePlan[] = [];
  for (const t of order) {
    const dump = file.tables[t] as TableDump;
    const info = await columnsOf(db, t);
    const pkCols = info
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    const have = new Set(info.map((c) => c.name));
    const cols = dump.columns.filter((c) => have.has(c));
    if (!pkCols.length || pkCols.some((c) => !cols.includes(c))) {
      throw new ApiError('conflict', `O backup não tem a chave da tabela ${t}: o esquema mudou demais para restaurar.`);
    }
    const idx = cols.map((c) => dump.columns.indexOf(c));
    const rows = dump.rows.map((r) => idx.map((i) => r[i] ?? null));
    const keys = rows.map((r) => pkCols.map((c) => r[cols.indexOf(c)]));
    plans.push({ table: t, cols, pkCols, rows, keys });
  }

  // Undo point: the content as it is now.
  const safety = await createBackup(env, {
    kind: 'pre_restore',
    scope: 'content',
    note: `Antes de restaurar o backup de ${localStamp(row.created_at)}`,
    actor: opts.actor,
  });

  const now = Date.now();
  const stmts: Query<unknown>[] = [q(db, 'PRAGMA defer_foreign_keys = true')];
  for (const p of plans) stmts.push(...upserts(db, p));
  const deletes: { table: string; at: number }[] = [];
  if (opts.removeNew) {
    for (const p of [...plans].reverse()) {
      if (NEVER_DELETE.has(p.table)) continue;
      const guard = unreferenced(p, fks);
      deletes.push({ table: p.table, at: stmts.length });
      stmts.push(
        q(
          db,
          `DELETE FROM ${ident(p.table)} WHERE ${notInBackup(p)}${guard ? ` AND ${guard}` : ''}`,
          JSON.stringify(p.keys),
        ),
      );
    }
  }
  const upserted = plans.reduce((n, p) => n + p.rows.length, 0);
  stmts.push(
    q(db, 'UPDATE backups SET restored_at = ? WHERE id = ?', now, id),
    await opts.actor.audit(
      {
        action: 'backup.restore',
        targetType: 'backup',
        targetId: id,
        diff: { safetyBackupId: safety.id, tables: plans.length, rows: upserted, removeNew: opts.removeNew },
      },
      now,
    ),
  );
  let results: D1Result[];
  try {
    results = await db.batch(stmts.map((s) => s.stmt));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg: 'restore failed', id, error: message }));
    throw new ApiError('conflict', `A restauração falhou e nada mudou: ${message.slice(0, 200)}`);
  }
  const removed = deletes.reduce((n, d) => n + (results[d.at]?.meta.changes ?? 0), 0);

  // Rows the backup does not have that stayed (learner data or other content points at them).
  const kept: RestoreResult['kept'] = [];
  if (opts.removeNew) {
    for (const p of plans) {
      if (NEVER_DELETE.has(p.table)) continue;
      const r = await one<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM ${ident(p.table)} WHERE ${notInBackup(p)}`,
        JSON.stringify(p.keys),
      );
      if (r?.n) kept.push({ table: p.table, count: r.n });
    }
  }
  return { safetyBackupId: safety.id, tables: plans.length, upserted, removed, kept };
}

// ---------- Schedule ----------

/** São Paulo has had no daylight saving time since 2019: UTC-3 all year. */
const LOCAL_OFFSET_MS = -3 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export async function readConfig(db: D1Database): Promise<BackupConfig> {
  const row = await one<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', SETTINGS.backupConfig);
  const parsed = BackupConfigSchema.safeParse(fromJson<unknown>(row?.value ?? null, null));
  return parsed.success ? parsed.data : DEFAULT_BACKUP_CONFIG;
}

export async function saveConfig(db: D1Database, config: BackupConfig, actor: BackupActor): Promise<void> {
  const now = Date.now();
  const before = await readConfig(db);
  await db.batch([
    q(
      db,
      `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      SETTINGS.backupConfig,
      JSON.stringify(config),
      actor.userId,
      now,
    ).stmt,
    (
      await actor.audit(
        { action: 'backup.config', targetType: 'app_setting', targetId: SETTINGS.backupConfig, before, after: config },
        now,
      )
    ).stmt,
  ]);
}

/** Is `t` (ms) inside the configured slot (that local hour, and weekday when weekly)? */
function inSlot(config: BackupConfig, t: number): boolean {
  if (config.frequency === 'off') return false;
  const local = new Date(t + LOCAL_OFFSET_MS);
  if (local.getUTCHours() !== config.hour) return false;
  return config.frequency === 'daily' || local.getUTCDay() === config.weekday;
}

/** Start of the next configured slot after `now`, or null when the schedule is off. */
export function nextAutoAt(config: BackupConfig, now = Date.now()): number | null {
  if (config.frequency === 'off') return null;
  let t = Math.floor(now / HOUR) * HOUR + HOUR;
  for (let i = 0; i < 24 * 8; i++, t += HOUR) if (inSlot(config, t)) return t;
  return null;
}

/**
 * The hourly cron: when this hour is the configured slot and no automatic backup ran in it yet,
 * make one, then keep only the newest `keep` automatic backups.
 */
export async function runScheduledBackup(env: Bindings, scheduledTime: number): Promise<BackupRow | null> {
  const db = env.DB;
  const config = await readConfig(db);
  if (!inSlot(config, scheduledTime)) return null;
  const slotStart = Math.floor(scheduledTime / HOUR) * HOUR;
  const done = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM backups WHERE kind = 'auto' AND created_at >= ?`,
    slotStart,
  );
  if (done?.n) return null;
  const actor = systemActor(db);
  let made: BackupRow | null = null;
  try {
    made = await createBackup(env, { kind: 'auto', scope: config.scope, note: null, actor, at: scheduledTime });
  } finally {
    await pruneAuto(env, config.keep, actor);
  }
  return made;
}

async function pruneAuto(env: Bindings, keep: number, actor: BackupActor): Promise<void> {
  const old = await all<{ id: string }>(
    env.DB,
    `SELECT id FROM backups WHERE kind = 'auto' ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`,
    keep,
  );
  for (const r of old) await deleteBackup(env, r.id, actor);
}
