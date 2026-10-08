// U4-hoje functional verification: Hoje (#/inicio), Conquistas (#/conquistas) and Revisão (#/revisao)
// driven against the real Worker (slot E2E_SLOT), on mobile and desktop, and compared with the
// prototype (prototipo/js/screens/inicio.js + conta.js) fed the very same fixture state.
//   npm run e2e -- --slot 34 specs/U4-hoje.spec.ts
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { APP_DIRS, slot as slotOf } from '../../parity/src/config';
import { FIXTURE_PASSWORD, fixtureUsers, storageOf } from '../../parity/src/fixture/state';
import { type StaticServer, servePrototype } from '../../parity/src/servePrototype';
import { SLOT } from '../src/slotEnv';
import { stubTurnstile } from '../src/turnstile';

const DESKTOP = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const PROTO = slotOf(SLOT).protoOrigin;

// ---------- page instrumentation ----------

interface Watch {
  errors: string[];
  csp: string[];
}
const watches = new WeakMap<Page, Watch>();

/** Console errors, page errors and CSP violations of a page (checked at the end of every test). */
async function instrument(ctx: BrowserContext, page: Page): Promise<Watch> {
  const w: Watch = { errors: [], csp: [] };
  watches.set(page, w);
  await ctx.addInitScript(() => {
    const W = window as unknown as { __csp: string[]; __said: string[] };
    W.__csp = [];
    W.__said = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      W.__csp.push(
        `${e.violatedDirective} ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${String(e.sample || '').slice(0, 120)}`,
      );
    });
    // TTS probe: record what speechSynthesis was asked to say (no real audio in headless runs).
    try {
      const ss = window.speechSynthesis;
      if (ss) {
        const orig = ss.speak.bind(ss);
        ss.speak = (u: SpeechSynthesisUtterance) => {
          W.__said.push(u.text);
          try {
            orig(u);
          } catch {
            // ignore
          }
        };
      }
    } catch {
      // ignore
    }
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) w.csp.push(t);
    else w.errors.push(`console: ${t}`);
  });
  return w;
}

async function assertClean(page: Page) {
  const w = watches.get(page);
  if (!w) return;
  const inPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  // Known, global (not this slice): zod v4's JIT probe `Function('')` in the shared chunk trips script-src eval once per load.
  const ZOD_PROBE = /^script-src eval @ .*\/assets\/[\w-]+\.js:1:\d+/;
  const all = w.csp.concat(inPage);
  const zod = all.filter((x) => ZOD_PROBE.test(x));
  if (zod.length) console.log(`[U4] zod eval probe CSP reports: ${zod.length} (${test.info().title})`);
  expect(
    all.filter((x) => !ZOD_PROBE.test(x)),
    'CSP violations',
  ).toEqual([]);
  expect(w.errors, 'console/page errors').toEqual([]);
  await expect(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

test.beforeEach(async ({ context, page }) => {
  await stubTurnstile(context);
  await context.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
  );
  await instrument(context, page);
});

test.afterEach(async ({ page }) => {
  await assertClean(page);
});

// ---------- helpers ----------

/** Every button/link/role=button in the view has an accessible name (aria-label, text, or img alt). */
async function assertNamedControls(page: Page) {
  const unnamed = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll('.view button, .view a, .view [role="button"], aside button, aside a, nav a'),
    )) {
      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el.textContent ?? '').trim() ||
        Array.from(el.querySelectorAll('img[alt]'))
          .map((i) => i.getAttribute('alt'))
          .join('');
      if (!name) out.push(el.outerHTML.slice(0, 160));
    }
    return out;
  });
  expect(unnamed, 'controls without an accessible name').toEqual([]);
}

/** The signed-out probe (GET /api/me/state → 401 on #/entrar) is expected: count errors from sign-in on. */
function signedIn(page: Page) {
  const w = watches.get(page);
  if (w) w.errors = w.errors.filter((e) => !/status of 401/.test(e));
}

