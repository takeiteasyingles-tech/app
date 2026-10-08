// Applies packages/db/migrations to the test D1 before each test file (already-applied ones are skipped).
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
