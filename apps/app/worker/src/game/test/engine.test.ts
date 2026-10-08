import { AwardResult, BADGES, GameSummary } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGameEngine } from '../engine';
import { DEFAULT_DAILY_CAPS, MAGGIE_TURNS_PER_SESSION } from '../rules';
import { all, db, exec, one, reset, seedBadges, seedEpisodes, spNoon } from './helpers';

const engine = createGameEngine(db);
const D1 = '2026-10-01';
const D2 = '2026-10-02';
const D3 = '2026-10-03';

async function award(kind: Parameters<typeof engine.award>[1], key: string, date = D1, meta = {}) {
  const res = await engine.award('U1', kind, key, { now: spNoon(date), ...meta });
  expect(AwardResult.safeParse(res).success).toBe(true);
  return res;
}

const stats = () =>
  one<{ points: number; streak: number; last_day: string }>('SELECT * FROM user_stats WHERE user_id = ?', 'U1');

beforeEach(async () => {
  await reset();
});

describe('idempotency', () => {
  it('awards a key once; a replay returns awarded:false with the current totals', async () => {
    const first = await award('step', 'step:1:1');
    // 10 for the step + 15 for the "Fazer 1 etapa" mission.
    expect(first).toMatchObject({ awarded: true, kind: 'step', points: 10, total: 25, dayPoints: 25 });
    expect(first.missionsDone).toEqual(['step']);

    const again = await award('step', 'step:1:1');
    expect(again).toMatchObject({
      awarded: false,
      points: 0,
      total: 25,
      dayPoints: 25,
      missionsDone: [],
      goalHit: false,
    });
    expect(again.levelUp).toBeNull();

    const rows = await all('SELECT * FROM point_ledger WHERE user_id = ? AND award_key = ?', 'U1', 'step:1:1');
    expect(rows).toHaveLength(1);
    expect((await stats())?.points).toBe(25);
    const day = await one<{ steps: number; points: number }>('SELECT * FROM daily_stats WHERE user_id = ?', 'U1');
    expect(day).toMatchObject({ steps: 1, points: 25 });
  });

  it('a replay on a later day neither awards nor touches the streak', async () => {
    await award('step', 'step:1:1', D1);
    await award('step', 'step:1:1', D3);
    expect(await stats()).toMatchObject({ streak: 1, last_day: D1 });
  });

  it('stores meta (minus engine fields) and maggie seconds on the ledger row', async () => {
    await award('maggie_session', 'msess:S1', D1, { maggieSec: 90, mode: 'livre' });
    const row = await one<{ meta: string; maggie_sec: number; points: number }>(
      'SELECT meta, maggie_sec, points FROM point_ledger WHERE award_key = ?',
      'msess:S1',
    );
    expect(row).toMatchObject({ maggie_sec: 90, points: 30 });
    expect(JSON.parse(row?.meta ?? '{}')).toEqual({ mode: 'livre' });
  });

  it('rejects engine-only and unknown kinds, bad keys and unknown users', async () => {
    await expect(engine.award('U1', 'mission', 'mission:x:step', { now: spNoon(D1) })).rejects.toThrow();
    await expect(engine.award('U1', 'nope' as never, 'x', { now: spNoon(D1) })).rejects.toThrow();
    await expect(engine.award('U1', 'step', '', { now: spNoon(D1) })).rejects.toThrow();
    await expect(engine.award('U1', 'maggie_turn', 'mturn:S1', { now: spNoon(D1) })).rejects.toThrow();
    await expect(engine.award('NOPE', 'step', 'step:1:1', { now: spNoon(D1) })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('streak', () => {
  it('+1 after yesterday, same day keeps it, a gap restarts at 1', async () => {
    await award('step', 'step:1:1', D1);
    expect((await stats())?.streak).toBe(1);
    await award('step', 'step:1:2', D1);
    expect((await stats())?.streak).toBe(1);
    await award('step', 'step:1:3', D2);
    expect((await stats())?.streak).toBe(2);
    await award('step', 'step:1:4', D3);
    expect(await stats()).toMatchObject({ streak: 3, last_day: D3 });
    await award('step', 'step:1:5', '2026-10-05');
    expect(await stats()).toMatchObject({ streak: 1, last_day: '2026-10-05' });
  });

  it('crosses months by calendar date', async () => {
    await award('step', 'step:1:1', '2026-09-30');
    await award('step', 'step:1:2', '2026-10-01');
    expect((await stats())?.streak).toBe(2);
  });

  it("uses the user's timezone for days (Tokyo crosses midnight, São Paulo does not)", async () => {
    const t1 = Date.parse('2026-10-01T14:00:00Z'); // Tokyo 23:00 Oct 1 · São Paulo 11:00 Oct 1
    const t2 = Date.parse('2026-10-01T16:00:00Z'); // Tokyo 01:00 Oct 2 · São Paulo 13:00 Oct 1

    await reset({ tz: 'Asia/Tokyo' });
    await engine.award('U1', 'step', 'step:1:1', { now: t1 });
    await engine.award('U1', 'step', 'step:1:2', { now: t2 });
    expect(await stats()).toMatchObject({ streak: 2, last_day: '2026-10-02' });
    const dates = await all<{ local_date: string }>(
      'SELECT local_date FROM point_ledger WHERE kind = ? ORDER BY id',
      'step',
    );
    expect(dates.map((d) => d.local_date)).toEqual(['2026-10-01', '2026-10-02']);

    await reset({ tz: 'America/Sao_Paulo' });
    await engine.award('U1', 'step', 'step:1:1', { now: t1 });
    await engine.award('U1', 'step', 'step:1:2', { now: t2 });
    expect(await stats()).toMatchObject({ streak: 1, last_day: '2026-10-01' });
  });

  it('São Paulo late evening is still the same local day (UTC already rolled over)', async () => {
    await engine.award('U1', 'step', 'step:1:1', { now: Date.parse('2026-10-01T12:00:00Z') });
    await engine.award('U1', 'step', 'step:1:2', { now: Date.parse('2026-10-02T02:30:00Z') }); // 23:30 SP
    expect(await stats()).toMatchObject({ streak: 1, last_day: '2026-10-01' });
  });

  it('a timezone change that moves the local date backwards never rewinds last_day', async () => {
    await engine.award('U1', 'step', 'step:1:1', { now: Date.parse('2026-10-01T16:00:00Z') });
    await exec("UPDATE users SET tz = 'Asia/Tokyo' WHERE id = 'U1'");
    await engine.award('U1', 'step', 'step:1:2', { now: Date.parse('2026-10-01T16:30:00Z') }); // Tokyo Oct 2
    await exec("UPDATE users SET tz = 'America/Sao_Paulo' WHERE id = 'U1'");
    await engine.award('U1', 'step', 'step:1:3', { now: Date.parse('2026-10-01T17:00:00Z') }); // SP Oct 1
    expect(await stats()).toMatchObject({ streak: 2, last_day: '2026-10-02' });
  });
});

describe('daily goal', () => {
  it('hits once when the day reaches goalTarget(minutes)', async () => {
    // minutes 10 → target 50. Day: 25 (step + mission), 35, 45, 55 (hit), 65.
    const hits: boolean[] = [];
    for (let n = 1; n <= 5; n++) hits.push((await award('step', `step:1:${n}`)).goalHit);
    expect(hits).toEqual([false, false, false, true, false]);
    const day = await one<{ goal_hit: number; points: number }>('SELECT goal_hit, points FROM daily_stats');
    expect(day).toEqual({ goal_hit: 1, points: 65 });
  });

  it('follows the profile minutes', async () => {
    await reset({ minutes: 30 }); // target 150
    const res = await award('test_pass', 'test_pass:1'); // 50
    expect(res.goalHit).toBe(false);
    const summary = await engine.summary('U1', { now: spNoon(D1) });
    expect(summary.goal).toEqual({ target: 150, done: 50, pct: 33, hit: false });
  });

  it('counts a mission bonus toward the goal', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('dub', 30)");
    expect((await award('dub', 'dub:x1')).goalHit).toBe(false); // 30
    const res = await award('step', 'step:1:1'); // 40 + 15 mission = 55
    expect(res).toMatchObject({ goalHit: true, missionsDone: ['step'], dayPoints: 55, total: 55 });
  });

  it('is per local day', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('dub', 60)");
    expect((await award('dub', 'dub:a', D1)).goalHit).toBe(true);
    expect((await award('dub', 'dub:b', D1)).goalHit).toBe(false);
    expect((await award('dub', 'dub:c', D2)).goalHit).toBe(true);
    const days = await all<{ local_date: string }>('SELECT local_date FROM daily_stats WHERE goal_hit = 1 ORDER BY 1');
    expect(days.map((d) => d.local_date)).toEqual([D1, D2]);
  });
});

describe('daily missions', () => {
  it('pays each mission bonus once a day, again the next day', async () => {
    expect((await award('step', 'step:1:1', D1)).missionsDone).toEqual(['step']);
    expect((await award('step', 'step:1:2', D1)).missionsDone).toEqual([]);
    const day = await one<{ missions: string }>('SELECT missions FROM daily_stats WHERE local_date = ?', D1);
    expect(JSON.parse(day?.missions ?? '{}')).toEqual({ step: true });
    expect((await award('step', 'step:1:3', D2)).missionsDone).toEqual(['step']);
    const keys = await all<{ award_key: string; points: number }>(
      "SELECT award_key, points FROM point_ledger WHERE kind = 'mission' ORDER BY id",
    );
    expect(keys).toEqual([
      { award_key: `mission:${D1}:step`, points: 15 },
      { award_key: `mission:${D2}:step`, points: 15 },
    ]);
  });

  it('extra and Mic missions (new account: no cards mission)', async () => {
    expect((await award('extra', 'extra:woods', D1)).missionsDone).toEqual(['extra']);
    // 2 minutes with the assistant: 90 s is not enough, 90 + 40 is.
    expect((await award('maggie_session', 'msess:S1', D1, { maggieSec: 90 })).missionsDone).toEqual([]);
    expect((await award('maggie_session', 'msess:S2', D1, { maggieSec: 40 })).missionsDone).toEqual(['maggie']);
    expect((await stats())?.points).toBe(20 + 15 + 30 + 30 + 15);
  });

  it('cards mission appears with a deck and is done after 5 cards', async () => {
    await exec(
      "INSERT INTO srs_cards(id, user_id, norm_key, en, pt, source, due_at, created_at) VALUES('C1', 'U1', 'hi', 'Hi', 'Oi', 'ep', 0, 0)",
    );
    const done: string[][] = [];
    for (let n = 1; n <= 5; n++) done.push((await award('card', `card:c${n}:${D1}`)).missionsDone);
    expect(done).toEqual([[], [], [], [], ['cards']]);
  });

  it('uses the configured mission bonus', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('mission', 25)");
    const res = await award('step', 'step:1:1');
    expect(res).toMatchObject({ points: 10, total: 35, missionsDone: ['step'] });
  });
});

describe('badges', () => {
  beforeEach(async () => {
    await seedBadges();
  });

  const ids = (r: AwardResult) => r.newBadges.map((b) => b.id);

  it('first step, returned once with its catalog fields', async () => {
    const res = await award('step', 'step:1:1');
    expect(res.newBadges).toEqual([{ id: 'first-step', t: 'Primeiro passo', s: 'Concluiu uma etapa', icon: 'flag' }]);
    expect(ids(await award('step', 'step:1:2'))).toEqual([]);
    expect(await all('SELECT badge_id FROM user_badges')).toEqual([{ badge_id: 'first-step' }]);
  });

  it('count thresholds: 20 cards on the 20th, 10 Mic turns on the 10th', async () => {
    for (let n = 1; n <= 20; n++) {
      const res = await award('card', `card:c${n}:${D1}`);
      expect(ids(res)).toEqual(n === 20 ? ['cards-20'] : []);
    }
    for (let n = 0; n < 10; n++) {
      const res = await award('maggie_turn', `mturn:S1:${n}`);
      expect(ids(res)).toEqual(n === 0 ? ['first-talk'] : n === 9 ? ['talk-10'] : []);
    }
  });

  it('streak-3 on the third consecutive day', async () => {
    expect(ids(await award('dub', 'dub:a', D1))).toEqual(['dub']);
    expect(ids(await award('song', 'song:1', D2))).toEqual(['song']);
    expect(ids(await award('extra', 'extra:x', D3))).toEqual(['cinema', 'streak-3']);
  });

  it('points and test badges with a level up', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('test_pass', 500)");
    const res = await award('test_pass', 'test_pass:1');
    expect(ids(res)).toEqual(['pts-500', 'test']);
    expect(res.levelUp).toEqual({ n: 4, name: 'Explorador' });
  });

  it('goal-5 after five goal days', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('dub', 60)");
    const got: string[][] = [];
    for (let d = 1; d <= 5; d++) got.push(ids(await award('dub', `dub:${d}`, `2026-10-0${d}`)));
    expect(got[4]).toContain('goal-5');
    expect(got.slice(0, 4).flat()).not.toContain('goal-5');
  });

  it('skips a badge whose rule is not valid JSON', async () => {
    await exec("UPDATE badges SET rule = '{bad' WHERE id = 'first-step'");
    expect(ids(await award('step', 'step:1:1'))).toEqual([]);
  });

  it('awards nothing while the badges table is empty, but the summary still lists the prototype badges', async () => {
    await exec('DELETE FROM badges');
    expect(ids(await award('step', 'step:1:1'))).toEqual([]);
    const s = await engine.summary('U1', { now: spNoon(D1) });
    expect(s.badges.map((b) => b.id)).toEqual(BADGES.map((b) => b.id));
    expect(s.badges.every((b) => !b.has)).toBe(true);
  });
});

