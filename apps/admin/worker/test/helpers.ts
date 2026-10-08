/// <reference types="@cloudflare/vitest-plugin/types" />
// Test harness for the admin Worker: a cookie-keeping client, staff/learner factories, a database
// reset and a compile-valid content fixture.
import { createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { newId, type Role } from '@tie/shared';
import { createSession, type Env, hashPassword } from '@tie/worker-core';
import { buildAdminApp } from '../src/index';

export const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
export const db = testEnv.DB;
export const ORIGIN = 'http://localhost';

const adminApp = buildAdminApp();

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

/** Inserts one row from a column → value object (JSON values are stringified). */
export async function ins(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  const vals = cols.map((k) => {
    const v = row[k];
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  await exec(`INSERT INTO ${table}(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`, ...vals);
}

let ipCounter = 0;
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

type Fetchable = { fetch: (req: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response> };

/** Minimal browser: keeps cookies from Set-Cookie and sends same-origin headers. */
export class Client {
  readonly cookies = new Map<string, string>();
  constructor(readonly target: Fetchable = adminApp) {}

  async send(path: string, opts: SendOpts = {}): Promise<Response> {
    const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? 'POST' : 'GET');
    const headers = new Headers(opts.headers);
    if (!opts.noOrigin && !headers.has('Origin') && method !== 'GET' && method !== 'HEAD')
      headers.set('Origin', ORIGIN);
    if (!headers.has('Sec-Fetch-Site')) headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('CF-Connecting-IP', opts.ip ?? freshIp());
    if (!headers.has('User-Agent')) headers.set('User-Agent', 'vitest');
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    let body = opts.body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    if (body instanceof FormData) {
      // Browsers send multipart with a known length; serialize it the same way.
      const r = new Request(ORIGIN, { method: 'POST', body });
      headers.set('Content-Type', r.headers.get('Content-Type') ?? '');
      body = await r.arrayBuffer();
    }
    if (!headers.has('Content-Length')) {
      if (typeof body === 'string') headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
      else if (body instanceof ArrayBuffer) headers.set('Content-Length', String(body.byteLength));
    }
    const ctx = createExecutionContext();
    const res = await this.target.fetch(new Request(ORIGIN + path, { method, headers, body }), testEnv, ctx);
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

  // biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field in the tests.
  async json<T = any>(path: string, opts: SendOpts = {}): Promise<{ status: number; body: T; res: Response }> {
    const res = await this.send(path, opts);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, res };
  }
}

export const PASSWORD = 'senha-forte-123';
let emailCounter = 0;
export const freshEmail = (prefix = 'u') => `${prefix}${++emailCounter}-${Date.now()}@test.local`;

export interface Account {
  id: string;
  email: string;
  client: Client;
  /** Admin session token hash (staff). */
  tokenHash?: string;
}

/** A staff member with an admin session cookie already set (no login round trip). */
export async function staff(roles: Role[], opts: { email?: string; password?: string | null } = {}): Promise<Account> {
  const id = newId();
  const email = opts.email ?? freshEmail(roles[0] ?? 'staff');
  const passHash = opts.password === null ? null : await hashPassword(opts.password ?? PASSWORD);
  await ins('users', {
    id,
    email,
    pass_hash: passHash,
    status: 'active',
    tz: 'America/Sao_Paulo',
    created_at: Date.now(),
  });
  for (const role of roles) await ins('user_roles', { user_id: id, role, granted_by: null, granted_at: Date.now() });
  const session = await createSession(db, { userId: id, audience: 'admin' });
  const client = new Client();
  client.cookies.set('tie_adm', session.token);
  return { id, email, client, tokenHash: session.tokenHash };
}

/** A learner with a profile, stats, the default plan and an app session (kept in `appToken`). */
export async function learner(opts: { email?: string; name?: string; password?: string } = {}) {
  const id = newId();
  const email = opts.email ?? freshEmail('aluno');
  const now = Date.now();
  await ins('users', {
    id,
    email,
    pass_hash: opts.password ? await hashPassword(opts.password) : null,
    status: 'active',
    tz: 'America/Sao_Paulo',
    created_at: now,
    last_login_at: now,
  });
  await ins('profiles', {
    user_id: id,
    name: opts.name ?? 'Ana',
    full_name: `${opts.name ?? 'Ana'} Souza`,
    updated_at: now,
  });
  await ins('user_stats', { user_id: id, points: 120, streak: 2 });
  await exec(
    `INSERT INTO user_plans(user_id, plan_id, assigned_by, assigned_at) SELECT ?, id, NULL, ? FROM plans WHERE is_default = 1`,
    id,
    now,
  );
  const session = await createSession(db, { userId: id, audience: 'app' });
  return { id, email, appToken: session.token };
}

const USER_TABLES = ['sessions', 'one_time_tokens', 'moderation_items', 'uploads', 'ai_usage_events', 'users'];
const CONTENT_TABLES = [
  'assistant_clips',
  'album_tracks',
  'albums',
  'extras',
  'exercise_items',
  'exercises',
  'mic_phrases',
  'ebook_test_questions',
  'episodes',
  'ebooks',
  'seasons',
  'steps',
  'cast_members',
  'mic_missions',
  'content_blobs',
  'option_lists',
  'point_rules',
  'levels',
  'badges',
  'assistants',
  'ai_prompts',
  'content_releases',
  'app_settings',
  'feature_flags',
  'media',
  'plans',
];

/** Empties every table except the append-only audit_log, seeds two plans and clears R2. */
export async function resetDb(): Promise<void> {
  await db.batch([...USER_TABLES, ...CONTENT_TABLES].map((t) => db.prepare(`DELETE FROM ${t}`)));
  await exec(
    `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
     VALUES('P0', 'gratis', 'Grátis', 60, '{}', 1, 1, 0, 0), ('P1', 'premium', 'Premium', 600, '{"premium_extras":true}', 0, 1, 0, 0)`,
  );
  let cursor: string | undefined;
  do {
    const page = await testEnv.MEDIA.list({ cursor });
    if (page.objects.length) await testEnv.MEDIA.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Audit rows written since `since` for an action. */
export async function auditRows(action: string, since: number) {
  return all<{
    actor_user_id: string | null;
    actor_role: string | null;
    target_id: string | null;
    diff: string | null;
  }>(
    'SELECT actor_user_id, actor_role, target_id, diff FROM audit_log WHERE action = ? AND at >= ? ORDER BY id',
    action,
    since,
  );
}

/** A tiny PNG header (signature + IHDR) with the given dimensions; enough for sniffing and sizing. */
export function pngBytes(width: number, height: number, extra = 64): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  // Varying tail bytes give each call its own sha256.
  for (let i = 33; i < b.length; i++) b[i] = (i * 7 + width + height * 3) & 255;
  return b;
}

export function fileForm(bytes: Uint8Array, type: string, name: string, field = 'file'): FormData {
  const form = new FormData();
  form.append(field, new File([bytes], name, { type }));
  return form;
}

// ---------- Content fixture (compiles cleanly; shaped like packages/shared/test/compile.test.ts) ----------

const NOW = 1_760_000_000_000;

export async function seedContent(): Promise<void> {
  const media = (id: string, key: string, kind: string, mime: string) =>
    ins('media', { id, r2_key: key, kind, mime, bytes: 10, sha256: id.padEnd(64, '0'), created_at: NOW });
  await media('m-intro', 'media/aaaa0001/audio/intro.mp3', 'audio', 'audio/mpeg');
  await media('m-video', 'media/aaaa0002/video/cena.mp4', 'video', 'video/mp4');
  await media('m-img', 'media/aaaa0003/img/home.webp', 'image', 'image/webp');
  await media('m-pdf', 'media/aaaa0004/ebook.pdf', 'pdf', 'application/pdf');
  await media('m-clip', 'media/aaaa0005/video/idle.mp4', 'video', 'video/mp4');
  for (let n = 1; n <= 10; n++) await ins('steps', { n, name: `Step ${n}`, pt: `etapa ${n}`, group_label: null });
  await ins('seasons', { n: 1, title: 'Arrival', synopsis: 'A família' });
  await ins('cast_members', { name: 'Zach', initials: 'ZW', color: '#3C5580' });
  await ins('ebooks', {
    num: 1,
    title: 'Nice to Meet You',
    eps_label: '1–2',
    scope: 'Escopo',
    five: [{ k: 'CUMPRIMENTO', title: 'T', rows: [{ en: 'Good', pt: 'Bem' }] }],
    real: [],
    lead: [{ m: { en: 'Hi', pt: 'Oi' }, opts: [{ en: 'Hi {N}', pt: 'Oi {N}' }] }],
    chat: [],
    extras_cards: [],
    pdf_media: 'm-pdf',
    pass_score: 1,
    updated_at: NOW,
  });
  const done = {
    title: 'T',
    line: 'L {N}',
    nextNum: '02',
    nextTitle: 'N',
    nextSub: 'S',
    nextNote: 'x',
    cta: 'Go',
    go: 'trilha',
  };
  await ins('episodes', {
    num: 1,
    title: 'Good Morning',
    season_n: 1,
    status: 'published',
    ebook_num: 1,
    synopsis: 'Sinopse',
    intro_media: 'm-intro',
    song_media: null,
    song_title: 'Song',
    scene_media: 'm-video',
    scene_note: 'nota',
    dialog_title: 'DIALOG',
    dialog_sub: 'sub',
    lyrics: [{ en: 'Hi! Good morning!', pt: 'Oi!', gap: 'morning' }],
    cast_names: ['Zach'],
    visual: [{ en: 'door', pt: 'porta' }],
    dialog: [{ who: 'Zach', en: 'Hi', pt: 'Oi' }],
    lesson: [{ k: '1 · TO BE', body: 'texto' }],
    pron: null,
    away_exp: [{ en: 'Hi', pt: 'Oi' }],
    away_words: ['hi'],
    done,
    updated_at: NOW,
  });
  await ins('episodes', { num: 2, title: 'Family', season_n: 1, status: 'title_only', ebook_num: 1, updated_at: NOW });
  await ins('mic_phrases', {
    id: 'e1-mic-0',
    episode_num: 1,
    sort: 0,
    en: 'Hi!',
    tip: 'tip',
    demo_result: 7,
    blue: 0,
    fb: 'fb',
  });
  await ins('exercises', {
    id: 'e1-ex0',
    episode_num: 1,
    sort: 0,
    kind: 'escrito',
    title: 'Ex',
    intro: null,
    audio: null,
  });
  await ins('exercise_items', {
    id: 'e1-ex0-i0',
    exercise_id: 'e1-ex0',
    sort: 0,
    q: 'Q1',
    opts: ['a', 'b'],
    answer_idx: 1,
  });
  await ins('ebook_test_questions', {
    id: 'eb1-t1',
    ebook_num: 1,
    part_idx: 0,
    part_title: 'PARTE A',
    n: 1,
    q: '___ Robert.',
    rev: 'R',
    ep_num: 1,
    step: 7,
    opts: ['Am', 'I’m'],
    answer_idx: 1,
  });
  await ins('extras', {
    id: 'woods-and-beans',
    title: 'Woods & Beans',
    kind: 'Sitcom',
    format: 'series',
    genres: ['comedia'],
    themes: ['comida'],
    level: 'A1',
    cefr: 1,
    ep_label: 'Ep. 3',
    dur: '8 min',
    cover_media: 'm-img',
    scene_media: null,
    synopsis: 'S',
    cast_list: [{ name: 'Maggie', initials: 'MW', color: '#2A6FF5' }],
    dub: 'Lucas',
    premiere: 0,
    locked: 0,
    premium: 0,
    lines: [{ who: 'Maggie', en: 'Hi', pt: 'Oi' }],
    vocab: [{ en: 'order', pt: 'pedido' }],
    sort: 0,
    status: 'published',
  });
  await ins('albums', {
    id: 'season-one',
    title: 'Músicas',
    sub: 'sub',
    level: 'A1',
    img_media: null,
    genres: ['pop'],
    sort: 0,
  });
  await ins('album_tracks', {
    id: 'season-one-t0',
    album_id: 'season-one',
    sort: 0,
    title: 'Say Hello',
    src_from: 'Ep 1',
    audio_media: 'm-intro',
    ep_num: 1,
  });
  await ins('assistants', {
    key: 'margaret',
    name: 'Maggie',
    full_name: 'Margaret Woods',
    art: 'a',
    age: 45,
    aka: ['Maggie'],
    role: 'Designer',
    tag: 'Acolhedora',
    style: 'Estilo',
    hello_en: 'Hello!',
    hello_pt: 'Olá!',
    voice: { gender: 'female', pitch: 1.05, rate: 1 },
    tts_speaker: 'asteria',
    persona: 'SECRET-PERSONA warm and elegant',
    poster_media: 'm-img',
    thumb_media: null,
    sort: 0,
    active: 1,
  });
  await ins('assistant_clips', { assistant_key: 'margaret', state: 'idle', media_id: 'm-clip' });
  await ins('mic_missions', {
    key: 'gente',
    title: 'Fazendo amizade',
    role: 'vizinha',
    goal: 'g',
    turns: [{ en: 'Hi', pt: 'Oi', words: [] }],
    sort: 0,
  });
  const blobs: Record<string, unknown> = {
    focus: { listening: { t: 't', b: 'b', cta: 'c', go: 'g' } },
    personalize: { formatWord: { series: 'séries' }, formatTheme: {} },
    extras_shelves: [{ k: 'pra-voce', t: 'Pra você' }],
    srs_grades: [
      { label: 'De novo', hint: '< 1 min', ms: 0 },
      { label: 'Difícil', hint: '10 min', ms: 600000 },
      { label: 'Bom', hint: '2 dias', ms: 172800000 },
      { label: 'Fácil', hint: '5 dias', ms: 432000000 },
    ],
    mic_modes: [{ k: 'livre', t: 'Conversa livre', s: 's', icon: 'chat' }],
    mic_openers: { _: { en: 'Hi, {N}.', pt: 'Oi, {N}.' } },
    mic_follow: [{ en: 'Bye', pt: 'Tchau', end: true }],
    mic_pron: [{ en: 'Hi', target: 'h', tip: 't' }],
    mic_help: [{ en: 'Sorry?', pt: 'não entendi' }],
    ebook_teasers: { 1: { title: 'O almoço', sub: 'E-book 2' } },
    scene_images: { default: 'm-img', episodes: {} },
    ui_images: { 'bg/home': 'm-img' },
    onboarding_meta: { remindMax: 5 },
  };
  for (const [key, json] of Object.entries(blobs)) await ins('content_blobs', { key, json, updated_at: NOW });
  const opt = (list_key: string, item_key: string, sort: number, label: string, more: Record<string, unknown> = {}) =>
    ins('option_lists', {
      list_key,
      scope: '',
      item_key,
      sort,
      label,
      sub: null,
      icon: null,
      img_media: null,
      extra: null,
      ...more,
    });
  await opt('onb_steps', 'conta', 0, 'Sua conta', { sub: 'Leva um minuto.', extra: { h: 'Primeiro' } });
  await opt('levels', 'zero', 0, 'Do zero', { sub: 'Nunca', extra: { season: 1, cefr: 'A1' } });
  await opt('formats', 'series', 0, 'Séries');
  await opt('genres', 'comedia', 0, 'Comédia', { scope: 'series' });
  await opt('goals', 'viagem', 0, 'Viajar', { sub: 'Aeroporto', icon: 'plane' });
  for (const [i, d] of ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].entries()) await opt('days', String(i), i, d);
  await opt('minutes', '20', 0, '20 min');
  await ins('point_rules', { kind: 'step', points: 10, daily_cap: null, verifiable: 1 });
  await ins('levels', { n: 1, min_points: 0, name: 'Iniciante' });
  await ins('badges', {
    id: 'first-step',
    title: 'Primeiro passo',
    sub: 'Concluiu',
    icon: 'flag',
    rule: { type: 'count', kind: 'step', min: 1 },
    sort: 0,
  });
}
