// The parity fixture (fixtures/state.v6.json) and the per-route users derived from it. Every user
// exists twice, identically: as localStorage['tie.v6'] for the prototype and as D1 rows (fixtureToSql)
// plus a known session token for the new app.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Any, loadPrototype } from '@tie/seed/loadPrototype';
import { norm } from '@tie/shared/domain/norm';
import { FIXTURE_FILE, FROZEN_MS } from '../config';

export const STORAGE_KEY = 'tie.v6';

export function loadFixture(file: string = FIXTURE_FILE): Any {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (state?.v !== 6) throw new Error(`${file} is not a prototype v6 state`);
  return state;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let protoData: Any | null = null;
const data = (): Any => {
  protoData ??= loadPrototype();
  return protoData;
};

/**
 * Episode 1 advanced to `step` the way the prototype would have left it: the phrases of step 6 and
 * the answers of step 9 done once passed, and the Take Away cards in the deck once step 8 is behind
 * (review.sync would add them, with a toast, otherwise).
 */
export function ep1At(base: Any, step: number): Any {
  const s = clone(base);
  const E = data().EPS[1];
  s.prog = { ...s.prog, 1: step };
  if (step > 6) {
    E.mic.forEach((_: unknown, i: number) => {
      s.scores[`1-${i}`] ??= 7;
    });
    s.stepOk['1-6'] = true;
  }
  if (step > 9) {
    E.ex.forEach((ex: Any, x: number) => {
      ex.items.forEach((it: Any, j: number) => {
        s.exAns[`1-${x}-${j}`] ??= it.a;
      });
    });
    s.stepOk['1-9'] = true;
  }
  if (step > 8) {
    const have = new Set((s.deck as Any[]).map((c) => norm(c.en)));
    for (const x of E.awayExp ?? []) {
      if (have.has(norm(x.en))) continue;
      have.add(norm(x.en));
      s.deck.push({ en: x.en, pt: x.pt, note: x.note || '', scene: `Ep. ${E.num} · Take Away`, at: FROZEN_MS });
    }
    s.due = (s.deck as Any[]).filter((c) => (c.at || 0) <= FROZEN_MS).length;
  }
  return s;
}

/** Signed in, no profile yet: the onboarding wizard at `onbStep`. */
export function freshUser(onbStep = 1): Any {
  return {
    v: 6,
    user: { name: 'Bruno', fullName: 'Bruno Lima', email: 'bruno@parity.test' },
    profile: null,
    onbStep,
    settings: {
      ts: 1,
      sound: true,
      hd: false,
      trans: true,
      slow: false,
      remind: true,
      phone: false,
      fx: true,
      free: false,
    },
  };
}

export type UserKey = 'none' | 'main' | 'fresh' | 'ep1-s7' | 'ep1-s8' | 'ep1-s9' | 'ep1-s10';
export type FixtureUserKey = Exclude<UserKey, 'none'>;

export interface FixtureUser {
  key: FixtureUserKey;
  userId: string;
  email: string;
  /**
   * Namespace for the user's primary-keyed rows that fixtureToSql does not scope by user (srs_cards
   * ids). null keeps the plain ids: only the canonical main user (Ana) has that.
   */
  ns: string | null;
  /** v6 state as seeded into D1 for the app (and, for per-route users, injected into the prototype). */
  state: Any;
}

/** Lowercase [a-z0-9-] slug, safe in emails, row ids and SQL literals. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Deterministic 7-char base36 id (the prototype's own Mic session id shape) for a namespaced copy. */
export function nsId(ns: string, id: string): string {
  const n = createHash('sha1').update(`${ns}:${id}`).digest().readUIntBE(0, 6);
  return n.toString(36).padStart(7, '0').slice(-7);
}

/** ana@parity.test + inicio-mobile → ana+inicio-mobile@parity.test */
export function nsEmail(email: string, ns: string): string {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}+${slug(ns)}${email.slice(at)}`;
}

/**
 * A copy of `state` whose globally keyed rows are unique to `ns`: Mic session ids (mic_sessions.id and
 * mic_turns.session_id are primary keys shared by all users) are renamed, and the signed-in email is
 * the D1 user's own. The prototype side of a route uses this very state, so both sides match.
 */
export function isolateState(state: Any, ns: string, email: string): Any {
  const s = clone(state);
  if (s.user) s.user.email = email;
  for (const x of (s.maggie?.sessions ?? []) as Any[]) x.id = nsId(ns, String(x.id));
  return s;
}

const BASE: Record<FixtureUserKey, { userId: string; email: string }> = {
  main: { userId: 'U_PARITY', email: 'ana@parity.test' },
  fresh: { userId: 'U_PARITY_FRESH', email: 'bruno@parity.test' },
  'ep1-s7': { userId: 'U_PARITY_EP1_S7', email: 'ana.s7@parity.test' },
  'ep1-s8': { userId: 'U_PARITY_EP1_S8', email: 'ana.s8@parity.test' },
  'ep1-s9': { userId: 'U_PARITY_EP1_S9', email: 'ana.s9@parity.test' },
  'ep1-s10': { userId: 'U_PARITY_EP1_S10', email: 'ana.s10@parity.test' },
};

/** The un-isolated state of a fixture user (the main fixture, a fresh signup, or episode 1 advanced). */
export function rawState(key: FixtureUserKey, base: Any, opts: { onbStep?: number } = {}): Any {
  if (key === 'main') return clone(base);
  if (key === 'fresh') return freshUser(opts.onbStep ?? 1);
  const step = Number(key.replace('ep1-s', ''));
  return ep1At(base, step);
}

/**
 * The slot's standing users. Ana (`main`) keeps the prototype's own ids (Mic session 56xdhnp, cards
 * fx-card-NNN); every other user gets its own namespace, so no two users ever share a primary key
 * (an upsert would otherwise move the row to whichever user was applied last).
 */
export function fixtureUsers(base: Any = loadFixture()): FixtureUser[] {
  return (Object.keys(BASE) as FixtureUserKey[]).map((key) => {
    const { userId, email } = BASE[key];
    const raw = rawState(key, base);
    if (key === 'main') return { key, userId, email, ns: null, state: raw };
    return { key, userId, email, ns: key, state: isolateState(raw, key, email) };
  });
}

/** What a capture job needs: its route's fixture user and, for 'fresh', the onboarding step. */
export interface JobSpec {
  /** Unique per (route, viewport) within a run, e.g. `inicio-mobile`. */
  tag: string;
  user: FixtureUserKey;
  onbStep?: number;
}

export const jobTag = (routeId: string, viewport: string) => slug(`${routeId}-${viewport}`);

/**
 * A user of its own for one capture job (route × viewport): own user id, email, session token and
 * row ids, so whatever an app screen writes while it is captured (view marks, awards, daily stats,
 * session touch) can never leak into another route, just as each prototype route starts from fresh
 * localStorage. Its state is what the prototype side gets too.
 */
export function jobUser(base: Any, spec: JobSpec): FixtureUser & { tag: string } {
  const ns = slug(spec.tag);
  const b = BASE[spec.user];
  const email = nsEmail(b.email, ns);
  const userId = `${b.userId}__${ns.toUpperCase().replace(/-/g, '_')}`;
  return {
    key: spec.user,
    tag: spec.tag,
    userId,
    email,
    ns,
    state: isolateState(rawState(spec.user, base, { onbStep: spec.onbStep }), ns, email),
  };
}

/** localStorage for the prototype side of a route. */
export function storageOf(state: Any | null): Record<string, string> | null {
  return state ? { [STORAGE_KEY]: JSON.stringify(state) } : null;
}

/** Deterministic app session token per user (32 bytes as base64url = 43 chars, the cookie shape). */
export function sessionToken(userKey: string, audience: 'app' | 'admin' = 'app'): string {
  return createHash('sha256').update(`tie-parity:${audience}:${userKey}`).digest('base64url');
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The test password every fixture user gets (local test databases only). */
export const FIXTURE_PASSWORD = 'parity-pass-2026';
