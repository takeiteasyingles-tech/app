/// <reference types="@cloudflare/vitest-plugin/types" />
import { appApi, MeExport, PhotoRes, type SettingsRes, TieState } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, Client, exec, one, photoForm, pngBytes, resetDb, signup, testEnv } from './helpers';

const M = appApi.me;
const NOW = Date.now();

beforeEach(resetDb);

/** Progress rows that need no content tables (no FK to episodes/phrases/items). */
async function seedProgress(uid: string, tag: string): Promise<void> {
  await exec(
    `INSERT INTO srs_cards(id, user_id, norm_key, en, pt, scene, note, source, due_at, reps, created_at)
     VALUES(?, ?, ?, ?, 'oi', 'Ep. 1', '', 'manual', ?, 0, ?)`,
    `card-${tag}`,
    uid,
    `hello ${tag}`,
    `Hello ${tag}`,
    NOW - 1000,
    NOW,
  );
  await exec('INSERT INTO step_completions(user_id, episode_num, step, completed_at) VALUES(?, 1, 1, ?)', uid, NOW);
  await exec(
    `INSERT INTO point_ledger(user_id, award_key, kind, points, local_date, created_at)
     VALUES(?, ?, 'step', 10, ?, ?)`,
    uid,
    `step:1:1:${tag}`,
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(NOW),
    NOW,
  );
  await exec(
    `INSERT INTO mic_sessions(id, user_id, assistant_key, mode, started_at, billed_until, secs, status, report, report_source)
     VALUES(?, ?, 'margaret', 'livre', ?, ?, 95, 'ended', ?, 'demo')`,
    `ms-${tag}`,
    uid,
    NOW - 5000,
    NOW - 5000,
    JSON.stringify({
      summary_pt: `Resumo ${tag}`,
      strengths: ['a'],
      fixes: [],
      pron: [],
      words: [],
      next_goal_pt: 'x',
    }),
  );
  await exec(
    `INSERT INTO mic_turns(session_id, idx, who, en, pt, created_at) VALUES(?, 0, 'her', 'Hi!', 'Oi!', ?),
     (?, 1, 'me', 'Hello', NULL, ?), (?, 2, 'coach', 'tip', NULL, ?)`,
    `ms-${tag}`,
    NOW,
    `ms-${tag}`,
    NOW,
    `ms-${tag}`,
    NOW,
  );
  await exec(
    'INSERT INTO ai_usage_monthly(user_id, period, seconds_used) VALUES(?, ?, 600)',
    uid,
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(NOW).slice(0, 7),
  );
}

describe('IDOR', () => {
  it('state, summary and export only ever contain the session user', async () => {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    await seedProgress(a.id, 'A');
    await seedProgress(b.id, 'B');

    const sa = TieState.parse((await a.client.json(`${M.state.path}?user=${b.id}&userId=${b.id}`)).body);
    expect(sa.user?.id).toBe(a.id);
    expect(sa.deck.map((d) => d.id)).toEqual(['card-A']);
    expect(sa.due).toBe(1);
    expect(sa.stepOk).toEqual({ '1-1': true });
    expect(sa.game.points).toBe(10);
    expect(sa.game.log).toHaveLength(1);
    expect(sa.maggie.sessions.map((s) => s.id)).toEqual(['ms-A']);
    expect(sa.maggie.sessions[0]?.turns.map((t) => t.who)).toEqual(['her', 'me']);
    expect(sa.maggie.sessions[0]?.report?.summary_pt).toBe('Resumo A');
    expect(sa.maggie.secLeft).toBe(3000);

    const ex = MeExport.parse((await a.client.json(M.export.path, { headers: { 'X-User-Id': b.id } })).body);
    expect(ex.user.id).toBe(a.id);
    expect(ex.user).not.toHaveProperty('pass_hash');
    const dump = JSON.stringify(ex);
    expect(dump).not.toContain(b.id);
    expect(dump).not.toContain('card-B');
    expect(ex.tables.srs_cards).toHaveLength(1);
    expect(ex.tables.mic_turns).toHaveLength(3);

    // Without a session nothing is readable.
    expect((await new Client().json(M.state.path)).status).toBe(401);
    // A forged or foreign-shaped cookie is not a session.
    const forged = new Client();
    forged.cookies.set('tie_s', b.id);
    expect((await forged.json(M.state.path)).status).toBe(401);
  });

  it('state lists only finished Mic sessions (an abandoned open call is not history)', async () => {
    const a = await signup('open@example.com');
    await seedProgress(a.id, 'A');
    await exec(
      `INSERT INTO mic_sessions(id, user_id, assistant_key, mode, started_at, billed_until, status)
       VALUES('ms-open', ?, 'margaret', 'missao', ?, ?, 'open')`,
      a.id,
      NOW,
      NOW,
    );
    await exec(
      `INSERT INTO mic_turns(session_id, idx, who, en, pt, created_at) VALUES('ms-open', 0, 'her', 'Hi!', 'Oi!', ?)`,
      NOW,
    );
    const sa = TieState.parse((await a.client.json(M.state.path)).body);
    expect(sa.maggie.sessions.map((s) => s.id)).toEqual(['ms-A']);
    expect(sa.maggie.sessions[0]?.turns.map((t) => t.who)).toEqual(['her', 'me']);
  });

  it('reset-progress only clears the caller', async () => {
    const a = await signup('ra@example.com');
    const b = await signup('rb@example.com');
    await seedProgress(a.id, 'A');
    await seedProgress(b.id, 'B');
    const bad = await a.client.json(M.resetProgress.path, { json: {} });
    expect(bad.status).toBe(400);
    const r = await a.client.json(M.resetProgress.path, { json: { confirm: true } });
    expect(r.status).toBe(200);
    const sa = TieState.parse((await a.client.json(M.state.path)).body);
    expect(sa.deck).toEqual([]);
    expect(sa.game.points).toBe(0);
    expect(sa.maggie.sessions).toEqual([]);
    expect(sa.maggie.secLeft).toBe(3000); // quota is not refunded
    const sb = TieState.parse((await b.client.json(M.state.path)).body);
    expect(sb.deck).toHaveLength(1);
    expect(sb.game.points).toBe(10);
  });
});

