// Preview → publish → the student app's manifest moves; releases and rollback. The app side is the
// real tie-app content route (apps/app/worker/src/routes/content.ts) on the same D1 and R2.
import { adminApi, appApi, buildPath } from '@tie/shared';
import { contentKey } from '@tie/shared/content/compile';
import { createApp } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import appContent from '../../../app/worker/src/routes/content';
import {
  type Account,
  auditRows,
  Client,
  exec,
  ins,
  learner,
  one,
  resetDb,
  seedContent,
  staff,
  testEnv,
} from './helpers';

const C = adminApi.content;
const R = adminApi.releases;

const studentApp = createApp();
studentApp.route('/', appContent);

async function studentManifest(token: string) {
  const c = new Client(studentApp);
  c.cookies.set('tie_s', token);
  return c.json(appApi.content.manifest.path);
}

describe('preview and publish', () => {
  let editor: Account;
  let admin: Account;
  let student: { appToken: string };

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    editor = await staff(['editor']);
    admin = await staff(['admin']);
    student = await learner();
  });

  it('previews without publishing anything', async () => {
    const r = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([]);
    expect(r.body.version).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.manifest.files).toEqual({
      catalog: 'catalog.json',
      episodes: [1],
      ebooks: [1],
      extras: ['woods-and-beans'],
    });
    expect(r.body.changed).toEqual(['catalog.json', 'ebook/1.json', 'ep/1.json', 'extra/woods-and-beans.json']);
    expect(await one('SELECT 1 FROM content_releases')).toBeNull();
    expect((await testEnv.MEDIA.list({ prefix: 'content/' })).objects).toHaveLength(0);
    expect((await studentManifest(student.appToken)).status).toBe(404);
  });

  it('publishes: R2 snapshot, release row, content.current, and the app manifest follows', async () => {
    const since = Date.now();
    const r = await editor.client.json(C.publish.path, { json: { notes: 'Primeira versão' } });
    expect(r.status).toBe(200);
    const ver: string = r.body.release.version;
    expect(r.body.release).toMatchObject({
      notes: 'Primeira versão',
      publishedBy: editor.id,
      manifest: { version: ver },
    });
    const keys = (await testEnv.MEDIA.list({ prefix: `content/${ver}/` })).objects.map((o) => o.key).sort();
    expect(keys).toEqual(
      ['catalog.json', 'ebook/1.json', 'ep/1.json', 'extra/woods-and-beans.json', 'manifest.json'].map((f) =>
        contentKey(ver, f),
      ),
    );
    const catalog = await (await testEnv.MEDIA.get(contentKey(ver, 'catalog.json')))?.text();
    expect(catalog).toContain(ver);
    expect(catalog).not.toContain('SECRET-PERSONA');
    expect((await one<{ value: string }>("SELECT value FROM app_settings WHERE key = 'content.current'"))?.value).toBe(
      ver,
    );
    expect(await auditRows('content.publish', since)).toHaveLength(1);

    const m1 = await studentManifest(student.appToken);
    expect(m1.status).toBe(200);
    expect(m1.body.version).toBe(ver);

    // An edit changes nothing for learners until the next publish …
    const upd = await editor.client.json(buildPath(C.episodes.update.path, { id: 1 }), {
      method: 'PUT',
      json: { title: 'Good Morning, Woods!' },
    });
    expect(upd.status).toBe(200);
    expect((await studentManifest(student.appToken)).body.version).toBe(ver);
    const pv = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(pv.body.changed).toEqual(['catalog.json', 'ep/1.json']);

    // … which moves the app's manifest to the new version.
    const r2 = await editor.client.json(C.publish.path, { json: {} });
    const ver2: string = r2.body.release.version;
    expect(ver2).not.toBe(ver);
    expect((await studentManifest(student.appToken)).body.version).toBe(ver2);
    const ep = JSON.parse((await (await testEnv.MEDIA.get(contentKey(ver2, 'ep/1.json')))?.text()) ?? '{}');
    expect(ep.title).toBe('Good Morning, Woods!');

    // Republishing identical content is idempotent (same version, same publishedAt).
    const r3 = await editor.client.json(C.publish.path, { json: {} });
    expect(r3.body.release).toEqual(r2.body.release);
    expect((await editor.client.json(C.preview.path, { method: 'POST' })).body.changed).toEqual([]);
  });

  it('refuses to publish content that does not compile, and preview lists why', async () => {
    // Rows the CMS would refuse, written straight to D1 (as a bad seed or manual SQL could).
    await exec("UPDATE episodes SET lyrics = '{not json' WHERE num = 1");
    await exec(`UPDATE content_blobs SET json = '[]' WHERE key = 'srs_grades'`);
    const pv = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(pv.body.version).toBe('');
    expect(pv.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'rows', path: 'episodes.1.lyrics' }),
        expect.objectContaining({ file: 'catalog.json', path: 'srs.grades' }),
      ]),
    );
    const pub = await editor.client.json(C.publish.path, { json: {} });
    expect(pub.status).toBe(400);
    expect(pub.body.error.code).toBe('validation_failed');
    expect(await one('SELECT 1 FROM content_releases')).toBeNull();
  });

  it('refuses a blank title on save, and never publishes a row that already has one', async () => {
    const blank = await editor.client.json(buildPath(C.episodes.update.path, { id: 1 }), {
      method: 'PUT',
      json: { title: '   ' },
    });
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe('validation_failed');
    expect((await one<{ title: string }>('SELECT title FROM episodes WHERE num = 1'))?.title).not.toBe('');
    const extra = await editor.client.json(buildPath(C.extras.update.path, { id: 'woods-and-beans' }), {
      method: 'PUT',
      json: { title: '' },
    });
    expect(extra.status).toBe(400);

    // A row saved blank before the rule (or by manual SQL) blocks the preview and the publish.
    await exec("UPDATE episodes SET title = '' WHERE num = 1");
    const pv = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(pv.body.version).toBe('');
    expect(pv.body.errors).toEqual([expect.objectContaining({ file: 'episodes', path: '1.title' })]);
    const pub = await editor.client.json(C.publish.path, { json: {} });
    expect(pub.status).toBe(400);
    expect(pub.body.error.code).toBe('validation_failed');
    expect(await one('SELECT 1 FROM content_releases')).toBeNull();
  });

  it('lets an e-book with no published episode stay untitled (the seed leaves e-books 4-10 so)', async () => {
    await ins('ebooks', {
      num: 4,
      title: '',
      eps_label: '7–8',
      scope: '',
      five: [],
      real: [],
      lead: [],
      chat: [],
      extras_cards: [],
      pdf_media: null,
      pass_score: 14,
      updated_at: Date.now(),
    });
    const pv = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(pv.body.errors).toEqual([]);
    expect((await editor.client.json(C.publish.path, { json: {} })).status).toBe(200);
    // E-book 1 has a published episode: learners open its hub, so it needs its title.
    await exec("UPDATE ebooks SET title = '' WHERE num = 1");
    const pv2 = await editor.client.json(C.preview.path, { method: 'POST' });
    expect(pv2.body.errors).toEqual([expect.objectContaining({ file: 'ebooks', path: '1.title' })]);
  });

  it('lists releases and rolls back (admin); the app manifest follows the rollback', async () => {
    const v1 = (await editor.client.json(C.publish.path, { json: { notes: 'v1' } })).body.release;
    await editor.client.json(buildPath(C.episodes.update.path, { id: 1 }), {
      method: 'PUT',
      json: { title: 'Outro título' },
    });
    const v2 = (await editor.client.json(C.publish.path, { json: { notes: 'v2' } })).body.release;

    const list = await admin.client.json(R.list.path);
    expect(list.body.current).toBe(v2.version);
    expect(list.body.items.map((i: { version: string }) => i.version).sort()).toEqual([v1.version, v2.version].sort());

    expect((await editor.client.send(buildPath(R.rollback.path, { id: v1.id }), { method: 'POST' })).status).toBe(403);
    const rb = await admin.client.json(buildPath(R.rollback.path, { id: v1.id }), { method: 'POST' });
    expect(rb.body).toEqual({ current: v1.version });
    expect((await studentManifest(student.appToken)).body.version).toBe(v1.version);

    // A release whose files are gone from R2 cannot become current.
    await testEnv.MEDIA.delete(contentKey(v2.version, 'manifest.json'));
    const gone = await admin.client.json(buildPath(R.rollback.path, { id: v2.id }), { method: 'POST' });
    expect(gone.status).toBe(409);
    expect((await admin.client.send(buildPath(R.rollback.path, { id: 'rel-nope' }), { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('keeps a file a published release uses; rollback refuses a release whose files are gone', async () => {
    const v1 = (await editor.client.json(C.publish.path, { json: {} })).body.release;
    expect(await testEnv.MEDIA.head(`releases/${v1.version}/media.json`)).not.toBeNull();
    // Every draft reference of m-img moves to another file (the PoC): only the release still uses it.
    await ins('media', {
      id: 'm-img2',
      r2_key: 'media/aaaa0006/img/nova.webp',
      kind: 'image',
      mime: 'image/webp',
      bytes: 10,
      sha256: 'm-img2'.padEnd(64, '0'),
      created_at: 1,
    });
    await exec("UPDATE extras SET cover_media = 'm-img2' WHERE cover_media = 'm-img'");
    await exec("UPDATE assistants SET poster_media = 'm-img2' WHERE poster_media = 'm-img'");
    await exec(`UPDATE content_blobs SET json = '{"default":"m-img2","episodes":{}}' WHERE key = 'scene_images'`);
    await exec(`UPDATE content_blobs SET json = '{"bg/home":"m-img2"}' WHERE key = 'ui_images'`);
    const M = adminApi.media;
    const del = buildPath(M.remove.path, { id: 'm-img' });
    const blocked = await editor.client.json(del, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('in_use');
    expect(blocked.body.error.details.refs).toEqual([{ table: 'content_releases', id: v1.version, column: 'current' }]);

    // A newer release no longer uses it, but v1 can still be rolled back to: still in use.
    const v2 = (await editor.client.json(C.publish.path, { json: {} })).body.release;
    expect(v2.version).not.toBe(v1.version);
    const refs = await editor.client.json(buildPath(M.refs.path, { id: 'm-img' }));
    expect(refs.body.refs).toEqual([{ table: 'content_releases', id: v1.version, column: 'release' }]);
    // A release without an index (published by the seed) is indexed from its snapshot on demand.
    await testEnv.MEDIA.delete(`releases/${v1.version}/media.json`);
    expect((await editor.client.json(del, { method: 'DELETE' })).status).toBe(409);
    expect(await testEnv.MEDIA.head(`releases/${v1.version}/media.json`)).not.toBeNull();
    expect(await one("SELECT 1 FROM media WHERE id = 'm-img'")).not.toBeNull();

    // A file removed behind the API's back: rolling back to v1 would serve a 404, so it is refused.
    await exec("DELETE FROM media WHERE id = 'm-img'");
    const rb = await admin.client.json(buildPath(R.rollback.path, { id: v1.id }), { method: 'POST' });
    expect(rb.status).toBe(409);
    expect(rb.body.error.details.missingMedia).toEqual(['/m/media/aaaa0003/img/home.webp']);
    expect((await studentManifest(student.appToken)).body.version).toBe(v2.version);
    // The current release (v2) does not use it, and nothing else does: the rollback to v2 is fine.
    expect((await admin.client.json(buildPath(R.rollback.path, { id: v2.id }), { method: 'POST' })).status).toBe(200);
  });
});
