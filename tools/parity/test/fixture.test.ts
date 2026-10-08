// Fixture users never share primary keys: applied together to a real SQLite with the D1 schema and the
// content seed, each one owns exactly its own deck and Mic sessions. (The bug this guards against:
// every clone of Ana reused fx-card-NNN and Mic session 56xdhnp, and the last user applied took them.)
import { describe, expect, it } from 'vitest';
import { FROZEN_MS } from '../src/config';
import { ownershipAfter, seededDb } from '../src/fixture/ownership';
import { buildFixtureSql, namespaceCards } from '../src/fixture/sql';
import { fixtureUsers, isolateState, jobTag, jobUser, loadFixture, nsEmail, nsId } from '../src/fixture/state';
import { expectedOwnership, SAMPLE_JOBS, validateSql } from '../src/fixture/validate';

const base = loadFixture();

describe('fixture isolation', () => {
  it('Ana keeps the prototype ids; every other user is namespaced', () => {
    const users = fixtureUsers(base);
    const main = users.find((u) => u.key === 'main');
    expect(main?.ns).toBeNull();
    expect(main?.state.maggie.sessions.map((s: { id: string }) => s.id)).toEqual(['56xdhnp', '3dekeaw']);
    const ids = new Set<string>();
    for (const u of users) for (const s of u.state.maggie?.sessions ?? []) ids.add(`${s.id}`);
    // main 2 + ep1-s7..s10 and ep1-done 2 each (fresh has none), all distinct
    expect(ids.size).toBe(12);
  });

  it('isolateState renames session ids deterministically and sets the email', () => {
    const a = isolateState(base, 'x', 'ana+x@parity.test');
    const b = isolateState(base, 'x', 'ana+x@parity.test');
    expect(a).toEqual(b);
    expect(a.user.email).toBe('ana+x@parity.test');
    expect(a.maggie.sessions[0].id).toBe(nsId('x', '56xdhnp'));
    expect(a.maggie.sessions[0].id).toMatch(/^[0-9a-z]{7}$/);
    expect(base.maggie.sessions[0].id).toBe('56xdhnp');
    expect(nsEmail('ana@parity.test', 'Perfil Mobile')).toBe('ana+perfil-mobile@parity.test');
  });

  it('namespaceCards rewrites only srs_cards ids', () => {
    const stmts = [
      "INSERT INTO srs_cards(id, user_id, en) VALUES\n('fx-card-000', 'U', 'fx-card-000 text'),\n('fx-card-001', 'U', 'b')\nON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id;",
      "INSERT INTO mic_scores(user_id) VALUES\n('fx-card-000');",
    ];
    const out = namespaceCards(stmts, 'ep1-s7');
    expect(out[0]).toContain("('fx-ep1-s7-card-000', 'U', 'fx-card-000 text')");
    expect(out[0]).toContain("('fx-ep1-s7-card-001'");
    expect(out[1]).toBe(stmts[1]);
    expect(namespaceCards(stmts, null)).toBe(stmts);
    expect(() => namespaceCards(stmts, "x'; DROP")).toThrow();
  });

  it('per-route users: own id, email, token and state, same state for both sides', () => {
    const fx = buildFixtureSql(base, FROZEN_MS, [
      { tag: jobTag('inicio', 'mobile'), user: 'main' },
      { tag: jobTag('inicio', 'desktop'), user: 'main' },
    ]);
    const m = fx.jobs['inicio-mobile'];
    const d = fx.jobs['inicio-desktop'];
    expect(m && d).toBeTruthy();
    if (!m || !d) return;
    expect(m.userId).not.toBe(d.userId);
    expect(m.token).not.toBe(d.token);
    expect(m.email).toBe('ana+inicio-mobile@parity.test');
    expect(m.state.user.email).toBe(m.email);
    expect(m.state.maggie.sessions[0].id).not.toBe(d.state.maggie.sessions[0].id);
    expect(jobUser(base, { tag: 'inicio-mobile', user: 'main' }).state).toEqual(m.state);
    const dup = { tag: 'inicio-mobile', user: 'main' } as const;
    expect(() => buildFixtureSql(base, FROZEN_MS, [dup, dup])).toThrow(/duplicate/);
  });

  it('applied together to SQLite (D1 schema + content seed), each user owns exactly its rows', () => {
    const fx = buildFixtureSql(base, FROZEN_MS, SAMPLE_JOBS);
    const users = [
      ...fixtureUsers(base).map((u) => ({ id: u.userId, state: u.state })),
      ...Object.values(fx.jobs).map((j) => ({ id: j.userId, state: j.state })),
    ];
    const got = ownershipAfter(
      fx.sql,
      users.map((u) => u.id),
    );

    // The canonical user (what maggie-relatorio/56xdhnp, revisao and the Hoje due badge rely on).
    expect(got.U_PARITY).toEqual({
      cards: 12,
      micSessions: 2,
      micTurns: expectedOwnership(base).micTurns,
      sessions: 1,
    });
    expect(got.U_PARITY?.micTurns).toBeGreaterThan(0);
    for (const u of users) expect(got[u.id], u.id).toEqual(expectedOwnership(u.state));
    // ep1-s10 has the Take Away cards on top of Ana's 12.
    expect(got.U_PARITY_EP1_S10?.cards).toBeGreaterThan(12);
  });

  it("a later run's fixture SQL removes the per-route users of an earlier run", () => {
    const db = seededDb();
    try {
      db.exec(buildFixtureSql(base, FROZEN_MS, SAMPLE_JOBS).sql);
      const n = () =>
        Number(
          (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM users WHERE id LIKE 'U_PARITY%' AND id NOT IN ('U_PARITY_ADMIN', 'U_PARITY_EDITOR')",
              )
              .get() as { n: number }
          ).n,
        );
      expect(n()).toBe(fixtureUsers(base).length + SAMPLE_JOBS.length);
      db.exec(buildFixtureSql(base, FROZEN_MS, []).sql);
      expect(n()).toBe(fixtureUsers(base).length);
      expect(Number((db.prepare('SELECT COUNT(*) AS n FROM srs_cards').get() as { n: number }).n)).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('validateSql (fixture:check) runs the same ownership check', () => {
    expect(validateSql(base).problems).toEqual([]);
  });
});
