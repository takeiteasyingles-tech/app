// U1-auth: functional + security checks for the auth/onboarding/profile screens (entrar, cadastro/1..7,
// perfil) against the real Worker on the e2e slot (E2E_SLOT). Signup flows create brand-new accounts
// through the UI (Turnstile stubbed offline with the test key); profile tests use their own D1 users
// cloned from the parity fixture's Ana and sign in with that user's session cookie.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, type Request, test } from '@playwright/test';
import { fixtureStatements } from '@tie/seed/fixtureToSql';
import { COOKIES } from '@tie/shared/constants';
import { VIEWPORTS, type ViewportName } from '../../parity/src/config';
import { contextOptions, prepareContext } from '../../parity/src/determinism';
import { type FixtureSql, namespaceCards, passHash } from '../../parity/src/fixture/sql';
import {
  FIXTURE_PASSWORD,
  freshUser,
  isolateState,
  loadFixture,
  nsEmail,
  sessionToken,
  storageOf,
  tokenHash,
} from '../../parity/src/fixture/state';
import { applyFixtures } from '../../parity/src/seedSlot';
import { type StaticServer, servePrototype } from '../../parity/src/servePrototype';
import { sl } from '../src/slotEnv';
import { stubTurnstile } from '../src/turnstile';

type Any = Record<string, any>;
const VPS: ViewportName[] = ['mobile', 'desktop'];

// Fake microphone for the voice test (speech.record).
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

// ---------------------------------------------------------------- users

const OUT = fileURLToPath(new URL('../out/u1-auth/', import.meta.url));
const USERS: string[] = [];
/** Users whose state is not Ana's: signed in, no profile, onboarding at step n. */
const FRESH: Record<string, number> = {};
for (const vp of VPS) {
  for (const t of [
    'login',
    'pf-head',
    'pf-photo',
    'pf-prefs',
    'pf-rhythm',
    'pf-settings',
    'pf-reset',
    'pf-del',
    'pf-out',
    'pf-a11y',
    'cmp-main',
  ])
    USERS.push(`u1-${t}-${vp}`);
  for (let n = 2; n <= 7; n++) {
    USERS.push(`u1-cmp-onb${n}-${vp}`);
    FRESH[`u1-cmp-onb${n}-${vp}`] = n;
  }
}
const baseState = (key: string): Any =>
  FRESH[key] ? freshUser(FRESH[key]) : JSON.parse(JSON.stringify(loadFixture()));
const userId = (key: string) => `U_E2E_${key.toUpperCase().replace(/-/g, '_')}`;
const emailOf = (key: string) => nsEmail('ana@parity.test', key);

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const now = Date.now();
  const pass = passHash(FIXTURE_PASSWORD);
  const statements: string[] = [];
  for (const key of USERS) {
    const state = isolateState(baseState(key), key, emailOf(key));
    statements.push(
      ...namespaceCards(
        fixtureStatements(state, {
          email: emailOf(key),
          passHash: pass,
          sessionTokenHash: tokenHash(sessionToken(key)),
          userId: userId(key),
          now,
        }),
        key,
      ),
    );
  }
  const fx: FixtureSql = { sql: `${statements.join('\n')}\n`, users: [], jobs: {}, admin: { email: '', token: '' } };
  await applyFixtures(sl, fx, (m) => console.log(`[u1] ${m}`));
});

// ---------------------------------------------------------------- helpers

const INIT = `(() => {
  window.__spoken = [];
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' @ ' + e.sourceFile + ':' + e.lineNumber + ':' + e.columnNumber + ' sample=' + e.sample);
  });
  if ('speechSynthesis' in window) {
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push({ text: u.text, rate: u.rate });
      setTimeout(() => { try { u.onstart && u.onstart(new Event('start')); u.onend && u.onend(new Event('end')); } catch (e) {} }, 50);
    };
  }
})();`;

// Same offline stand-in as src/turnstile.ts, except that reset() re-runs the widget and hands a fresh
// token to the callback, as the real Turnstile does (the shared stub's reset is a no-op, so a second
// submit after a failed one would wait for a token that never comes).
const TS_STUB = `(() => {
  let n = 0;
  const widgets = new Map();
  const fire = (o) => { const cb = typeof o.callback === 'function' ? o.callback : null; if (cb) setTimeout(() => cb('XXXX.DUMMY.TOKEN.XXXX'), 0); };
  window.turnstile = {
    render(el, opts) { const id = 'tie-ts-' + (++n); widgets.set(id, opts || {}); fire(opts || {}); return id; },
    reset(id) { const o = widgets.get(id); if (o) fire(o); },
    remove(id) { widgets.delete(id); },
    ready(fn) { setTimeout(fn, 0); },
    getResponse() { return 'XXXX.DUMMY.TOKEN.XXXX'; },
    isExpired() { return false; },
  };
})();`;

async function prep(ctx: BrowserContext, opts: { key?: string; ai?: boolean } = {}): Promise<void> {
  await stubTurnstile(ctx);
  await ctx.route('https://challenges.cloudflare.com/**', (route) =>
    /\/turnstile\/v0\/api\.js/.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: TS_STUB })
      : route.fulfill({ status: 204, body: '' }),
  );
  if (opts.key)
    await ctx.addCookies([
      { name: COOKIES.app, value: sessionToken(opts.key), url: sl.origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  await ctx.addInitScript({ content: INIT });
  await ctx.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: !!opts.ai }) }),
  );
}

