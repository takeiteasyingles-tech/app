// Thin typed helpers over D1. Plain SQL, positional `?` params, no ORM.

export type SqlValue = string | number | null | ArrayBuffer | Uint8Array;
/** Accepted bind values; booleans become 0/1 and undefined becomes NULL. */
export type Bind = SqlValue | boolean | undefined;

/** A prepared statement tagged with its row type so batch() can infer result tuples. */
export interface Query<Row = Record<string, unknown>> {
  readonly stmt: D1PreparedStatement;
  /** Phantom field, never set; carries the row type. */
  readonly _row?: Row;
}

function norm(v: Bind): SqlValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export function q<Row = Record<string, unknown>>(db: D1Database, sql: string, ...params: Bind[]): Query<Row> {
  const stmt = db.prepare(sql);
  return { stmt: params.length ? stmt.bind(...params.map(norm)) : stmt };
}

/** First row or null. */
export async function one<Row = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Bind[]
): Promise<Row | null> {
  return q<Row>(db, sql, ...params).stmt.first<Row>();
}

export async function all<Row = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Bind[]
): Promise<Row[]> {
  const res = await q<Row>(db, sql, ...params).stmt.all<Row>();
  return res.results;
}

export interface RunResult {
  changes: number;
  lastRowId: number | null;
}

export async function run(db: D1Database, sql: string, ...params: Bind[]): Promise<RunResult> {
  const res = await q(db, sql, ...params).stmt.run();
  return toRunResult(res.meta);
}

function toRunResult(meta: D1Meta): RunResult {
  return { changes: meta.changes ?? 0, lastRowId: meta.last_row_id ?? null };
}

export type BatchRows<Qs extends readonly Query<unknown>[]> = {
  -readonly [K in keyof Qs]: Qs[K] extends Query<infer R> ? R[] : never;
};

/**
 * Runs the statements in one round trip, atomically (D1 batches are a single transaction).
 * Returns the rows of each statement in order; use batchRun() when you need change counts.
 */
export async function batch<const Qs extends readonly Query<unknown>[]>(
  db: D1Database,
  queries: Qs,
): Promise<BatchRows<Qs>> {
  if (queries.length === 0) return [] as unknown as BatchRows<Qs>;
  const res = await db.batch(queries.map((x) => x.stmt));
  return res.map((r) => r.results) as unknown as BatchRows<Qs>;
}

export async function batchRun(db: D1Database, queries: readonly Query<unknown>[]): Promise<RunResult[]> {
  if (queries.length === 0) return [];
  const res = await db.batch(queries.map((x) => x.stmt));
  return res.map((r) => toRunResult(r.meta));
}

/** JSON column writer. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** JSON column reader that never throws (corrupt or NULL → fallback). */
export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** SQLite has no boolean; INTEGER 0/1 → boolean. */
export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';
