// Media library: magic-byte uploads, dedupe, listing, references, guarded deletes and /m/* serving.
import { adminApi, buildPath, LIMITS } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, Client, exec, fileForm, ins, learner, one, pngBytes, resetDb, staff, testEnv } from './helpers';

const M = adminApi.media;

describe('media library', () => {
  let editor: Account;

  beforeEach(async () => {
    await resetDb();
    editor = await staff(['editor']);
  });

  const upload = (bytes: Uint8Array, type: string, name: string) =>
    editor.client.json(M.upload.path, { body: fileForm(bytes, type, name) });

  it('stores an image by its real type, with size and sha256, under media/{sha8}/', async () => {
    const r = await upload(pngBytes(640, 360), 'application/pdf', 'Capa Nova (final).PDF');
    expect(r.status).toBe(201);
    const m = r.body.media;
    expect(m).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      width: 640,
      height: 360,
      sourcePath: 'Capa Nova (final).PDF',
    });
    expect(m.r2Key).toMatch(
      new RegExp(`^media/${m.sha256.slice(0, 8)}/up/${m.sha256.slice(8, 16)}-capa-nova-final\\.png$`),
    );
    expect(m.url).toBe(`/m/${m.r2Key}`);
    const obj = await testEnv.MEDIA.head(m.r2Key);
    expect(obj?.httpMetadata?.contentType).toBe('image/png');

    // Same bytes again: the existing row, nothing new stored.
    const again = await upload(pngBytes(640, 360), 'image/png', 'outra.png');
    expect(again.status).toBe(200);
    expect(again.body.media.id).toBe(m.id);
    expect((await testEnv.MEDIA.list({ prefix: 'media/' })).objects).toHaveLength(1);
  });

  it('rejects unknown or disallowed bytes whatever the declared type, and oversized bodies', async () => {
    const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(text, 'image/png', 'x.png')).status).toBe(415);
    const heic = new Uint8Array([
      0,
      0,
      0,
      24,
      ...new TextEncoder().encode('ftypheic'),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect((await upload(heic, 'video/mp4', 'x.mp4')).status).toBe(415);
    expect(
      (await editor.client.json(M.upload.path, { body: fileForm(pngBytes(1, 1), 'image/png', 'a.png', 'other') }))
        .status,
    ).toBe(400);
    const big = await editor.client.json(M.upload.path, {
      body: 'x',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=abc',
        'Content-Length': String(LIMITS.mediaMaxBytes + 1024 * 1024),
      },
    });
    expect(big.status).toBe(413);
  });

  it('lists with filters and pages', async () => {
    for (let i = 0; i < 3; i++) await upload(pngBytes(10 + i, 10), 'image/png', `img-${i}.png`);
    await upload(new TextEncoder().encode('%PDF-1.7\n%x'), 'application/pdf', 'ebook.pdf');
    const pdfs = await editor.client.json(`${M.list.path}?kind=pdf`);
    expect(pdfs.body.items.map((m: { mime: string }) => m.mime)).toEqual(['application/pdf']);
    const named = await editor.client.json(`${M.list.path}?q=img-1`);
    expect(named.body.items).toHaveLength(1);
    const first = await editor.client.json(`${M.list.path}?limit=3`);
    expect(first.body.items).toHaveLength(3);
    const second = await editor.client.json(`${M.list.path}?limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('deletes only unreferenced files and reports where a file is used', async () => {
    const m = (await upload(pngBytes(50, 50), 'image/png', 'capa.png')).body.media;
    await ins('albums', { id: 'a1', title: 'A', img_media: m.id, genres: '[]', sort: 0 });
    await ins('content_blobs', { key: 'ui_images', json: JSON.stringify({ 'bg/home': m.id }), updated_at: 1 });
    const refs = await editor.client.json(buildPath(M.refs.path, { id: m.id }));
    expect(refs.body.refs).toEqual([
      { table: 'albums', id: 'a1', column: 'img_media' },
      { table: 'content_blobs', id: 'ui_images', column: 'bg/home' },
    ]);
    const blocked = await editor.client.json(buildPath(M.remove.path, { id: m.id }), { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.refs).toHaveLength(2);
    await exec('DELETE FROM albums');
    await exec('DELETE FROM content_blobs');
    expect((await editor.client.json(buildPath(M.remove.path, { id: m.id }), { method: 'DELETE' })).body).toEqual({
      ok: true,
    });
    expect(await one('SELECT 1 FROM media WHERE id = ?', m.id)).toBeNull();
    expect(await testEnv.MEDIA.head(m.r2Key)).toBeNull();
  });

  it('serves content media to staff and learner uploads to moderators only', async () => {
    const m = (await upload(pngBytes(8, 8), 'image/png', 'p.png')).body.media;
    const ok = await editor.client.send(m.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('image/png');
    const range = await editor.client.send(m.url, { headers: { Range: 'bytes=0-7' } });
    expect(range.status).toBe(206);
    expect((await new Client().send(m.url)).status).toBe(401);

    const l = await learner();
    const key = `users/${l.id}/photo-x.png`;
    await testEnv.MEDIA.put(key, pngBytes(4, 4), { httpMetadata: { contentType: 'image/png' } });
    await ins('uploads', {
      id: 'upx',
      user_id: l.id,
      kind: 'photo',
      r2_key: key,
      mime: 'image/png',
      bytes: 1,
      sha256: 'x',
      created_at: 1,
    });
    const moderator = await staff(['moderator']);
    expect((await moderator.client.send(`/m/${key}`)).status).toBe(200);
    expect((await editor.client.send(`/m/${key}`)).status).toBe(403);
    expect((await moderator.client.send('/m/content/abc/catalog.json')).status).toBe(404);
    expect((await moderator.client.send('/m/media/../users/x')).status).toBe(404);
  });
});
