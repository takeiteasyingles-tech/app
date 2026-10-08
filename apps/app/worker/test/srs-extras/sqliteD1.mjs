// Test-only D1Database stand-in over Node's built-in SQLite (node:sqlite), with the real migrations
// from packages/db applied. Covers what the routes use: prepare/bind/first/all/run and atomic batch().
// Plain JS (typed by sqliteD1.d.mts) so the worker tsconfig, which only loads workers-types, stays clean.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = new URL('../../../../../packages/db/migrations/', import.meta.url);

const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

const toSql = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Stmt(this.db, this.sql, params.map(toSql));
  }
  exec() {
    const st = this.db.sqlite.prepare(this.sql);
    if (returnsRows(this.sql)) {
      const rows = st.all(...this.params).map((r) => ({ ...r }));
      return { results: rows, meta: { changes: Number(this.db.sqlite.prepare('SELECT changes() AS n').get().n) } };
    }
    const r = st.run(...this.params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first(col) {
    const row = this.exec().results[0] ?? null;
    return col && row ? row[col] : row;
  }
  async all() {
    const r = this.exec();
    return { success: true, results: r.results, meta: r.meta };
  }
  async run() {
    const r = this.exec();
    return { success: true, results: [], meta: r.meta };
  }
}

export class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) this.sqlite.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  prepare(sql) {
    return new Stmt(this, sql);
  }
  async batch(stmts) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => {
        const r = s.exec();
        return { success: true, results: r.results, meta: r.meta };
      });
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }
  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }
  /** Synchronous helpers for test setup and assertions. */
  sql(sql, ...params) {
    return this.sqlite
      .prepare(sql)
      .all(...params.map(toSql))
      .map((r) => ({ ...r }));
  }
  asD1() {
    return this;
  }
}

export function createTestD1() {
  return new SqliteD1();
}