async function login(page: Page, email: string) {
  await page.goto('/#/entrar');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-pass').fill(FIXTURE_PASSWORD);
  await page
    .getByRole('button', { name: /^Entrar$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
  signedIn(page);
}

async function apiState(page: Page): Promise<Record<string, unknown> & { game: { points: number }; deck: unknown[] }> {
  const r = await page.request.get('/api/me/state');
  expect(r.status()).toBe(200);
  return (await r.json()) as never;
}

async function signupFresh(page: Page, name = 'Carla') {
  const id = randomBytes(4).toString('hex');
  await page.goto('/#/entrar');
  await page.getByText('Criar conta grátis').first().click();
  await page.locator('#onb-fullname').fill(`${name} Teste`);
  await page.locator('#onb-name').fill(name);
  await page.locator('#onb-birth').fill('1996-03-21');
  await page.locator('#onb-email').fill(`u4-${id}@e2e.test`);
  await page.locator('#onb-pass').fill(`pw-${randomBytes(6).toString('hex')}`);
  const btn = (re: RegExp) => page.getByRole('button', { name: re }).first();
  await btn(/^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
  await page.getByText('Viajar sem travar').first().click();
  await btn(/^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/3$/);
  for (const n of [3, 4, 5]) {
    await btn(/^Pular$/).click();
    await expect(page).toHaveURL(new RegExp(`#\\/cadastro\\/${n + 1}$`));
  }
  await btn(/^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/7$/);
  await btn(/Pular por enquanto|Começar o curso/).click();
  await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
  signedIn(page);
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Hoje's sections as plain text (same extraction on both sides). */
async function hojeDigest(page: Page) {
  return page.evaluate(() => {
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const cardWith = (lbl: string) =>
      Array.from(document.querySelectorAll('.card')).find((c) =>
        n(c.querySelector('.lbl')?.textContent).startsWith(lbl),
      );
    const mic = Array.from(document.querySelectorAll('a.card')).find((a) =>
      (a.getAttribute('href') ?? '').includes('maggie'),
    );
    return {
      hello: n(document.querySelector('h1.h1')?.textContent),
      // The port says "Etapa de hoje feita" where the prototype said "Episódio de hoje feito".
      nowCard: n(document.querySelector('.now-card')?.textContent).replace(
        'Etapa de hoje feita',
        'Episódio de hoje feito',
      ),
      // The port drops the Extra row's video length (" · 9 min") from its detail, next to its 8 min.
      tasks: Array.from(document.querySelectorAll('.plan .task')).map((t) => [
        t.getAttribute('href'),
        t.className,
        n(t.textContent).replace(/ · \d+ min(?=\d+ min$)/, ''),
      ]),
      plan: n(cardWith('Plano de hoje')?.textContent).replace(/ · \d+ min(?=\d+ min)/g, ''),
      missions: n(cardWith('Missões do dia')?.textContent),
      covers: Array.from(document.querySelectorAll('.covers .cover')).map((c) => n(c.textContent)),
      micHref: mic?.getAttribute('href') ?? null,
      mic: n(mic?.textContent),
      focus: n(document.querySelector('.card.or')?.textContent),
      homeGrid: !!document.querySelector('.home-grid'),
      topbar: !!document.querySelector('header.topbar'),
    };
  });
}

/** The prototype fed `state` in localStorage (fresh context per call), on the same route. */
async function protoPage(ctx: BrowserContext, state: unknown, hash: string): Promise<Page> {
  const storage = storageOf(state);
  await ctx.addInitScript((st) => {
    if (!st) return;
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v as string);
  }, storage);
  await ctx.route(
    (u) => !u.href.startsWith(PROTO),
    (r) => r.abort('blockedbyclient'),
  );
  const p = await ctx.newPage();
  await p.goto(`${PROTO}/index.html#/${hash}`, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return p;
}

let proto: StaticServer | null = null;
test.beforeAll(async () => {
  try {
    proto = await servePrototype(slotOf(SLOT).protoPort);
  } catch {
    proto = null; // already served (parity run on the same slot): reuse it
  }
});
test.afterAll(async () => {
  await proto?.close().catch(() => {});
});

const users = fixtureUsers();
const userState = (key: string) => users.find((u) => u.key === key)?.state;

// =====================================================================================
// Hoje
// =====================================================================================

test.describe('Hoje (#/inicio)', () => {
  test('mobile: sections, links and Mic minutes from the server', async ({ page, browser }) => {
    await login(page, 'ana.s7@parity.test');
    const st = (await apiState(page)) as unknown as { maggie: { secLeft: number }; profile: { name: string } };
    await expect(page.getByRole('heading', { level: 1, name: 'Oi, Ana.' })).toBeVisible();
    const d = await hojeDigest(page);
    expect(d.topbar, 'mobile topbar').toBe(true);
    expect(d.homeGrid).toBe(false);
    await expect(page.locator('header.topbar .logo')).toBeVisible();
    await expect(page.locator('header.topbar')).toContainText(/Modo demo|IA ligada/);
    // Gamebar comes first in the mobile column
    const firstKid = await page.evaluate(() => {
      const wrap = document.querySelector('.scroll .wrap');
      const col = wrap?.children[1];
      return col?.firstElementChild?.className ?? '';
    });
    expect(firstKid).toMatch(/gamebar/);
    // Now-card: ep 1 at step 7
    expect(d.nowCard).toContain('Continue o curso');
    expect(d.nowCard).toContain('01');
    expect(d.nowCard).toContain('7/10');
    expect(d.nowCard).toMatch(/Você está em .+ · cerca de 8 min para esta etapa/);
    await expect(page.locator('.now-card .segs i')).toHaveCount(10);
    await expect(page.locator('.now-card .segs i.done')).toHaveCount(6);
    await expect(page.locator('.now-card .segs i.now')).toHaveCount(1);
    // Plan
    expect(d.tasks.length).toBeGreaterThanOrEqual(2);
    expect(d.plan).toMatch(/\d+ de \d+ feitos · \d+ min/);
    expect(d.plan).toMatch(/Meta de hoje: \d+ de \d+ pontos\./);
    await expect(page.locator('.ring')).toHaveCount(1);
    // Missions
    expect(d.missions).toMatch(/Missões do dia\s*\d+\/\d+/);
    // Extras: 4 covers on mobile
    expect(d.covers.length).toBe(4);
    // Mic card with real minutes left
    expect(d.micHref).toMatch(/^#\/maggie\?modo=missao&m=[\w-]+$/);
    expect(d.mic).toContain(`${Math.round(st.maggie.secLeft / 60)} min de conversa no mês · +30 pontos`);
    expect(d.mic).toMatch(/Mic · .+ · missão de hoje/);
    // Focus + week
    expect(d.focus).toContain('Foco da semana');
    await expect(page.getByText(/\d dias por semana/)).toBeVisible();
    // Week dots: one per study day (fixture: Mon–Fri), blue up to today's weekday; reminder hours.
    const week = page.locator('.card.row').filter({ hasText: 'dias por semana' });
    await expect(week).toContainText('5 dias por semana');
    // personalize.hour(): "7h30", "20h" (prototype copy " · lembretes às …"; the port puts it on its own line)
    await expect(week).toContainText(/[Ll]embretes às 7h30, 20h/);
    const dots = await week
      .locator('span[style*="border-radius"]')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(dots.length).toBe(5);
    const [blueRgb, greyRgb] = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.background = 'var(--blue)';
      const b = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--line2)';
      const g = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [b, g];
    });
    const wd = await page.evaluate(() => new Date().getDay()); // browser tz = America/Sao_Paulo
    for (const [i, day] of [1, 2, 3, 4, 5].entries()) {
      expect(dots[i], `dot ${day}`).toBe(day <= wd ? blueRgb : greyRgb);
    }
    // Tabbar
    await expect(page.locator('nav.tabbar a.tab.on')).toHaveText(/Hoje/);
    await assertNamedControls(page);

    // ---- compare with the prototype (same state) ----
    const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const pp = await protoPage(pctx, userState('ep1-s7'), 'inicio');
    const pd = await hojeDigest(pp);
    await pctx.close();
    expect(d.hello).toBe(pd.hello);
    expect(d.nowCard).toBe(pd.nowCard);
    expect(d.tasks).toEqual(pd.tasks);
    expect(d.plan).toBe(pd.plan);
    expect(d.missions).toBe(pd.missions);
    expect(d.covers).toEqual(pd.covers);
    expect(d.micHref).toBe(pd.micHref);
    // Mic minutes come from the server (prototype: localStorage); everything else must match.
    expect(d.mic.replace(/\d+ min de conversa/, 'N min de conversa')).toBe(
      pd.mic.replace(/\d+ min de conversa/, 'N min de conversa'),
    );
    expect(d.focus).toBe(pd.focus);
  });

  test('mobile: every link navigates', async ({ page }) => {
    await login(page, 'ana.s7@parity.test');
    const back = async () => {
      await page.goto('/#/inicio');
      await expect(page.getByRole('heading', { level: 1, name: 'Oi, Ana.' })).toBeVisible();
    };
    // CTA of the now-card
    await page.locator('.now-card .btn').click();
    await expect(page).toHaveURL(/#\/episodio\/1(\/\d+)?$/);
    await back();
    // Plan tasks
    const hrefs = await page.locator('.plan .task').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    for (const h of hrefs) {
      await page.locator(`.plan .task[href="${h}"]`).click();
      await expect(page).not.toHaveURL(/#\/inicio$/);
      await back();
    }
    // Ver tudo
    await page.getByRole('link', { name: 'Ver tudo' }).click();
    await expect(page).toHaveURL(/#\/extra$/);
    await back();
    // A cover
    const cover = page.locator('.covers .cover').first();
    await cover.click();
    await expect(page).toHaveURL(/#\/extra\/[\w-]+$/);
    await back();
    // Mic card
    await page.locator('a.card[href^="#/maggie"]').click();
    await expect(page).toHaveURL(/#\/maggie\?modo=missao&m=/);
    await back();
    // Focus CTA
    await page.locator('.card.or a.btn').click();
    await expect(page).not.toHaveURL(/#\/inicio$/);
    await back();
    // Avatar → Perfil
    await page
      .getByRole('button', { name: 'Perfil' })
      .or(page.getByRole('link', { name: 'Perfil' }))
      .first()
      .click();
    await expect(page).toHaveURL(/#\/perfil$/);
  });

  test('catalog failure shows a retry card, "Tentar de novo" recovers', async ({ page }) => {
    await login(page, 'ana.s7@parity.test');
    await page.route('**/catalog.json', (r) =>
      r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) }),
    );
    await page.reload();
    await expect(page.getByText('Não deu para carregar o conteúdo.')).toBeVisible();
    await page.unroute('**/catalog.json');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Oi, Ana.' })).toBeVisible();
    await expect(page.locator('.now-card')).toBeVisible();
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of 503/.test(e));
  });

  test('fresh learner: "Começar o episódio 1"', async ({ page }) => {
    await signupFresh(page, 'Carla');
    await expect(page.locator('.now-card')).toContainText('Comece o curso');
    await expect(page.locator('.now-card')).toContainText('Primeira etapa:');
    await expect(page.locator('.now-card .btn')).toHaveText(/Começar o episódio 1/);
    await expect(page.locator('.now-card .stepcount')).toHaveText('1/10');
    const st = (await apiState(page)) as unknown as { maggie: { secLeft: number } };
    await expect(page.locator('a.card[href^="#/maggie"]')).toContainText(
      `${Math.round(st.maggie.secLeft / 60)} min de conversa no mês`,
    );
    await page.locator('.now-card .btn').click();
    await expect(page).toHaveURL(/#\/episodio\/1/);
  });

  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('two-column grid, sidebar, 6 covers, prototype parity', async ({ page, browser }) => {
      await login(page, 'ana.s7@parity.test');
      await expect(page.getByRole('heading', { level: 1, name: 'Oi, Ana.' })).toBeVisible();
      const d = await hojeDigest(page);
      expect(d.topbar).toBe(false);
      expect(d.homeGrid).toBe(true);
      await expect(page.locator('aside.side')).toBeVisible();
      await expect(page.locator('aside.side a.nav.on')).toHaveText(/Hoje/);
      const cols = page.locator('.home-grid > .stack');
      await expect(cols).toHaveCount(2);
      await expect(cols.nth(0).locator('.now-card')).toHaveCount(1);
      // The prototype put the EXTRA shelf in the left column, which left the right column ending far
      // above it (parity critic, round 3). The port runs it under both columns as one row of six.
      await expect(page.locator('.home-grid .covers')).toHaveCount(0);
      await expect(page.locator('.home-grid + section .covers')).toHaveCount(1);
      const tracks = await page
        .locator('.home-grid + section .covers')
        .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      expect(tracks).toBe(6);
      await expect(cols.nth(1).locator('.gamebar')).toHaveCount(1);
      await expect(cols.nth(1).locator('a.card[href^="#/maggie"]')).toHaveCount(1);
      const boxes = await cols.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
      expect(boxes[1]).toBeGreaterThan((boxes[0] ?? 0) + 200);
      expect(d.covers.length).toBe(6);
      await assertNamedControls(page);

      const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pp = await protoPage(pctx, userState('ep1-s7'), 'inicio');
      const pd = await hojeDigest(pp);
      await pctx.close();
      expect(d.covers).toEqual(pd.covers);
      expect(d.tasks).toEqual(pd.tasks);
      expect(d.nowCard).toBe(pd.nowCard);
      expect(d.focus).toBe(pd.focus);
      expect(d.homeGrid).toBe(pd.homeGrid);
    });
  });
});

// =====================================================================================
// Revisão
// =====================================================================================

test.describe('Revisão (#/revisao)', () => {
  test('mobile: flip, TTS, grade → server, +2 pontos, persists on reload', async ({ page }) => {
    await login(page, 'ana@parity.test');
    const before = await apiState(page);
    const q0 = (await (await page.request.get('/api/srs/queue')).json()) as { due: number; total: number };
    expect(q0.due).toBeGreaterThan(1);
    await page.goto('/#/revisao');
    const title = page.locator('header.topbar');
    await expect(title).toContainText('Revisão');
    await expect(title).toContainText(`${q0.due} cartões hoje`);
    // tab badge
    await expect(page.locator('nav.tabbar a[href="#/revisao"] .badge')).toHaveText(String(q0.due));

    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    await expect(flash).toContainText('Toque para ver a tradução');
    const en = norm(await flash.locator('.h1').textContent());
    // Speaker: says the EN without flipping
    const speaker = page.getByRole('button', { name: 'Ouvir', exact: true });
    await expect(speaker).toBeVisible();
    await speaker.click();
    await expect(flash).toContainText('Toque para ver a tradução');
    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
    expect(said.some((t) => norm(t) === en)).toBe(true);

    // Flip
    await flash.click();
    await expect(flash).toContainText('Como foi? Escolha abaixo · +2 pontos');
    await expect(flash.locator('.p-read')).toBeVisible();
    const grades = page.locator('button.card.stack.tc');
    await expect(grades).toHaveCount(4);
    await expect(grades.nth(0)).toContainText('De novo');
    await expect(grades.nth(1)).toContainText('Difícil');
    await expect(grades.nth(2)).toContainText('Bom');
    await expect(grades.nth(3)).toContainText('Fácil');
    await assertNamedControls(page);
    // Flip back
    await flash.click();
    await expect(flash).toContainText('Toque para ver a tradução');
    await expect(grades).toHaveCount(0);
    await flash.click();

    // Grade "Bom"
    const resp = page.waitForResponse(
      (r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()) && r.request().method() === 'POST',
    );
    await grades.nth(2).click();
    const r = await resp;
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { award?: { points: number; awarded: boolean } | null; due: number };
    expect(body.award?.awarded).toBe(true);
    expect(body.award?.points).toBe(2);
    await expect(page.locator('#fxroot .pts-toast')).toHaveText('+2 pontos');
    await expect(title).toContainText(`${q0.due - 1} ${q0.due - 1 === 1 ? 'cartão hoje' : 'cartões hoje'}`);
    await expect(flash).toContainText('Toque para ver a tradução'); // next card starts face up
    expect(norm(await flash.locator('.h1').textContent())).not.toBe(en);

    const after = await apiState(page);
    expect(after.game.points).toBe(before.game.points + 2);

    // Persisted
    await page.reload();
    await expect(title).toContainText(`${q0.due - 1} ${q0.due - 1 === 1 ? 'cartão hoje' : 'cartões hoje'}`);
    const q1 = (await (await page.request.get('/api/srs/queue')).json()) as { due: number };
    expect(q1.due).toBe(q0.due - 1);

    // "De novo" keeps the card due (back of the queue)
    const en2 = norm(await flash.locator('.h1').textContent());
    await flash.click();
    const resp2 = page.waitForResponse((x) => /\/grade$/.test(x.url()));
    await page.locator('button.card.stack.tc').nth(0).click();
    expect((await resp2).status()).toBe(200);
    await expect(title).toContainText(`${q0.due - 1} `);
    if (q0.due - 1 > 1) expect(norm(await flash.locator('.h1').textContent())).not.toBe(en2);
  });

  test('mobile: keyboard (Space flips, 1–4 grade) and empty state "Revisão em dia"', async ({ page }) => {
    await login(page, 'ana.s8@parity.test');
    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    const total = ((await apiState(page)).deck as unknown[]).length;
    // Focus visible on the flash card via keyboard
    await page.keyboard.press('Tab');
    let guard = 0;
    while (guard++ < 40) {
      const isFlash = await page.evaluate(() => document.activeElement?.classList.contains('flash') ?? false);
      if (isFlash) break;
      await page.keyboard.press('Tab');
    }
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return 'none';
      const cs = getComputedStyle(el);
      return `${cs.outlineStyle} ${cs.outlineWidth}`;
    });
    expect(outline).not.toMatch(/^none/);

    // Grade everything "Fácil" through the keyboard until the queue is empty.
    let n = 0;
    while ((await flash.count()) > 0 && n < 60) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Space');
      await expect(flash).toContainText('Como foi?');
      await page.waitForTimeout(150);
      const resp = page.waitForResponse((x) => /\/grade$/.test(x.url()));
      await page.keyboard.press('4');
      expect((await resp).status()).toBe(200);
      n++;
      await page.waitForTimeout(50);
    }
    expect(n).toBeGreaterThan(0);
    await expect(page.getByText('Revisão em dia.')).toBeVisible();
    await expect(page.getByText(/Nenhum cartão para agora\. O próximo volta .+\./)).toBeVisible();
    await expect(page.locator('header.topbar')).toContainText('0 cartões hoje');
    await expect(page.locator('.bar i')).toHaveAttribute('style', /width: ?100%/);
    await expect(page.locator('.card.soft')).toContainText(`Seu baralho tem ${total} cartões.`);
    await expect(page.locator('nav.tabbar a[href="#/revisao"] .badge')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Revisão em dia.')).toBeVisible();
    await page
      .getByRole('link', { name: /Ver um Extra/ })
      .or(page.getByRole('button', { name: /Ver um Extra/ }))
      .first()
      .click();
    await expect(page).toHaveURL(/#\/extra$/);
  });

  test('grade failure rolls back and toasts; no persona in content the screen loads', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', async (r) => {
      if (/\/api\/content\//.test(r.url()) && r.ok()) bodies.push(await r.text().catch(() => ''));
    });
    await login(page, 'ana@parity.test');
    const before = await apiState(page);
    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    const title = norm(await page.locator('header.topbar').textContent());
    const en = norm(await flash.locator('.h1').textContent());
    await page.route('**/api/srs/cards/*/grade', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }),
    );
    await flash.click();
    await page.locator('button.card.stack.tc').nth(3).click();
    await expect(page.locator('#fxroot .toast')).toBeVisible();
    await expect(flash.locator('.h1')).toHaveText(en);
    expect(norm(await page.locator('header.topbar').textContent())).toBe(title);
    await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0);
    expect((await apiState(page)).game.points).toBe(before.game.points);
    await page.unroute('**/api/srs/cards/*/grade');
    // the 500 is logged by the browser as a failed resource: expected here
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of 500/.test(e));
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/"persona"\s*:/);
  });

  test('fresh learner: "Seus cartões começam no episódio"', async ({ page }) => {
    await signupFresh(page, 'Duda');
    await page.goto('/#/revisao');
    await expect(page.getByText('Seus cartões começam no episódio.')).toBeVisible();
    await expect(page.getByText(/Termine o Take a Look do episódio 01/)).toBeVisible();
    await expect(page.locator('header.topbar')).toContainText('0 cartões hoje');
    await expect(page.locator('.card.soft')).toContainText(
      'Toque numa palavra da legenda dos Extras para trazer mais.',
    );
    await page.getByText('Continuar o episódio').click();
    await expect(page).toHaveURL(/#\/episodio\/1/);
  });

  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('heading, sidebar badge, info card matches the prototype', async ({ page, browser }) => {
      await login(page, 'ana.s9@parity.test');
      await page.locator('aside.side a[href="#/revisao"]').click();
      await expect(page).toHaveURL(/#\/revisao$/);
      await expect(page.locator('header.topbar')).toHaveCount(0);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveText(/\d+ cart(ão|ões) hoje/);
      const due = Number((await h1.textContent())?.match(/\d+/)?.[0]);
      await expect(page.locator('aside.side a[href="#/revisao"] .badge')).toHaveText(String(due));
      const info = norm(await page.locator('.card.soft').textContent());

      const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pp = await protoPage(pctx, userState('ep1-s9'), 'revisao');
      const pinfo = norm(await pp.locator('.card.soft').textContent());
      const ph1 = norm(await pp.locator('h1.h1').textContent());
      const pscene = norm(await pp.locator('button.flash .sm').first().textContent());
      await pctx.close();
      expect(info).toBe(pinfo);
      expect(norm(await h1.textContent())).toBe(ph1);
      expect(norm(await page.locator('button.flash .sm').first().textContent())).toBe(pscene);
    });
  });
});

