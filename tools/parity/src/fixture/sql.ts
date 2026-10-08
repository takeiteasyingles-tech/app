// D1 rows for the fixture users (through @tie/seed fixtureToSql, so positional v6 keys map to the stable
// content ids) and a fixture super_admin with an admin session, for one slot's local database.
//
// Primary keys are global, not per user: fixtureToSql names cards fx-card-NNN and keeps the state's Mic
// session ids, and upserts them ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id. Two users
// with the same ids would therefore steal each other's rows (the last one applied wins). Every user
// but the canonical Ana gets its own namespace: isolated Mic session ids in its state (isolateState)
// and namespaced card ids here (namespaceCards).
import { pbkdf2Sync } from 'node:crypto';
import { sqlLiteral, toSqlFile } from '@tie/seed/emitSql';
import { extract } from '@tie/seed/extract';
import { fixtureStatements } from '@tie/seed/fixtureToSql';
import type { Any } from '@tie/seed/loadPrototype';
import { loadPrototype } from '@tie/seed/loadPrototype';
import { buildContent, type SeedContent } from '@tie/seed/transform/content';
import { MediaIndex, scanMedia } from '@tie/seed/transform/media';
import { SUPER_ADMIN_EMAIL } from '@tie/shared/authz';
import { FROZEN_MS } from '../config';
import {
  FIXTURE_PASSWORD,
  type FixtureUser,
  fixtureUsers,
  type JobSpec,
  jobUser,
  loadFixture,
  sessionToken,
  tokenHash,
} from './state';

/** pbkdf2-sha256$100000$<salt b64>$<hash b64>, the worker-core format (deterministic salt: test data). */
export function passHash(password: string, saltSeed = 'tie-parity'): string {
  const salt = pbkdf2Sync(saltSeed, 'salt', 1, 16, 'sha256');
  const hash = pbkdf2Sync(Buffer.from(password.normalize('NFKC'), 'utf8'), salt, 100_000, 32, 'sha256');
  return `pbkdf2-sha256$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export const ADMIN_USER_ID = 'U_PARITY_ADMIN';

export interface FixtureSqlUser {
  key: string;
  userId: string;
  email: string;
  token: string;
}

export interface FixtureJobUser extends FixtureSqlUser {
  tag: string;
  /** The v6 state seeded for this user; the prototype side of the job gets the same state. */
  state: Any;
}

export interface FixtureSql {
  sql: string;
  /** Standing users (main, fresh, ep1-sN). */
  users: FixtureSqlUser[];
  /** One user per capture job, by job tag. */
  jobs: Record<string, FixtureJobUser>;
  admin: { email: string; token: string };
}

/**
 * fixtureToSql numbers a user's cards fx-card-NNN; for a namespaced user they become
 * fx-<ns>-card-NNN. The id is the first column of every srs_cards tuple, so the rewrite is anchored
 * on the tuple start and never touches card text.
 */
export function namespaceCards(statements: string[], ns: string | null): string[] {
  if (!ns) return statements;
  if (!/^[a-z0-9-]+$/.test(ns)) throw new Error(`bad fixture namespace ${ns}`);
  return statements.map((s) =>
    s.startsWith('INSERT INTO srs_cards(') ? s.replace(/^\('fx-card-(\d+)'/gm, `('fx-${ns}-card-$1'`) : s,
  );
}

type GradingContent = Pick<SeedContent, 'exercise_items' | 'ebook_test_questions' | 'mic_phrases'>;

let contentCache: GradingContent | null = null;
const gradingContent = (now: number): GradingContent => {
  contentCache ??= buildContent(loadPrototype(), extract(), new MediaIndex(scanMedia()), now);
  return contentCache;
};

function userStatements(u: FixtureUser, token: string, pass: string, now: number, content: GradingContent) {
  return namespaceCards(
    fixtureStatements(u.state, {
      email: u.email,
      passHash: pass,
      sessionTokenHash: tokenHash(token),
      userId: u.userId,
      now,
      content,
    }),
    u.ns,
  );
}

/**
 * All fixture users of a slot, plus one isolated user per capture job. `now` is the frozen harness
 * time, so dates in D1 line up with the frozen browser clock (the Worker clock is shifted to the same
 * instant by the entry shim).
 */
export function buildFixtureSql(
  base: Any = loadFixture(),
  now: number = FROZEN_MS,
  jobs: readonly JobSpec[] = [],
): FixtureSql {
  const content = gradingContent(now);
  const pass = passHash(FIXTURE_PASSWORD);
  // Per-route users of earlier runs on this slot (ids contain "__"); cascades to all their rows.
  const statements: string[] = ["DELETE FROM users WHERE id LIKE 'U\\_PARITY%\\_\\_%' ESCAPE '\\';"];
  const users: FixtureSqlUser[] = [];
  for (const u of fixtureUsers(base)) {
    const token = sessionToken(u.key);
    statements.push(...userStatements(u, token, pass, now, content));
    users.push({ key: u.key, userId: u.userId, email: u.email, token });
  }
  const jobUsers: Record<string, FixtureJobUser> = {};
  for (const spec of jobs) {
    if (jobUsers[spec.tag]) throw new Error(`duplicate capture job ${spec.tag}`);
    const u = jobUser(base, spec);
    const token = sessionToken(`job:${u.tag}`);
    statements.push(...userStatements(u, token, pass, now, content));
    jobUsers[spec.tag] = { key: u.key, tag: u.tag, userId: u.userId, email: u.email, token, state: u.state };
  }
  const adminToken = sessionToken('super_admin', 'admin');
  statements.push(...adminStatements(adminToken, now, pass));
  return {
    sql: toSqlFile(statements, `parity fixtures: ${users.length} users + ${jobs.length} per-route users + super_admin`),
    users,
    jobs: jobUsers,
    admin: { email: SUPER_ADMIN_EMAIL, token: adminToken },
  };
}

/**
 * The super_admin (the configured SUPER_ADMIN_EMAIL; kept if bootstrap-admin already created it)
 * with an admin-audience session. Its password is the fixture test password only when it had none.
 */
function adminStatements(token: string, now: number, pass: string): string[] {
  const e = sqlLiteral(SUPER_ADMIN_EMAIL);
  const th = sqlLiteral(tokenHash(token));
  return [
    `INSERT INTO users(id, email, pass_hash, status, tz, created_at) VALUES(${sqlLiteral(ADMIN_USER_ID)}, ${e}, ${sqlLiteral(pass)}, 'active', 'America/Sao_Paulo', ${now}) ON CONFLICT(email) DO NOTHING;`,
    `UPDATE users SET status = 'active', pass_hash = COALESCE(pass_hash, ${sqlLiteral(pass)}) WHERE email = ${e};`,
    `INSERT INTO user_roles(user_id, role, granted_by, granted_at) SELECT id, 'super_admin', NULL, ${now} FROM users WHERE email = ${e} ON CONFLICT(user_id, role) DO NOTHING;`,
    `DELETE FROM sessions WHERE token_hash = ${th};`,
    `INSERT INTO sessions(token_hash, user_id, audience, created_at, last_seen_at, expires_at, ip_hash, ua) SELECT ${th}, id, 'admin', ${now}, ${now}, ${now + 8 * 3600_000}, NULL, 'parity-fixture' FROM users WHERE email = ${e};`,
  ];
}
