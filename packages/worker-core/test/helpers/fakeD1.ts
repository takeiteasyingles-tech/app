// Minimal in-memory stand-in for D1Database: records every statement and answers from a script.
// Enough to unit-test SQL-building helpers without workerd.

export interface Executed {
  sql: string;
  params: unknown[];
  via: 'first' | 'all' | 'run' | 'batch';
}

export type Responder = (sql: string, params: unknown[]) => unknown[];

export class FakeD1 {
  readonly executed: Executed[] = [];
  constructor(private readonly respond: Responder = () => []) {}

  prepare(sql: string) {
    const db = this;
    const make = (params: unknown[]) => ({
      sql,
      params,
      bind: (...p: unknown[]) => make(p),
      async first() {
        db.executed.push({ sql, params, via: 'first' });
        return db.respond(sql, params)[0] ?? null;
      },
      async all() {
        db.executed.push({ sql, params, via: 'all' });
        return { success: true, meta: meta(0), results: db.respond(sql, params) };
      },
      async run() {
        db.executed.push({ sql, params, via: 'run' });
        db.respond(sql, params);
        return { success: true, meta: meta(1), results: [] };
      },
    });
    return make([]);
  }

  async batch(stmts: { sql: string; params: unknown[] }[]) {
    return stmts.map((s) => {
      this.executed.push({ sql: s.sql, params: s.params, via: 'batch' });
      return { success: true, meta: meta(1), results: this.respond(s.sql, s.params) };
    });
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

function meta(changes: number) {
  return { changes, last_row_id: 1, duration: 0, size_after: 0, rows_read: 0, rows_written: changes, changed_db: true };
}
