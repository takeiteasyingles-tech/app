// Operação → Backup: manual and agent backups (full and content), download, restore of the course
// content without touching learner data (upsert, guarded deletes, pre-restore undo point), the
// automatic schedule (slot, once per slot, pruning) and delete.
import { adminApi, BACKUP_R2_PREFIX, buildPath } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextAutoAt, runScheduledBackup } from '../src/lib/backups';
import { type Account, all, auditRows, exec, ins, learner, one, resetDb, seedContent, staff, testEnv } from './helpers';

const B = adminApi.backups;

async function make(by: Account, scope: 'full' | 'content', note?: string) {
  const res = await by.client.json(B.create.path, { json: { scope, ...(note ? { note } : {}) } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.item as { id: string; rows: number; tables: number; scope: string; status: string; kind: string };
}

async function unzip(res: Response): Promise<{ format: string; scope: string; tables: Record<string, unknown> }> {
  const body = res.body as ReadableStream;
  return JSON.parse(await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text());
}

describe('backups', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    admin = await staff(['admin']);
  });

  it('makes full and content backups, lists and downloads them', async () => {
    const since = Date.now();
    const full = await make(admin, 'full', 'Antes da temporada 2');
    expect(full).toMatchObject({ scope: 'full', status: 'ok', kind: 'manual' });
    expect(full.rows).toBeGreaterThan(10);
    const content = await make(admin, 'content');
    expect(content.tables).toBeLessThan(full.tables);
    expect(await testEnv.MEDIA.head(`${BACKUP_R2_PREFIX}${full.id}.json.gz`)).not.toBeNull();

    const list = await admin.client.json(B.list.path);
    expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([content.id, full.id]);
    expect(list.body.config).toMatchObject({ frequency: 'daily', scope: 'full' });
    expect(list.body.nextAutoAt).toBeGreaterThan(Date.now());

    const dl = await admin.client.send(buildPath(B.download.path, { id: full.id }));
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Type')).toBe('application/gzip');
    expect(dl.headers.get('Content-Disposition')).toMatch(/attachment; filename="tie-backup-full-.*\.json\.gz"/);
    const file = await unzip(dl);
    expect(file.format).toBe('tie-backup');
    expect(Object.keys(file.tables)).toContain('users');
    expect(Object.keys(file.tables)).toContain('episodes');
    expect(Object.keys(file.tables)).not.toContain('sessions');
    expect(Object.keys(file.tables)).not.toContain('backups');

    const cfile = await unzip(await admin.client.send(buildPath(B.download.path, { id: content.id })));
    expect(Object.keys(cfile.tables)).toContain('season_test_questions');
    expect(Object.keys(cfile.tables)).not.toContain('users');

    const audits = await auditRows('backup.create', since);
    expect(audits).toHaveLength(2);
    expect(audits[0]?.actor_user_id).toBe(admin.id);
    // Editors and moderators have no access.
    const editor = await staff(['editor']);
    expect((await editor.client.send(B.list.path)).status).toBe(403);
  });

  it('restores the content into the draft without losing learner data', async () => {
    const ana = await learner();
    await ins('exercise_answers', {
      user_id: ana.id,
      item_id: 'e1-ex0-i0',
      choice_idx: 1,
      correct: 1,
      answered_at: Date.now(),
    });
    const backup = await make(admin, 'content');

    // After the backup: edits, deletions and new rows (one of them already answered by a learner).
    await exec("UPDATE episodes SET synopsis = 'Mudou' WHERE num = 1");
    await exec("DELETE FROM mic_phrases WHERE id = 'e1-mic-0'");
    await ins('episodes', { num: 3, title: 'Novo', season_n: 1, status: 'draft', updated_at: Date.now() });
    await ins('exercises', { id: 'e1-ex8', episode_num: 1, sort: 8, kind: 'escrito', title: 'Sem respostas' });
    await ins('exercise_items', {
      id: 'e1-ex8-i0',
      exercise_id: 'e1-ex8',
      sort: 0,
      q: 'Q',
      opts: ['a'],
      answer_idx: 0,
    });
    await ins('exercises', { id: 'e1-ex9', episode_num: 1, sort: 9, kind: 'escrito', title: 'Respondido' });
    await ins('exercise_items', {
      id: 'e1-ex9-i0',
      exercise_id: 'e1-ex9',
      sort: 0,
      q: 'Q',
      opts: ['a'],
      answer_idx: 0,
    });
    await ins('exercise_answers', {
      user_id: ana.id,
      item_id: 'e1-ex9-i0',
      choice_idx: 0,
      correct: 1,
      answered_at: Date.now(),
    });

    const since = Date.now();
    const res = await admin.client.json(buildPath(B.restore.path, { id: backup.id }), { json: { removeNew: true } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.result;
    expect(r.upserted).toBeGreaterThan(0);
    expect(r.removed).toBeGreaterThanOrEqual(3); // episode 3, e1-ex8 and its item
    expect(r.kept).toEqual(
      expect.arrayContaining([
        { table: 'exercises', count: 1 },
        { table: 'exercise_items', count: 1 },
      ]),
    );

    expect((await one<{ synopsis: string }>('SELECT synopsis FROM episodes WHERE num = 1'))?.synopsis).toBe('Sinopse');
    expect(await one("SELECT id FROM mic_phrases WHERE id = 'e1-mic-0'")).not.toBeNull();
    expect(await one('SELECT num FROM episodes WHERE num = 3')).toBeNull();
    expect(await one("SELECT id FROM exercises WHERE id = 'e1-ex8'")).toBeNull();
    expect(await one("SELECT id FROM exercises WHERE id = 'e1-ex9'")).not.toBeNull();
    // Learner data untouched: both answers and the account.
    expect(await all('SELECT item_id FROM exercise_answers WHERE user_id = ?', ana.id)).toHaveLength(2);
    expect(await one('SELECT id FROM users WHERE id = ?', ana.id)).not.toBeNull();

    // The undo point exists and works.
    const safety = await one<{ kind: string; scope: string }>(
      'SELECT kind, scope FROM backups WHERE id = ?',
      r.safetyBackupId,
    );
    expect(safety).toEqual({ kind: 'pre_restore', scope: 'content' });
    expect(
      (await one<{ restored_at: number }>('SELECT restored_at FROM backups WHERE id = ?', backup.id))?.restored_at,
    ).toBeGreaterThan(0);
    expect(await auditRows('backup.restore', since)).toHaveLength(1);
    const undo = await admin.client.json(buildPath(B.restore.path, { id: r.safetyBackupId }), { json: {} });
    expect(undo.status).toBe(200);
    expect((await one<{ synopsis: string }>('SELECT synopsis FROM episodes WHERE num = 1'))?.synopsis).toBe('Mudou');
  });

  it('keeps rows created after the backup when asked to', async () => {
    const backup = await make(admin, 'full');
    await ins('episodes', { num: 4, title: 'Fica', season_n: 1, status: 'draft', updated_at: Date.now() });
    const res = await admin.client.json(buildPath(B.restore.path, { id: backup.id }), { json: { removeNew: false } });
    expect(res.status).toBe(200);
    expect(res.body.result.removed).toBe(0);
    expect(await one('SELECT num FROM episodes WHERE num = 4')).not.toBeNull();
  });

  it('schedules automatic backups once per slot and prunes the old ones', async () => {
    const put = await admin.client.json(B.config.path, {
      method: 'PUT',
      json: { frequency: 'daily', hour: 3, weekday: 0, scope: 'content', keep: 2 },
    });
    expect(put.status).toBe(200);
    expect(put.body.config.keep).toBe(2);
    // 03:05 in São Paulo = 06:05 UTC.
    const day = (d: number) => Date.UTC(2026, 10, d, 6, 5);
    expect(new Date(nextAutoAt(put.body.config, Date.UTC(2026, 10, 3, 7, 0)) ?? 0).toISOString()).toBe(
      '2026-11-04T06:00:00.000Z',
    );

    expect(await runScheduledBackup(testEnv, Date.UTC(2026, 10, 1, 9, 5))).toBeNull(); // not the slot
    const first = await runScheduledBackup(testEnv, day(1));
    expect(first).toMatchObject({ kind: 'auto', scope: 'content', createdBy: null });
    expect(await runScheduledBackup(testEnv, day(1) + 60_000)).toBeNull(); // same slot, already done
    await runScheduledBackup(testEnv, day(2));
    await runScheduledBackup(testEnv, day(3));
    // keep: 2 → the oldest automatic one is gone; a manual one is never pruned.
    const autos = await all<{ created_at: number }>(
      "SELECT created_at FROM backups WHERE kind = 'auto' ORDER BY created_at",
    );
    expect(autos.map((a) => a.created_at)).toEqual([day(2), day(3)]);
    // The audit log is append-only (other tests' rows stay): look for the cron's own rows.
    const cron = (await auditRows('backup.create', day(1))).filter((a) => a.actor_user_id === null);
    expect(cron.length).toBeGreaterThanOrEqual(3);
    expect(cron.every((a) => a.actor_role === 'system')).toBe(true);

    const off = await admin.client.json(B.config.path, {
      method: 'PUT',
      json: { frequency: 'off', hour: 3, weekday: 0, scope: 'content', keep: 2 },
    });
    expect(off.body.nextAutoAt).toBeNull();
    expect(await runScheduledBackup(testEnv, day(5))).toBeNull();
    const bad = await admin.client.send(B.config.path, {
      method: 'PUT',
      json: { frequency: 'daily', hour: 25, weekday: 0, scope: 'content', keep: 2 },
    });
    expect(bad.status).toBe(400);
  });

  it('deletes a backup and its file', async () => {
    const b = await make(admin, 'content');
    const del = await admin.client.json(buildPath(B.remove.path, { id: b.id }), { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await one('SELECT id FROM backups WHERE id = ?', b.id)).toBeNull();
    expect(await testEnv.MEDIA.head(`${BACKUP_R2_PREFIX}${b.id}.json.gz`)).toBeNull();
    const again = await admin.client.send(buildPath(B.remove.path, { id: b.id }), { method: 'DELETE' });
    expect(again.status).toBe(404);
  });
});
