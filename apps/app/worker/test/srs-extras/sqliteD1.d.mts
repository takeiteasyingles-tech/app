export declare class SqliteD1 {
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
  /** Runs SQL synchronously and returns plain row objects (setup and assertions). */
  sql<Row = Record<string, unknown>>(sql: string, ...params: unknown[]): Row[];
  asD1(): D1Database;
}

export declare function createTestD1(): SqliteD1;