describe('caps', () => {
  it('point_rules.daily_cap limits a kind per local day', async () => {
    await exec("INSERT INTO point_rules(kind, points, daily_cap, verifiable) VALUES('word', 3, 3, 0)");
    const got: boolean[] = [];
    for (const w of ['a', 'b', 'c', 'd']) got.push((await award('word', `word:${w}`, D1)).awarded);
    expect(got).toEqual([true, true, true, false]);
    // The capped key was not used up: it can land the next day.
    expect((await award('word', 'word:d', D2)).awarded).toBe(true);
  });

  it('missing rule rows fall back to the default soft caps', async () => {
    const cap = DEFAULT_DAILY_CAPS.word;
    let awarded = 0;
    for (let n = 0; n <= cap; n++) if ((await award('word', `word:w${n}`)).awarded) awarded++;
    expect(awarded).toBe(cap);
  });

  it('a rule row with daily_cap NULL is uncapped', async () => {
    await exec("INSERT INTO point_rules(kind, points, daily_cap) VALUES('word', 3, NULL)");
    let awarded = 0;
    for (let n = 0; n <= DEFAULT_DAILY_CAPS.word; n++) if ((await award('word', `word:w${n}`)).awarded) awarded++;
    expect(awarded).toBe(DEFAULT_DAILY_CAPS.word + 1);
  });

  it('a capped award does not move the streak', async () => {
    await exec("INSERT INTO point_rules(kind, points, daily_cap) VALUES('word', 3, 0)");
    expect((await award('word', 'word:a')).awarded).toBe(false);
    expect(await stats()).toMatchObject({ streak: 0, last_day: null });
  });

  it(`maggie_turn: at most ${MAGGIE_TURNS_PER_SESSION} per Mic session`, async () => {
    let awarded = 0;
    for (let n = 0; n <= MAGGIE_TURNS_PER_SESSION; n++) {
      if ((await award('maggie_turn', `mturn:S1:${n}`)).awarded) awarded++;
    }
    expect(awarded).toBe(MAGGIE_TURNS_PER_SESSION);
    expect((await award('maggie_turn', 'mturn:S10:0')).awarded).toBe(true);
    expect((await award('maggie_turn', `mturn:S1:${MAGGIE_TURNS_PER_SESSION + 5}`, D2)).awarded).toBe(false);
  });
});

