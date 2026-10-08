// D1Database stand-in over Node's built-in SQLite (node:sqlite), loaded with the real migrations
// from packages/db. Enough of the D1 surface for the learning code: prepare/bind/first/all/run and
// an atomic batch. Foreign keys are enforced, as on D1.

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

// Specifiers go through variables so the Workers tsconfig (no Node types) never resolves them.
const SQLITE = 'node:sqlite';
const FS = 'node:fs';
const { DatabaseSync } = (await import(/* @vite-ignore */ SQLITE)) as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ FS)) as {
  readFileSync(path: URL, enc: 'utf8'): string;
  readdirSync(path: URL): string[];
};

// Workers' ImportMeta type has no `url`; under Vitest (Node) it is the file URL.
const MIGRATIONS = new URL(
  '../../../../../../../packages/db/migrations/',
  (import.meta as unknown as { url: string }).url,
);

const returnsRows = (sql: string) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

function meta(changes: number, lastRowId: number) {
  return { changes, last_row_id: lastRowId, duration: 0, size_after: 0, rows_read: 0, rows_written: changes };
}

class Stmt {
  constructor(
    private readonly db: SqliteDatabase,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }

  exec(): { results: Record<string, unknown>[]; meta: ReturnType<typeof meta> } {
    const stmt = this.db.prepare(this.sql);
    if (returnsRows(this.sql)) {
      const results = stmt.all(...this.params).map((r) => ({ ...r }));
      return { results, meta: meta(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql) ? 0 : results.length, 0) };
    }
    const r = stmt.run(...this.params);
    return { results: [], meta: meta(Number(r.changes), Number(r.lastInsertRowid)) };
  }

  async first<T>(): Promise<T | null> {
    return (this.exec().results[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const r = this.exec();
    return { success: true, results: r.results as T[], meta: r.meta };
  }

  async run() {
    const r = this.exec();
    return { success: true, results: [], meta: r.meta };
  }
}

export class SqliteD1 {
  readonly raw: SqliteDatabase;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    for (const file of readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      this.raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    }
  }

  prepare(sql: string): Stmt {
    return new Stmt(this.raw, sql);
  }

  async batch(stmts: Stmt[]) {
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => ({ success: true, ...s.exec() }));
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  /** Test-side SQL. */
  rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  exec(sql: string, ...params: unknown[]): void {
    this.raw.prepare(sql).run(...params);
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