// =====================================================================================
// Conquistas
// =====================================================================================

async function conquistasDigest(page: Page) {
  return page.evaluate(() => {
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    return {
      level: n(document.querySelector('.card.navy')?.textContent),
      medals: Array.from(document.querySelectorAll('.badges .medal')).map((m) => [m.className, n(m.textContent)]),
      medalLbl: n(
        Array.from(document.querySelectorAll('.lbl')).find((l) => /^Medalhas/.test(n(l.textContent)))?.textContent,
      ),
      earn: n(document.querySelector('.card.soft')?.textContent),
      missions: n(
        Array.from(document.querySelectorAll('.card')).find((c) =>
          n(c.querySelector('.lbl')?.textContent).startsWith('Missões do dia'),
        )?.textContent,
      ),
    };
  });
}

test.describe('Conquistas (#/conquistas)', () => {
  test('mobile: level card, 14 medals, points table, back button; points follow a review', async ({
    page,
    browser,
  }) => {
    await login(page, 'ana.s10@parity.test');
    const st = await apiState(page);
    await page.goto('/#/conquistas');
    const top = page.locator('header.topbar');
    await expect(top).toContainText('Sua caminhada');
    await expect(top).toContainText('Conquistas');
    const d = await conquistasDigest(page);
    expect(d.level).toContain(`${st.game.points} pontos`);
    expect(d.level).toMatch(/Faltam \d+ pontos para o nível \d+ · .+|Nível máximo alcançado\./);
    expect(d.medals.length).toBe(14);
    const has = d.medals.filter(([c]) => !String(c).includes('locked')).length;
    expect(d.medalLbl).toBe(`Medalhas · ${has} de 14`);
    const locked = page.locator('.badges .medal.locked').first();
    if (await locked.count()) {
      // Spec 01 §11: locked medals at 50% opacity (tie.css .medal.locked). The port overrides it
      // inline for contrast (opacity 1, no card fill, grey icon disc, padlock badge; accepted by the
      // parity critic); here we require that locked medals stay visibly distinct from earned ones.
      const look = await locked.evaluate((e) => {
        const cs = getComputedStyle(e);
        return {
          opacity: Number(cs.opacity),
          bg: cs.backgroundColor,
          badge: !!e.querySelector('.ic > span[aria-hidden="true"] svg'),
        };
      });
      expect(look.opacity < 0.9 || (look.bg === 'rgba(0, 0, 0, 0)' && look.badge)).toBe(true);
    }
    expect(d.earn).toBe(
      'Como ganhar pontosEtapa do episódio+10Episódio inteiro+40Exercício certo+5Pronúncia nota 8++15Fala no Mic+5Conversa inteira+30Extra até o fim+20Cartão revisado+2Missão do dia+15Teste do e-book+50',
    );
    await expect(page.locator('.gamebar')).toHaveCount(1);
    await assertNamedControls(page);

    // prototype parity (same state)
    const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const pp = await protoPage(pctx, userState('ep1-s10'), 'conquistas');
    const pd = await conquistasDigest(pp);
    await pctx.close();
    expect(d.medals).toEqual(pd.medals);
    expect(d.earn).toBe(pd.earn);
    expect(d.missions).toBe(pd.missions);
    expect(d.level.replace(/\d+ pontos/g, 'N pontos')).toBe(pd.level.replace(/\d+ pontos/g, 'N pontos'));

    // Review one card, come back: points went up by 2 (server-authoritative)
    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    {
      await flash.click();
      const resp = page.waitForResponse((x) => /\/grade$/.test(x.url()));
      await page.locator('button.card.stack.tc').nth(3).click();
      expect((await resp).status()).toBe(200);
      await page.goto('/#/conquistas');
      await expect(page.locator('.card.navy')).toContainText(`${st.game.points + 2} pontos`);
      await page.reload();
      await expect(page.locator('.card.navy')).toContainText(`${st.game.points + 2} pontos`);
    }
    // Back → Hoje
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page).toHaveURL(/#\/inicio$/);
  });

  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('h1, sidebar entry active, no topbar', async ({ page, browser }) => {
      await login(page, 'ana.s10@parity.test');
      await page.locator('aside.side a[href="#/conquistas"]').click();
      await expect(page).toHaveURL(/#\/conquistas$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Conquistas' })).toBeVisible();
      await expect(page.locator('header.topbar')).toHaveCount(0);
      await expect(page.locator('aside.side a.nav.on')).toHaveText(/Conquistas/);
      await expect(page.locator('.badges .medal')).toHaveCount(14);
      await assertNamedControls(page);
      // Round 7: desktop medals and points table = the prototype on desktop (same fixture state; one
      // review since then cannot unlock a medal).
      const d = await conquistasDigest(page);
      const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pp = await protoPage(pctx, userState('ep1-s10'), 'conquistas');
      const pd = await conquistasDigest(pp);
      const ph1 = norm(await pp.locator('h1.h1').first().textContent());
      await pctx.close();
      expect(d.medals).toEqual(pd.medals);
      expect(d.medalLbl).toBe(pd.medalLbl);
      expect(d.earn).toBe(pd.earn);
      expect(ph1).toBe('Conquistas');
    });
  });
});