describe('levels', () => {
  it('reports a level up from the levels table when it has rows', async () => {
    await exec("INSERT INTO levels(n, min_points, name) VALUES(1, 0, 'Zero'), (2, 20, 'Vinte')");
    const res = await award('step', 'step:1:1'); // 25
    expect(res.levelUp).toEqual({ n: 2, name: 'Vinte' });
    expect((await engine.summary('U1', { now: spNoon(D1) })).level).toMatchObject({ n: 2, name: 'Vinte', next: null });
  });

  it('defaults to the prototype LEVELS', async () => {
    await exec("INSERT INTO point_rules(kind, points) VALUES('dub', 100)");
    expect((await award('dub', 'dub:a')).levelUp).toEqual({ n: 2, name: 'Curioso' });
  });
});

describe('summary', () => {
  it('fresh account matches the prototype summary() shape', async () => {
    const s = await engine.summary('U1', { now: spNoon(D1) });
    expect(GameSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      points: 0,
      level: { n: 1, name: 'Iniciante', from: 0, next: 100, pct: 0 },
      streak: 1,
      goal: { target: 50, done: 0, pct: 0, hit: false },
      daily: { points: 0, steps: 0, cards: 0, maggieSec: 0, extras: 0, mic: 0, goal: false, missions: {} },
    });
    expect(s.missions.map((m) => m.k)).toEqual(['step', 'extra', 'maggie']);
    expect(s.missions[0]).toEqual({ k: 'step', t: 'Fazer 1 etapa do episódio', go: 'episodio/1', done: false });
    expect(s.missions[2]?.t).toBe('2 minutos com a Maggie');
    expect(s.badges).toHaveLength(14);
  });

  it('reflects awards, badges and missions', async () => {
    await seedBadges();
    await award('step', 'step:1:1');
    const s = await engine.summary('U1', { now: spNoon(D1) });
    expect(s).toMatchObject({ points: 25, streak: 1, goal: { target: 50, done: 25, pct: 50, hit: false } });
    expect(s.daily).toMatchObject({ steps: 1, points: 25, missions: { step: true } });
    expect(s.missions.find((m) => m.k === 'step')?.done).toBe(true);
    expect(s.badges.filter((b) => b.has).map((b) => b.id)).toEqual(['first-step']);
  });

  it('shows the streak while it is alive and 1 once it broke', async () => {
    await award('step', 'step:1:1', D1);
    await award('step', 'step:1:2', D2);
    expect((await engine.summary('U1', { now: spNoon(D2) })).streak).toBe(2);
    expect((await engine.summary('U1', { now: spNoon(D3) })).streak).toBe(2);
    expect((await engine.summary('U1', { now: spNoon('2026-10-04') })).streak).toBe(1);
  });

  it("reads today's counters in the user's timezone", async () => {
    await reset({ tz: 'Asia/Tokyo' });
    await engine.award('U1', 'step', 'step:1:1', { now: Date.parse('2026-10-01T16:00:00Z') }); // Tokyo Oct 2
    const tokyo = await engine.summary('U1', { now: Date.parse('2026-10-01T17:00:00Z') });
    expect(tokyo.goal.done).toBe(25);
    const sp = await engine.summary('U1', { now: Date.parse('2026-10-01T17:00:00Z'), tz: 'America/Sao_Paulo' });
    expect(sp.goal.done).toBe(0);
  });

  it('points the step mission at the current episode and names the chosen assistant', async () => {
    await seedEpisodes([1, 2, 5]);
    await exec(
      "INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES('U1', 1, 10, 1, 1)",
    );
    await exec(
      `INSERT INTO assistants(key, name, full_name, art, aka, voice, tts_speaker, persona, sort)
       VALUES('margaret', 'Maggie', 'Margaret', 'a', '[]', '{}', 'asteria', '', 1),
             ('robert', 'Robert', 'Robert', 'o', '[]', '{}', 'orion', '', 2)`,
    );
    await exec("UPDATE profiles SET assistant_key = 'robert' WHERE user_id = 'U1'");
    const s = await engine.summary('U1', { now: spNoon(D1) });
    expect(s.missions[0]?.go).toBe('episodio/2');
    expect(s.missions[2]?.t).toBe('2 minutos com o Robert');
  });
});
