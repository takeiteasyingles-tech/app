// Feature C (spec 07): episode ratings (list with filters and pages, NPS summary) and the learning
// statistics (one learner, the course funnel), with their permissions.
import { adminFeedbackApi, adminStatsApi, buildPath, feedbackStats, newId } from '@tie/shared';
import { addDays, DAY, localDate } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, ins, learner, resetDb, staff } from './helpers';

const F = adminFeedbackApi;
const S = adminStatsApi;
const NOW = Date.now();
const TZ = 'America/Sao_Paulo';

async function seedCourse(): Promise<void> {
  await ins('seasons', { n: 1, title: 'Arrival', synopsis: null });
  await ins('ebooks', { num: 1, title: 'Nice to Meet You', pass_score: 14, updated_at: NOW });
  await ins('ebooks', { num: 2, title: 'Not yet', pass_score: 14, updated_at: NOW });
  await ins('episodes', {
    num: 1,
    title: 'Good Morning',
    season_n: 1,
    status: 'published',
    ebook_num: 1,
    updated_at: NOW,
  });
  await ins('episodes', { num: 2, title: 'Family', season_n: 1, status: 'published', ebook_num: 1, updated_at: NOW });
  await ins('episodes', { num: 3, title: 'Draft one', season_n: 1, status: 'draft', ebook_num: 2, updated_at: NOW });
}

async function rate(userId: string, ep: number, stars: number, comment: string | null, at: number) {
  await ins('lesson_feedback', {
    id: newId(),
    user_id: userId,
    episode_num: ep,
    stars,
    comment,
    created_at: at,
    updated_at: at,
  });
}

async function progress(userId: string, ep: number, step: number, done: boolean) {
  await ins('episode_progress', {
    user_id: userId,
    episode_num: ep,
    furthest_step: step,
    done_at: done ? NOW : null,
    updated_at: NOW,
  });
}