// =====================================================================================
// Cross-screen flows (server-authoritative points, missions and goal across the three screens)
// =====================================================================================

/** Text of a label-headed card (".lbl" first line). */
const cardText = (page: Page, lbl: string) =>
  page
    .locator('.card')
    .filter({ has: page.locator('.lbl', { hasText: lbl }) })
    .first();

test.describe('cross-screen', () => {
  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('5 reviews → "Revisar 5 cartões" mission, points and goal on Hoje + Conquistas; persists', async ({
      page,
    }) => {
      await login(page, 'ana.s9@parity.test');
      const st0 = (await apiState(page)) as unknown as {
        game: { points: number };
        profile: { minutes: number };
      };
      const target = Math.max(50, Math.round((st0.profile.minutes || 20) * 5));
      // Hoje before: today is a fresh day for the fixture (real clock)
      const plan = cardText(page, 'Plano de hoje');
      await expect(plan).toContainText(`Meta de hoje: 0 de ${target} pontos.`);
      await expect(page.locator('.plan .task[href="#/revisao"]')).toContainText('Rebobinar 5 cartões');
      await expect(page.locator('.plan .task[href="#/revisao"]')).not.toHaveClass(/done/);
      const missions = cardText(page, 'Missões do dia');
      const m0 = norm(await missions.locator('.row.between .xs').first().textContent());
      const [m0done, m0total] = m0.split('/').map(Number) as [number, number];
      await expect(missions).toContainText('Revisar 5 cartões');

      // Revisão through the sidebar; grade 5 cards (clicks and keyboard)
      await page.locator('aside.side a[href="#/revisao"]').click();
      await expect(page).toHaveURL(/#\/revisao$/);
      const badge = page.locator('aside.side a[href="#/revisao"] .badge');
      const due0 = Number(await badge.textContent());
      expect(due0).toBeGreaterThanOrEqual(5);
      const flash = page.locator('button.flash');
      const awards: { points: number; missionsDone: string[]; total: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const resp = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
        if (i % 2 === 0) {
          await flash.click();
          await page.locator('button.card.stack.tc').nth(2).click(); // Bom
        } else {
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await page.keyboard.press('Space');
          await expect(flash).toContainText('Como foi?');
          await page.keyboard.press('3'); // Bom
        }
        const r = await resp;
        expect(r.status()).toBe(200);
        const b = (await r.json()) as { award: { points: number; missionsDone: string[]; total: number } };
        awards.push(b.award);
        await expect(flash).toContainText('Toque para ver a tradução');
      }
      expect(awards.map((a) => a.points)).toEqual([2, 2, 2, 2, 2]);
      expect(awards[4]?.missionsDone).toContain('cards');
      const gained = 5 * 2 + 15;
      expect(awards[4]?.total).toBe(st0.game.points + gained);
      await expect(badge).toHaveText(String(due0 - 5));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${due0 - 5} cartões hoje`);

      // Hoje after
      await page.locator('aside.side a[href="#/inicio"]').click();
      await expect(page).toHaveURL(/#\/inicio$/);
      await expect(plan).toContainText(`Meta de hoje: ${gained} de ${target} pontos.`);
      await expect(page.locator('.ring')).toContainText(`${Math.round((gained / target) * 100)}%`);
      await expect(page.locator('.plan .task[href="#/revisao"]')).toHaveClass(/done/);
      await expect(missions.locator('.row.between .xs').first()).toHaveText(`${m0done + 1}/${m0total}`);
      await expect(page.locator('.gamebar')).toContainText(String(st0.game.points + gained));

      // Conquistas after
      await page.locator('aside.side a[href="#/conquistas"]').click();
      await expect(page.locator('.card.navy')).toContainText(`${st0.game.points + gained} pontos`);
      await expect(cardText(page, 'Missões do dia').locator('.row.between .xs').first()).toHaveText(
        `${m0done + 1}/${m0total}`,
      );

      // Persisted server-side
      await page.reload();
      await expect(page.locator('.card.navy')).toContainText(`${st0.game.points + gained} pontos`);
      await page.goto('/#/inicio');
      await expect(plan).toContainText(`Meta de hoje: ${gained} de ${target} pontos.`);
      await expect(page.locator('.plan .task[href="#/revisao"]')).toHaveClass(/done/);
      const st1 = await apiState(page);
      expect(st1.game.points).toBe(st0.game.points + gained);
    });
  });

  test('mobile: keyboard focus is visible on Hoje links and the Conquistas back button', async ({ page }) => {
    await login(page, 'ana.s7@parity.test');
    const outlineOf = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { tag: el.tagName, cls: el.className, outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
      });
    const seen: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const o = await outlineOf();
      if (!o) continue;
      expect(o.outline, `${o.tag}.${o.cls}`).not.toMatch(/^none|0px$/);
      seen.push(`${o.tag}.${String(o.cls).split(' ')[0]}`);
    }
    expect(seen.some((x) => x.startsWith('A.task'))).toBe(true);
    await page.goto('/#/conquistas');
    const back = page.getByRole('button', { name: 'Voltar' });
    await expect(back).toBeVisible();
    let o: Awaited<ReturnType<typeof outlineOf>> = null;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const isBack = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Voltar');
      if (isBack) {
        o = await outlineOf();
        break;
      }
    }
    expect(o, 'Voltar reachable with Tab').not.toBeNull();
    expect(o?.outline).not.toMatch(/^none/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/inicio$/);
  });
});

// =====================================================================================
// Round 3 additions: layout overflow, desktop review controls, medal unlock through reviews
// =====================================================================================

/** Neither the page nor any `.scroll` pane scrolls sideways. */
async function assertNoHorizontalOverflow(page: Page, what: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > window.innerWidth + 1) out.push(`document ${de.scrollWidth} > ${window.innerWidth}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.scroll'))) {
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(`.scroll ${el.scrollWidth} > ${el.clientWidth}`);
        // Name the innermost elements that stick out (round 7: which part of the screen overflows).
        const right = el.getBoundingClientRect().right;
        const wide = Array.from(el.querySelectorAll<HTMLElement>('*')).filter(
          (x) => x.getBoundingClientRect().right > right + 1 && !x.querySelector('*'),
        );
        for (const x of wide.slice(0, 4))
          out.push(
            `  ${x.tagName.toLowerCase()}.${String(x.className).split(' ').join('.')} → ${Math.round(x.getBoundingClientRect().right)}px`,
          );
      }
    }
    return out;
  });
  expect(bad, `${what}: horizontal overflow`).toEqual([]);
}