interface Watch {
  errors: string[];
  allow: RegExp[];
}
function watch(page: Page, allow: RegExp[] = []): Watch {
  const w: Watch = { errors: [], allow };
  const push = (m: string) => {
    if (!w.allow.some((r) => r.test(m))) w.errors.push(m);
  };
  page.on('pageerror', (e) => push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) push(`http ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return w;
}

const ZOD_EVAL = { n: 0 };

async function expectClean(page: Page, w: Watch): Promise<void> {
  const all = await page.evaluate(() => (window as any).__csp as string[]).catch(() => [] as string[]);
  // zod v4's allowsEval probe (Function('') in try/catch, shared chunk, every screen) is reported
  // separately as a global finding; anything else fails the slice.
  const csp = all.filter((v) => !/^script-src eval @ .*\/assets\/ai-[\w-]+\.js:1:\d+ sample=$/.test(v));
  if (all.length !== csp.length) ZOD_EVAL.n++;
  expect.soft(csp, 'CSP violations').toEqual([]);
  expect.soft(w.errors, 'console/page/API errors').toEqual([]);
  await expect.soft(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

/** The shell probes GET /api/me/state on load; signed out it answers 401 (and Chrome logs the 401). */
const SIGNED_OUT = [/http 401 GET .*\/api\/me\/state/, /401 \(Unauthorized\)/];

const view = (page: Page) => page.locator('.view').last();
const toast = (page: Page, text: string | RegExp) => page.locator('#fxroot .toast').filter({ hasText: text });
const spoken = (page: Page) => page.evaluate(() => (window as any).__spoken as { text: string }[]);
const btn = (page: Page, name: RegExp) => page.getByRole('button', { name }).first();

async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll(
        '.app button, .app a[href], .app [role=button], .app input:not([type=hidden]), .overlay button',
      ),
    )) {
      const h = el as HTMLElement;
      if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') continue;
      const lab = (h as HTMLInputElement).labels?.length
        ? Array.from((h as HTMLInputElement).labels!)
            .map((l) => l.textContent)
            .join('')
        : '';
      const name =
        h.getAttribute('aria-label') ||
        h.getAttribute('title') ||
        lab ||
        (h.tagName !== 'INPUT' ? (h.textContent || '').trim() : '') ||
        Array.from(h.querySelectorAll('img[alt]'))
          .map((i) => i.getAttribute('alt'))
          .join('');
      if (!name) out.push(h.outerHTML.slice(0, 160));
    }
    return out;
  });
}

async function tabTo(page: Page, sel: string, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return true;
  }
  return false;
}
async function ringVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    return a.matches(':focus-visible') && (outline || cs.boxShadow !== 'none');
  });
}

/** Waits for the next PUT /api/me/profile and returns its JSON body. */
async function nextProfilePut(page: Page, act: () => Promise<unknown>): Promise<Any> {
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/me/profile') && r.method() === 'PUT', { timeout: 10_000 }),
    act(),
  ]);
  const res = await req.response();
  expect(res?.status(), `PUT /api/me/profile ${req.postData()}`).toBeLessThan(300);
  return JSON.parse(req.postData() || '{}');
}

async function serverState(page: Page): Promise<Any> {
  return page.evaluate(async () => (await fetch('/api/me/state', { credentials: 'same-origin' })).json());
}

const id8 = () => randomBytes(4).toString('hex');

async function fillAccount(page: Page, f: { full: string; name?: string; birth: string; email: string; pass: string }) {
  await page.locator('#onb-fullname').fill(f.full);
  if (f.name != null) await page.locator('#onb-name').fill(f.name);
  await page.locator('#onb-birth').fill(f.birth);
  await page.locator('#onb-email').fill(f.email);
  await page.locator('#onb-pass').fill(f.pass);
}

/** JPEG dimensions from the first SOF marker of a buffer that contains a JPEG. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (i < 0) return null;
  i += 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1] as number;
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// ---------------------------------------------------------------- tests per viewport

for (const vp of VPS) {
  test.describe(`U1 ${vp}`, () => {
    const V = VIEWPORTS[vp];
    // VIEWPORTS entries are flat ({width, height, …}); Playwright wants them under `viewport`.
    test.use({
      viewport: { width: V.width, height: V.height },
      isMobile: V.isMobile,
      hasTouch: V.hasTouch,
      deviceScaleFactor: V.deviceScaleFactor,
      permissions: ['microphone'],
    });

    // ------------------------------------------------------------ entrar

    test(`entrar: layout, PROD changes, legal sheets (${vp})`, async ({ page, context }) => {
      await prep(context);
      const w = watch(page, SIGNED_OUT);
      await page.goto('/#/entrar');
      const v = view(page);
      await expect(v.locator('.auth .hero h1')).toHaveText('Você não faz lições. Você acompanha uma história.', {
        timeout: 20_000,
      });
      await expect(v.locator('.auth .hero')).toContainText(
        'Uma série do zero ao B2, com a Maggie para conversar quando você quiser.',
      );
      await expect(v.locator('.formcard .h2')).toHaveText('Entrar');
      await expect(v.locator('#login-email')).toHaveAttribute('placeholder', 'voce@email.com');
      await expect(v.locator('#login-pass')).toHaveAttribute('type', 'password');
      // PROD: no social, no demo, no prototype footer
      await expect(v.getByText(/Google|Apple/)).toHaveCount(0);
      await expect(v.getByText(/conta demo/i)).toHaveCount(0);
      await expect(v.getByText(/Protótipo/)).toHaveCount(0);
      await expect(page.locator('.tabbar')).toHaveCount(0);
      await expect(page.locator('aside.side')).toHaveCount(0);
      // eye toggle
      await v.getByRole('button', { name: 'Mostrar senha' }).click();
      await expect(v.locator('#login-pass')).toHaveAttribute('type', 'text');
      await v.getByRole('button', { name: 'Mostrar senha' }).click();
      await expect(v.locator('#login-pass')).toHaveAttribute('type', 'password');
      // Esqueci a senha → support toast
      await btn(page, /^Esqueci a senha$/).click();
      await expect(toast(page, /suporte/)).toBeVisible();
      // legal sheets
      await v.getByRole('link', { name: 'Termos de Uso' }).click();
      await expect(page).toHaveURL(/#\/entrar\?doc=termos$/);
      const sheet = page.getByRole('dialog', { name: 'Termos de Uso' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(/Versão \S+/);
      await sheet.getByRole('button', { name: 'Fechar' }).click();
      await expect(page).toHaveURL(/#\/entrar$/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await v.getByRole('link', { name: 'Política de Privacidade' }).click();
      await expect(page.getByRole('dialog', { name: 'Política de Privacidade' })).toContainText('não fica guardado');
      await page.keyboard.press('Escape');
      await page.goto('/#/entrar');
      // Criar conta grátis → cadastro/1
      await btn(page, /^Criar conta grátis$/).click();
      await expect(page).toHaveURL(/#\/cadastro\/1$/);
      await expect(view(page).locator('.wiz-head .lbl')).toHaveText('Etapa 1 de 7 · Sua conta');
      expect(await unnamedControls(page), 'unnamed controls').toEqual([]);
      await expectClean(page, w);
    });

    test(`entrar: validation, wrong password, login + reload, guards (${vp})`, async ({ page, context }) => {
      await prep(context);
      const w = watch(page, [
        /http 401 POST .*\/api\/auth\/login/,
        /http 401 GET .*\/api\/me\/state/,
        /401 \(Unauthorized\)/,
      ]);
      await page.goto('/#/entrar');
      const v = view(page);
      await expect(v.locator('#login-email')).toBeVisible({ timeout: 20_000 });
      // client validation (no request)
      let loginCalls = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/auth/login')) loginCalls++;
      });
      await btn(page, /^Entrar$/).click();
      await expect(v.getByText('Confira o e-mail. Ele precisa ter @ e um domínio.')).toBeVisible();
      await expect(v.getByText('A senha tem pelo menos 6 caracteres.')).toBeVisible();
      expect(loginCalls).toBe(0);
      // wrong password → server error under the password
      await v.locator('#login-email').fill(emailOf(`u1-login-${vp}`));
      await v.locator('#login-pass').fill('senha-errada-123');
      const [bad] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
        btn(page, /^Entrar$/).click(),
      ]);
      expect(bad.status()).toBe(401);
      expect(JSON.parse(bad.request().postData() || '{}').turnstileToken, 'turnstile token sent').toBeTruthy();
      await expect(v.locator('.err')).toHaveCount(1);
      await expect(v.getByText('Confira o e-mail. Ele precisa ter @ e um domínio.')).toHaveCount(0);
      // right password, Enter key submits
      await v.locator('#login-pass').fill(FIXTURE_PASSWORD);
      const [ok] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
        v.locator('#login-pass').press('Enter'),
      ]);
      expect(ok.status()).toBe(200);
      await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1, name: /Oi, Ana/ })).toBeVisible();
      // session persists across reload; entrar/cadastro redirect to inicio while a profile exists
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: /Oi, Ana/ })).toBeVisible({ timeout: 20_000 });
      await page.goto('/#/entrar');
      await expect(page).toHaveURL(/#\/inicio$/);
      await page.goto('/#/cadastro/3');
      await expect(page).toHaveURL(/#\/inicio$/);
      // password never stored client-side
      const stored = await page.evaluate(
        () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
      );
      expect(stored).not.toContain(FIXTURE_PASSWORD);
      await expectClean(page, w);
    });

    test(`entrar: ?reset=<token> form (admin-issued link) (${vp})`, async ({ page, context }) => {
      await prep(context);
      const w = watch(page, [...SIGNED_OUT, /http 4\d\d POST .*\/api\/auth\/reset\/consume/, /status of 4\d\d/]);
      await page.goto('/#/entrar?reset=abcdefghijklmnopqrstuvwxyz012345');
      const v = view(page);
      await expect(v.locator('.formcard .h2')).toHaveText('Criar uma senha nova', { timeout: 20_000 });
      await btn(page, /^Salvar a senha nova$/).click();
      await expect(v.getByText('A senha precisa de pelo menos 6 caracteres.')).toBeVisible();
      await v.locator('#reset-pass').fill('nova-senha-123');
      const [r] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/auth/reset/consume')),
        btn(page, /^Salvar a senha nova$/).click(),
      ]);
      expect(r.status()).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(r.request().postData() || '{}')).toMatchObject({
        token: 'abcdefghijklmnopqrstuvwxyz012345',
        password: 'nova-senha-123',
      });
      await expect(page.locator('#fxroot .toast')).toBeVisible();
      await expect(page).toHaveURL(/reset=/);
      // a malformed token falls back to the login form
      await page.goto('/#/entrar?reset=%3Cscript%3E');
      await expect(view(page).locator('.formcard .h2')).toHaveText('Entrar');
      await page.goto('/#/entrar?reset=abcdefghijklmnopqrstuvwxyz012345');
      await btn(page, /^Voltar para Entrar$/).click();
      await expect(page).toHaveURL(/#\/entrar$/);
      await expect(view(page).locator('.formcard .h2')).toHaveText('Entrar');
      await expectClean(page, w);
    });

    test(`guards: signed out → entrar (${vp})`, async ({ page, context }) => {
      await prep(context);
      const w = watch(page, [/http 401 GET .*\/api\/me\/state/, /401 \(Unauthorized\)/]);
      for (const r of ['perfil', 'inicio', 'cadastro/4']) {
        await page.goto(`/#/${r}`);
        await expect(page).toHaveURL(r.startsWith('cadastro') ? /#\/(cadastro\/1|entrar)$/ : /#\/entrar$/, {
          timeout: 20_000,
        });
      }
      await expectClean(page, w);
    });

    // ------------------------------------------------------------ cadastro

    test(`cadastro: full onboarding with real signup, persistence, voice test (${vp})`, async ({ page, context }) => {
      test.setTimeout(150_000);
      await prep(context);
      const w = watch(page, [...SIGNED_OUT, /speech|recogn/i]);
      const email = `u1-${vp}-${id8()}@e2e.test`;
      const pass = `pw-${id8()}`;
      await page.goto('/#/cadastro/1');
      const v = view(page);
      await expect(v.locator('h1.h1')).toHaveText('Primeiro, a sua conta.', { timeout: 20_000 });
      await expect(v.locator('.wiz-head .steps i')).toHaveCount(7);
      await expect(v.locator('.wiz-head .steps i.now')).toHaveCount(1);
      await expect(v.getByRole('button', { name: 'Sair' })).toBeVisible();
      await expect(v).toContainText('O primeiro episódio é grátis para sempre.');
      // validation messages (prototype copy)
      let signupCalls = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/auth/signup')) signupCalls++;
      });
      await btn(page, /^Continuar/).click();
      await expect(v.getByText('Digite o nome e o sobrenome.')).toBeVisible();
      await expect(v.getByText('Confira a data de nascimento.')).toBeVisible();
      await expect(v.getByText('Confira o e-mail.')).toBeVisible();
      await expect(v.getByText('A senha precisa de pelo menos 6 caracteres.')).toBeVisible();
      await fillAccount(page, { full: 'Bruno Teste', birth: '2030-01-01', email: 'x', pass: '123' });
      await btn(page, /^Continuar/).click();
      await expect(v.getByText('Confira a data de nascimento.')).toBeVisible();
      expect(signupCalls).toBe(0);
      // name auto-filled from the first name
      await fillAccount(page, { full: 'Bruno Teste Silva', name: '', birth: '1990-04-02', email, pass });
      await v.getByRole('button', { name: 'Mostrar senha' }).click();
      await expect(v.locator('#onb-pass')).toHaveAttribute('type', 'text');
      const [sres] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/auth/signup'), { timeout: 30_000 }),
        btn(page, /^Continuar/).click(),
      ]);
      expect(sres.status()).toBe(201);
      const sbody = JSON.parse(sres.request().postData() || '{}');
      expect(sbody).toMatchObject({
        name: 'Bruno',
        fullName: 'Bruno Teste Silva',
        birth: '1990-04-02',
        email,
        acceptTerms: true,
      });
      expect(sbody.turnstileToken).toBeTruthy();
      expect(sbody.termsVersion).toBeTruthy();
      await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
      const stored = await page.evaluate(
        () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
      );
      expect(stored, 'password must not be stored client-side').not.toContain(pass);

      // 2 · objetivo: max 3, counter, Continuar gating
      await expect(v.locator('.wiz-head .lbl')).toHaveText('Etapa 2 de 7 · Objetivo');
      await expect(v.locator('.optcard')).toHaveCount(8);
      await expect(btn(page, /^Continuar/)).toBeDisabled();
      await expect(v.getByText('0 de 3 escolhidos')).toBeVisible();
      const goals = v.locator('.optcard');
      for (const i of [0, 1, 2]) await goals.nth(i).click();
      await expect(v.getByText('3 de 3 escolhidos')).toBeVisible();
      await goals.nth(3).click();
      await expect(toast(page, 'Até 3. Desmarque um para trocar.')).toBeVisible();
      await expect(v.locator('.optcard.on')).toHaveCount(3);
      await goals.nth(2).click();
      await expect(v.locator('.optcard.on')).toHaveCount(2);
      const goalKeysUi = await v.locator('.optcard.on .h3').allTextContents();
      await expect(btn(page, /^Continuar/)).toBeEnabled();
      // back to 1 shows the account (read-only email), forward again
      await v.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/cadastro\/1$/);
      await expect(v.locator('#onb-email')).toHaveValue(email);
      await expect(v.locator('#onb-email')).toHaveAttribute('readonly', '');
      await btn(page, /^Continuar/).click();
      await expect(page).toHaveURL(/#\/cadastro\/2$/);
      await expect(v.locator('.optcard.on')).toHaveCount(2);
      await btn(page, /^Continuar/).click();

      // 3 · gostos: format → genre block; deselect prunes; themes
      await expect(page).toHaveURL(/#\/cadastro\/3$/);
      await expect(v.locator('.fmt-grid .fmt')).toHaveCount(9);
      await expect(btn(page, /^Continuar/)).toBeDisabled();
      const block = (fmt: string) =>
        v.locator('.stack.mt24').filter({ has: page.locator('.lbl', { hasText: `Em ${fmt}, o que você curte?` }) });
      await v.locator('.fmt-grid .fmt', { hasText: 'Séries' }).click();
      await v.locator('.fmt-grid .fmt', { hasText: 'Novelas' }).click();
      await v.locator('.fmt-grid .fmt', { hasText: 'Música' }).click();
      await expect(v.locator('.fmt.on')).toHaveCount(3);
      await expect(v.locator('.fmt.on .ck svg')).toHaveCount(3);
      await expect(v.locator('.lbl', { hasText: /^Em .*, o que você curte\?$/ })).toHaveCount(3);
      // Comédia (séries + novelas) and Ação (séries only)
      await block('séries').locator('.chip', { hasText: 'Comédia' }).click();
      await block('séries').locator('.chip', { hasText: 'Ação' }).click();
      await block('música').locator('.chip', { hasText: 'Rock' }).click();
      await expect(block('novelas').locator('.chip.on', { hasText: 'Comédia' })).toHaveCount(1);
      // deselecting Séries prunes Ação but keeps Comédia (still offered by Novelas)
      await v.locator('.fmt-grid .fmt', { hasText: 'Séries' }).click();
      await expect(v.locator('.lbl', { hasText: /^Em .*, o que você curte\?$/ })).toHaveCount(2);
      await v.locator('.fmt-grid .fmt', { hasText: 'Séries' }).click();
      await expect(block('séries').locator('.chip.on', { hasText: 'Ação' })).toHaveCount(0);
      await expect(block('séries').locator('.chip.on', { hasText: 'Comédia' })).toHaveCount(1);
      // drop Novelas and Séries again → only Música stays
      await v.locator('.fmt-grid .fmt', { hasText: 'Novelas' }).click();
      await v.locator('.fmt-grid .fmt', { hasText: 'Séries' }).click();
      await expect(v.locator('.fmt.on')).toHaveCount(1);
      await expect(block('música').locator('.chip.on')).toHaveCount(1);
      await v.locator('.lbl', { hasText: 'E fora da tela?' }).locator('xpath=../..').locator('.chip').first().click();
      await btn(page, /^Continuar/).click();

      // 4 · trava: Qual trava mais?
      await expect(page).toHaveURL(/#\/cadastro\/4$/);
      await expect(v.locator('.optcard')).toHaveCount(8);
      await v.locator('.optcard').nth(0).click();
      await expect(v.getByText('Qual trava mais?')).toHaveCount(0);
      await v.locator('.optcard').nth(2).click();
      await expect(v.getByText('Qual trava mais?')).toBeVisible();
      await expect(v.getByText('Vira o foco da semana na tela Hoje.')).toBeVisible();
      const mainChips = v.locator('.card.or .chip');
      await expect(mainChips).toHaveCount(2);
      await expect(mainChips.nth(0)).toHaveClass(/\bon\b/);
      await mainChips.nth(1).click();
      await expect(mainChips.nth(1)).toHaveClass(/\bon\b/);
      await btn(page, /^Continuar/).click();

      // 5 · estilo
      await expect(page).toHaveURL(/#\/cadastro\/5$/);
      await expect(v.locator('.grid3 .optcard')).toHaveCount(6);
      await v.locator('.grid3 .optcard').nth(1).click();
      await expect(v.locator('.grid3 .optcard.on')).toHaveCount(1);
      await v.locator('.lbl', { hasText: 'Você rende mais…' }).locator('xpath=../..').locator('.chip').nth(1).click();
      await v
        .locator('.lbl', { hasText: 'Quando você erra, prefere que a Maggie…' })
        .locator('xpath=../..')
        .locator('.chip')
        .nth(0)
        .click();
      await btn(page, /^Continuar/).click();

      // 6 · ritmo
      await expect(page).toHaveURL(/#\/cadastro\/6$/);
      const days = v.locator('.days button');
      await expect(days).toHaveCount(7);
      const daysLabel = v.locator('.xs.mt4').first();
      const before = await v.locator('.days button.on').count();
      await expect(daysLabel).toContainText(`${before} dias por semana`);
      // turn every day off → Continuar disabled
      for (let i = 0; i < 7; i++)
        if (await days.nth(i).evaluate((e) => e.classList.contains('on'))) await days.nth(i).click();
      await expect(daysLabel).toHaveText('0 dias por semana · ritmo leve');
      await expect(btn(page, /^Continuar/)).toBeDisabled();
      for (const i of [1, 3, 5]) await days.nth(i).click();
      await expect(daysLabel).toHaveText('3 dias por semana · ritmo tranquilo');
      await v.locator('.lbl', { hasText: 'Minutos por dia' }).locator('xpath=../..').locator('.chip').nth(2).click();
      // reminders: add until 5, then remove one
      const remRows = v.locator('input[type=time]');
      const start = await remRows.count();
      for (let i = start; i < 5; i++) await v.getByRole('button', { name: /Adicionar (outro )?lembrete/ }).click();
      await expect(remRows).toHaveCount(5);
      await expect(v.getByRole('button', { name: /Adicionar (outro )?lembrete/ })).toHaveCount(0);
      await v.getByRole('button', { name: 'Remover lembrete 5' }).click();
      await expect(remRows).toHaveCount(4);
      await remRows.nth(0).fill('06:45');
      // wait for the debounced PUT, then reload: resumes on step 6 with the answers
      await page.waitForTimeout(1500);
      await page.reload();
      await expect(page).toHaveURL(/#\/cadastro\/6$/, { timeout: 20_000 });
      await expect(view(page).locator('.days button.on')).toHaveCount(3);
      await expect(view(page).locator('input[type=time]')).toHaveCount(4);
      await expect(view(page).locator('input[type=time]').first()).toHaveValue('06:45');
      await view(page).getByRole('button', { name: 'Voltar' }).click();
      await view(page).getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/cadastro\/4$/);
      await expect(view(page).locator('.optcard.on')).toHaveCount(2);
      await expect(view(page).locator('.card.or .chip').nth(1)).toHaveClass(/\bon\b/);
      await page.goto('/#/cadastro/6');
      await btn(page, /^Continuar/).click();

      // 7 · voz
      await expect(page).toHaveURL(/#\/cadastro\/7$/);
      const vz = view(page);
      await expect(vz.locator('h1.h1')).toHaveText('Diga oi para a Maggie.');
      await expect(vz.locator('.caption .en')).toHaveText('Hi, Bruno. Can you say this for me?');
      await expect(vz.locator('.card .h1')).toHaveText('Hi, I’m Bruno.');
      await expect(vz.locator('.vu i')).toHaveCount(18);
      await expect(vz).toContainText('O áudio serve para a nota e não fica guardado.');
      await expect(btn(page, /^Pular por enquanto$/)).toBeVisible();
      await vz.getByRole('button', { name: /Ouvir a Maggie/ }).click();
      await expect.poll(async () => (await spoken(page)).map((s) => s.text).join('|')).toContain('Hi, I’m Bruno.');
      await vz.getByRole('button', { name: 'Gravar' }).click();
      await expect(vz.getByText('Ouvindo… toque para parar')).toBeVisible({ timeout: 10_000 });
      await expect(vz.getByRole('button', { name: 'Parar a gravação' })).toBeVisible();
      // auto-stops at 4.2 s, scored in demo mode
      await expect(vz.locator('.num')).toBeVisible({ timeout: 20_000 });
      await expect(vz.locator('.row.center.base')).toContainText('/10');
      await expect(vz.getByText('Toque para tentar de novo')).toBeVisible();
      await expect(btn(page, /^Começar o curso$/)).toBeVisible();
      await page.waitForTimeout(1200); // debounced draft PUT (voice)

      // finish → POST /api/me/profile/complete, confetti/toast, Hoje
      const [fin] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/me/profile/complete')),
        btn(page, /^Começar o curso$/).click(),
      ]);
      expect(fin.status()).toBe(200);
      await expect(toast(page, 'Tudo pronto. Bem-vindo a Beacon, Bruno.')).toBeVisible();
      await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1, name: /Oi, Bruno/ })).toBeVisible();
      const st = await serverState(page);
      expect(st.profile).toMatchObject({ name: 'Bruno', fullName: 'Bruno Teste Silva', level: 'zero', minutes: 40 });
      expect(st.profile.goals).toHaveLength(2);
      expect(st.profile.formats).toHaveLength(1);
      expect(st.profile.diffs).toHaveLength(2);
      expect(st.profile.mainDiff).toBe(st.profile.diffs[1]);
      expect(st.profile.days).toEqual([1, 3, 5]);
      expect(st.profile.reminders).toHaveLength(4);
      expect(st.profile.reminders).toEqual([...st.profile.reminders].sort());
      expect(st.profile.reminders).toContain('06:45');
      expect(st.profile.voice?.score).toEqual(expect.any(Number));
      expect(goalKeysUi.length).toBe(2);
      // reload keeps the profile; perfil shows the answers
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: /Oi, Bruno/ })).toBeVisible({ timeout: 20_000 });
      await page.goto('/#/perfil');
      await expect(view(page).locator('.card.navy .h1')).toHaveText('Bruno');
      await expect(view(page).locator('.card.navy')).toContainText(email);
      // logout and log back in with the new password
      await btn(page, /^Sair$/).click();
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      await page.locator('#login-email').fill(email);
      await page.locator('#login-pass').fill(pass);
      await btn(page, /^Entrar$/).click();
      await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
      await expectClean(page, w);
    });

    test(`cadastro: email taken, skip path, X logs out, resume step (${vp})`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await prep(context);
      const w = watch(page, [
        /http 409 POST .*\/api\/auth\/signup/,
        /409 \(Conflict\)/,
        /http 401 GET .*\/api\/me\/state/,
        /401 \(Unauthorized\)/,
      ]);
      await page.goto('/#/cadastro/1');
      const v = view(page);
      await expect(v.locator('#onb-fullname')).toBeVisible({ timeout: 20_000 });
      await fillAccount(page, {
        full: 'Ana Repetida',
        name: 'Ana',
        birth: '1994-05-12',
        email: emailOf(`u1-login-${vp}`),
        pass: 'qualquer-123',
      });
      const [r] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/auth/signup')),
        btn(page, /^Continuar/).click(),
      ]);
      expect(r.status()).toBe(409);
      await expect(v.locator('.err')).toHaveCount(1);
      await expect(page).toHaveURL(/#\/cadastro\/1$/);
      // new account, Pular on 2–5
      const email = `u1-skip-${vp}-${id8()}@e2e.test`;
      await page.locator('#onb-email').fill(email);
      await btn(page, /^Continuar/).click();
      await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
      for (const n of [2, 3, 4, 5]) {
        await btn(page, /^Pular$/).click();
        await expect(page).toHaveURL(new RegExp(`#\\/cadastro\\/${n + 1}$`));
      }
      await expect(btn(page, /^Pular$/)).toHaveCount(0); // ritmo has no Pular
      // reload on 6 → still 6 (onbStep persisted)
      await page.waitForTimeout(800);
      await page.reload();
      await expect(page).toHaveURL(/#\/cadastro\/6$/, { timeout: 20_000 });
      // signed in, no profile: /#/inicio → resumes the onboarding
      await page.goto('/#/inicio');
      await expect(page).toHaveURL(/#\/cadastro\/6$/, { timeout: 20_000 });
      // step 1 X while signed in = logout
      await page.goto('/#/cadastro/1');
      await expect(page.locator('#onb-email')).toHaveValue(email);
      await view(page).getByRole('button', { name: 'Sair' }).click();
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      const me = await page.evaluate(async () => (await fetch('/api/me/state')).status);
      expect(me).toBe(401);
      await expectClean(page, w);
    });

    test(`cadastro: voice test with AI on sends the WAV to /api/pronounce (${vp})`, async ({ page, context }) => {
      test.setTimeout(90_000);
      await prep(context, { ai: true });
      let body: Any | null = null;
      await context.route('**/api/pronounce', async (route) => {
        body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            score: 9,
            praise_pt: 'Muito bem!',
            issues: [{ word: 'Hi', tip_pt: 'só ar' }],
            heard: 'hi im carla',
          }),
        });
      });
      const w = watch(page, [...SIGNED_OUT, /speech|recogn/i]);
      await page.goto('/#/cadastro/1');
      await expect(page.locator('#onb-fullname')).toBeVisible({ timeout: 20_000 });
      await fillAccount(page, {
        full: 'Carla Voz',
        name: 'Carla',
        birth: '2001-02-03',
        email: `u1-voz-${vp}-${id8()}@e2e.test`,
        pass: `pw-${id8()}`,
      });
      await btn(page, /^Continuar/).click();
      await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
      await page.goto('/#/cadastro/7');
      const vz = view(page);
      await expect(vz).toContainText('Hi, I’m Carla.');
      await expect(vz).not.toContainText('No modo demo a nota é estimada.');
      await vz.getByRole('button', { name: 'Gravar' }).click();
      await expect(vz.locator('.mic.rec')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(800);
      // While recording, the mic button is named for what it does now.
      await expect(vz.locator('.mic.rec')).toHaveAttribute('aria-pressed', 'true');
      await vz.getByRole('button', { name: 'Parar a gravação' }).click(); // stop early
      await expect(vz.locator('.num')).toHaveText('9', { timeout: 15_000 });
      await expect(vz.locator('.fb.ok')).toContainText('Muito bem!');
      await expect(vz.locator('.fb.ok')).toContainText('Hi: só ar');
      expect(body, 'pronounce called').not.toBeNull();
      expect((body as unknown as Any).target).toBe('Hi, I’m Carla.');
      const wav = Buffer.from(String((body as unknown as Any).audio || ''), 'base64');
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
      await expectClean(page, w);
    });

    // ------------------------------------------------------------ perfil

    test(`perfil: header, layout, sessions, ladder, plan (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-head-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      const leaks: string[] = [];
      page.on('response', async (r) => {
        if (!r.url().includes('/api/') || !/json/.test(r.headers()['content-type'] || '')) return;
        const t = await r.text().catch(() => '');
        if (/"persona"|systemPrompt|"system"\s*:|pass_hash|token_hash/.test(t)) leaks.push(r.url());
      });
      await page.goto('/#/perfil');
      const v = view(page);
      await expect(v.locator('.card.navy .h1')).toHaveText('Ana', { timeout: 20_000 });
      await expect(v.locator('.card.navy')).toContainText(emailOf(key));
      await expect(v.locator('.card.navy .pill').last()).toHaveText(/^A\d\+? · Temporada \d$/);
      await expect(v.locator('.gamebar').first()).toBeVisible();
      if (vp === 'mobile') {
        await expect(page.locator('.tabbar')).toBeVisible();
        await expect(page.locator('aside.side')).toHaveCount(0);
      } else {
        await expect(page.locator('aside.side')).toBeVisible();
        await expect(page.locator('.tabbar')).toHaveCount(0);
      }
      const titles = await v.locator('.card.stack > div:first-child > .lbl').allTextContents();
      for (const t of [
        'Sua foto',
        'Seu assistente no Mic',
        'Seu nível',
        'O que você busca',
        'Formatos que você curte',
        'Gêneros',
        'Fora da tela',
        'O que trava',
        'Jeito de aprender',
        'Ritmo',
        'Do zero ao B2',
        'Leitura, som e efeitos',
        'Plano',
      ])
        expect(titles, `section ${t}`).toContain(t);
      await expect(v.locator('.avpick')).toHaveCount(6);
      await expect(v.locator('.avpick.on')).toHaveCount(1);
      await expect(v.locator('.assist-row .assist')).toHaveCount(5);
      // ladder: 8 bars
      const ladder = v.locator('.card', { hasText: 'Do zero ao B2' });
      for (const c of ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+'])
        await expect(ladder.getByText(c, { exact: true })).toBeVisible();
      // Mic sessions (≤4) link to their reports
      const st = await serverState(page);
      const n = Math.min(4, st.maggie.sessions.length);
      if (n) {
        const rows = v.locator('.card', { hasText: 'Conversas no Mic' }).locator('a.listrow');
        await expect(rows).toHaveCount(n);
        await expect(rows.first()).toHaveAttribute('href', `#/maggie/relatorio/${st.maggie.sessions[0].id}`);
        await expect(rows.first()).toContainText(/\d+ falas/);
      } else console.log(`[u1] ${vp}: no Mic sessions in /api/me/state for the fixture user`);
      // plan: real plan name and minutes
      const plan = v.locator('.card', { has: page.locator('.lbl', { hasText: /^Plano$/ }) });
      await expect(plan.locator('.h3')).toHaveText(`Plano ${st.plan?.name ?? 'Padrão'}`);
      const limit = Math.round(st.plan?.aiMinutesMonth ?? st.maggie.limitSec / 60);
      await expect(plan.locator('.sm').first()).toHaveText(
        new RegExp(`^${limit} min de conversa no Mic por mês · \\d+ usados$`),
      );
      await expect(plan).toContainText(/\d+ min livres/);
      // account actions
      for (const b of ['Sair', 'Zerar progresso', 'Excluir minha conta'])
        await expect(btn(page, new RegExp(`^${b}$`))).toBeVisible();
      expect(await unnamedControls(page), 'unnamed controls').toEqual([]);
      expect(leaks, 'persona / secrets in API responses').toEqual([]);
      await expectClean(page, w);
    });

    test(`perfil: avatar + photo upload (256x256 JPEG) + clear (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-photo-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      await page.goto('/#/perfil');
      const v = view(page);
      await expect(v.locator('.avpick')).toHaveCount(6, { timeout: 20_000 });
      // avatar pick
      const body = await nextProfilePut(page, () => v.locator('.avpick').nth(4).click());
      expect(body).toEqual({ avatar: 5 });
      await expect(v.locator('.avpick').nth(4)).toHaveClass(/\bon\b/);
      // photo upload: 640×400 PNG → client crops to 256×256 JPEG
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 400;
        const g = c.getContext('2d')!;
        g.fillStyle = '#2A6FF5';
        g.fillRect(0, 0, 640, 400);
        g.fillStyle = '#F45A28';
        g.fillRect(200, 100, 240, 200);
        return c.toDataURL('image/png').split(',')[1];
      });
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/me/photo') && r.method() === 'POST'),
        v
          .locator('input[type=file]')
          .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png ?? '', 'base64') }),
      ]);
      const pd = req.postDataBuffer();
      expect(pd, 'multipart body').toBeTruthy();
      expect(req.headers()['content-type']).toMatch(/multipart\/form-data/);
      expect(jpegSize(pd as Buffer)).toEqual({ w: 256, h: 256 });
      const res = await req.response();
      expect(res?.status()).toBeLessThan(300);
      await expect(toast(page, 'Foto atualizada.')).toBeVisible();
      await expect(v.getByText('Trocar a minha foto')).toBeVisible();
      await expect(v.getByRole('button', { name: 'Usar um avatar em vez da foto' })).toBeVisible();
      await expect(v.locator('.avpick.on')).toHaveCount(0);
      // reload: the photo persists and loads from the server
      await page.reload();
      await expect(view(page).getByText('Trocar a minha foto')).toBeVisible({ timeout: 20_000 });
      const st = await serverState(page);
      expect(st.profile.photo).toBeTruthy();
      expect(String(st.profile.photo)).not.toMatch(/^blob:|^data:/);
      const picOk = await page.evaluate(async (src) => (await fetch(src)).status, st.profile.photo);
      expect(picOk).toBe(200);
      const header = view(page).locator('.card.navy img').first();
      if (await header.count())
        await expect.poll(() => header.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(256);
      // clear → DELETE /api/me/photo, avatar back
      const [del] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/me/photo') && r.method() === 'DELETE'),
        view(page).getByRole('button', { name: 'Usar um avatar em vez da foto' }).click(),
      ]);
      expect((await del.response())?.status()).toBeLessThan(300);
      await expect(view(page).getByText('Enviar a minha foto')).toBeVisible();
      await expect(view(page).locator('.avpick').nth(4)).toHaveClass(/\bon\b/);
      await page.reload();
      await expect(view(page).getByText('Enviar a minha foto')).toBeVisible({ timeout: 20_000 });
      await expect(view(page).locator('.avpick').nth(4)).toHaveClass(/\bon\b/);
      // a non-image file is refused with a toast, nothing sent
      let posted = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/me/photo') && r.method() === 'POST') posted++;
      });
      await view(page)
        .locator('input[type=file]')
        .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
      await expect(toast(page, 'Não deu para ler esta imagem. Tente outra foto.')).toBeVisible();
      expect(posted).toBe(0);
      await expectClean(page, w);
    });

    test(`perfil: assistant, level, goals, formats, genres, themes, diffs, styles, feedback (${vp})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      const key = `u1-pf-prefs-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      await page.goto('/#/perfil');
      const v = view(page);
      await expect(v.locator('.assist-row .assist')).toHaveCount(5, { timeout: 20_000 });
      const sec = (t: string) =>
        v
          .locator('.card.stack')
          .filter({ has: page.locator(':scope > div:first-child > .lbl', { hasText: new RegExp(`^${t}$`) }) });
      // assistant: picks + speaks hello
      const other = v.locator('.assist-row .assist:not(.on)').first();
      const otherName = (await other.locator('b').textContent()) ?? '';
      const ab = await nextProfilePut(page, () => other.click());
      expect(ab.assistant).toBeTruthy();
      await expect(v.locator('.assist-row .assist.on b')).toHaveText(otherName);
      await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
      await expect(sec('Jeito de aprender')).toContainText(new RegExp(`Quando erra, (a|o) ${otherName}…`));
      // level
      const lvl = sec('Seu nível').locator('.chip');
      await expect(lvl).toHaveCount(4);
      const lb = await nextProfilePut(page, () => lvl.nth(3).click());
      expect(lb).toEqual({ level: 'avancar' });
      await expect(toast(page, 'Nível atualizado.')).toBeVisible();
      await expect(v.locator('.card.navy .pill').last()).toHaveText(/Temporada [2-8]/);
      // goals ≤3 (Ana has 3)
      const goals = sec('O que você busca').locator('.chip');
      await expect(sec('O que você busca').locator('.chip.on')).toHaveCount(3);
      let puts = 0;
      const cnt = (r: Request) => {
        if (r.url().endsWith('/api/me/profile') && r.method() === 'PUT') puts++;
      };
      page.on('request', cnt);
      await sec('O que você busca').locator('.chip:not(.on)').first().click();
      await expect(toast(page, 'Até 3. Desmarque um para trocar.')).toBeVisible();
      await page.waitForTimeout(300);
      expect(puts).toBe(0);
      page.off('request', cnt);
      const gb = await nextProfilePut(page, () => sec('O que você busca').locator('.chip.on').first().click());
      expect(gb.goals).toHaveLength(2);
      await expect(sec('O que você busca').locator('.chip.on')).toHaveCount(2);
      void goals;
      // formats → toast + genres section follows
      const genresBefore = await sec('Gêneros').locator('.chip').count();
      const fb = await nextProfilePut(page, () =>
        sec('Formatos que você curte').locator('.chip', { hasText: 'Games' }).click(),
      );
      expect(fb.formats).toHaveLength(4);
      await expect(toast(page, 'Prateleira do EXTRA reorganizada.')).toBeVisible();
      await expect.poll(() => sec('Gêneros').locator('.chip').count()).toBeGreaterThan(genresBefore);
      // genres / themes toggles
      const gen = await nextProfilePut(page, () => sec('Gêneros').locator('.chip:not(.on)').first().click());
      expect(gen.genres.length).toBe(7);
      const th = await nextProfilePut(page, () => sec('Fora da tela').locator('.chip.on').first().click());
      expect(th.themes.length).toBe(2);
      // diffs + main
      const tr = sec('O que trava');
      await expect(tr.getByText('O que trava mais · vira o foco da semana')).toBeVisible();
      const mainChips = tr.locator('.chips').nth(1).locator('.chip');
      await expect(mainChips).toHaveCount(3);
      const mb = await nextProfilePut(page, () => mainChips.nth(2).click());
      expect(mb).toEqual({ mainDiff: 'shy' });
      await expect(toast(page, 'Foco da semana atualizado.')).toBeVisible();
      // removing the main diff moves mainDiff to the first one left
      const db = await nextProfilePut(page, () => tr.locator('.chips').first().locator('.chip.on').nth(2).click());
      expect(db).toEqual({ diffs: ['pron', 'listening'], mainDiff: 'pron' });
      // styles, feedback
      const sb = await nextProfilePut(page, () =>
        sec('Jeito de aprender').locator('.chips').first().locator('.chip:not(.on)').first().click(),
      );
      expect(sb.styles).toHaveLength(3);
      const fdb = await nextProfilePut(page, () =>
        sec('Jeito de aprender').locator('.chips').nth(1).locator('.chip:not(.on)').first().click(),
      );
      expect(typeof fdb.feedback).toBe('string');
      // reload: everything persisted on the server
      await page.waitForTimeout(500);
      await page.reload();
      await expect(view(page).locator('.assist-row .assist.on b')).toHaveText(otherName, { timeout: 20_000 });
      const st = await serverState(page);
      expect(st.profile).toMatchObject({
        level: 'avancar',
        mainDiff: 'pron',
        diffs: ['pron', 'listening'],
        feedback: fdb.feedback,
      });
      expect(st.profile.goals).toHaveLength(2);
      expect(st.profile.formats).toHaveLength(4);
      expect(st.profile.genres).toHaveLength(7);
      expect(st.profile.themes).toHaveLength(2);
      expect(st.profile.styles).toHaveLength(3);
      expect(st.profile.assistant).toBe(ab.assistant);
      await expectClean(page, w);
    });

    test(`perfil: ritmo — days, minutes (goal toast), reminders (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-rhythm-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      await page.goto('/#/perfil');
      const v = view(page);
      const sec = v
        .locator('.card.stack')
        .filter({ has: page.locator(':scope > div:first-child > .lbl', { hasText: /^Ritmo$/ }) });
      await expect(sec.locator('.days button')).toHaveCount(7, { timeout: 20_000 });
      const d = await nextProfilePut(page, () => sec.locator('.days button').nth(0).click());
      expect(d).toEqual({ days: [0, 1, 2, 3, 4, 5] });
      await expect(sec.locator('.days button.on')).toHaveCount(6);
      const goalLbl = sec.locator('.lbl', { hasText: /Minutos por dia · meta de \d+ pontos/ });
      const g0 = await goalLbl.textContent();
      const m = await nextProfilePut(page, () => sec.locator('.chips .chip').nth(3).click());
      expect(m).toEqual({ minutes: 50 });
      await expect(toast(page, /^Meta diária: \d+ pontos\.$/)).toBeVisible();
      await expect(goalLbl).not.toHaveText(g0 ?? '');
      // reminders: Ana has 07:30 and 20:00
      const times = sec.locator('input[type=time]');
      await expect(times).toHaveCount(2);
      const a = await nextProfilePut(page, () => sec.getByRole('button', { name: 'Adicionar lembrete' }).click());
      expect(a.reminders).toEqual(['07:30', '20:00', '07:00']);
      await expect(times).toHaveCount(3);
      const r = await nextProfilePut(page, () => sec.getByRole('button', { name: 'Remover lembrete 1' }).click());
      expect(r.reminders).toEqual(['20:00', '07:00']);
      const e = await nextProfilePut(page, () => times.nth(1).fill('21:15'));
      expect(e.reminders).toEqual(['20:00', '21:15']);
      for (let i = 2; i < 5; i++)
        await nextProfilePut(page, () => sec.getByRole('button', { name: 'Adicionar lembrete' }).click());
      await expect(times).toHaveCount(5);
      await expect(sec.getByRole('button', { name: 'Adicionar lembrete' })).toHaveCount(0);
      await page.waitForTimeout(400);
      await page.reload();
      const sec2 = view(page)
        .locator('.card.stack')
        .filter({ has: page.locator(':scope > div:first-child > .lbl', { hasText: /^Ritmo$/ }) });
      await expect(sec2.locator('input[type=time]')).toHaveCount(5, { timeout: 20_000 });
      await expect(sec2.locator('.days button.on')).toHaveCount(6);
      await expect(sec2.locator('.chips .chip').nth(3)).toHaveClass(/\bon\b/);
      const st = await serverState(page);
      expect(st.profile.minutes).toBe(50);
      expect(st.profile.reminders).toContain('21:15');
      await expectClean(page, w);
    });

    test(`perfil: text size + toggles persist, HD refused offline (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-settings-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      await page.goto('/#/perfil');
      const v = view(page);
      const seg = v.locator('.seg button');
      await expect(seg).toHaveCount(3, { timeout: 20_000 });
      await expect(seg.nth(0)).toHaveClass(/\bon\b/);
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/me/settings') && r.method() === 'PATCH'),
        seg.nth(2).click(),
      ]);
      expect(JSON.parse(req.postData() || '{}')).toEqual({ ts: 1.25 });
      await expect(seg.nth(2)).toHaveClass(/\bon\b/);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              getComputedStyle(document.documentElement).getPropertyValue('--ts').trim() ||
              getComputedStyle(document.querySelector('.app')!).getPropertyValue('--ts').trim(),
          ),
        )
        .toBe('1.25');
      const sw = (name: string) => v.getByRole('switch', { name });
      for (const n of [
        'Sons',
        'Confete e animações',
        'Voz HD dos personagens',
        'Começar em 0,75×',
        'Lembrete de episódio',
      ])
        await expect(sw(n)).toBeVisible();
      await expect(sw('Sons')).toHaveAttribute('aria-checked', 'true');
      await sw('Sons').click();
      await expect(sw('Sons')).toHaveAttribute('aria-checked', 'false');
      await sw('Confete e animações').click();
      await sw('Começar em 0,75×').click();
      await sw('Lembrete de episódio').click();
      // HD needs the AI
      let hdPatch = false;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/me/settings') && /"hd"/.test(r.postData() || '')) hdPatch = true;
      });
      await sw('Voz HD dos personagens').click();
      await expect(toast(page, 'A voz HD precisa da IA ligada. Tente de novo mais tarde.')).toBeVisible();
      await expect(sw('Voz HD dos personagens')).toHaveAttribute('aria-checked', 'false');
      await expect(v.getByText('Disponível quando a IA estiver ligada')).toBeVisible();
      await page.waitForTimeout(800);
      expect(hdPatch).toBe(false);
      await page.reload();
      await expect(view(page).locator('.seg button').nth(2)).toHaveClass(/\bon\b/, { timeout: 20_000 });
      const st = await serverState(page);
      expect(st.settings).toMatchObject({ ts: 1.25, sound: false, fx: false, slow: false, remind: false, hd: false });
      await expect(view(page).getByRole('switch', { name: 'Sons' })).toHaveAttribute('aria-checked', 'false');
      await expectClean(page, w);
    });

    test(`perfil: Baixar meus dados + Zerar progresso (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-reset-${vp}`;
      await prep(context, { key });
      const w = watch(page);
      await page.goto('/#/perfil');
      const v = view(page);
      await expect(btn(page, /^Zerar progresso$/)).toBeVisible({ timeout: 20_000 });
      // export
      const [dl] = await Promise.all([page.waitForEvent('download'), btn(page, /^Baixar meus dados$/).click()]);
      expect(dl.suggestedFilename()).toMatch(/^takeiteasy-dados-\d{4}-\d{2}-\d{2}\.json$/);
      const p = await dl.path();
      const data = JSON.parse(readFileSync(p, 'utf8'));
      expect(JSON.stringify(data)).toContain(emailOf(key));
      expect(JSON.stringify(data)).not.toMatch(/pass_hash|passHash|token_hash/);
      await expect(toast(page, 'Seus dados foram baixados.')).toBeVisible();
      // reset: cancel first
      const before = await serverState(page);
      expect(before.game.points).toBeGreaterThan(0);
      await btn(page, /^Zerar progresso$/).click();
      const sheet = page.getByRole('dialog', { name: 'Zerar o seu progresso?' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await serverState(page)).game.points).toBe(before.game.points);
      await btn(page, /^Zerar progresso$/).click();
      const [r] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/me/reset-progress')),
        page.getByRole('dialog').getByRole('button', { name: 'Zerar o progresso' }).click(),
      ]);
      expect(r.status()).toBeLessThan(300);
      await expect(toast(page, 'Progresso zerado. Bom recomeço!')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const after = await serverState(page);
      expect(after.game.points).toBe(0);
      expect(after.profile.name).toBe('Ana');
      expect(Object.keys(after.epsDone ?? {})).toHaveLength(0);
      await page.reload();
      await expect(view(page).locator('.card.navy .h1')).toHaveText('Ana', { timeout: 20_000 });
      void v;
      await expectClean(page, w);
    });

    test(`perfil: Excluir minha conta (password confirm) (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-del-${vp}`;
      await prep(context, { key });
      const w = watch(page, [/http 401 (DELETE|POST|GET) .*\/api\/(me|auth\/login|me\/state)/, /401 \(Unauthorized\)/]);
      await page.goto('/#/perfil');
      await expect(btn(page, /^Excluir minha conta$/)).toBeVisible({ timeout: 20_000 });
      await btn(page, /^Excluir minha conta$/).click();
      const sheet = page.getByRole('dialog', { name: 'Excluir a sua conta?' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Excluir minha conta' }).click();
      await expect(sheet.getByText('Digite a sua senha para confirmar.')).toBeVisible();
      await sheet.locator('#pf-del-pass').fill('errada-errada');
      const [bad] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/me') && x.request().method() === 'DELETE'),
        sheet.getByRole('button', { name: 'Excluir minha conta' }).click(),
      ]);
      expect(bad.status()).toBeGreaterThanOrEqual(400);
      await expect(sheet.getByText('Senha incorreta. Confira e tente de novo.')).toBeVisible();
      // scrim closes it
      await page.locator('.overlay .scrim').click({ position: { x: 5, y: 5 } });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await btn(page, /^Excluir minha conta$/).click();
      await page.locator('#pf-del-pass').fill(FIXTURE_PASSWORD);
      const [ok] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/me') && x.request().method() === 'DELETE'),
        page.locator('#pf-del-pass').press('Enter'),
      ]);
      expect(ok.status()).toBeLessThan(300);
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      await expect(toast(page, 'Sua conta foi excluída. Obrigado por estudar com a gente.')).toBeVisible();
      expect(await page.evaluate(async () => (await fetch('/api/me/state')).status)).toBe(401);
      // cannot log in any more
      await page.locator('#login-email').fill(emailOf(key));
      await page.locator('#login-pass').fill(FIXTURE_PASSWORD);
      const [li] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/auth/login')),
        btn(page, /^Entrar$/).click(),
      ]);
      expect(li.status()).toBe(401);
      await expect(page).toHaveURL(/#\/entrar$/);
      await expectClean(page, w);
    });

    test(`perfil: Sair ends the server session (${vp})`, async ({ page, context }) => {
      const key = `u1-pf-out-${vp}`;
      await prep(context, { key });
      const w = watch(page, [/http 401 GET .*\/api\/me\/state/, /401 \(Unauthorized\)/]);
      await page.goto('/#/perfil');
      await expect(btn(page, /^Sair$/)).toBeVisible({ timeout: 20_000 });
      const [r] = await Promise.all([
        page.waitForResponse((x) => x.url().endsWith('/api/auth/logout')),
        btn(page, /^Sair$/).click(),
      ]);
      expect(r.status()).toBeLessThan(300);
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      await page.reload();
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      // the old cookie is revoked server-side too
      const status = await page.evaluate(async () => (await fetch('/api/me/state')).status);
      expect(status).toBe(401);
      await page.goto('/#/perfil');
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 20_000 });
      const ls = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      expect(ls).not.toContain(emailOf(key));
      await expectClean(page, w);
    });

    test(`a11y: names + visible keyboard focus on entrar, cadastro, perfil (${vp})`, async ({ page, context }) => {
      await prep(context);
      const w = watch(page, [/http 401 GET .*\/api\/me\/state/, /401 \(Unauthorized\)/]);
      await page.goto('/#/entrar');
      await expect(page.locator('#login-email')).toBeVisible({ timeout: 20_000 });
      expect(await unnamedControls(page)).toEqual([]);
      expect(await tabTo(page, '#login-email')).toBe(true);
      expect(await ringVisible(page), 'focus ring on #login-email').toBe(true);
      expect(await tabTo(page, 'button[aria-label="Mostrar senha"]')).toBe(true);
      expect(await ringVisible(page), 'focus ring on eye button').toBe(true);
      expect(await tabTo(page, '.btn.block')).toBe(true);
      expect(await ringVisible(page), 'focus ring on Entrar').toBe(true);
      await page.goto('/#/cadastro/1');
      await expect(page.locator('#onb-fullname')).toBeVisible();
      expect(await unnamedControls(page)).toEqual([]);
      expect(await tabTo(page, 'button[aria-label="Sair"]')).toBe(true);
      expect(await ringVisible(page), 'focus ring on Sair').toBe(true);
      await expectClean(page, w);
      // perfil (signed in)
      await context.addCookies([
        { name: COOKIES.app, value: sessionToken(`u1-pf-a11y-${vp}`), url: sl.origin, httpOnly: true, sameSite: 'Lax' },
      ]);
      await page.reload();
      await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
      await page.goto('/#/perfil');
      await expect(view(page).locator('.avpick')).toHaveCount(6, { timeout: 20_000 });
      expect(await unnamedControls(page)).toEqual([]);
      expect(await tabTo(page, '.avpick', 120)).toBe(true);
      expect(await ringVisible(page), 'focus ring on .avpick').toBe(true);
      expect(await tabTo(page, '.chip', 120)).toBe(true);
      expect(await ringVisible(page), 'focus ring on .chip').toBe(true);
      expect(await tabTo(page, '[role=switch]', 200)).toBe(true);
      expect(await ringVisible(page), 'focus ring on switch').toBe(true);
      // keyboard activation of a chip
      expect(await tabTo(page, '.days button', 200)).toBe(true);
      const was = await page.evaluate(() => document.activeElement!.classList.contains('on'));
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/me/profile') && r.method() === 'PUT'),
        page.keyboard.press('Enter'),
      ]);
      expect(req).toBeTruthy();
      await expect
        .poll(() => page.evaluate(() => document.querySelector('.days button')!.classList.contains('on')))
        .toBe(!was);
      await expectClean(page, w);
    });
  });
}

// ---------------------------------------------------------------- security: headers + client bundle

test.describe('U1 security', () => {
  test('CSP and security headers are served with the app shell', async ({ request }) => {
    const r = await request.get(`${sl.origin}/`);
    expect(r.status()).toBe(200);
    const h = r.headers();
    const csp = h['content-security-policy'] ?? '';
    expect(csp, 'CSP header').toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  test('client bundle carries no secrets, persona or AI prompts; slice code has no innerHTML', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const dist = sl.distDir('app');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html|json|webmanifest|css|map)$/.test(e.name)) files.push(p);
      }
    };
    walk(dist);
    expect(files.length).toBeGreaterThan(5);
    const BAD =
      /"persona"|persona:|systemPrompt|You are (Maggie|an? )|TURNSTILE_SECRET|SESSION_SECRET|BEGIN (RSA )?PRIVATE|pass_hash|token_hash|@cf\/meta\//;
    const hits = files
      .map((f) => [f, BAD.exec(readFileSync(f, 'utf8'))?.[0]] as const)
      .filter(([, m]) => m)
      .map(([f, m]) => `${f.slice(dist.length)}: ${m}`);
    expect(hits, 'secrets / persona in client bundle').toEqual([]);
    expect(files.filter((f) => f.endsWith('.map')), 'source maps shipped').toEqual([]);
    const slice = ['screens/entrada', 'screens/cadastro', 'screens/perfil'].flatMap((d) =>
      readdirSync(join(root, 'apps/app/web/src', d)).map((f) => join(root, 'apps/app/web/src', d, f)),
    );
    const html = slice.filter((f) =>
      /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/.test(readFileSync(f, 'utf8')),
    );
    expect(html, 'innerHTML in U1 slice code').toEqual([]);
  });
});

// ---------------------------------------------------------------- DOM parity with the prototype (report)

function signatureFn(sel: string): string[] {
  const root = document.querySelectorAll(sel);
  const el0 = root[root.length - 1];
  if (!el0) return ['<no root>'];
  const out: string[] = [];
  const walk = (el: Element, d: number) => {
    let buf = '';
    const ind = '  '.repeat(d);
    const flushText = () => {
      const t = buf.replace(/\s+/g, ' ').trim();
      if (t) out.push(`${ind}"${t}"`);
      buf = '';
    };
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        buf += n.textContent || '';
        continue;
      }
      flushText();
      if (n.nodeType !== 1) continue;
      const e = n as HTMLElement;
      const tag = e.tagName.toLowerCase();
      if (tag === 'svg') {
        out.push(`${ind}svg`);
        continue;
      }
      if (tag === 'video' || tag === 'source') continue;
      const cls = Array.from(e.classList)
        .filter((c) => c !== 'enter')
        .sort()
        .join('.');
      const st: string[] = [];
      for (let i = 0; i < e.style.length; i++) {
        const p = e.style[i] as string;
        if (p === 'background-image') continue;
        st.push(`${p}:${e.style.getPropertyValue(p).trim()}`);
      }
      st.sort();
      const attrs: string[] = [];
      for (const a of ['href', 'id', 'placeholder', 'disabled', 'aria-label']) {
        if (e.hasAttribute(a)) attrs.push(`${a}=${e.getAttribute(a)}`);
      }
      out.push(
        `${ind}${tag}${cls ? `.${cls}` : ''}${st.length ? ` {${st.join(';')}}` : ''}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`,
      );
      walk(e, d + 1);
    }
    flushText();
  };
  walk(el0, 0);
  return out;
}

function lineDiff(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) out.push(`+ app   @${j}: ${b[j++]}`);
    else out.push(`- proto @${i}: ${a[i++]}`);
  }
  return out;
}

test.describe('U1 DOM parity with the prototype', () => {
  let proto: StaticServer;
  test.beforeAll(async () => {
    proto = await servePrototype(sl.protoPort);
  });
  test.afterAll(async () => {
    await proto?.close();
  });
  for (const vp of VPS) {
    test(`DOM parity report (${vp})`, async ({ browser }) => {
      test.setTimeout(300_000);
      // [name, route, app user (null = signed out)]
      const cases: [string, string, string | null][] = [
        ['entrar', 'entrar', null],
        ['cadastro-1', 'cadastro/1', null],
        ...[2, 3, 4, 5, 6, 7].map((n): [string, string, string] => [
          `cadastro-${n}`,
          `cadastro/${n}`,
          `u1-cmp-onb${n}-${vp}`,
        ]),
        ['perfil', 'perfil', `u1-cmp-main-${vp}`],
      ];
      const summary: Record<string, number> = {};
      mkdirSync(OUT, { recursive: true });
      for (const [name, route, user] of cases) {
        const sigs: Record<'proto' | 'app', string[]> = { proto: [], app: [] };
        for (const side of ['proto', 'app'] as const) {
          const ctx = await browser.newContext({ ...contextOptions(vp) });
          try {
            if (side === 'proto') {
              const st = user ? isolateState(baseState(user), user, emailOf(user)) : null;
              await prepareContext(ctx, {
                side: 'prototype',
                seedKey: `${name}|${vp}`,
                storage: storageOf(st),
                allowOrigins: [new URL(proto.url).origin],
              });
            } else {
              await prep(ctx, user ? { key: user } : {});
            }
            const page = await ctx.newPage();
            const base = side === 'proto' ? proto.url.replace(/\/?$/, '/') : `${sl.origin}/`;
            await page.goto(`${base}#/${route}`);
            await expect(page.locator('.view h1, .view .card').first()).toBeVisible({ timeout: 20_000 });
            await page.waitForTimeout(1200);
            sigs[side] = await page.evaluate(signatureFn, '.view');
          } finally {
            await ctx.close();
          }
        }
        const d = lineDiff(sigs.proto, sigs.app);
        summary[name] = d.length;
        // The wizard steps after the account must keep the prototype's STRUCTURE (tags, classes, ids,
        // text) so tie.css renders them the same; inline-style refinements (desktop 2-column cards,
        // readable disabled CTA, check-circle shadow, VU resting shape…) are reported in the .diff.txt
        // files but not asserted. Intended structural changes: full weekday names on the .days buttons
        // (proto: "dia N"), the voice step's non-demo footer copy, and the estilo counter line.
        const noStyle = (l: string) => l.replace(/ \{[^}]*\}/g, '');
        const ds = lineDiff(sigs.proto.map(noStyle), sigs.app.map(noStyle));
        const INTENDED = [
          /button(\.on)? \[aria-label=(dia \d|Domingo|Segunda|Terça|Quarta|Quinta|Sexta|Sábado)\]$/,
          /"O microfone só liga quando .*(No modo demo a nota é estimada|a nota é uma estimativa)\."$/,
          /^\+ app .*(div\.sm$|"Marque pelo menos um para continuar"$|"\d+ escolhidos?"$)/,
        ];
        const unexpected = ds.filter((l) => !INTENDED.some((re) => re.test(l)));
        if (/^cadastro-[2-7]$/.test(name))
          expect
            .soft(unexpected, `DOM diff ${name} ${vp} (out/u1-auth/dom-${name}-${vp}.diff.txt)`)
            .toEqual([]);
        writeFileSync(join(OUT, `dom-${name}-${vp}.proto.txt`), sigs.proto.join('\n'));
        writeFileSync(join(OUT, `dom-${name}-${vp}.app.txt`), sigs.app.join('\n'));
        writeFileSync(join(OUT, `dom-${name}-${vp}.diff.txt`), d.join('\n'));
      }
      writeFileSync(join(OUT, `dom-summary-${vp}.json`), JSON.stringify(summary, null, 2));
      console.log(`[u1] DOM diff lines ${vp}: ${JSON.stringify(summary)}`);
    });
  }
});
