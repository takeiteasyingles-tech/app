// Rows → idempotent SQL for `wrangler d1 execute --file`. Each statement stays under D1's 100 KB
// statement limit (multi-row INSERTs are split), and every insert is an upsert or an insert-or-ignore,
// so running the seed twice changes nothing. Upserts use ON CONFLICT DO UPDATE (never REPLACE, which
// would delete the row first and cascade into user state such as mic_scores).
import type { ContentRows } from '@tie/shared/content/compile';
import type { SeedConfig } from './transform/config';

export const MAX_STATEMENT_BYTES = 100_000;
/** Headroom under the limit for the statement's prefix/suffix. */
const TARGET_BYTES = 90_000;

export type SqlValue = string | number | boolean | null | undefined;
export type Row = Record<string, SqlValue>;

export function sqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`sql: non-finite number ${v}`);
    return String(v);
  }
  if (v.includes('\0')) throw new Error('sql: NUL byte in string');
  return `'${v.replace(/'/g, "''")}'`;
}

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`sql: bad identifier ${name}`);
  return name;
};

export type ConflictMode = 'upsert' | 'ignore';

export interface TableSpec {
  table: string;
  /** Primary-key columns (the ON CONFLICT target). */
  key: readonly string[];
  mode: ConflictMode;
}

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** INSERT statements for one table, each ≤ MAX_STATEMENT_BYTES. */
export function insertStatements(spec: TableSpec, rows: readonly Row[]): string[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0] as Row);
  for (const r of rows) {
    const k = Object.keys(r);
    if (k.length !== cols.length || k.some((c, i) => c !== cols[i])) {
      throw new Error(`sql: ${spec.table} rows have different columns (${k.join(',')} vs ${cols.join(',')})`);
    }
  }
  const head = `INSERT INTO ${ident(spec.table)}(${cols.map(ident).join(', ')}) VALUES\n`;
  const updates = cols.filter((c) => !spec.key.includes(c));
  const tail =
    spec.mode === 'ignore' || updates.length === 0
      ? `\nON CONFLICT(${spec.key.map(ident).join(', ')}) DO NOTHING;`
      : `\nON CONFLICT(${spec.key.map(ident).join(', ')}) DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(', ')};`;

  const out: string[] = [];
  let batch: string[] = [];
  let size = bytes(head) + bytes(tail);
  const flush = () => {
    if (batch.length) out.push(head + batch.join(',\n') + tail);
    batch = [];
    size = bytes(head) + bytes(tail);
  };
  for (const r of rows) {
    const tuple = `(${cols.map((c) => sqlLiteral(r[c])).join(', ')})`;
    const n = bytes(tuple) + 2;
    if (bytes(head) + bytes(tail) + n > MAX_STATEMENT_BYTES) {
      throw new Error(`sql: one ${spec.table} row is ${n} bytes, over the ${MAX_STATEMENT_BYTES}-byte statement limit`);
    }
    if (size + n > TARGET_BYTES) flush();
    batch.push(tuple);
    size += n;
  }
  flush();
  return out;
}

/** Content tables in foreign-key order. Content is upserted (the seed is its source until an admin edits it). */
export const CONTENT_SPECS: readonly TableSpec[] = [
  { table: 'media', key: ['id'], mode: 'upsert' },
  { table: 'steps', key: ['n'], mode: 'upsert' },
  { table: 'seasons', key: ['n'], mode: 'upsert' },
  { table: 'cast_members', key: ['name'], mode: 'upsert' },
  { table: 'episodes', key: ['num'], mode: 'upsert' },
  { table: 'mic_phrases', key: ['id'], mode: 'upsert' },
  { table: 'exercises', key: ['id'], mode: 'upsert' },
  { table: 'exercise_items', key: ['id'], mode: 'upsert' },
  { table: 'ebooks', key: ['num'], mode: 'upsert' },
  { table: 'ebook_test_questions', key: ['id'], mode: 'upsert' },
  { table: 'extras', key: ['id'], mode: 'upsert' },
  { table: 'albums', key: ['id'], mode: 'upsert' },
  { table: 'album_tracks', key: ['id'], mode: 'upsert' },
  { table: 'assistants', key: ['key'], mode: 'upsert' },
  { table: 'assistant_clips', key: ['assistant_key', 'state'], mode: 'upsert' },
  { table: 'mic_missions', key: ['key'], mode: 'upsert' },
  { table: 'content_blobs', key: ['key'], mode: 'upsert' },
  { table: 'option_lists', key: ['list_key', 'scope', 'item_key'], mode: 'upsert' },
];

/** Configuration an admin owns after the first seed: created once, never overwritten. */
export const CONFIG_SPECS: readonly TableSpec[] = [
  { table: 'point_rules', key: ['kind'], mode: 'ignore' },
  { table: 'levels', key: ['n'], mode: 'ignore' },
  { table: 'badges', key: ['id'], mode: 'ignore' },
  { table: 'plans', key: ['id'], mode: 'ignore' },
  { table: 'feature_flags', key: ['key'], mode: 'ignore' },
  { table: 'app_settings', key: ['key'], mode: 'ignore' },
  { table: 'ai_prompts', key: ['key'], mode: 'ignore' },
];

export interface SeedStatementOptions {
  /**
   * 'upsert' (default, local seeds and `--remote --force`): the prototype overwrites the content rows.
   * 'ignore' (`--remote` without --force): only missing rows are inserted, so content an admin
   * edited in production is never overwritten (spec 06 "Seeding").
   */
  contentMode?: ConflictMode;
}

/** Every statement of the content + configuration seed, in dependency order. */
export function seedStatements(content: ContentRows, config: SeedConfig, opts: SeedStatementOptions = {}): string[] {
  const rowsOf = (table: string): Row[] => {
    const src = { ...content, ...config } as unknown as Record<string, Row[] | undefined>;
    const rows = src[table];
    if (!rows) throw new Error(`sql: no rows for ${table}`);
    return rows;
  };
  const out: string[] = [];
  const contentMode = opts.contentMode ?? 'upsert';
  for (const spec of CONTENT_SPECS) out.push(...insertStatements({ ...spec, mode: contentMode }, rowsOf(spec.table)));
  for (const spec of CONFIG_SPECS) out.push(...insertStatements(spec, rowsOf(spec.table)));
  return out;
}

/** One file, one statement per paragraph (wrangler splits on statement boundaries, quotes aware). */
export function toSqlFile(statements: readonly string[], header = ''): string {
  return `${header ? `-- ${header}\n` : ''}${statements.join('\n\n')}\n`;
}
