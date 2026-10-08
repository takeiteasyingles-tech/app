// Fixture validation: (1) the prototype loads it as a v6 state and Hoje renders without the error
// card (and review.sync has nothing to add, so no surprise toast); (2) fixtureToSql accepts every user
// derived from it (all positional keys map to existing content ids).
import type { Browser } from '@playwright/test';
import type { Any } from '@tie/seed/loadPrototype';
import { norm } from '@tie/shared/domain/norm';
import { FROZEN_MS } from '../config';
import { contextOptions, prepareContext, settle } from '../determinism';
import { checkHojeInPage } from './builder';
import { type Ownership, ownershipAfter } from './ownership';
import { buildFixtureSql } from './sql';
import { fixtureUsers, type JobSpec, STORAGE_KEY } from './state';

export interface ValidationResult {
  ok: boolean;
  problems: string[];
  screenshot?: Buffer;
}

export async function validateInPrototype(browser: Browser, protoUrl: string, state: Any): Promise<ValidationResult> {
  const ctx = await browser.newContext(contextOptions('desktop'));
  const problems: string[] = [];
  try {
    await prepareContext(ctx, {
      side: 'prototype',
      seedKey: 'fixture-check',
      storage: { [STORAGE_KEY]: JSON.stringify(state) },
      allowOrigins: [new URL(protoUrl).origin],
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${protoUrl}/#/inicio`, { waitUntil: 'load' });
    await settle(page);
    const res = await page.evaluate(checkHojeInPage);
    problems.push(...res.problems);
    const screenshot = await page.screenshot({ fullPage: true });
    return { ok: problems.length === 0, problems, screenshot };
  } finally {
    await ctx.close();
  }
}

/** Rows a user should own once its state is in D1: deduped deck cards, Mic sessions and turns. */
export function expectedOwnership(state: Any): Ownership {
  const keys = new Set(((state.deck ?? []) as Any[]).map((c) => norm(c.en)).filter(Boolean));
  const sessions = (state.maggie?.sessions ?? []) as Any[];
  return {
    cards: keys.size,
    micSessions: sessions.length,
    micTurns: sessions.reduce((n, s) => n + ((s.turns ?? []) as Any[]).length, 0),
    sessions: 1,
  };
}

/** Jobs a validation run adds next to the standing users, to check per-route isolation as well. */
export const SAMPLE_JOBS: JobSpec[] = [
  { tag: 'inicio-mobile', user: 'main' },
  { tag: 'inicio-desktop', user: 'main' },
  { tag: 'ep1-7-mobile', user: 'ep1-s7' },
  { tag: 'cadastro-3-mobile', user: 'fresh', onbStep: 3 },
];

/**
 * fixtureToSql accepts every user, and after applying all of them (standing users + sample per-route
 * users) to a real SQLite with the schema and the content seed, each user owns exactly its own deck
 * and Mic sessions (no shared primary keys moved to another user).
 */
export function validateSql(state: Any): ValidationResult {
  try {
    const fx = buildFixtureSql(state, FROZEN_MS, SAMPLE_JOBS);
    if (!fx.sql.includes('INSERT INTO mic_sessions')) return { ok: false, problems: ['no mic_sessions rows emitted'] };
    if (fx.users.length < 2) return { ok: false, problems: ['expected several fixture users'] };
    const expected = new Map<string, Ownership>();
    for (const u of fixtureUsers(state)) expected.set(u.userId, expectedOwnership(u.state));
    for (const j of Object.values(fx.jobs)) expected.set(j.userId, expectedOwnership(j.state));
    const got = ownershipAfter(fx.sql, [...expected.keys()]);
    const problems: string[] = [];
    for (const [id, want] of expected) {
      const have = got[id];
      if (JSON.stringify(have) !== JSON.stringify(want))
        problems.push(`${id}: owns ${JSON.stringify(have)}, expected ${JSON.stringify(want)}`);
    }
    return { ok: problems.length === 0, problems };
  } catch (err) {
    return { ok: false, problems: [`fixtureToSql: ${(err as Error).message}`] };
  }
}
