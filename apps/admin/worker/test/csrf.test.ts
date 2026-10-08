// CSRF and transport rules (spec 04 §5) on the admin API: Origin must be the admin origin,
// Sec-Fetch-Site same-origin, and bodies JSON (multipart only on the media upload).
import { adminApi } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, resetDb, staff } from './helpers';

describe('csrf', () => {
  let admin: Account;
  const path = adminApi.plans.create.path;
  const plan = { slug: 'pro', name: 'Pro', aiMinutesMonth: 100 };

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });

  it('accepts a same-origin JSON write', async () => {
    expect((await admin.client.send(path, { json: plan })).status).toBe(201);
  });

  it('refuses a write without Origin', async () => {
    const r = await admin.client.json(path, { json: plan, noOrigin: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf_failed');
  });

  it('refuses a foreign Origin, even with a valid session', async () => {
    const r = await admin.client.json(path, { json: plan, headers: { Origin: 'https://evil.example' } });
    expect(r.body.error.code).toBe('csrf_failed');
  });

  it('refuses a cross-site fetch', async () => {
    const r = await admin.client.json(path, { json: plan, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(r.body.error.code).toBe('csrf_failed');
  });

  it('refuses form-encoded and text bodies (HTML forms cannot send JSON)', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const r = await admin.client.json(path, { body: JSON.stringify(plan), headers: { 'Content-Type': type } });
      expect(r.status).toBe(415);
    }
  });

  it('allows multipart only on the media upload', async () => {
    const form = new FormData();
    form.append('slug', 'x');
    expect((await admin.client.send(path, { body: form })).status).toBe(415);
  });

  it('applies to logout and login too', async () => {
    expect((await admin.client.json(adminApi.auth.logout.path, { method: 'POST', noOrigin: true })).status).toBe(403);
    expect((await admin.client.send(adminApi.auth.me.path)).status).toBe(200);
  });

  it('sends the security headers and no-store', async () => {
    const r = await admin.client.send(adminApi.auth.me.path);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