test.describe('round 3', () => {
  test('mobile: no horizontal overflow on Hoje, Revisão (front/back) and Conquistas', async ({ page }) => {
    // RL_AUTH is per ip+email: ana.s7 has already signed in five times above.
    await login(page, 'ana.s10@parity.test');
    await assertNoHorizontalOverflow(page, 'inicio');
    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    await assertNoHorizontalOverflow(page, 'revisao front');
    await flash.click();
    await expect(page.locator('button.card.stack.tc')).toHaveCount(4);
    await assertNoHorizontalOverflow(page, 'revisao back');
    await page.goto('/#/conquistas');
    await expect(page.locator('.badges .medal')).toHaveCount(14);
    await assertNoHorizontalOverflow(page, 'conquistas');
  });

  test.describe('desktop 1024', () => {
    test.use({ ...DESKTOP, viewport: { width: 1024, height: 768 } });
    test('no horizontal overflow at the narrowest desktop width', async ({ page }) => {
      await login(page, 'ana.s9@parity.test');
      await expect(page.locator('.home-grid')).toHaveCount(1);
      await assertNoHorizontalOverflow(page, 'inicio');
      await page.goto('/#/revisao');
      await expect(page.locator('button.flash')).toBeVisible();
      await assertNoHorizontalOverflow(page, 'revisao');
      await page.goto('/#/conquistas');
      await expect(page.locator('.badges .medal')).toHaveCount(14);
      await assertNoHorizontalOverflow(page, 'conquistas');
    });
  });

  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('Revisão: "Ver a tradução", legend, deck stats, speaker, click grade → server + toast', async ({ page }) => {
      await login(page, 'ana@parity.test');
      const before = await apiState(page);
      const q0 = (await (await page.request.get('/api/srs/queue')).json()) as { due: number; total: number };
      expect(q0.due).toBeGreaterThan(1);
      await page.goto('/#/revisao');
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveText(`${q0.due} cartões hoje`);
      // Deck stats and legend (desktop right column)
      const stats = page.locator('.gamebar').filter({ hasText: 'no baralho' });
      await expect(stats).toContainText(`${q0.due}para agora`);
      await expect(stats).toContainText(`${before.deck.length}no baralho`);
      await expect(page.locator('.card').filter({ hasText: 'Como avaliar' })).toContainText(
        'Espaço vira o cartão; as teclas 1 a 4 escolhem a nota.',
      );
      const flash = page.locator('button.flash');
      const en = norm(await flash.locator('.h1').textContent());
      // Speaker
      await page.getByRole('button', { name: 'Ouvir', exact: true }).click();
      const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
      expect(said.some((t) => norm(t) === en)).toBe(true);
      await expect(flash.locator('.p-read')).toHaveCount(0);
      // "Ver a tradução"
      const ver = page.getByRole('button', { name: /Ver a tradução/ });
      await expect(ver).toBeVisible();
      await ver.click();
      await expect(flash.locator('.p-read')).toBeVisible();
      await expect(ver).toHaveCount(0);
      const grades = page.locator('button.card.stack.tc');
      await expect(grades).toHaveCount(4);
      const resp = page.waitForResponse(
        (r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()) && r.request().method() === 'POST',
      );
      await grades.nth(1).click(); // Difícil (10 min)
      const r = await resp;
      expect(r.status()).toBe(200);
      const aw = ((await r.json()) as { award: { points: number; dayPoints: number } }).award;
      expect(aw.points).toBe(2);
      await expect(page.locator('#fxroot .pts-toast')).toHaveText('+2 pontos');
      await expect(h1).toHaveText(`${q0.due - 1} ${q0.due - 1 === 1 ? 'cartão hoje' : 'cartões hoje'}`);
      await expect(page.locator('aside.side a[href="#/revisao"] .badge')).toHaveText(String(q0.due - 1));
      // Sidebar footer card: today's goal follows the server's day points.
      await expect(page.locator('aside.side')).toContainText(`Meta de hoje${aw.dayPoints}/`);
      expect((await apiState(page)).game.points).toBe(before.game.points + 2);
    });
  });

  test('mobile: reviewing up to 20 cards unlocks "Memória em dia" (toast, Conquistas, persisted)', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'ana.s10@parity.test');
    await page.goto('/#/conquistas');
    const lbl = page.locator('.lbl', { hasText: /^Medalhas · / });
    const has0 = Number((await lbl.textContent())?.match(/· (\d+) de/)?.[1]);
    const medal = page.locator('.badges .medal').filter({ hasText: 'Memória em dia' });
    await expect(medal).toHaveClass(/locked/);

    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    let unlocked = false;
    for (let i = 0; i < 26 && !unlocked; i++) {
      if (!(await flash.count())) break;
      await flash.click();
      const resp = page.waitForResponse((x) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(x.url()));
      await page.locator('button.card.stack.tc').nth(3).click();
      const r = await resp;
      expect(r.status()).toBe(200);
      const b = (await r.json()) as { award: { newBadges: { id: string }[] } };
      unlocked = b.award.newBadges.some((x) => x.id === 'cards-20');
      await expect(flash.or(page.getByText('Revisão em dia.'))).toBeVisible();
    }
    expect(unlocked, 'cards-20 awarded by the server').toBe(true);
    await expect(page.locator('#fxroot').getByText('Medalha: Memória em dia. 20 cartões revisados.')).toBeVisible({
      timeout: 5_000,
    });
    await page.goto('/#/conquistas');
    await expect(medal).not.toHaveClass(/locked/);
    await expect(lbl).toHaveText(`Medalhas · ${has0 + 1} de 14`);
    await page.reload();
    await expect(medal).not.toHaveClass(/locked/);
    await expect(lbl).toHaveText(`Medalhas · ${has0 + 1} de 14`);
  });
});

// =====================================================================================
// Round 4: keyboard-only review on desktop (focused controls, no double flip), Hoje desktop focus
// =====================================================================================

test.describe('round 4', () => {
  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('Revisão by keyboard only: focused card flips once, Ouvir speaks, Enter on a grade grades', async ({
      page,
    }) => {
      await login(page, 'ana@parity.test');
      const before = await apiState(page);
      await page.goto('/#/revisao');
      const flash = page.locator('button.flash');
      await expect(flash).toBeVisible();
      const h1 = page.getByRole('heading', { level: 1 });
      const due0 = Number((await h1.textContent())?.match(/\d+/)?.[0]);
      const focusOutline = () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return {
            label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30),
            cls: el.className,
            outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
            shadow: cs.boxShadow,
          };
        });
      // Tab to the flash card
      let found = false;
      for (let i = 0; i < 40 && !found; i++) {
        await page.keyboard.press('Tab');
        found = await page.evaluate(() => document.activeElement?.classList.contains('flash') ?? false);
      }
      expect(found, 'flash card reachable by Tab').toBe(true);
      const fo = await focusOutline();
      expect(fo?.outline, 'flash focus ring').not.toMatch(/^none|0px$/);
      // Space on the focused card: exactly one flip (native click only, the window handler skips buttons)
      await page.keyboard.press('Space');
      await expect(flash.locator('.p-read')).toBeVisible();
      await page.waitForTimeout(200);
      await expect(flash.locator('.p-read')).toBeVisible();
      // Enter flips back
      await page.keyboard.press('Enter');
      await expect(flash.locator('.p-read')).toHaveCount(0);
      // Tab onward: the speaker ("Ouvir") follows the card and speaks without flipping
      await page.keyboard.press('Tab');
      expect((await focusOutline())?.label).toBe('Ouvir');
      expect((await focusOutline())?.outline).not.toMatch(/^none|0px$/);
      const en = norm(await flash.locator('.h1').textContent());
      await page.keyboard.press('Enter');
      const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
      expect(said.some((t) => norm(t) === en)).toBe(true);
      await expect(flash.locator('.p-read')).toHaveCount(0);
      // "Ver a tradução" reachable, Enter shows the grades
      let onVer = false;
      for (let i = 0; i < 6 && !onVer; i++) {
        await page.keyboard.press('Tab');
        onVer = /Ver a tradução/.test((await focusOutline())?.label ?? '');
      }
      expect(onVer, '"Ver a tradução" reachable by Tab').toBe(true);
      expect((await focusOutline())?.outline).not.toMatch(/^none|0px$/);
      await page.keyboard.press('Enter');
      const grades = page.locator('button.card.stack.tc');
      await expect(grades).toHaveCount(4);
      // Tab into the grades (focus moved away from the removed button: walk until a grade has focus)
      let onGrade = false;
      for (let i = 0; i < 12 && !onGrade; i++) {
        await page.keyboard.press('Tab');
        onGrade = await page.evaluate(() => document.activeElement?.matches('button.card.stack.tc') ?? false);
      }
      expect(onGrade, 'grade buttons reachable by Tab').toBe(true);
      expect((await focusOutline())?.outline).not.toMatch(/^none|0px$/);
      expect((await focusOutline())?.label).toMatch(/^De novo/);
      // Two more Tabs: "Bom" (2 days) so the card leaves today's queue
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect((await focusOutline())?.label).toMatch(/^Bom/);
      const resp = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
      await page.keyboard.press('Enter');
      const r = await resp;
      expect(r.status()).toBe(200);
      await expect(page.locator('#fxroot .pts-toast')).toHaveText('+2 pontos');
      await expect(h1).toHaveText(`${due0 - 1} ${due0 - 1 === 1 ? 'cartão hoje' : 'cartões hoje'}`);
      expect((await apiState(page)).game.points).toBe(before.game.points + 2);
    });

    test('Hoje desktop: Tab reaches the plan, covers, Mic card and focus CTA with a visible ring', async ({ page }) => {
      await login(page, 'ana.s9@parity.test');
      await expect(page.locator('.home-grid')).toHaveCount(1);
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const o = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const href = el.getAttribute('href') ?? '';
          const kind = el.matches('.plan .task')
            ? 'task'
            : el.matches('.cover')
              ? 'cover'
              : href.startsWith('#/maggie')
                ? 'mic'
                : el.closest('.card.or')
                  ? 'focus'
                  : el.closest('.now-card')
                    ? 'now'
                    : 'other';
          return { kind, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, html: el.outerHTML.slice(0, 80) };
        });
        if (!o) continue;
        if (o.kind !== 'other') {
          expect(o.outline, o.html).not.toMatch(/^none|0px$/);
          seen.add(o.kind);
        }
      }
      expect([...seen].sort()).toEqual(['cover', 'focus', 'mic', 'now', 'task']);
    });
  });
});

// =====================================================================================
// Round 5: goal consistency across widgets, live layout switch, rapid grading race, slow grade
// while navigating away, info card parity for a deck with captured cards
// =====================================================================================

/** "12/100" → [12, 100] from the gamebar's goal tile. */
async function gamebarGoal(page: Page): Promise<[number, number]> {
  const t = norm(await page.locator('.gamebar a.g.goal b').first().textContent());
  const [a, b] = t.split('/').map(Number);
  return [a ?? NaN, b ?? NaN];
}

