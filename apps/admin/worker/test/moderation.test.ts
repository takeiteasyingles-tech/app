// Moderation queue and decisions: photo removal hides the photo and clears the profile, transcript
// removal redacts the turn, decisions are final and audited.
import { adminApi, buildPath } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, auditRows, exec, ins, learner, one, resetDb, staff } from './helpers';

const Q = adminApi.moderation;
const decide = (id: string) => buildPath(Q.decide.path, { id });

describe('moderation', () => {
  let moderator: Account;
  let student: { id: string };

  beforeEach(async () => {
    await resetDb();
    moderator = await staff(['moderator']);
    student = await learner();
    await ins('uploads', {
      id: 'up1',
      user_id: student.id,
      kind: 'photo',
      r2_key: `users/${student.id}/photo-up1.png`,
      mime: 'image/png',
      bytes: 10,
      sha256: 'x',
      created_at: 1,
    });
    await ins('moderation_items', {
      id: 'mod-photo',
      kind: 'photo',
      subject_user_id: student.id,
      ref_type: 'upload',
      ref_id: 'up1',
      reason: 'new_profile_photo',
      priority: 1,
      created_at: 100,
    });
    await ins('mic_sessions', {
      id: 'ms1',
      user_id: student.id,
      assistant_key: 'margaret',
      mode: 'livre',
      started_at: 1,
      billed_until: 1,
      flagged: 1,
      report: '{"summary_pt":"x"}',
    });
    await ins('mic_turns', { session_id: 'ms1', idx: 0, who: 'her', en: 'Hi!', created_at: 1 });
    await ins('mic_turns', {
      session_id: 'ms1',
      idx: 1,
      who: 'me',
      en: 'something nasty',
      pt: 'algo',
      words: '[]',
      created_at: 2,
    });
    await ins('moderation_items', {
      id: 'mod-turn',
      kind: 'transcript',
      subject_user_id: student.id,
      ref_type: 'mic_turn',
      ref_id: 'ms1:1',
      reason: 'llama_guard',
      guard_categories: '["S10"]',
      excerpt: 'something nasty',
      priority: 2,
      created_at: 200,
    });
  });

  it('lists the open queue by priority, oldest first, with the photo preview URL', async () => {
    const r = await moderator.client.json(Q.list.path);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual(['mod-turn', 'mod-photo']);
    expect(r.body.items[0].guardCategories).toEqual(['S10']);
    expect(r.body.items[1].mediaUrl).toBe(`/m/users/${student.id}/photo-up1.png`);
    const p1 = await moderator.client.json(`${Q.list.path}?limit=1`);
    const p2 = await moderator.client.json(`${Q.list.path}?limit=1&cursor=${p1.body.nextCursor}`);
    expect([p1.body.items[0].id, p2.body.items[0].id]).toEqual(['mod-turn', 'mod-photo']);
    expect((await moderator.client.json(`${Q.list.path}?kind=photo`)).body.items).toHaveLength(1);
  });

  it('audits every queue page that carries transcript excerpts', async () => {
    const since = Date.now();
    await moderator.client.json(Q.list.path);
    // A page with no excerpt (photos only) is not a transcript read.
    await moderator.client.json(`${Q.list.path}?kind=photo`);
    const rows = await auditRows('moderation.excerpts_read', since);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_user_id).toBe(moderator.id);
    expect(JSON.parse(rows[0]?.diff ?? '{}').items).toEqual([
      { id: 'mod-turn', subjectUserId: student.id, ref: 'ms1:1' },
    ]);
  });

  it('removing a photo hides the upload and clears profile.photo_upload', async () => {
    await exec("UPDATE profiles SET photo_upload = 'up1' WHERE user_id = ?", student.id);
    const since = Date.now();
    const r = await moderator.client.json(decide('mod-photo'), { json: { decision: 'removed', notes: 'nudez' } });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ status: 'removed', reviewedBy: moderator.id, notes: 'nudez' });
    expect(await one('SELECT status FROM uploads WHERE id = ?', 'up1')).toEqual({ status: 'removed' });
    expect(await one('SELECT photo_upload FROM profiles WHERE user_id = ?', student.id)).toEqual({
      photo_upload: null,
    });
    const [audit] = await auditRows('moderation.decide', since);
    expect(audit?.actor_user_id).toBe(moderator.id);
    expect(JSON.parse(audit?.diff ?? '{}')).toMatchObject({
      status: { from: 'pending', to: 'removed' },
      effects: ['upload_removed', 'profile_photo_cleared'],
    });
    // Final: a second decision conflicts and changes nothing.
    const again = await moderator.client.json(decide('mod-photo'), { json: { decision: 'approved' } });
    expect(again.status).toBe(409);
    expect(await auditRows('moderation.decide', since)).toHaveLength(1);
  });

  it('removing a transcript redacts the turn; approving leaves it', async () => {
    const r = await moderator.client.json(decide('mod-turn'), { json: { decision: 'removed' } });
    expect(r.body.item.status).toBe('removed');
    const turn = await one<{ en: string; pt: string | null; words: string | null }>(
      "SELECT en, pt, words FROM mic_turns WHERE session_id = 'ms1' AND idx = 1",
    );
    expect(turn).toEqual({ en: '[mensagem removida pela moderação]', pt: null, words: null });
    expect(await one("SELECT en FROM mic_turns WHERE session_id = 'ms1' AND idx = 0")).toEqual({ en: 'Hi!' });

    await ins('moderation_items', {
      id: 'mod-2',
      kind: 'photo',
      subject_user_id: student.id,
      ref_type: 'upload',
      ref_id: 'up1',
      created_at: 300,
    });
    expect((await moderator.client.json(decide('mod-2'), { json: { decision: 'approved' } })).body.item.status).toBe(
      'approved',
    );
    expect(await one('SELECT status FROM uploads WHERE id = ?', 'up1')).toEqual({ status: 'active' });
  });

  it('removing a reported session redacts every turn and drops its report', async () => {
    await ins('moderation_items', {
      id: 'mod-rep',
      kind: 'report',
      subject_user_id: student.id,
      reporter_user_id: student.id,
      ref_type: 'mic_session',
      ref_id: 'ms1',
      reason: 'ofensivo',
      created_at: 5,
    });
    await moderator.client.json(decide('mod-rep'), { json: { decision: 'removed' } });
    expect(
      await one(
        "SELECT COUNT(*) AS n FROM mic_turns WHERE session_id = 'ms1' AND en <> '[mensagem removida pela moderação]'",
      ),
    ).toEqual({ n: 0 });
    expect(await one("SELECT report FROM mic_sessions WHERE id = 'ms1'")).toEqual({ report: null });
  });

  it('validates the decision', async () => {
    expect((await moderator.client.send(decide('mod-turn'), { json: { decision: 'pending' } })).status).toBe(400);
    expect((await moderator.client.send(decide('nope'), { json: { decision: 'approved' } })).status).toBe(404);
    const decided = await moderator.client.json(`${Q.list.path}?status=removed`);
    expect(decided.body.items).toEqual([]);
  });
});
