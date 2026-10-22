/// <reference types="@cloudflare/vitest-plugin/types" />
// "Esqueci a senha" (spec 07, feature A): POST /api/auth/reset/request.
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { appApi, DURATIONS, LIMITS } from '@tie/shared';
import { hashToken } from '@tie/worker-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESEND_ENDPOINT } from '../../mail/resend';
import { escapeHtml, resetEmail } from '../../mail/resetEmail';
import { resetLink } from '../../routes/auth';
import { all, buildApp, Client, exec, freshIp, ORIGIN, one, resetDb, signup, testEnv } from './helpers';

const A = appApi.auth;
const app = buildApp();

beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
});

/** POST reset/request with an env override (e.g. RESEND_API_KEY); waits for the waitUntil work. */
async function request(email: string, opts: { env?: Record<string, unknown>; ip?: string } = {}): Promise<Response> {
  const headers = new Headers({
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': opts.ip ?? freshIp(),
    'Content-Type': 'application/json',
    'User-Agent': 'vitest',
  });
  const env = opts.env ? { ...testEnv, ...opts.env } : testEnv;
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(ORIGIN + A.resetRequest.path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const resetRows = (uid: string) =>
  all<{ token_hash: string; expires_at: number; created_by: string | null; used_at: number | null }>(
    "SELECT token_hash, expires_at, created_by, used_at FROM one_time_tokens WHERE user_id = ? AND kind = 'reset'",
    uid,
  );

/** The token from the dev console line `[mail:auth.reset] … Reset link: <url>`. */
function tokenFromLog(spy: { mock: { calls: unknown[][] } }): string {
  const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Reset link:'));
  const m = /[?&]reset=([\w-]+)/.exec(line ?? '');
  if (!m?.[1]) throw new Error(`no reset link logged: ${line}`);
  return m[1];
}

describe('POST /api/auth/reset/request', () => {
  it('answers 204 for an unknown e-mail and stores nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const audits = async () => (await all("SELECT id FROM audit_log WHERE action = 'auth.reset_request'")).length;
    const before = await audits();
    const res = await request('ghost@example.com', { env: { RESEND_API_KEY: 're_test' } });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await all('SELECT token_hash FROM one_time_tokens')).toHaveLength(0);
    expect(await audits()).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('issues a 1-hour link (logged without a key) that the existing consume endpoint accepts', async () => {
    const { client, id } = await signup('esqueci@example.com');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const before = Date.now();
    const res = await request('  Esqueci@Example.com ');
    expect(res.status).toBe(204);

    const rows = await resetRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.created_by).toBeNull();
    expect(rows[0]?.expires_at).toBeGreaterThanOrEqual(before + DURATIONS.resetEmailTokenMs);
    expect(rows[0]?.expires_at).toBeLessThanOrEqual(Date.now() + DURATIONS.resetEmailTokenMs);

    const token = tokenFromLog(log);
    expect(await hashToken(token)).toBe(rows[0]?.token_hash);
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(`${ORIGIN}/#/entrar?reset=${token}`);

    const audit = await one<{ actor_user_id: string; target_id: string; diff: string }>(
      "SELECT actor_user_id, target_id, diff FROM audit_log WHERE action = 'auth.reset_request' AND target_id = ?",
      id,
    );
    expect(audit).toMatchObject({ actor_user_id: id, target_id: id });
    expect(audit?.diff ?? '').not.toContain('esqueci@');

    // The link works with POST /api/auth/reset/consume, once, and kills the old sessions.
    const ok = await new Client().json(A.resetConsume.path, {
      json: { token, password: 'senha-nova-1', turnstileToken: 't' },
    });
    expect(ok.status).toBe(200);
    expect((await client.json(appApi.me.state.path)).status).toBe(401);
    const again = await new Client().json<{ error: { code: string } }>(A.resetConsume.path, {
      json: { token, password: 'senha-nova-2', turnstileToken: 't' },
    });
    expect(again.body.error.code).toBe('token_invalid');
    const login = await new Client().json(A.login.path, {
      json: { email: 'esqueci@example.com', password: 'senha-nova-1', turnstileToken: 't' },
    });
    expect(login.status).toBe(200);
  });

  it(`sends at most ${LIMITS.resetMailsPerHour} links an hour per account, still answering 204`, async () => {
    const { id } = await signup('muitos@example.com');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // An admin-issued link does not count against the e-mail throttle.
    await exec(
      "INSERT INTO one_time_tokens(token_hash, user_id, kind, created_by, expires_at) VALUES('admin-link', ?, 'reset', ?, ?)",
      id,
      id,
      Date.now() + DURATIONS.resetTokenMs,
    );
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.resetMailsPerHour + 1; i++) statuses.push((await request('muitos@example.com')).status);
    expect(statuses).toEqual(Array(LIMITS.resetMailsPerHour + 1).fill(204));
    const mine = (await resetRows(id)).filter((r) => r.created_by === null);
    expect(mine).toHaveLength(LIMITS.resetMailsPerHour);
    const audits = await all<{ diff: string }>(
      "SELECT diff FROM audit_log WHERE action = 'auth.reset_request' AND target_id = ? ORDER BY id",
      id,
    );
    expect(audits).toHaveLength(LIMITS.resetMailsPerHour + 1);
    expect(audits.at(-1)?.diff).toContain('throttled');

    // An expired link frees a slot again.
    await exec(
      'UPDATE one_time_tokens SET expires_at = ? WHERE user_id = ? AND created_by IS NULL',
      Date.now() - 1,
      id,
    );
    expect((await request('muitos@example.com')).status).toBe(204);
    expect((await resetRows(id)).filter((r) => r.created_by === null && r.expires_at > Date.now())).toHaveLength(1);
  });

  it('sends nothing to suspended accounts or accounts without a password', async () => {
    const { id: suspended } = await signup('susp@example.com');
    await exec("UPDATE users SET status = 'suspended' WHERE id = ?", suspended);
    const { id: invited } = await signup('convite@example.com');
    await exec('UPDATE users SET pass_hash = NULL WHERE id = ?', invited);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await request('susp@example.com', { env: { RESEND_API_KEY: 're_test' } })).status).toBe(204);
    expect((await request('convite@example.com', { env: { RESEND_API_KEY: 're_test' } })).status).toBe(204);
    expect(await all("SELECT token_hash FROM one_time_tokens WHERE kind = 'reset'")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the branded e-mail through Resend when RESEND_API_KEY is set', async () => {
    const { id } = await signup('resend@example.com', { name: 'Ana <b>' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const res = await request('resend@example.com', {
      env: { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Take It Easy <no-reply@tie.example>' },
    });
    expect(res.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer re_test_key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'Take It Easy <no-reply@tie.example>',
      to: ['resend@example.com'],
      subject: 'Crie uma senha nova no Take It Easy',
    });
    const text = String(body.text);
    const html = String(body.html);
    const token = /reset=([\w-]+)/.exec(text)?.[1] ?? '';
    expect(await hashToken(token)).toBe((await resetRows(id))[0]?.token_hash);
    expect(text).toContain('Oi, Ana <b>!');
    expect(text).toContain('1 hora');
    expect(html).toContain('Oi, Ana &lt;b&gt;!');
    expect(html).not.toContain('<b>!');
    expect(html).toContain(`href="${ORIGIN}/#/entrar?reset=${token}"`);
    expect(html).not.toMatch(/<img|<script|https?:\/\/(?!localhost)/);
  });

  it('answers 204 when Resend fails', async () => {
    await signup('falha@example.com');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"bad"}', { status: 500 }));
    const res = await request('falha@example.com', { env: { RESEND_API_KEY: 're_test' } });
    expect(res.status).toBe(204);
  });

  it('rate limits per IP (RL_AUTH) without telling whether the e-mail exists', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(`x${i}@example.com`, { ip })).status);
    expect(codes.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(codes.at(-1)).toBe(429);
  });

  it('refuses a missing Turnstile token and a malformed e-mail', async () => {
    const bad = await new Client().json<{ error: { code: string } }>(A.resetRequest.path, {
      json: { email: 'nao-e-email', turnstileToken: 't' },
    });
    expect(bad.status).toBe(400);
    const noTs = await new Client().json<{ error: { code: string } }>(A.resetRequest.path, {
      json: { email: 'a@example.com', turnstileToken: '' },
    });
    expect(noTs.status).toBe(400);
  });
});

describe('reset e-mail template', () => {
  it('renders pt-BR text and HTML with the escaped link', () => {
    const link = resetLink('https://app.example/', 'tok_123-abc');
    expect(link).toBe('https://app.example/#/entrar?reset=tok_123-abc');
    const m = resetEmail({ name: '', link, minutes: 60 });
    expect(m.text).toMatch(/^Oi!/);
    expect(m.text).toContain(link);
    expect(m.html).toContain('lang="pt-BR"');
    expect(m.html).toContain('Criar senha nova');
    expect(m.html).toContain(escapeHtml(link));
    expect(resetEmail({ name: 'Bia', link, minutes: 30 }).text).toContain('30 minutos');
  });
});