test.describe('round 5', () => {
  test('mobile: plan goal, ring, gamebar and missions agree across Hoje/Conquistas; live mobile↔desktop switch', async ({
    page,
  }) => {
    // ana.s8 signed in once so far in a full run (RL_AUTH is 5/60s per ip+email).
    await login(page, 'ana.s8@parity.test');
    await expect(page.getByRole('heading', { level: 1, name: 'Oi, Ana.' })).toBeVisible();
    const plan = cardText(page, 'Plano de hoje');
    const meta = norm(await plan.locator(':scope > .xs').last().textContent());
    const mm = meta.match(/^Meta de hoje: (\d+) de (\d+) pontos\.( Batida\.)?$/);
    expect(mm, meta).not.toBeNull();
    const done = Number(mm?.[1]);
    const target = Number(mm?.[2]);
    expect(await gamebarGoal(page)).toEqual([done, target]);
    expect(!!mm?.[3]).toBe(done >= target);
    await expect(page.locator('.ring')).toContainText(`${Math.min(100, Math.round((done / target) * 100))}%`);
    const missionsHoje = norm(await cardText(page, 'Missões do dia').textContent());

    // Live switch to desktop (no reload): sidebar + two columns, same numbers.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.home-grid')).toHaveCount(1);
    await expect(page.locator('aside.side')).toBeVisible();
    await expect(page.locator('header.topbar')).toHaveCount(0);
    await expect(page.locator('.covers .cover')).toHaveCount(6);
    expect(await gamebarGoal(page)).toEqual([done, target]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('.home-grid')).toHaveCount(0);
    await expect(page.locator('header.topbar')).toBeVisible();
    await expect(page.locator('nav.tabbar')).toBeVisible();
    await expect(page.locator('.covers .cover')).toHaveCount(4);

    // Conquistas reads the same missions and points.
    await page.locator('.gamebar a.g.pts').first().click();
    await expect(page).toHaveURL(/#\/conquistas$/);
    expect(norm(await cardText(page, 'Missões do dia').textContent())).toBe(missionsHoje);
    const pts = norm(await page.locator('.gamebar a.g.pts b').first().textContent());
    await expect(page.locator('.card.navy')).toContainText(`${pts} pontos`);
    const st = await apiState(page);
    expect(String(st.game.points)).toBe(pts);
    // The level bar's fill is a percentage between 0 and 100.
    const w = await page.locator('.card.navy .bar i').evaluate((e) => (e as HTMLElement).style.width);
    expect(w).toMatch(/^\d{1,3}%$/);
    expect(Number.parseInt(w, 10)).toBeLessThanOrEqual(100);
    // Gamebar goal tile → Hoje
    await page.locator('.gamebar a.g.goal').first().click();
    await expect(page).toHaveURL(/#\/inicio$/);
  });

  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('Revisão: info card = prototype (captured cards), rapid keyboard grading, slow grade while leaving', async ({
      page,
      browser,
    }) => {
      // ana (main) has signed in four times so far in a full run: this is the fifth (RL_AUTH 5/60s).
      await login(page, 'ana@parity.test');
      await page.locator('aside.side a[href="#/revisao"]').click();
      await expect(page).toHaveURL(/#\/revisao$/);
      const flash = page.locator('button.flash');
      await expect(flash).toBeVisible();

      // Info card with the deck's captured (non "Ep. ") cards, same sentence as the prototype.
      const info = norm(await page.locator('.card.soft').first().textContent());
      expect(info).toMatch(/mais \d+ que você levou dos Extras e das conversas no Mic\. Seu baralho tem \d+ cartões\./);
      const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pp = await protoPage(pctx, userState('main'), 'revisao');
      const pinfo = norm(await pp.locator('.card.soft').textContent());
      await pctx.close();
      expect(info).toBe(pinfo);

      // Rapid keyboard grading: Space/3 three times without waiting for the server.
      const h1 = page.getByRole('heading', { level: 1 });
      const due0 = Number((await h1.textContent())?.match(/\d+/)?.[0]);
      const k = Math.min(3, due0 - 1);
      expect(k).toBeGreaterThan(0);
      const st0 = await apiState(page);
      const ids: string[] = [];
      const responses: Promise<import('@playwright/test').Response>[] = [];
      page.on('request', (r) => {
        const m = r.url().match(/\/api\/srs\/cards\/([^/]+)\/grade$/);
        if (m && r.method() === 'POST') ids.push(decodeURIComponent(m[1] ?? ''));
      });
      page.on('response', (r) => {
        if (/\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url())) responses.push(Promise.resolve(r));
      });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < k; i++) {
        await page.keyboard.press('Space');
        await page.keyboard.press('3');
      }
      await expect.poll(() => responses.length, { timeout: 10_000 }).toBe(k);
      const rs = await Promise.all(responses);
      expect(rs.map((r) => r.status())).toEqual(Array(k).fill(200));
      expect(new Set(ids).size, `distinct cards graded: ${ids.join(',')}`).toBe(k);
      const totals = await Promise.all(
        rs.map(async (r) => ((await r.json()) as { award: { total: number; points: number } }).award),
      );
      expect(totals.map((a) => a.points)).toEqual(Array(k).fill(2));
      const finalTotal = Math.max(...totals.map((a) => a.total));
      await expect(h1).toHaveText(`${due0 - k} ${due0 - k === 1 ? 'cartão hoje' : 'cartões hoje'}`);
      expect((await apiState(page)).game.points).toBe(finalTotal);
      expect(finalTotal).toBeGreaterThanOrEqual(st0.game.points + 2 * k);
      await page.reload();
      await expect(h1).toHaveText(`${due0 - k} ${due0 - k === 1 ? 'cartão hoje' : 'cartões hoje'}`);

      // Slow grade, then leave for Hoje before the answer: the award still lands (gamebar), no errors.
      if (due0 - k > 0) {
        await page.route('**/api/srs/cards/*/grade', async (r) => {
          await new Promise((res) => setTimeout(res, 1500));
          await r.continue();
        });
        await page.getByRole('button', { name: /Ver a tradução/ }).click();
        const resp = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
        await page.locator('button.card.stack.tc').nth(3).click();
        await page.locator('aside.side a[href="#/inicio"]').click();
        await expect(page).toHaveURL(/#\/inicio$/);
        const r = await resp;
        expect(r.status()).toBe(200);
        const aw = ((await r.json()) as { award: { total: number } }).award;
        await expect(page.locator('.home-grid .gamebar a.g.pts b')).toHaveText(String(aw.total));
        await expect(page.locator('#fxroot .pts-toast')).toHaveText('+2 pontos');
        await page.unroute('**/api/srs/cards/*/grade');
        expect((await apiState(page)).game.points).toBe(aw.total);
      }
    });
  });
});

// =====================================================================================
// Round 6: hostile card text, grade API abuse (owner/validation/CSRF/auth), once-a-day card award,
// daily goal hit (toast + Hoje "Batida." + ring 100%)
// =====================================================================================

/** Same-origin fetch from the page (sends Origin and the session cookie like the app does). */
async function pageFetch(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ([p, m, b]) => {
      const r = await fetch(p, {
        method: m,
        headers: b === undefined ? {} : { 'content-type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
        credentials: 'same-origin',
      });
      return { status: r.status, text: await r.text() };
    },
    [path, init.method ?? 'GET', init.body] as const,
  );
}

