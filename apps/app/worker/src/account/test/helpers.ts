/// <reference types="@cloudflare/vitest-plugin/types" />

import { createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { appApi } from '@tie/shared';
import { createApp, type Env, fail } from '@tie/worker-core';
import auth from '../../routes/auth';
import me from '../../routes/me';
import uploads from '../../routes/uploads';

export const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
export const db = testEnv.DB;
export const ORIGIN = 'http://localhost';

/** Same middleware stack as worker/src/index.ts, with only the S1 route modules mounted. */
export function buildApp() {
  const app = createApp({ multipart: (path, method) => method === 'POST' && path === appApi.me.photoUpload.path });
  app.route('/', auth);
  app.route('/', me);
  app.route('/', uploads);
  app.all('*', () => {
    throw fail('not_found');
  });
  return app;
}

const app = buildApp();

export async function exec(sql: string, ...params: unknown[]): Promise<void> {
  await db
    .prepare(sql)
    .bind(...params)
    .run();
}

export async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}

let ipCounter = 0;
/** A fresh client IP per request keeps RL_AUTH (ip+email) out of the way unless a test pins one. */
export const freshIp = (): string => {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export interface SendOpts {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  ip?: string;
  /** Omit the Origin header (CSRF tests). */
  noOrigin?: boolean;
}

/** Minimal browser: keeps cookies from Set-Cookie and sends same-origin headers. */
export class Client {
  readonly cookies = new Map<string, string>();

  async send(path: string, opts: SendOpts = {}): Promise<Response> {
    const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? 'POST' : 'GET');
    const headers = new Headers(opts.headers);
    if (!opts.noOrigin && !headers.has('Origin') && method !== 'GET') headers.set('Origin', ORIGIN);
    if (!headers.has('Sec-Fetch-Site')) headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('CF-Connecting-IP', opts.ip ?? freshIp());
    headers.set('User-Agent', 'vitest');
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    let body = opts.body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(ORIGIN + path, { method, headers, body }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    for (const line of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async json<T = unknown>(path: string, opts: SendOpts = {}): Promise<{ status: number; body: T; res: Response }> {
    const res = await this.send(path, opts);
    return { status: res.status, body: (await res.json()) as T, res };
  }
}

export const TODAY_BIRTH = '1990-05-20';

export function signupBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    password: 'segredo123',
    fullName: 'Ana Souza',
    name: 'Ana',
    birth: TODAY_BIRTH,
    tz: 'America/Sao_Paulo',
    termsVersion: '2026-10',
    acceptTerms: true,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    ...extra,
  };
}

export async function signup(
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ client: Client; id: string }> {
  const client = new Client();
  const r = await client.json<{ user: { id: string } }>(appApi.auth.signup.path, { json: signupBody(email, extra) });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { client, id: r.body.user.id };
}

/** Empties every table S1 touches and seeds the default plan. */
export async function resetDb(): Promise<void> {
  await db.batch(
    [
      'DELETE FROM sessions',
      'DELETE FROM one_time_tokens',
      'DELETE FROM user_plans',
      'DELETE FROM user_roles',
      'DELETE FROM moderation_items',
      'DELETE FROM uploads',
      'DELETE FROM ai_usage_events',
      'DELETE FROM users',
      'DELETE FROM plans',
      'DELETE FROM feature_flags',
      'DELETE FROM app_settings',
    ].map((sql) => db.prepare(sql)),
  );
  await exec(
    `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
     VALUES('P0', 'gratis', 'Grátis', 60, '{}', 1, 1, 0, 0), ('P1', 'premium', 'Premium', 600, '{}', 0, 1, 0, 0)`,
  );
  const listed = await testEnv.MEDIA.list();
  if (listed.objects.length) await testEnv.MEDIA.delete(listed.objects.map((o) => o.key));
}

/** A tiny PNG header (signature + IHDR) with the given dimensions; enough for sniffing and sizing. */
export function pngBytes(width: number, height: number, extra = 64): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  return b;
}

export function photoForm(bytes: Uint8Array, type = 'image/png', name = 'me.png'): FormData {
  const form = new FormData();
  form.append('photo', new File([bytes], name, { type }));
  return form;
}
