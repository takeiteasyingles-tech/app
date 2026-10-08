// Shared setup for the S5/S6 route and service tests: a real-SQL D1 (node:sqlite + migrations), a
// ledger-backed AwardService stand-in (INSERT OR IGNORE on point_ledger, like the real engine), seeded
// content and logged-in users.
import type { AwardResult, PointKind } from '@tie/shared';
import { type AwardService, createApp, createSession, type Env, localDate } from '@tie/worker-core';
import extrasRoutes from '../../src/routes/extras';
import srsRoutes from '../../src/routes/srs';
import { createSrsService } from '../../src/services/srs.impl';
import { createTestD1, type SqliteD1 } from './sqliteD1.mjs';

export const ORIGIN = 'http://localhost';
export const TZ = 'America/Sao_Paulo';

const POINTS: Record<PointKind, number> = {
  step: 10,
  episode: 40,
  ex_right: 5,
  mic_try: 5,
  mic_good: 15,
  song: 10,
  maggie_turn: 5,
  maggie_session: 30,
  extra: 20,
  dub: 10,
  card: 2,
  quiz_hit: 5,
  test_pass: 50,
  mission: 15,
  word: 3,
};

export interface AwardCall {
  userId: string;
  kind: PointKind;
  key: string;
}

export function ledgerAward(db: SqliteD1, clock: () => number): AwardService & { calls: AwardCall[] } {
  const calls: AwardCall[] = [];
  return {
    calls,
    async award(userId, kind, key, meta) {
      calls.push({ userId, kind, key });
      const t = meta?.now ?? clock();
      const day = localDate(t, TZ);
      const res = await db
        .asD1()
        .prepare(
          `INSERT OR IGNORE INTO point_ledger(user_id, award_key, kind, points, local_date, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, key, kind, POINTS[kind], day, t)
        .run();
      const total = db.sql<{ points: number }>('SELECT points FROM user_stats WHERE user_id = ?', userId)[0]?.points;
      return {
        awarded: res.meta.changes === 1,
        kind,
        points: POINTS[kind],
        total: total ?? 0,
        dayPoints: 0,
        levelUp: null,
        goalHit: false,
        newBadges: [],
        missionsDone: [],
      } satisfies AwardResult;
    },
  };
}

export function seed(db: SqliteD1): void {
  const t = 1;
  db.sql(
    `INSERT INTO users(id, email, tz, created_at) VALUES('u1', 'a@x.test', ?, ?), ('u2', 'b@x.test', ?, ?)`,
    TZ,
    t,
    TZ,
    t,
  );
  db.sql(
    `INSERT INTO episodes(num, title, status, visual, away_exp, lyrics, updated_at) VALUES(1, 'Ep 1', 'published', ?, ?, ?, ?)`,
    JSON.stringify([
      { en: 'the kitchen', pt: 'a cozinha' },
      { en: 'I am home!', pt: 'Cheguei!' },
      { en: 'The kitchen.', pt: 'duplicada' },
      { bogus: true },
    ]),
    JSON.stringify([
      { en: 'Take it easy', pt: 'Calma', note: 'informal' },
      { en: 'See you', pt: 'Até mais' },
    ]),
    JSON.stringify([
      { en: 'Hello there, friend', pt: 'Olá, amigo', gap: 'there,' },
      { en: 'No gap here', pt: 'Sem lacuna' },
    ]),
    t,
  );
  // Lines 0-2 are spoken by Maggie (the dubbing character), line 3 by Ben.
  const extra = (
    id: string,
    locked: number,
    status: string,
    lines: number,
    dub: string | null = 'Maggie',
    premium = 0,
  ) =>
    db.sql(
      `INSERT INTO extras(id, title, format, genres, themes, cast_list, lines, vocab, sort, locked, status, dub, premium)
       VALUES(?, ?, 'serie', '[]', '[]', '[]', ?, '[]', 1, ?, ?, ?, ?)`,
      id,
      id,
      JSON.stringify(
        Array.from({ length: lines }, (_, i) => ({ who: i < 3 ? 'Maggie' : 'Ben', en: `Line ${i}`, pt: `Fala ${i}` })),
      ),
      locked,
      status,
      dub,
      premium,
    );
  extra('woods', 0, 'published', 4);
  extra('soon', 1, 'published', 2);
  extra('draft', 0, 'draft', 2);
  extra('nodub', 0, 'published', 2, null);
  extra('vip', 0, 'published', 2, 'Maggie', 1);
  // u2 is on a plan with premium extras; u1 has no plan (no default plan seeded either).
  db.sql(
    `INSERT INTO plans(id, slug, name, ai_minutes_month, features, created_at, updated_at)
     VALUES('P1', 'premium', 'Premium', 600, ?, ?, ?)`,
    JSON.stringify({ premium_extras: true }),
    t,
    t,
  );
  db.sql(`INSERT INTO user_plans(user_id, plan_id, assigned_at) VALUES('u2', 'P1', ?)`, t);
  db.sql(
    `INSERT INTO episodes(num, title, status, lyrics, updated_at) VALUES(2, 'Ep 2', 'draft', ?, ?)`,
    JSON.stringify([{ en: 'Secret draft lyric', pt: 'Rascunho', gap: 'draft' }]),
    t,
  );
  db.sql(`INSERT INTO albums(id, title, genres, sort) VALUES('season-one', 'Season One', '[]', 1)`);
  db.sql(
    `INSERT INTO album_tracks(id, album_id, sort, title, ep_num, lines) VALUES
       ('t-own', 'season-one', 1, 'Own', NULL, ?), ('t-ep', 'season-one', 2, 'Ep', 1, NULL),
       ('t-draft', 'season-one', 3, 'Draft', 2, NULL)`,
    JSON.stringify([{ en: 'Don’t stop now', pt: 'Não pare agora', gap: 'Don’t' }]),
  );
}

export const MEDIA_TOKEN_KEY = 'test-media-token-key';

export interface Harness {
  db: SqliteD1;
  clock: { t: number };
  award: ReturnType<typeof ledgerAward>;
  srs: ReturnType<typeof createSrsService>;
  env: Env;
  /** JSON request as user (cookie) with same-origin headers. */
  call(user: 'u1' | 'u2' | null, method: string, path: string, body?: unknown): Promise<Response>;
}

/** The service clock starts at the real time so route-level reads (which use Date.now) agree with it. */
export async function harness(start = Date.now()): Promise<Harness> {
  const db = createTestD1();
  seed(db);
  const clock = { t: start };
  const now = () => clock.t;
  const award = ledgerAward(db, now);
  const env = { DB: db.asD1(), APP_ORIGIN: ORIGIN, COOKIE_PREFIX: '', MEDIA_TOKEN_KEY } as unknown as Env;
  const srs = createSrsService(env, { award } as never, { now });
  const app = createApp({
    services: { award: () => award, srs: (e, s) => createSrsService(e, s, { now }) },
  });
  app.route('/', srsRoutes);
  app.route('/', extrasRoutes);
  const tokens = {
    u1: (await createSession(env.DB, { userId: 'u1', audience: 'app' })).token,
    u2: (await createSession(env.DB, { userId: 'u2', audience: 'app' })).token,
  };
  return {
    db,
    clock,
    award,
    srs,
    env,
    async call(user, method, path, body) {
      const headers: Record<string, string> = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
      if (user) headers.Cookie = `tie_s=${tokens[user]}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return app.request(
        `${ORIGIN}${path}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        env,
      );
    },
  };
}