test.describe('round 6', () => {
  test('mobile: hostile card text renders as text; grade API rejects abuse; one card award per card per day', async ({
    page,
    browser,
  }) => {
    await signupFresh(page, 'Bia');
    const hostile = [
      {
        en: '<img src=x onerror="window.__xss=1">Hello there',
        pt: '<script>window.__xss=2</script>Olá',
        scene: 'Extra · <i>Cena</i>',
        note: '<b>nota</b>',
        source: 'extra',
      },
      { en: 'Second <svg onload="window.__xss=3"> card', pt: 'Segundo', scene: 'Mic · teste', source: 'mic' },
    ];
    const add = await pageFetch(page, '/api/srs/cards', { method: 'POST', body: { cards: hostile } });
    expect(add.status, add.text).toBe(200);
    const added = (JSON.parse(add.text) as { added: { id: string; en: string }[] }).added;
    expect(added.length).toBe(2);
    const id0 = added[0]?.id ?? '';

    // ---- API abuse (from the page, so Origin and cookie are the app's) ----
    expect((await pageFetch(page, `/api/srs/cards/${id0}/grade`, { method: 'POST', body: { grade: 4 } })).status).toBe(
      400,
    );
    expect((await pageFetch(page, `/api/srs/cards/${id0}/grade`, { method: 'POST', body: { grade: -1 } })).status).toBe(
      400,
    );
    expect(
      (await pageFetch(page, `/api/srs/cards/${id0}/grade`, { method: 'POST', body: { grade: '2' } })).status,
    ).toBe(400);
    expect(
      (await pageFetch(page, '/api/srs/cards/nope-404/grade', { method: 'POST', body: { grade: 2 } })).status,
    ).toBe(404);
    // Another learner's card (the fixture's main user owns fx-card-001)
    expect(
      (await pageFetch(page, '/api/srs/cards/fx-card-001/grade', { method: 'POST', body: { grade: 2 } })).status,
    ).toBe(404);
    // No Origin (APIRequestContext does not send one) → CSRF refusal
    const noOrigin = await page.request.post(`/api/srs/cards/${id0}/grade`, { data: { grade: 2 } });
    expect(noOrigin.status()).toBe(403);
    // Foreign Origin → refusal
    const foreign = await page.request.post(`/api/srs/cards/${id0}/grade`, {
      data: { grade: 2 },
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(foreign.status()).toBe(403);
    // Signed out → 401
    const anon = await browser.newContext();
    const anonRes = await anon.request.post(`${new URL(page.url()).origin}/api/srs/cards/${id0}/grade`, {
      data: { grade: 2 },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(anonRes.status()).toBe(401);
    await anon.close();
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of (400|403|404)/.test(e));

    // ---- The screen renders the hostile text literally ----
    await page.goto('/#/revisao');
    await page.reload();
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    await expect(page.locator('header.topbar')).toContainText('2 cartões hoje');
    // Equal due times: either card may come first. Walk both faces of both (flip, flip back).
    const h1 = flash.locator('.h1');
    const firstEn = norm(await h1.textContent());
    const [A, B] = firstEn === hostile[0]?.en ? [hostile[0], hostile[1]] : [hostile[1], hostile[0]];
    expect([hostile[0]?.en, hostile[1]?.en]).toContain(firstEn);
    const c0 = hostile[0];
    if (A === c0) {
      await expect(flash).toContainText('Extra · <i>Cena</i>');
      await flash.click();
      await expect(flash.locator('.p-read')).toContainText('<script>window.__xss=2</script>Olá');
      await expect(flash.locator('.p-read')).toContainText('<b>nota</b>');
    } else {
      await expect(flash).toContainText('Mic · teste');
      await flash.click();
      await expect(flash.locator('.p-read')).toContainText('Segundo');
    }
    const injected = await page.evaluate(() => ({
      xss: (window as unknown as { __xss?: number }).__xss ?? null,
      img: document.querySelectorAll('.flash img[src="x"], .flash script, .flash svg[onload]').length,
    }));
    expect(injected).toEqual({ xss: null, img: 0 });
    await expect(page.locator('.card.soft')).toContainText(
      'mais 2 que você levou dos Extras e das conversas no Mic. Seu baralho tem 2 cartões.',
    );

    // ---- "De novo" twice on the same card the same day: +2 once ----
    const pts0 = (await apiState(page)).game.points;
    const g1 = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
    await page.locator('button.card.stack.tc').nth(0).click();
    const b1 = (await (await g1).json()) as { award: { awarded: boolean; points: number } | null };
    expect(b1.award?.awarded).toBe(true);
    await expect(page.locator('#fxroot .pts-toast')).toHaveText('+2 pontos');
    // De novo keeps it due: the other card is next, then this one comes back.
    await expect(h1).toHaveText(B?.en ?? '');
    await expect(page.locator('header.topbar')).toContainText('2 cartões hoje');
    await flash.click();
    if (B === c0) {
      await expect(flash).toContainText('Extra · <i>Cena</i>');
      await expect(flash.locator('.p-read')).toContainText('<script>window.__xss=2</script>Olá');
      await expect(flash.locator('.p-read')).toContainText('<b>nota</b>');
    }
    expect(
      await page.evaluate(() => ({
        xss: (window as unknown as { __xss?: number }).__xss ?? null,
        n: document.querySelectorAll('img[src="x"], .flash script, svg[onload]').length,
      })),
    ).toEqual({ xss: null, n: 0 });
    const g2 = page.waitForResponse((r) => /\/grade$/.test(r.url()));
    await page.locator('button.card.stack.tc').nth(3).click(); // Fácil
    const r2 = await g2;
    expect(r2.status()).toBe(200);
    const total2 = ((await r2.json()) as { award: { total: number } }).award.total;
    await expect(h1).toHaveText(A?.en ?? '');
    await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0, { timeout: 8_000 });
    await flash.click();
    const g3 = page.waitForResponse((r) => /\/grade$/.test(r.url()));
    await page.locator('button.card.stack.tc').nth(3).click();
    const b3 = (await (await g3).json()) as { award: { awarded: boolean; points: number; total: number } | null };
    expect(b3.award?.awarded ?? false, 'second award for the same card today').toBe(false);
    await page.waitForTimeout(400);
    await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0);
    await expect(page.getByText('Revisão em dia.')).toBeVisible();
    // +2 per first review of each card, nothing for the replay (whose answer may still carry the
    // "Revisar 5 cartões" mission bonus: that mission is done once nothing is due, as in the prototype).
    expect(total2).toBe(pts0 + 4);
    expect(b3.award?.points ?? 0).toBe(0);
    const final = b3.award?.total ?? total2;
    expect([total2, total2 + 15]).toContain(final);
    expect((await apiState(page)).game.points).toBe(final);
    await page.goto('/#/conquistas');
    await expect(page.locator('.card.navy')).toContainText(`${final} pontos`);
    await expect(page.locator('.gamebar a.g.pts b').first()).toHaveText(String(final));
    // The mission shows done (the client mirrors the bonus from a non-awarded answer too).
    await expect(cardText(page, 'Missões do dia')).toContainText('Revisar 5 cartões');
  });

  test('mobile: reviews hit the daily goal → toast, Hoje "Batida." and a full ring (persisted)', async ({ page }) => {
    test.setTimeout(180_000);
    await signupFresh(page, 'Gabi');
    const st = (await apiState(page)) as unknown as { profile: { minutes: number }; game: { points: number } };
    const target = Math.max(50, Math.round((st.profile.minutes || 20) * 5));
    const n = Math.min(50, Math.ceil(target / 2) + 2);
    const cards = Array.from({ length: n }, (_, i) => ({
      en: `goal card number ${i + 1}`,
      pt: `cartão ${i + 1}`,
      scene: 'Extra · teste',
      source: 'extra' as const,
    }));
    const add = await pageFetch(page, '/api/srs/cards', { method: 'POST', body: { cards } });
    expect(add.status, add.text).toBe(200);
    await page.goto('/#/revisao');
    await page.reload();
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    let hit: { dayPoints: number } | null = null;
    for (let i = 0; i < n && !hit; i++) {
      await flash.click();
      const resp = page.waitForResponse((x) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(x.url()));
      await page.locator('button.card.stack.tc').nth(2).click();
      const r = await resp;
      expect(r.status()).toBe(200);
      const a = ((await r.json()) as { award: { goalHit?: boolean; dayPoints: number; levelUp?: unknown } }).award;
      if (a.goalHit) {
        hit = a;
        if (!a.levelUp)
          await expect(
            page.locator('#fxroot').getByText(`Meta do dia batida. ${a.dayPoints} pontos hoje.`),
          ).toBeVisible();
      }
    }
    expect(hit, 'goal hit by the server').not.toBeNull();
    await page.goto('/#/inicio');
    const plan = cardText(page, 'Plano de hoje');
    await expect(plan).toContainText(/Meta de hoje: \d+ de \d+ pontos\. Batida\./);
    await expect(page.locator('.ring')).toContainText('100%');
    await page.reload();
    await expect(plan).toContainText(/Batida\./);
    await expect(page.locator('.ring')).toContainText('100%');
  });
});

// =====================================================================================
// Round 7: route guards on the three routes, long unbroken card text, session lost mid-review
// =====================================================================================

test.describe('round 7', () => {
  test('guards: signed out → entrar, no profile → cadastro, for inicio/revisao/conquistas', async ({
    page,
    browser,
  }) => {
    for (const r of ['inicio', 'revisao', 'conquistas']) {
      await page.goto(`/#/${r}`);
      await expect(page).toHaveURL(/#\/entrar$/, { timeout: 15_000 });
      await expect(page.locator('.now-card, button.flash, .badges')).toHaveCount(0);
    }
    // The APIs the screens read refuse an anonymous caller.
    const anon = await browser.newContext();
    const origin = new URL(page.url()).origin;
    for (const p of ['/api/me/state', '/api/srs/queue']) {
      expect((await anon.request.get(`${origin}${p}`)).status(), p).toBe(401);
    }
    await anon.close();
    // The fixture's "fresh" user has an account and no profile yet (onboarding step 1).
    await page.goto('/#/entrar');
    await page.locator('#login-email').fill('bruno@parity.test');
    await page.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await page
      .getByRole('button', { name: /^Entrar$/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/cadastro\/\d+$/, { timeout: 20_000 });
    for (const r of ['inicio', 'revisao', 'conquistas']) {
      await page.goto(`/#/${r}`);
      await expect(page).toHaveURL(/#\/cadastro\/\d+$/, { timeout: 15_000 });
      await expect(page.locator('.now-card, button.flash, .badges')).toHaveCount(0);
    }
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of 401/.test(e));
  });

  test('mobile: long unbroken card text never overflows; Hoje counts the new cards; session lost mid-review → entrar', async ({
    page,
    context,
  }) => {
    await signupFresh(page, 'Lia');
    const long = `Supercalifragilistic${'x'.repeat(140)}`;
    const add = await pageFetch(page, '/api/srs/cards', {
      method: 'POST',
      body: {
        cards: [
          { en: long, pt: `tradução ${'y'.repeat(150)}`, scene: `Extra · ${'z'.repeat(100)}`, source: 'extra' },
          { en: 'short card', pt: 'cartão curto', scene: 'Mic · teste', source: 'mic' },
        ],
      },
    });
    expect(add.status, add.text).toBe(200);
    // Hoje: the plan gains "Rebobinar 2 cartões" → revisao (same wording as prototipo guide.plan).
    await page.reload();
    await expect(page.locator('.plan .task[href="#/revisao"]')).toContainText('Rebobinar 2 cartões');
    await expect(page.locator('nav.tabbar a[href="#/revisao"] .badge')).toHaveText('2');
    await page.goto('/#/revisao');
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    // Equal due times: either card may come first. Grade the short one away ("Bom") if it leads.
    if (norm(await flash.locator('.h1').textContent()) === 'short card') {
      await flash.click();
      const g = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
      await page.locator('button.card.stack.tc').nth(2).click();
      expect((await g).status()).toBe(200);
    }
    await expect(flash.locator('.h1')).toHaveText(long);
    const overflow = async (what: string) => {
      try {
        await assertNoHorizontalOverflow(page, what);
      } catch (e) {
        expect.soft(String((e as Error).message), what).toBe('');
      }
    };
    await overflow('revisao long front');
    await flash.click();
    await expect(flash.locator('.p-read')).toBeVisible();
    await overflow('revisao long back');
    // The flash card stays inside the viewport.
    const box = await flash.boundingBox();
    expect.soft((box?.x ?? 0) + (box?.width ?? 0), 'flash card right edge').toBeLessThanOrEqual(375 + 1);

    // Session gone (cookie cleared / expired): grading sends the learner to entrar, no crash.
    await context.clearCookies();
    const resp = page.waitForResponse((r) => /\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()));
    await page.locator('button.card.stack.tc').nth(2).click();
    expect((await resp).status()).toBe(401);
    await expect(page).toHaveURL(/#\/entrar$/, { timeout: 15_000 });
    await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0);
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of 401/.test(e));
  });
});

// =====================================================================================
// Round 8: catalog failure on Revisão and Conquistas (retry card, then the screen), desktop level
// ladder named for assistive tech
// =====================================================================================

test.describe('round 8', () => {
  test.describe('desktop', () => {
    test.use(DESKTOP);
    test('catalog failure on Revisão/Conquistas: retry card recovers; level ladder nodes are named', async ({
      page,
    }) => {
      await signupFresh(page, 'Rita');
      for (const [route, ready] of [
        ['revisao', 'Seus cartões começam no episódio.'],
        ['conquistas', 'Como ganhar pontos'],
      ] as const) {
        await page.route('**/catalog.json', (r) =>
          r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) }),
        );
        await page.goto(`/#/${route}`);
        await page.reload();
        await expect(page.getByText('Não deu para carregar o conteúdo.')).toBeVisible();
        await page.unroute('**/catalog.json');
        await page.getByRole('button', { name: 'Tentar de novo' }).click();
        await expect(page.getByText(ready).first()).toBeVisible();
      }
      // Desktop level ladder: every node has a spoken label, the current one says so.
      const nodes = page.locator('.card.navy [role="img"][aria-label^="Nível "]');
      expect(await nodes.count()).toBeGreaterThanOrEqual(2);
      await expect(page.locator('.card.navy [role="img"][aria-label$="· seu nível"]')).toHaveCount(1);
      await assertNamedControls(page);
      const w = watches.get(page);
      if (w) w.errors = w.errors.filter((e) => !/status of 503/.test(e));
    });
  });
});

