// `npm run seed:bootstrap-admin -- --local [--persist-to dir] | --remote [--origin https://tie-admin…]`
// Creates the super_admin (diego.perez@digitalsolvers.com) without a password, grants the role and
// issues a fresh admin_invite token (7 days). The token is printed once and only its SHA-256 is
// stored; running it again revokes the previous unused invite and prints a new one.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { SUPER_ADMIN_EMAIL } from '@tie/shared/authz';
import { DEFAULT_TZ, DURATIONS } from '@tie/shared/constants';
import { newId, randomToken } from '@tie/shared/ids';
import { sqlLiteral } from './emitSql';
import { OUT_DIR } from './publish';
import { executeFile, resolvePersist, type Target } from './wrangler';

export interface BootstrapResult {
  token: string;
  sql: string;
}

export function bootstrapSql(
  token: string,
  now: number = Date.now(),
  email: string = SUPER_ADMIN_EMAIL,
  userId: string = newId(now),
): string {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const e = sqlLiteral(email);
  return [
    `INSERT INTO users(id, email, pass_hash, status, tz, created_at) VALUES(${sqlLiteral(userId)}, ${e}, NULL, 'active', ${sqlLiteral(DEFAULT_TZ)}, ${now}) ON CONFLICT(email) DO NOTHING;`,
    `UPDATE users SET status = 'active' WHERE email = ${e} AND status = 'suspended';`,
    `INSERT INTO user_roles(user_id, role, granted_by, granted_at) SELECT id, 'super_admin', NULL, ${now} FROM users WHERE email = ${e} ON CONFLICT(user_id, role) DO NOTHING;`,
    `DELETE FROM one_time_tokens WHERE kind = 'admin_invite' AND email = ${e} AND used_at IS NULL;`,
    `INSERT INTO one_time_tokens(token_hash, user_id, kind, email, role, created_by, expires_at, used_at) SELECT ${sqlLiteral(tokenHash)}, id, 'admin_invite', email, 'super_admin', NULL, ${now + DURATIONS.inviteTokenMs}, NULL FROM users WHERE email = ${e};`,
  ].join('\n');
}

export async function bootstrapAdmin(t: Target, now: number = Date.now()): Promise<BootstrapResult> {
  const token = randomToken(32);
  const sql = bootstrapSql(token, now);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `bootstrap-${now}.sql`);
  writeFileSync(file, sql);
  try {
    await executeFile(t, file);
  } finally {
    rmSync(file, { force: true });
  }
  return { token, sql };
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean', default: false },
      remote: { type: 'boolean', default: false },
      'persist-to': { type: 'string' },
      origin: { type: 'string' },
    },
  });
  if (values.local === values.remote) throw new Error('pass exactly one of --local or --remote');
  const t: Target = values.remote
    ? { mode: 'remote' }
    : { mode: 'local', persistTo: resolvePersist(values['persist-to']) };
  const origin = (values.origin ?? (values.remote ? '' : 'http://localhost:8788')).replace(/\/+$/, '');
  const { token } = await bootstrapAdmin(t);
  console.log(`super_admin: ${SUPER_ADMIN_EMAIL}`);
  console.log('One-time admin invite (valid 7 days, shown only now):');
  console.log(`  token: ${token}`);
  if (origin) console.log(`  url:   ${origin}/#/convite/${token}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
