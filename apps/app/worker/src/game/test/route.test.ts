import { AwardResult, gameApi } from '@tie/shared';
import { createApp, createSession, type Env, localDate } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import routes from '../../routes/game';
import { gameServices } from '../index';
import { all, db, exec, reset, seedEpisodes } from './helpers';

const ORIGIN = 'http://localhost:8813';
const app = createApp({ services: gameServices });
app.route('/', routes);
const env = { DB: db, APP_ORIGIN: ORIGIN, COOKIE_PREFIX: '' } as unknown as Env;

let cookie = '';

beforeEach(async () => {
  await reset();
  const { token } = await createSession(db, { userId: 'U1', audience: 'app' });
  cookie = `tie_s=${token}`;
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    `${ORIGIN}${gameApi.event.path}`,
    {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function ok(body: unknown): Promise<AwardResult> {
  const res = await post(body);
  expect(res.status).toBe(200);
  return AwardResult.parse(await res.json());
}

const keys = async () =>
  (await all<{ award_key: string }>("SELECT award_key FROM point_ledger WHERE kind <> 'mission' ORDER BY id")).map(
    (r) => r.award_key,
  );

describe('POST /api/game/event', () => {
  it('awards a word once, keyed by norm()', async () => {
    expect(await ok({ kind: 'word', key: 'Hello!' })).toMatchObject({ awarded: true, kind: 'word', points: 3 });
    expect(await ok({ kind: 'word', key: '  hello ' })).toMatchObject({ awarded: false, points: 0 });
    expect(await keys()).toEqual(['word:hello']);
  });

  it('dates quiz hits in the user timezone', async () => {
    await ok({ kind: 'quiz_hit', key: 'eb1:t3' });
    expect(await ok({ kind: 'quiz_hit', key: 'eb1:t3' })).toMatchObject({ awarded: false });
    expect(await keys()).toEqual([`quiz:eb1:t3:${localDate(Date.now(), 'America/Sao_Paulo')}`]);
  });

  it("pays Take the Lead hits only for the e-book's real turns", async () => {
    await exec(
      'INSERT OR REPLACE INTO ebooks(num, title, lead, updated_at) VALUES(1, \'E1\', \'[{"m":1},{"m":2},{"m":3}]\', 0)',
    );
    expect(await ok({ kind: 'quiz_hit', key: 'lead-eb1:2' })).toMatchObject({ awarded: true });
    for (const key of ['lead-eb1:3', 'lead-eb1:1000', 'lead-eb1:x', 'lead-eb9:0']) {
      expect((await post({ kind: 'quiz_hit', key })).status, key).toBe(400);
    }
    expect((await keys()).length).toBe(1);
  });

  it('accepts songs only for published episodes or known album tracks', async () => {
    expect((await post({ kind: 'song', key: '1' })).status).toBe(404);
    await seedEpisodes([1]);
    expect(await ok({ kind: 'song', key: '1' })).toMatchObject({ awarded: true, points: 10 });
    await exec("INSERT INTO albums(id, title, genres, sort) VALUES('season-one', 'Season One', '[]', 1)");
    await exec("INSERT INTO album_tracks(id, album_id, sort, title) VALUES('so-1', 'season-one', 1, 'Hello')");
    expect(await ok({ kind: 'song', key: 'so-1' })).toMatchObject({ awarded: true });
    expect(await keys()).toEqual(['song:1', 'song:so-1']);
  });

  it('rejects verifiable kinds and malformed keys', async () => {
    for (const body of [
      { kind: 'step', key: '1:1' },
      { kind: 'ex_right', key: 'e1-ex0-i0' },
      { kind: 'quiz_hit', key: 'no-colon' },
      { kind: 'song', key: 'a/b' },
      { kind: 'word', key: '?!' },
      { kind: 'word', key: '' },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_failed');
    }
    expect(await keys()).toEqual([]);
  });

  it('needs a session and a same-origin JSON request', async () => {
    expect((await post({ kind: 'word', key: 'hi' }, { Cookie: '' })).status).toBe(401);
    expect((await post({ kind: 'word', key: 'hi' }, { Origin: 'https://evil.example' })).status).toBe(403);
  });
});