describe('feedback list and summary', () => {
  let editor: Account;
  let moderator: Account;
  let ana: { id: string; email: string };
  let bia: { id: string; email: string };

  beforeEach(async () => {
    await resetDb();
    await seedCourse();
    editor = await staff(['editor']);
    moderator = await staff(['moderator']);
    ana = await learner({ name: 'Ana' });
    bia = await learner({ name: 'Bia' });
    const cara = await learner({ name: 'Cara' });
    await rate(ana.id, 1, 5, 'Adorei 100% do episódio', NOW - 5 * DAY);
    await rate(bia.id, 1, 2, null, NOW - 3 * DAY);
    await rate(cara.id, 1, 4, 'Bom, mas rápido demais', NOW - 2 * DAY);
    await rate(ana.id, 2, 3, 'ok', NOW - DAY);
    await rate(bia.id, 2, 5, null, NOW);
  });

  it('lists newest first with the display name (never the e-mail), and pages with a cursor', async () => {
    const r = await editor.client.json(`${F.list.path}?limit=2`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toMatchObject({ userId: bia.id, userName: 'Bia', episodeNum: 2, episodeTitle: 'Family' });
    expect(JSON.stringify(r.body)).not.toContain(ana.email);
    const seen = r.body.items.map((i: { id: string }) => i.id);
    let cursor: string | null = r.body.nextCursor;
    while (cursor) {
      const page = await editor.client.json(`${F.list.path}?limit=2&cursor=${cursor}`);
      seen.push(...page.body.items.map((i: { id: string }) => i.id));
      cursor = page.body.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    expect((await editor.client.send(`${F.list.path}?cursor=bad!`)).status).toBe(400);
  });

  it('filters by episode, stars, star range, comment, text and date range', async () => {
    const count = async (qs: string) => (await moderator.client.json(`${F.list.path}?${qs}`)).body.items.length;
    expect(await count('episode=1')).toBe(3);
    expect(await count('stars=5')).toBe(2);
    expect(await count('minStars=3&maxStars=4')).toBe(2);
    expect(await count('hasComment=1')).toBe(3);
    expect(await count('hasComment=false')).toBe(2);
    expect(await count('q=BOM%2C%20MAS')).toBe(1);
    // LIKE wildcards are literal.
    expect(await count('q=100%25')).toBe(1);
    expect(await count('q=_')).toBe(0);
    expect(await count(`from=${NOW - 2.5 * DAY}`)).toBe(3);
    expect(await count(`from=${NOW - 4 * DAY}&to=${NOW - 1.5 * DAY}`)).toBe(2);
    expect((await moderator.client.send(`${F.list.path}?stars=6`)).status).toBe(400);
  });

  it('summarizes per episode with the shared NPS formula', async () => {
    const r = await editor.client.json(F.summary.path);
    expect(r.status).toBe(200);
    expect(r.body.overall).toEqual({ ...feedbackStats([0, 1, 1, 1, 2]), dist: [0, 1, 1, 1, 2], comments: 3 });
    expect(r.body.overall.nps).toBe(20); // (2 promoters − 1 detractor) / 5
    expect(r.body.episodes.map((e: { episodeNum: number }) => e.episodeNum)).toEqual([1, 2]);
    expect(r.body.episodes[0]).toEqual({
      episodeNum: 1,
      title: 'Good Morning',
      count: 3,
      avg: 3.67,
      dist: [0, 1, 0, 1, 1],
      nps: 0,
      comments: 2,
    });
    const recent = await editor.client.json(`${F.summary.path}?from=${NOW - 1.5 * DAY}`);
    expect(recent.body.overall.count).toBe(2);
    expect(recent.body.episodes.map((e: { episodeNum: number }) => e.episodeNum)).toEqual([2]);
  });

  it('answers an empty summary with null averages', async () => {
    await resetDb();
    const a = await staff(['admin']);
    const r = await a.client.json(F.summary.path);
    expect(r.body).toEqual({
      overall: { count: 0, avg: null, dist: [0, 0, 0, 0, 0], nps: null, comments: 0 },
      episodes: [],
    });
  });
});

describe('learning statistics', () => {
  let admin: Account;
  let editor: Account;

  beforeEach(async () => {
    await resetDb();
    await seedCourse();
    admin = await staff(['admin']);
    editor = await staff(['editor']);
  });

  it('needs users.read: editors are refused, moderators read', async () => {
    const u = await learner();
    expect((await editor.client.send(buildPath(S.user.path, { id: u.id }))).status).toBe(403);
    expect((await editor.client.send(S.learning.path)).status).toBe(403);
    const moderator = await staff(['moderator']);
    expect((await moderator.client.send(buildPath(S.user.path, { id: u.id }))).status).toBe(200);
    expect((await moderator.client.send(S.learning.path)).status).toBe(200);
    expect((await moderator.client.send(buildPath(S.user.path, { id: 'nao-existe' }))).status).toBe(404);
  });

  it("returns one learner's progress, tests, certificates, study time and ratings", async () => {
    const u = await learner({ name: 'Ana' });
    await progress(u.id, 1, 10, true);
    await progress(u.id, 2, 4, false);
    await ins('ebook_test_results', { user_id: u.id, ebook_num: 1, score: 15, passed: 1, submitted_at: NOW });
    await ins('season_test_results', {
      user_id: u.id,
      season_n: 1,
      score: 18,
      total: 20,
      score_pct: 90,
      passed: 1,
      best_pct: 90,
      attempts: 2,
      submitted_at: NOW,
      passed_at: NOW,
    });
    await ins('certificates', {
      id: 'cert-1',
      code: 'TIE-ABCD-EFGH',
      user_id: u.id,
      season_n: 1,
      full_name_snapshot: 'Ana Souza',
      season_title_snapshot: 'Arrival',
      score_pct: 90,
      issued_at: NOW,
    });
    const today = localDate(NOW, TZ);
    const day = (date: string, extra: Record<string, unknown>) =>
      ins('daily_stats', { user_id: u.id, local_date: date, ...extra });
    await day(today, { points: 40, steps: 3, maggie_sec: 120, goal_hit: 1 });
    await day(addDays(today, -29), { points: 10, maggie_sec: 30 });
    await day(addDays(today, -30), { points: 99, maggie_sec: 600, goal_hit: 1 }); // outside the 30 days
    await ins('srs_cards', {
      id: newId(),
      user_id: u.id,
      norm_key: 'door',
      en: 'door',
      pt: 'porta',
      source: 'visual',
      due_at: NOW,
      created_at: NOW,
    });
    await rate(u.id, 1, 4, 'Legal', NOW);

    const r = await admin.client.json(buildPath(S.user.path, { id: u.id }));
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.userId).toBe(u.id);
    expect(s.episodes).toEqual([
      { num: 1, title: 'Good Morning', seasonN: 1, furthestStep: 10, done: true, doneAt: NOW, updatedAt: NOW },
      { num: 2, title: 'Family', seasonN: 1, furthestStep: 4, done: false, doneAt: null, updatedAt: NOW },
    ]);
    expect(s.ebookTests).toEqual([{ ebookNum: 1, score: 15, passScore: 14, passed: true, submittedAt: NOW }]);
    expect(s.seasonTests[0]).toMatchObject({ seasonN: 1, scorePct: 90, attempts: 2, passed: true });
    expect(s.certificates).toEqual([
      { id: 'cert-1', code: 'TIE-ABCD-EFGH', seasonN: 1, scorePct: 90, issuedAt: NOW, revokedAt: null },
    ]);
    expect(s.study).toEqual({
      points: 120,
      streak: 2,
      lastDay: null,
      maggieSecTotal: 750,
      maggieSec30d: 150,
      activeDays30d: 2,
      goalDays: 2,
      srsCards: 1,
    });
    expect(s.last30).toHaveLength(30);
    expect(s.last30[0]).toMatchObject({ date: addDays(today, -29), points: 10 });
    expect(s.last30[29]).toEqual({
      date: today,
      points: 40,
      steps: 3,
      cards: 0,
      mic: 0,
      extras: 0,
      maggieSec: 120,
      goal: true,
    });
    expect(s.last30.filter((d: { points: number }) => d.points === 0)).toHaveLength(28);
    expect(s.feedback).toEqual([{ episodeNum: 1, stars: 4, comment: 'Legal', updatedAt: NOW }]);
  });

  it('builds the funnel over published episodes, without staff accounts', async () => {
    const a = await learner();
    const b = await learner();
    const c = await learner();
    await progress(a.id, 1, 10, true);
    await progress(b.id, 1, 10, true);
    await progress(c.id, 1, 6, false);
    await progress(a.id, 2, 3, false);
    await progress(editor.id, 1, 10, true); // staff: left out
    await rate(a.id, 1, 5, null, NOW);
    await rate(b.id, 1, 1, null, NOW);
    await rate(editor.id, 1, 1, null, NOW); // staff: left out
    await ins('ebook_test_results', { user_id: a.id, ebook_num: 1, score: 15, passed: 1, submitted_at: NOW });
    await ins('ebook_test_results', { user_id: b.id, ebook_num: 1, score: 9, passed: 0, submitted_at: NOW });
    await ins('ebook_test_results', { user_id: c.id, ebook_num: 1, score: 0, passed: 0, submitted_at: 0 }); // redo
    const result = (userId: string, passedAt: number | null, attempts: number) =>
      ins('season_test_results', {
        user_id: userId,
        season_n: 1,
        score: 10,
        total: 20,
        score_pct: 50,
        passed: passedAt ? 1 : 0,
        best_pct: 50,
        attempts,
        submitted_at: NOW,
        passed_at: passedAt,
      });
    await result(a.id, NOW, 1);
    await result(b.id, null, 2);
    const today = localDate(NOW, TZ);
    for (const u of [a, b]) await ins('daily_stats', { user_id: u.id, local_date: today, points: 10 });
    await ins('daily_stats', { user_id: c.id, local_date: addDays(today, -6), points: 10 });
    await ins('daily_stats', { user_id: editor.id, local_date: today, points: 10 }); // staff

    const r = await admin.client.json(S.learning.path);
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.days).toBe(30);
    expect(s.episodes).toEqual([
      {
        num: 1,
        title: 'Good Morning',
        seasonN: 1,
        started: 3,
        completed: 2,
        completionPct: 67,
        ratings: 2,
        avgStars: 3,
        nps: 0,
      },
      {
        num: 2,
        title: 'Family',
        seasonN: 1,
        started: 1,
        completed: 0,
        completionPct: 0,
        ratings: 0,
        avgStars: null,
        nps: null,
      },
    ]);
    // E-book 2 has no published episode yet.
    expect(s.ebookTests).toEqual([{ ebookNum: 1, takers: 2, passed: 1, passPct: 50 }]);
    expect(s.seasonTests).toEqual([
      { seasonN: 1, published: false, takers: 2, passed: 1, passPct: 50, avgAttempts: 1.5, certificates: 0 },
    ]);
    expect(s.activeByDay).toHaveLength(30);
    expect(s.activeByDay[29]).toEqual({ date: today, learners: 2 });
    expect(s.activeByDay[23]).toEqual({ date: addDays(today, -6), learners: 1 });

    const week = await admin.client.json(`${S.learning.path}?days=7`);
    expect(week.body.activeByDay).toHaveLength(7);
    expect(week.body.activeByDay[0]).toEqual({ date: addDays(today, -6), learners: 1 });
    expect((await admin.client.send(`${S.learning.path}?days=5`)).status).toBe(400);
  });
});