describe('settings', () => {
  it('ignores free unless dev.free_steps is on for the user', async () => {
    const { client } = await signup('set@example.com');
    let r = await client.json<SettingsRes>(M.settings.path, {
      method: 'PATCH',
      json: { ts: 1.12, sound: false, free: true, phone: true },
    });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ ts: 1.12, sound: false, free: false, phone: false });
    const bad = await client.json(M.settings.path, { method: 'PATCH', json: { ts: 2 } });
    expect(bad.status).toBe(400);

    await exec("INSERT INTO feature_flags(key, enabled, rollout_pct, updated_at) VALUES('dev.free_steps', 1, 100, 0)");
    r = await client.json<SettingsRes>(M.settings.path, { method: 'PATCH', json: { free: true } });
    expect(r.body.settings.free).toBe(true);
    const st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.flags['dev.free_steps']).toBe(true);
    expect(st.settings).toMatchObject({ free: true, ts: 1.12, sound: false });
  });
});

describe('photo upload', () => {
  it('rejects non-images, empty and oversized files', async () => {
    const { client } = await signup('photo@example.com');
    const text = new TextEncoder().encode('definitely not an image, just text');
    const notImage = await client.json<{ error: { code: string } }>(M.photoUpload.path, {
      body: photoForm(text, 'image/png', 'fake.png'),
    });
    expect(notImage.status).toBe(415);
    expect(notImage.body.error.code).toBe('unsupported_media_type');

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);
    expect((await client.send(M.photoUpload.path, { body: photoForm(gif, 'image/gif', 'a.gif') })).status).toBe(415);

    const pdf = new TextEncoder().encode('%PDF-1.7 fake');
    expect((await client.send(M.photoUpload.path, { body: photoForm(pdf, 'image/jpeg', 'a.jpg') })).status).toBe(415);

    expect((await client.send(M.photoUpload.path, { body: photoForm(new Uint8Array(0)) })).status).toBe(400);

    // Rejected attempts count toward RL_UPLOAD (5/60s per user), so continue as a second user.
    const { client: other } = await signup('photo2@example.com');
    const huge = pngBytes(256, 256, 2 * 1024 * 1024);
    expect((await other.send(M.photoUpload.path, { body: photoForm(huge) })).status).toBe(413);

    const wide = pngBytes(2048, 64);
    expect((await other.send(M.photoUpload.path, { body: photoForm(wide) })).status).toBe(413);

    const noField = new FormData();
    noField.append('other', 'x');
    expect((await other.send(M.photoUpload.path, { body: noField })).status).toBe(400);

    expect(await all('SELECT id FROM uploads')).toEqual([]);
    expect((await testEnv.MEDIA.list()).objects).toEqual([]);
  });

  it('stores a valid photo, queues it for moderation, replaces and deletes it', async () => {
    const { client, id } = await signup('pic@example.com');
    const up = await client.json<PhotoRes>(M.photoUpload.path, { body: photoForm(pngBytes(256, 256)) });
    expect(up.status).toBe(201);
    PhotoRes.parse(up.body);
    expect(up.body.status).toBe('pending');
    expect(up.body.photo).toMatch(new RegExp(`^/m/users/${id}/photo-[0-9A-Z]{26}\\.png$`));
    const key = up.body.photo.slice(3);
    const obj = await testEnv.MEDIA.head(key);
    expect(obj?.httpMetadata?.contentType).toBe('image/png');

    const upload = await one<{ id: string; status: string }>('SELECT id, status FROM uploads WHERE user_id = ?', id);
    expect(upload?.status).toBe('active');
    expect(
      await one('SELECT kind, status, subject_user_id FROM moderation_items WHERE ref_id = ?', upload?.id),
    ).toEqual({
      kind: 'photo',
      status: 'pending',
      subject_user_id: id,
    });
    await client.json(appApi.me.profileComplete.path, { method: 'POST' });
    let st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.profile?.photo).toBe(up.body.photo);

    // Replacing retires the old upload and its R2 object.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 200,
      1, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9,
    ]);
    const up2 = await client.json<PhotoRes>(M.photoUpload.path, { body: photoForm(jpeg, 'image/jpeg', 'me.jpg') });
    expect(up2.status).toBe(201);
    expect(up2.body.photo).toMatch(/\.jpg$/);
    expect(await testEnv.MEDIA.head(key)).toBeNull();
    expect(await one('SELECT status FROM uploads WHERE id = ?', upload?.id)).toEqual({ status: 'removed' });
    expect(await one('SELECT status FROM moderation_items WHERE ref_id = ?', upload?.id)).toEqual({
      status: 'dismissed',
    });

    const del = await client.json(M.photoDelete.path, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await testEnv.MEDIA.head(up2.body.photo.slice(3))).toBeNull();
    st = TieState.parse((await client.json(M.state.path)).body);
    expect(st.profile?.photo).toBeNull();
  });

  it('rate limits uploads per user', async () => {
    const { client } = await signup('burst@example.com');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push((await client.send(M.photoUpload.path, { body: photoForm(pngBytes(8, 8)) })).status);
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes[5]).toBe(429);
  });
});

