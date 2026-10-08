import { describe, expect, expectTypeOf, it } from 'vitest';
import { can } from '../src/authz';
import { LIMITS } from '../src/constants';
import {
  adminApi,
  appApi,
  type authApi,
  type BodyIn,
  type BodyOut,
  buildPath,
  contentFileUrl,
  ebookApi,
  listEndpoints,
  type ParamsOut,
  ProfilePatch,
  type ResOf,
  SignupBody,
  TutorReply,
} from '../src/contracts/index';
import { freshState, TieState } from '../src/state';

describe('endpoint tables', () => {
  const app = listEndpoints(appApi);
  const admin = listEndpoints(adminApi);

  it('covers the spec surface', () => {
    expect(app.length).toBeGreaterThanOrEqual(40);
    expect(admin.length).toBeGreaterThanOrEqual(60);
  });

  it('has no duplicate method+path', () => {
    const all = [...app, ...admin].map((e) => `${e.method} ${e.path}`);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps student routes under /api or /m and admin routes under /admin-api', () => {
    for (const e of app) expect(e.path).toMatch(/^\/(api|m)\//);
    for (const e of admin) expect(e.path).toMatch(/^\/admin-api\//);
  });

  it('gives every staff endpoint a permission that an admin holds', () => {
    for (const e of admin) {
      if (e.access !== 'staff' || e.path === '/admin-api/auth/me') continue;
      expect(e.perm, `${e.method} ${e.path}`).toBeDefined();
      if (e.perm && e.perm !== 'roles.grant_admin') expect(can(['admin'], e.perm)).toBe(true);
    }
  });

  it('declares params for every :param path', () => {
    for (const e of [...app, ...admin]) {
      if (/:[a-z]/i.test(e.path)) expect(e.params, `${e.method} ${e.path}`).toBeDefined();
    }
  });

  it('builds paths', () => {
    expect(buildPath(ebookApi.download.path, { n: 1 })).toBe('/api/ebooks/1/download');
    expect(contentFileUrl('abcdef12', 'ep/1.json')).toBe('/api/content/v/abcdef12/ep/1.json');
    expect(() => buildPath('/x/:id', {})).toThrow();
  });
});

describe('schemas', () => {
  it('normalizes signup and enforces the password and name rules', () => {
    const ok = SignupBody.parse({
      email: '  Ana@Example.COM ',
      password: 'segredo123',
      fullName: 'Ana Souza',
      name: 'Ana',
      birth: '1995-04-10',
      tz: 'America/Sao_Paulo',
      termsVersion: '2026-10',
      acceptTerms: true,
      turnstileToken: 'x',
      extra: 'stripped',
    });
    expect(ok.email).toBe('ana@example.com');
    expect('extra' in ok).toBe(false);
    // Spec 01: "Senha | 6+ chars" ("Mínimo de 6 caracteres").
    expect(SignupBody.safeParse({ ...ok, password: '12345' }).success).toBe(false);
    expect(SignupBody.safeParse({ ...ok, password: '123456' }).success).toBe(true);
    expect(SignupBody.safeParse({ ...ok, fullName: 'Ana' }).success).toBe(false);
  });

  it('truncates tutor text to the cap instead of rejecting it (spec 04 §3.1)', () => {
    const body = appApi.ai.tutor.body;
    const parsed = body.parse({ session_id: 'S1', text: 'a'.repeat(LIMITS.tutorTextMax + 50), turn: 1 });
    expect(parsed.text).toHaveLength(LIMITS.tutorTextMax);
    expect(body.safeParse({ session_id: 'S1', text: '', turn: 1 }).success).toBe(false);
  });

  it('bills Mic session start against the quota (spec 04 §3: user + quota)', () => {
    expect(appApi.mic.start.quota).toBe(true);
  });

  it('rejects unknown keys on admin bodies', () => {
    const body = adminApi.plans.create.body;
    expect(body.safeParse({ slug: 'premium', name: 'Premium', aiMinutesMonth: 600 }).success).toBe(true);
    expect(body.safeParse({ slug: 'premium', name: 'Premium', aiMinutesMonth: 600, x: 1 }).success).toBe(false);
    const ep = adminApi.content.episodes.update.body;
    expect(ep.safeParse({ title: 'Good Morning' }).success).toBe(true);
    expect(ep.safeParse({ updatedAt: 1 }).success).toBe(false);
  });

  it('accepts a prototype-shaped tutor reply', () => {
    const reply = {
      reply_en: 'Oh, you’re 24. Nice!',
      reply_pt: 'Ah, você tem 24.',
      feedback: {
        status: 'ajuste',
        original: 'I have 24 years',
        corrected: 'I’m 24',
        explain_pt: '…',
        cat: 'Idade com to be',
      },
      pron_watch: [{ word: 'have', tip_pt: '…' }],
      new_words: [{ en: 'age', pt: 'idade' }],
      mood: 'correcting',
      end: false,
      hint_en: 'I’m … years old.',
      hint_pt: 'Eu tenho … anos.',
      source: 'ia',
    };
    expect(TutorReply.parse(reply)).toEqual(reply);
    expect(TutorReply.safeParse({ ...reply, mood: 'angry' }).success).toBe(false);
  });

  it('lets the profile patch carry onbStep but not photo', () => {
    const p = ProfilePatch.parse({ goals: ['viagem'], onbStep: 3, photo: 'x' });
    expect(p).toEqual({ goals: ['viagem'], onbStep: 3 });
    expect(ProfilePatch.safeParse({ goals: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('validates the fresh state', () => {
    const s = freshState(0);
    expect(TieState.parse(s)).toEqual(s);
    expect(s.settings.free).toBe(false);
    expect(s.draft).not.toHaveProperty('pass');
  });

  it('infers request and response types', () => {
    expectTypeOf<BodyIn<typeof authApi.login>>().toHaveProperty('turnstileToken');
    expectTypeOf<BodyOut<typeof appApi.progress.exercise>>().toEqualTypeOf<{ itemId: string; choice: number }>();
    expectTypeOf<ParamsOut<typeof ebookApi.testSubmit>>().toEqualTypeOf<{ n: number }>();
    expectTypeOf<ResOf<typeof appApi.ai.tts>>().toEqualTypeOf<ArrayBuffer>();
    expectTypeOf<ResOf<typeof appApi.me.state>>().toEqualTypeOf<TieState>();
    expectTypeOf<BodyIn<typeof appApi.me.state>>().toEqualTypeOf<undefined>();
  });
});