// =====================================================================================
// Round 9: Hoje greeting row = prototype, medal state for assistive tech, double-click grade sends
// one request, card capture limits, document security headers
// =====================================================================================

test.describe('round 9', () => {
  test('mobile: Hoje greeting row (level pill, Temporada · CEFR, avatar) = prototype; medals expose their state', async ({
    page,
    browser,
  }) => {
    // ana.s8: third sign-in in a full run (RL_AUTH 5/60s per ip+email).
    await login(page, 'ana.s8@parity.test');
    const greet = async (p: Page) =>
      p.evaluate(() => {
        const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const h = document.querySelector('h1.h1');
        const row = h?.parentElement?.querySelector('.row.mt8');
        return { h1: n(h?.textContent), row: n(row?.textContent), pill: !!row?.querySelector('.levelpill') };
      });
    const d = await greet(page);
    expect(d.pill).toBe(true);
    expect(d.row).toMatch(/Temporada \d+ · [ABC][12]/);
    const avatar = page
      .getByRole('button', { name: 'Perfil' })
      .or(page.getByRole('link', { name: 'Perfil' }))
      .first();
    await expect(avatar).toBeVisible();
    const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const pp = await protoPage(pctx, userState('ep1-s8'), 'inicio');
    const pd = await greet(pp);
    await pctx.close();
    expect(d).toEqual(pd);

    // Conquistas: each medal's spoken label says earned/locked, in agreement with .locked.
    await page.goto('/#/conquistas');
    await expect(page.locator('.badges .medal')).toHaveCount(14);
    const ms = await page
      .locator('.badges .medal')
      .evaluateAll((els) =>
        els.map((e) => [e.classList.contains('locked'), e.getAttribute('aria-label') ?? ''] as const),
      );
    for (const [locked, label] of ms) {
      expect(label).toMatch(locked ? /\. Bloqueada\.$/ : /\. Conquistada\.$/);
    }
  });

  test('mobile: a double-click on a grade sends one request and awards once', async ({ page }) => {
    await signupFresh(page, 'Nina');
    const add = await pageFetch(page, '/api/srs/cards', {
      method: 'POST',
      body: {
        cards: [
          { en: 'double one', pt: 'um', scene: 'Extra · teste', source: 'extra' },
          { en: 'double two', pt: 'dois', scene: 'Extra · teste', source: 'extra' },
          { en: 'double three', pt: 'três', scene: 'Extra · teste', source: 'extra' },
        ],
      },
    });
    expect(add.status, add.text).toBe(200);
    const pts0 = (await apiState(page)).game.points;
    await page.goto('/#/revisao');
    await page.reload();
    const flash = page.locator('button.flash');
    await expect(flash).toBeVisible();
    const posts: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/srs\/cards\/[^/]+\/grade$/.test(r.url()) && r.method() === 'POST') posts.push(r.url());
    });
    await flash.click();
    const bom = page.locator('button.card.stack.tc').nth(2);
    await expect(bom).toBeVisible();
    await bom.dblclick();
    await page.waitForTimeout(800);
    // The second click lands on the next card's face (grades gone), so it flips at most: one grade.
    expect(posts.length, posts.join(',')).toBe(1);
    await expect(page.locator('header.topbar')).toContainText('2 cartões hoje');
    expect((await apiState(page)).game.points).toBe(pts0 + 2);
  });

  test('card capture limits: oversize text and oversize batches are refused; grade needs POST', async ({ page }) => {
    await signupFresh(page, 'Olga');
    const big = await pageFetch(page, '/api/srs/cards', {
      method: 'POST',
      body: { cards: [{ en: 'a'.repeat(20_000), pt: 'b', scene: 'Extra · x', source: 'extra' }] },
    });
    expect(big.status, 'one 20k-char card').toBeGreaterThanOrEqual(400);
    expect(big.status).toBeLessThan(500);
    const many = await pageFetch(page, '/api/srs/cards', {
      method: 'POST',
      body: {
        cards: Array.from({ length: 2000 }, (_, i) => ({
          en: `bulk ${i}`,
          pt: `lote ${i}`,
          scene: 'Extra · x',
          source: 'extra',
        })),
      },
    });
    expect(many.status, 'a 2000-card batch').toBeGreaterThanOrEqual(400);
    expect(many.status).toBeLessThan(500);
    const badSource = await pageFetch(page, '/api/srs/cards', {
      method: 'POST',
      body: { cards: [{ en: 'x', pt: 'y', scene: 'Extra · x', source: 'admin' }] },
    });
    expect(badSource.status, 'unknown source').toBe(400);
    const st = await apiState(page);
    expect(st.deck.length, 'nothing stored by refused captures').toBe(0);
    const get = await pageFetch(page, '/api/srs/cards/whatever/grade');
    expect(get.status).not.toBe(200);
    const w = watches.get(page);
    if (w) w.errors = w.errors.filter((e) => !/status of (400|404|405|413)/.test(e));
  });

  test('document security headers: strict CSP (no inline/eval scripts), nosniff, no framing', async ({ page }) => {
    const r = await page.request.get('/');
    expect(r.status()).toBe(200);
    const h = r.headers();
    const csp = h['content-security-policy'] ?? '';
    expect(csp, 'CSP header').not.toBe('');
    const scriptSrc =
      (csp.split(';').find((d) => /^\s*script-src\s/.test(d)) ?? csp.match(/default-src[^;]*/)?.[0]) || '';
    expect(scriptSrc, 'script-src').not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*/);
    expect(csp).toMatch(/frame-ancestors 'none'|frame-ancestors 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(h['x-content-type-options']).toBe('nosniff');
    // The screens' API responses are not cacheable by shared caches.
    await login(page, 'ana.s8@parity.test');
    const st = await page.request.get('/api/me/state');
    expect(st.headers()['cache-control'] ?? '', '/api/me/state cache-control').toMatch(/no-store|private/);
  });
});

// =====================================================================================
// Static checks: slice code and the client bundle
// =====================================================================================

test.describe('static', () => {
  test('no innerHTML in the slice, no secrets/persona in the bundle', async () => {
    const root = join(APP_DIRS.app, 'web', 'src', 'screens');
    for (const dir of ['inicio', 'conquistas', 'revisao']) {
      for (const f of readdirSync(join(root, dir))) {
        const src = readFileSync(join(root, dir, f), 'utf8');
        expect(src, `${dir}/${f}`).not.toMatch(/innerHTML|dangerouslySetInnerHTML|outerHTML|insertAdjacentHTML|eval\(/);
      }
    }
    const dist = slotOf(SLOT).distDir('app');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (/\.(js|html|css|json|webmanifest)$/.test(e.name)) files.push(join(d, e.name));
      }
    };
    walk(dist);
    expect(files.length).toBeGreaterThan(0);
    // The assistants' personas (prototipo/js/data/assistants.js) must never reach the client.
    const asst = readFileSync(join(APP_DIRS.app, '..', '..', 'prototipo', 'js', 'data', 'assistants.js'), 'utf8');
    const personas = Array.from(asst.matchAll(/persona:\s*'((?:[^'\\]|\\.){40,})'/g)).map((m) =>
      (m[1] ?? '').slice(10, 50),
    );
    expect(personas.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      for (const p of personas) expect(t.includes(p), `${f} contains a persona`).toBe(false);
    }
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/persona\s*[:=]\s*["'`][^"'`]{20,}/i);
      expect(t, f).not.toMatch(
        /(TURNSTILE_SECRET|MEDIA_TOKEN_KEY|SESSION_SECRET|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'][^"']+/,
      );
      expect(t, f).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });
});
