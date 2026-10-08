// Applies the D1 migrations, the content seed and the fixture SQL to an in-memory SQLite (D1 is
// SQLite; foreign keys on, like D1) and reports who owns what. Catches fixture users that share
// primary keys: upserts would silently move those rows to whichever user was applied last.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSeed } from '@tie/seed';
import { seedStatements, toSqlFile } from '@tie/seed/emitSql';
import { FROZEN_MS, REPO_ROOT } from '../config';

const MIGRATIONS = join(REPO_ROOT, 'packages', 'db', 'migrations');

export interface Ownership {
  cards: number;
  micSessions: number;
  micTurns: number;
  sessions: number;
}

let seedSql: string | null = null;

/** A fresh database with the schema and the content seed (cached SQL, new database each call). */
export function seededDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  for (const f of readdirSync(MIGRATIONS)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  if (!seedSql) {
    const { content, config } = buildSeed(FROZEN_MS);
    seedSql = toSqlFile(seedStatements(content, config));
  }
  db.exec(seedSql);
  return db;
}

/** Applies `fixtureSql` (twice: re-applying must change nothing) and counts each user's rows. */
export function ownershipAfter(fixtureSql: string, userIds: string[]): Record<string, Ownership> {
  const db = seededDb();
  try {
    db.exec(fixtureSql);
    db.exec(fixtureSql);
    const count = (sql: string, id: string) => Number((db.prepare(sql).get(id) as { n: number }).n);
    return Object.fromEntries(
      userIds.map((id) => [
        id,
        {
          cards: count('SELECT COUNT(*) AS n FROM srs_cards WHERE user_id = ?', id),
          micSessions: count('SELECT COUNT(*) AS n FROM mic_sessions WHERE user_id = ?', id),
          micTurns: count(
            'SELECT COUNT(*) AS n FROM mic_turns t JOIN mic_sessions s ON s.id = t.session_id WHERE s.user_id = ?',
            id,
          ),
          sessions: count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', id),
        },
      ]),
    );
  } finally {
    db.close();
  }
}
