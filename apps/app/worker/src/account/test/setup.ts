/// <reference types="@cloudflare/vitest-plugin/types" />
// Applies packages/db/migrations to the test D1 before each test file (already-applied ones are skipped).
import { applyD1Migrations } from 'cloudflare:test';
import { testEnv } from './helpers';

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