describe('delete account', () => {
  it('requires the password, then removes every row and R2 object', async () => {
    const { client, id } = await signup('bye@example.com');
    await seedProgress(id, 'Z');
    const up = await client.json<PhotoRes>(M.photoUpload.path, { body: photoForm(pngBytes(64, 64)) });
    await testEnv.MEDIA.put(`users/${id}/orphan.bin`, 'x');

    const wrong = await client.json<{ error: { code: string } }>(M.deleteAccount.path, {
      method: 'DELETE',
      json: { password: 'wrong', confirm: true },
    });
    expect(wrong.body.error.code).toBe('invalid_credentials');

    const r = await client.json(M.deleteAccount.path, {
      method: 'DELETE',
      json: { password: 'segredo123', confirm: true },
    });
    expect(r.status).toBe(200);
    expect(client.cookies.has('tie_s')).toBe(false);
    for (const table of ['users', 'profiles', 'sessions', 'srs_cards', 'uploads', 'mic_sessions', 'point_ledger']) {
      const col = table === 'users' ? 'id' : 'user_id';
      expect(await all(`SELECT 1 FROM ${table} WHERE ${col} = ?`, id)).toEqual([]);
    }
    expect(await all('SELECT 1 FROM mic_turns WHERE session_id = ?', 'ms-Z')).toEqual([]);
    expect(await all('SELECT 1 FROM moderation_items WHERE subject_user_id = ?', id)).toEqual([]);
    expect((await testEnv.MEDIA.list({ prefix: `users/${id}/` })).objects).toEqual([]);
    expect(await testEnv.MEDIA.head(up.body.photo.slice(3))).toBeNull();
    expect(
      await one("SELECT action FROM audit_log WHERE action = 'me.delete_account' AND target_id = ?", id),
    ).not.toBeNull();
    expect((await client.json(M.state.path)).status).toBe(401);
  });

  it('refuses staff accounts', async () => {
    const { client, id } = await signup('staff@example.com');
    await exec("INSERT INTO user_roles(user_id, role, granted_at) VALUES(?, 'editor', 0)", id);
    const r = await client.json<{ error: { code: string } }>(M.deleteAccount.path, {
      method: 'DELETE',
      json: { password: 'segredo123', confirm: true },
    });
    expect(r.status).toBe(403);
    expect(await one('SELECT id FROM users WHERE id = ?', id)).not.toBeNull();
  });
});
