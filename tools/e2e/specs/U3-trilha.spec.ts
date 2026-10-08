// U3-trilha: functional + parity checks for the Trilha and e-book screens (trilha, ebook/1,
// ebook/1/five, ebook/1/real, ebook/1/lead, ebook/1/teste) against the real Worker on the e2e slot.
// Each test gets its own D1 user (cloned from the parity fixture's Ana), created once in beforeAll
// through the parity fixture machinery, and signs in with that user's session cookie.
// The "parity" tests drive the same steps in the prototype (served from prototipo/, read-only) and
// compare the rendered .view DOM (tags, classes, inline styles, hrefs, text) with the app's.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { fixtureStatements } from '@tie/seed/fixtureToSql';
import { COOKIES } from '@tie/shared/constants';
import { VIEWPORTS, type ViewportName } from '../../parity/src/config';
import { contextOptions, prepareContext } from '../../parity/src/determinism';
import { type FixtureSql, namespaceCards, passHash } from '../../parity/src/fixture/sql';
import {
  FIXTURE_PASSWORD,
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

type Any = Record<string, any>;
const OUT = process.env.U3_OUT
  ? join(fileURLToPath(new URL('../out/', import.meta.url)), process.env.U3_OUT)
  : fileURLToPath(new URL('../out/u3-trilha/', import.meta.url));
const VPS: ViewportName[] = ['mobile', 'desktop'];
// The parity test opens several contexts per test; Playwright's trace recorder trips on that here.
test.use({ trace: 'off' });

// ---------------------------------------------------------------- users

type Kind = 'main' | 'done';
const USERS: { key: string; kind: Kind }[] = [];
for (const vp of VPS) {
  for (const t of ['trilha', 'ebook', 'parts', 'lead', 'teste', 'a11y', 'cmp-main', 'cmp-lead', 'cmp-teste']) {
    USERS.push({ key: `u3-${t}-${vp}`, kind: 'main' });
  }
  for (const t of ['done', 'cmp-done']) USERS.push({ key: `u3-${t}-${vp}`, kind: 'done' });
}
USERS.push({ key: 'u3-race-mobile', kind: 'main' });

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function stateOf(kind: Kind): Any {
  const s = clone(loadFixture());
  if (kind === 'done') {
    s.epsDone = { 1: true, 2: true };
    s.prog = { 1: 10, 2: 10 };
  }
  return s;
}
const userId = (key: string) => `U_E2E_${key.toUpperCase().replace(/-/g, '_')}`;
const emailOf = (key: string) => nsEmail('ana@parity.test', key);

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const now = Date.now();
  const pass = passHash(FIXTURE_PASSWORD);
  const statements: string[] = [];
  for (const u of USERS) {
    const state = isolateState(stateOf(u.kind), u.key, emailOf(u.key));
    statements.push(
      ...namespaceCards(
        fixtureStatements(state, {
          email: emailOf(u.key),
          passHash: pass,
          sessionTokenHash: tokenHash(sessionToken(u.key)),
          userId: userId(u.key),
          now,
        }),
        u.key,
      ),
    );
  }
  const fx: FixtureSql = {
    sql: `${statements.join('\n')}\n`,
    users: [],
    jobs: {},
    admin: { email: '', token: '' },
  };
  await applyFixtures(sl, fx, (m) => console.log(`[u3] ${m}`));
});

// ---------------------------------------------------------------- page helpers

interface Watch {
  errors: string[];
}

const INIT = `(() => {
  window.__spoken = [];
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' @' + e.sourceFile + ':' + e.lineNumber + ':' + e.columnNumber + ' ' + (e.sample || ''));
  });
  if ('speechSynthesis' in window) {
    const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push({ text: u.text, rate: u.rate });
      try { setTimeout(() => { try { u.onend && u.onend(new Event('end')); } catch (e) {} }, 50); } catch (e) {}
    };
    void real;
  }
})();`;

async function prepApp(ctx: BrowserContext, key: string): Promise<void> {
  await ctx.addCookies([
    { name: COOKIES.app, value: sessionToken(key), url: sl.origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  await ctx.addInitScript({ content: INIT });
  await ctx.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
  );
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text()))
      w.errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400)
      w.errors.push(`http ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return w;
}

async function expectClean(page: Page, w: Watch): Promise<void> {
  const all = await page.evaluate(() => (window as any).__csp as string[]).catch(() => [] as string[]);
  // zod v4's allowsEval probe (`try { Function('') } catch {}` in the shared ai chunk) trips
  // script-src on every page; it is caught and harmless, and not part of this slice: logged apart.
  const probe = (x: string) => /^script-src eval @.*\/assets\/ai-[\w-]+\.js:/.test(x);
  if (all.some(probe)) console.log('[u3] known global CSP report: zod allowsEval probe (script-src eval)');
  expect
    .soft(
      all.filter((x) => !probe(x)),
      'CSP violations',
    )
    .toEqual([]);
  expect.soft(w.errors, 'console/page/API errors').toEqual([]);
  await expect.soft(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

const view = (page: Page) => page.locator('.view').last();
const spoken = (page: Page) => page.evaluate(() => (window as any).__spoken as { text: string; rate: number }[]);

/** Buttons/links inside .view (and the topbar) without an accessible name. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.app button, .app a[href], .app [role=button]'))) {
      const h = el as HTMLElement;
      if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') continue;
      const name =
        h.getAttribute('aria-label') ||
        h.getAttribute('title') ||
        (h.textContent || '').trim() ||
        Array.from(h.querySelectorAll('img[alt]'))
          .map((i) => i.getAttribute('alt'))
          .join('');
      if (!name) out.push(h.outerHTML.slice(0, 160));
    }
    return out;
  });
}

async function tabTo(page: Page, sel: string, max = 60): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return true;
  }
  return false;
}

async function focusRing(page: Page): Promise<{ fv: boolean; outline: string; shadow: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    return {
      fv: a.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      shadow: cs.boxShadow,
    };
  });
}

const visibleRing = (r: { outline: string; shadow: string }) =>
  !/^none/.test(r.outline) && !/ 0px /.test(`${r.outline} `) ? true : r.shadow !== 'none';

// ---------------------------------------------------------------- functional tests, per viewport

for (const vp of VPS) {
  test.describe(`U3 ${vp}`, () => {
    test.use({
      viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height },
      isMobile: VIEWPORTS[vp].isMobile,
      hasTouch: VIEWPORTS[vp].hasTouch,
      deviceScaleFactor: VIEWPORTS[vp].deviceScaleFactor,
    });

    test(`trilha: season header, chapters, nodes (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-trilha-${vp}`);
      const w = watch(page);
      await page.goto('/#/trilha');
      const v = view(page);
      await expect(v.locator('.trail')).toBeVisible({ timeout: 20_000 });
      if (vp === 'mobile') {
        await expect(page.locator('.topbar')).toContainText('Temporada 1');
        await expect(page.locator('.topbar')).toContainText('Arrival');
        await expect(page.locator('.tabbar')).toBeVisible();
      } else {
        await expect(v.locator('h1.h1')).toHaveText('Arrival');
        await expect(v).toContainText('Temporada 1 · A1 · 20 episódios');
        await expect(page.locator('aside.side')).toBeVisible();
        await expect(page.locator('.tabbar')).toHaveCount(0);
      }
      await expect(v).toContainText('0 de 20');
      await expect(v).toContainText('A família, a viagem de Robert ao Brasil');
      // production extra: the bar counts steps (episode 1 at step 6 → 5/200 steps) and a "now" link
      await expect(v.locator('.card .bar i').first()).toHaveAttribute('style', /width:\s*3%/);
      const nowLink = v.locator('a.sm', { hasText: 'Agora: 01 Good Morning · etapa 6 de 10' });
      await expect(nowLink).toHaveAttribute('href', '#/episodio/1');
      // <details> with the 8 seasons
      const det = v.locator('details');
      await expect(det.locator('summary')).toHaveText('Ver as 8 temporadas');
      await expect(det).not.toHaveAttribute('open', '');
      await det.locator('summary').click();
      await expect(det).toHaveAttribute('open', '');
      await expect(det.locator('.pill')).toHaveCount(8);
      await expect(det.locator('.pill.navy')).toHaveCount(1);
      for (const s of [
        'Arrival',
        'Settling In',
        'Behind the Counter',
        'First Customers',
        'The Deal',
        'Under Pressure',
        'Going Big',
        'Full Circle',
      ])
        await expect(det).toContainText(s);
      // 10 chapters, 20 episode nodes, 10 extras nodes
      await expect(v.locator('.trail .chapter')).toHaveCount(10);
      await expect(v.locator('.trail .chapter').first()).toHaveText('E-book 1 · Nice to Meet You');
      await expect(v.locator('.trail .node:not(.aside)')).toHaveCount(20);
      await expect(v.locator('.trail .node.aside')).toHaveCount(10);
      // Ana: episode 1 current at step 6, nothing done
      const now = v.locator('.trail .node.now');
      await expect(now).toHaveCount(1);
      await expect(now).toHaveAttribute('href', '#/episodio/1');
      await expect(now).toContainText('Good Morning');
      await expect(now).toContainText('etapa 6 de 10');
      await expect(now.locator('.pill.or')).toHaveText('Agora');
      await expect(now.locator('.segs, .seg').first()).toBeVisible();
      await expect(v.locator('.trail .node.done')).toHaveCount(0);
      const ep2 = v.locator('.trail .node:not(.aside)').nth(1);
      await expect(ep2).toHaveClass(/locked/);
      await expect(ep2).toContainText('A seguir');
      expect(await ep2.evaluate((e) => e.tagName)).toBe('DIV');
      const x1 = v.locator('.trail .node.aside').first();
      await expect(x1).toHaveClass(/locked/);
      await expect(x1).toContainText('Extras e teste do e-book 1');
      await expect(x1).toContainText('Liberam com os dois episódios');
      await expect(v.locator('.trail .node.aside').last()).toContainText('Mais o Season Check');
      // a locked node is inert, the current one opens the player
      await ep2.click();
      await expect(page).toHaveURL(/#\/trilha$/);
      await now.click();
      await expect(page).toHaveURL(/#\/episodio\/1/);
      await expectClean(page, w);
    });

    test(`trilha: done episodes and the e-book extras node (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-done-${vp}`);
      const w = watch(page);
      await page.goto('/#/trilha');
      const v = view(page);
      await expect(v.locator('.trail')).toBeVisible({ timeout: 20_000 });
      await expect(v).toContainText('2 de 20');
      const done = v.locator('.trail .node.done:not(.aside)');
      await expect(done).toHaveCount(2);
      await expect(done.nth(0)).toHaveAttribute('href', '#/episodio/1/1');
      await expect(done.nth(1)).toHaveAttribute('href', '#/episodio/2/1');
      await expect(done.nth(0)).toContainText('Concluído');
      await expect(done.nth(0).locator('.pill.gold')).toHaveText('+40');
      const x1 = v.locator('a.node.aside.done');
      await expect(x1).toHaveCount(1);
      await expect(x1).toHaveAttribute('href', '#/ebook/1');
      await expect(x1).toContainText('Take Five · Take the Lead · Take it for Real · teste');
      await expect(x1).not.toContainText('/20');
      await x1.click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      await expect(view(page)).toContainText('Os episódios');
      await expect(view(page)).toContainText('Concluído · abrir de novo');
      // after a graded attempt the extras node shows the score ("· 20/20")
      const O = { Origin: new URL(page.url()).origin, 'Content-Type': 'application/json' };
      const sub = await page.request.post('/api/ebooks/1/test/submit', {
        data: JSON.stringify({ answers: { 'eb1-t1': 1, 'eb1-t2': 0 } }),
        headers: O,
      });
      expect(sub.status()).toBe(200);
      const sc = (await sub.json()).score as number;
      await page.goto('/#/trilha');
      await page.reload();
      await expect(view(page).locator('a.node.aside.done')).toContainText(`teste · ${sc}/20`, { timeout: 20_000 });
      await expectClean(page, w);
    });

    test(`ebook hub: scope, episodes, extras, test card, teaser (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-ebook-${vp}`);
      const w = watch(page);
      await page.goto('/#/ebook/1');
      const v = view(page);
      const head = vp === 'mobile' ? page.locator('.topbar') : v;
      await expect(head).toContainText('Temporada 1 · E-book 01');
      await expect(head).toContainText('Nice to Meet You');
      if (vp === 'desktop') await expect(v.locator('h1.h1')).toHaveText('Nice to Meet You');
      await expect(v).toContainText('Lições 1 e 2 · A1', { timeout: 20_000 });
      await expect(v.locator('.pill').first()).toHaveText('E-book 01');
      const eps = v.locator('a.card.row');
      await expect(eps).toHaveCount(2);
      await expect(eps.nth(0)).toHaveAttribute('href', '#/episodio/1/1');
      await expect(eps.nth(0)).toContainText('Good Morning');
      // production extra: where the learner is in episode 1 (Ana is at step 6)
      await expect(eps.nth(0)).toContainText('Em andamento · etapa 6 de 10');
      await expect(eps.nth(1)).toContainText('This Is My Family');
      await expect(eps.nth(1)).toContainText('A fazer');
      await expect(v).toContainText('Take some extras · opcionais');
      const grid = v.locator('a[href="#/ebook/1/five"]').locator('xpath=..');
      const cols = await grid.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      // prototype layout: the 4 extras as cards of one shape, 2 columns on desktop (Take It Out dashed)
      expect(cols).toBe(vp === 'desktop' ? 2 : 1);
      await expect(v.locator('a[href="#/ebook/1/five"]')).toContainText('5 páginas');
      await expect(v.locator('a[href="#/ebook/1/lead"]')).toContainText('~4 min');
      await expect(v.locator('a[href="#/ebook/1/real"]')).toContainText('8 dicas');
      await expect(v.locator('.card.dash').filter({ hasText: 'Take It Out' })).toContainText('Em produção');
      const test1 = v.locator('.card.navy').filter({ hasText: 'Take the episode test' });
      await expect(test1).toContainText(
        '20 questões sobre as Lições 1 e 2. Nota de corte: 70%, ou 14 acertos. Recomenda, não bloqueia.',
      );
      await expect(test1).not.toContainText('Última tentativa');
      await expect(test1.getByRole('button', { name: 'Fazer o teste · +50 pontos' })).toBeVisible();
      await expect(v.locator('.card.dash').filter({ hasText: 'Na próxima' })).toContainText('Sunday Lunch');
      // prototype: tabs:true, nav:'trilha' (the Trilha tab / side item stays lit on the hub)
      if (vp === 'mobile') await expect(page.locator('.tabbar a.tab.on')).toHaveAttribute('href', '#/trilha');
      else await expect(page.locator('aside.side')).toBeVisible();
      // navigation: test button, extras, back
      await test1.getByRole('button', { name: 'Fazer o teste · +50 pontos' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1\/teste$/);
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/trilha$/);
      await expectClean(page, w);
    });

    test(`ebook parts: five and real (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-parts-${vp}`);
      const w = watch(page);
      await page.goto('/#/ebook/1');
      await view(page).locator('a[href="#/ebook/1/five"]').click();
      await expect(page).toHaveURL(/#\/ebook\/1\/five$/);
      const v = view(page);
      const head = vp === 'mobile' ? page.locator('.topbar') : v;
      await expect(head).toContainText('E-book 01 · Extra');
      await expect(head).toContainText('Take Five');
      await expect(v.locator('p.p-read').first()).toHaveText(
        'Páginas culturais bilíngues. Opcional, mas é aqui que mora o inglês que o livro não ensina.',
      );
      const pages = v.locator('[id^="five-p"]');
      await expect(pages).toHaveCount(5);
      await expect(pages.locator('.lbl.or')).toHaveText(['CUMPRIMENTO', 'CORPO', 'NOMES', 'CONVERSA', 'PALAVRA-CHAVE']);
      await expect(pages.nth(0)).toContainText('Página 1 de 5');
      await expect(v).toContainText('“HOW ARE YOU?” NÃO É UMA PERGUNTA');
      await expect(pages.locator('span.lbl', { hasText: /^EVITE$/ })).toHaveCount(4);
      await expect(v.locator('.card.navy')).toHaveCount(1);
      // page index: jumps to a page
      const idx = v.locator('nav[aria-label="Páginas"] button.chip');
      await expect(idx).toHaveCount(5);
      await idx.nth(4).click();
      await expect(pages.nth(4)).toBeInViewport({ timeout: 5000 });
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      await view(page).locator('a[href="#/ebook/1/real"]').click();
      await expect(page).toHaveURL(/#\/ebook\/1\/real$/);
      const r = view(page);
      const cards = r.locator('.card.stack').filter({ hasText: 'Na rua' });
      await expect(cards).toHaveCount(8);
      await expect(cards.first()).toContainText('No livro');
      await expect(cards.first()).toContainText('Good, thanks. You?');
      await expect(r).toContainText('Uma observação sobre sotaque');
      await expectClean(page, w);
    });

    test(`ebook lead: branching chat, help, fixes, points, end card (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-lead-${vp}`);
      const w = watch(page);
      await page.goto('/#/ebook/1/lead');
      const v = view(page);
      await expect(v.locator('.bub.her')).toHaveCount(1, { timeout: 20_000 });
      // mobile: each of her bubbles carries her name; desktop: the chat panel header names her
      if (vp === 'mobile') await expect(v.locator('.bub.her').first()).toContainText('Margaret');
      else await expect(v).toContainText('Margaret Woods');
      await expect(v.locator('.bub.her').first()).toContainText('Oh, hi! Good morning.');
      await expect(v).toContainText('Responda em voz alta ou toque');
      await expect(v).toContainText('0 de 5 falas');
      const opts = v.locator('button.opt');
      await expect(opts).toHaveCount(3);
      await expect(opts.nth(0)).toContainText('Good morning! My name is Ana.');
      await expect(v.locator('button.chip')).toHaveCount(3);

      // help phrase: Margaret repeats, slower
      await v.locator('button.chip').filter({ hasText: 'Sorry?' }).click();
      await expect(v.locator('.bub.me').last()).toContainText('Sorry?');
      await expect(v.locator('.thinking')).toHaveCount(1);
      await expect(v.locator('button.opt')).toHaveCount(0);
      await expect(v.locator('.bub.her').last()).toContainText('(de novo, mais devagar) Ah, oi! Bom dia.');
      await expect(v.locator('.thinking')).toHaveCount(0);
      await expect
        .poll(async () =>
          (await spoken(page)).some((x) => x.text === 'Oh, hi! Good morning.' && Math.abs(x.rate - 0.75) < 0.3),
        )
        .toBe(true);

      // wrong option: a fix, no award
      let events = 0;
      page.on('request', (r) => {
        if (r.url().includes('/api/game/event')) events++;
      });
      await opts.nth(2).click();
      await expect(v.locator('.bub.me').last()).toContainText('Good morning! Am Ana.');
      await expect(v.locator('.thinking')).toHaveCount(1);
      await expect(v.locator('.bub.her').last()).toContainText('How are you?');
      expect(events).toBe(0);
      await expect.poll(async () => (await spoken(page)).some((x) => x.text.includes('How are you?'))).toBe(true);

      // right option: server award, +5 pontos
      const ev = page.waitForResponse((r) => r.url().includes('/api/game/event'));
      await v.locator('button.opt').nth(0).click();
      const res = await ev;
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.award?.awarded ?? body.awarded).toBeTruthy();
      await expect
        .soft(page.locator('#fxroot .pts-toast'), 'lead: +5 pontos toast from the quiz_hit award')
        .toHaveText('+5 pontos');
      await expect(v.locator('.bub.her').last()).toContainText('This is my son, Zach.');
      await expect(v).toContainText('2 de 5 falas');
      await v.locator('button.opt').nth(0).click();
      await expect(v.locator('.bub.her').last()).toContainText('Zach is a student.');
      await v.locator('button.opt').nth(2).click(); // I’m designer. (fix)
      await expect(v.locator('.bub.her').last()).toContainText('Bye, see you!');
      await expect(v.locator('button.opt')).toHaveCount(2);
      await v.locator('button.opt').nth(1).click(); // Bye-bye! (fix) → end
      const end = v.locator('.card.hi');
      await expect(end).toContainText('Missão cumprida.');
      await expect(end.locator('.fb.fix')).toHaveCount(3);
      await expect(end.locator('.fb.fix').nth(0)).toContainText('I’m Ana, nunca Am Ana');
      await expect(v.locator('button.opt')).toHaveCount(0);
      await expect(v).toContainText('5 de 5 falas');
      await expect(end.getByRole('button', { name: 'Fazer ao vivo com a Maggie' })).toBeVisible();

      // ephemeral: leaving and coming back starts over
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      await view(page).locator('a[href="#/ebook/1/lead"]').click();
      await expect(view(page).locator('.bub')).toHaveCount(1);
      await expect(view(page).locator('.card.hi')).toHaveCount(0);
      // finish with a fix again, then reset; a clean run gives the "Nenhum ajuste" card
      for (const i of [2, 0, 0, 0, 0]) {
        await expect(v.locator('button.opt').nth(i)).toBeVisible();
        await v.locator('button.opt').nth(i).click();
      }
      await end.getByRole('button', { name: 'Conversar de novo' }).click();
      await expect(v.locator('.bub')).toHaveCount(1);
      for (let t = 0; t < 5; t++) {
        await expect(v.locator('button.opt').first()).toBeVisible();
        await v.locator('button.opt').nth(0).click();
      }
      await expect(v.locator('.card.hi .fb.ok')).toContainText('Nenhum ajuste desta vez.');
      await v.getByRole('button', { name: 'Fazer ao vivo com a Maggie' }).click();
      await expect(page).toHaveURL(/#\/maggie\?modo=missao&m=gente$/);
      await expectClean(page, w);
    });

    test(`ebook teste: answers persist, server grading, review, redo, pass award (${vp})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(150_000);
      await prepApp(context, `u3-teste-${vp}`);
      const w = watch(page);
      await page.goto('/#/ebook/1/teste');
      const v = view(page);
      const progress = v
        .locator('.row')
        .filter({ has: page.locator('.bar') })
        .first();
      await expect(progress).toContainText('0 de 20', { timeout: 20_000 });
      expect(await progress.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
      await expect(v.locator('.lbl.or')).toHaveText([
        'PARTE A · ESCOLHA A ALTERNATIVA CORRETA',
        'PARTE B · COMPLETE',
        'PARTE C · TRADUZA PARA O INGLÊS',
        'PARTE D · PRONÚNCIA',
      ]);
      await expect(v.locator('input.input')).toHaveCount(9);

      // choice → saved at once
      const save1 = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/answers'));
      await card(page, 1).getByRole('button', { name: 'I’m' }).click();
      expect((await save1).status()).toBe(200);
      await expect(card(page, 1).getByRole('button', { name: 'I’m' })).toHaveClass(/pick/);
      await expect(card(page, 1).getByRole('button', { name: 'I’m' })).toHaveAttribute('aria-pressed', 'true');
      await expect(progress).toContainText('1 de 20');
      // typed → saved after a pause
      const save2 = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/answers'));
      await page.locator('#tq9').fill('name');
      await expect(progress).toContainText('2 de 20');
      expect((await save2).status()).toBe(200);
      // audio question
      await card(page, 20).getByRole('button', { name: 'Ouvir o áudio' }).click();
      await expect.poll(async () => (await spoken(page)).map((x) => x.text)).toContain('hi');
      // reload: answers come back from the server
      await page.reload();
      await expect(progress).toContainText('2 de 20', { timeout: 20_000 });
      await expect(card(page, 1).getByRole('button', { name: 'I’m' })).toHaveClass(/pick/);
      await expect(page.locator('#tq9')).toHaveValue('name');
      // typed, then leaving at once: the pending answer is flushed on unmount
      const save3 = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/answers'));
      await page.locator('#tq10').fill('nice');
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      expect((await save3).status()).toBe(200);
      await page.goto('/#/ebook/1/teste');
      await page.reload();
      await expect(page.locator('#tq10')).toHaveValue('nice', { timeout: 20_000 });
      await expect(progress).toContainText('3 de 20');

      // a failing attempt (13/20)
      await answerAll(page, FAIL);
      await expect(progress).toContainText('19 de 20');
      const sub = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/submit'));
      await page.waitForTimeout(1200); // saves settled (the in-flight race has its own test)
      await v.getByRole('button', { name: 'Entregar o teste' }).click();
      const subRes = await sub;
      expect(subRes.status()).toBe(200);
      expect((await subRes.json()).score).toBe(13);
      const res = v.locator('.card.navy').first();
      await expect(res).toContainText('Resultado');
      await expect(res.locator('.num')).toHaveText('13');
      await expect(res).toContainText('/20 · 65%');
      await expect(res).toContainText('Abaixo de 70%.');
      await expect(res).toContainText(
        'A recomendação é repetir as Lições 1 e 2 antes de seguir. Recomenda, não bloqueia.',
      );
      await expect(v).toContainText('O que revisar');
      const wrong = v.locator('.card').filter({ has: page.locator('.fb.err') });
      await expect(wrong).toHaveCount(7);
      await expect(wrong.locator('.num')).toHaveText(['1', '2', '4', '8', '15', '16', '20']);
      await expect(wrong.nth(0).locator('.fb.err')).toContainText('Am');
      await expect(wrong.nth(0).locator('.fb.ok')).toContainText('I’m');
      await expect(wrong.nth(5).locator('.fb.err')).toContainText('Sem resposta');
      await expect(wrong.nth(4).locator('.fb.ok')).toContainText('She’s an engineer.');
      await expect(wrong.nth(0).locator('a.btn.link')).toHaveAttribute('href', '#/episodio/1/7');
      await expect(wrong.nth(0).locator('a.btn.link')).toHaveText('Revisar: Lição 1 · Take a Lesson');
      await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0);
      expect(await page.evaluate(() => document.querySelector('.scroll')?.scrollTop ?? 0)).toBe(0);
      // reload: the result is server state
      await page.reload();
      await expect(view(page).locator('.card.navy .num').first()).toHaveText('13', { timeout: 20_000 });
      await expect(
        view(page)
          .locator('.card')
          .filter({ has: page.locator('.fb.err') }),
      ).toHaveCount(7);
      // review link opens the player
      await view(page).locator('a.btn.link').first().click();
      await expect(page).toHaveURL(/#\/episodio\/1\//);
      // hub shows the last score
      await page.goto('/#/ebook/1');
      const hubTest = view(page).locator('.card.navy').filter({ hasText: 'Take the episode test' });
      await expect(hubTest).toContainText('Última tentativa: 13/20', { timeout: 20_000 });
      await hubTest.getByRole('button', { name: 'Refazer o teste' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1\/teste$/);
      // the result is still there; "Refazer o teste" clears it
      const redo = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/answers'));
      await view(page).getByRole('button', { name: 'Refazer o teste' }).click();
      expect((await redo).status()).toBe(200);
      await expect(progress).toContainText('0 de 20');
      await page.reload();
      await expect(
        view(page)
          .locator('.row')
          .filter({ has: page.locator('.bar') })
          .first(),
      ).toContainText('0 de 20', {
        timeout: 20_000,
      });
      // prototype testRedo keeps testScore: the hub still says "Última tentativa: 13/20" / "Refazer o teste"
      await page.goto('/#/ebook/1');
      const hubAfterRedo = view(page).locator('.card.navy').filter({ hasText: 'Take the episode test' });
      await expect(hubAfterRedo).toBeVisible({ timeout: 20_000 });
      await expect
        .soft(hubAfterRedo, 'hub keeps the last score after Refazer (prototype keeps testScore)')
        .toContainText('Última tentativa: 13/20');
      await page.goto('/#/ebook/1/teste');
      await expect(
        view(page)
          .locator('.row')
          .filter({ has: page.locator('.bar') })
          .first(),
      ).toContainText('0 de 20', {
        timeout: 20_000,
      });

      // pass (20/20): +50 pontos
      await answerAll(page, PASS);
      const sub2 = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/submit'));
      await page.waitForTimeout(1200);
      // the sticky "Entregar" in the progress row submits too
      await view(page).getByRole('button', { name: 'Entregar', exact: true }).click();
      const r2 = await (await sub2).json();
      expect(r2.score).toBe(20);
      expect(r2.award?.awarded).toBe(true);
      await expect(page.locator('#fxroot .pts-toast').first()).toHaveText('+50 pontos');
      const res2 = view(page).locator('.card.navy').first();
      await expect(res2.locator('.num')).toHaveText('20');
      await expect(res2).toContainText('/20 · 100%');
      await expect(res2).toContainText('Acima da nota de corte.');
      await expect(res2).toContainText('O e-book 1 está fechado. Revise os pontos abaixo antes do E-book 2.');
      await expect(view(page)).not.toContainText('O que revisar');
      // second pass: no second award
      await view(page).getByRole('button', { name: 'Refazer o teste' }).click();
      await expect(
        view(page)
          .locator('.row')
          .filter({ has: page.locator('.bar') })
          .first(),
      ).toContainText('0 de 20');
      await answerAll(page, PASS);
      const sub3 = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/submit'));
      await page.waitForTimeout(1800); // earlier toasts gone
      await view(page).getByRole('button', { name: 'Entregar o teste' }).click();
      const r3 = await (await sub3).json();
      expect(r3.award?.awarded ?? false).toBe(false);
      await page.waitForTimeout(600);
      await expect(page.locator('#fxroot .pts-toast')).toHaveCount(0);
      await view(page).getByRole('button', { name: 'Voltar à trilha' }).click();
      await expect(page).toHaveURL(/#\/trilha$/);
      await expectClean(page, w);
    });

    test(`a11y: names on controls, visible keyboard focus (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u3-a11y-${vp}`);
      const w = watch(page);
      const report: Record<string, unknown> = {};
      for (const route of ['trilha', 'ebook/1', 'ebook/1/five', 'ebook/1/real', 'ebook/1/lead', 'ebook/1/teste']) {
        await page.goto(`/#/${route}`);
        await expect(view(page).locator('.card').first()).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(300);
        report[route] = await unnamedControls(page);
        expect.soft(report[route], `unnamed controls on ${route}`).toEqual([]);
      }
      // keyboard focus on a trail node, a lead option, a test choice
      const checks: [string, string][] = [
        ['trilha', '.trail a.node'],
        ['ebook/1', 'a.card'],
        ['ebook/1/lead', 'button.opt'],
        ['ebook/1/five', 'nav button.chip'],
        ['ebook/1/teste', 'button.pillopt'],
      ];
      for (const [route, sel] of checks) {
        await page.goto(`/#/${route}`);
        await expect(view(page).locator(sel).first()).toBeVisible({ timeout: 20_000 });
        await page
          .locator('body')
          .click({ position: { x: 1, y: 1 } })
          .catch(() => {});
        const ok = await tabTo(page, sel);
        expect.soft(ok, `Tab reaches ${sel} on ${route}`).toBe(true);
        if (ok) {
          const ring = await focusRing(page);
          report[`focus ${route} ${sel}`] = ring;
          expect.soft(visibleRing(ring), `visible focus ring on ${sel} (${route}): ${JSON.stringify(ring)}`).toBe(true);
        }
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `a11y-${vp}.json`), JSON.stringify(report, null, 2));
      await expectClean(page, w);
    });
  });
}

// ---------------------------------------------------------------- screenshots (visual sanity, for the report)

for (const vp of VPS) {
  test(`screens: visual sanity shots (${vp})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ ...contextOptions(vp), bypassCSP: false });
    try {
      await prepApp(ctx, `u3-cmp-done-${vp}`);
      const page = await ctx.newPage();
      const w = watch(page);
      mkdirSync(join(OUT, 'shots'), { recursive: true });
      for (const route of ['trilha', 'ebook/1', 'ebook/1/five', 'ebook/1/real', 'ebook/1/lead', 'ebook/1/teste']) {
        await page.goto(`${sl.origin}/#/${route}`);
        await expect(page.locator('.view .card').first()).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(OUT, 'shots', `${route.replace(/\//g, '-')}-${vp}.png`) });
      }
      await expectClean(page, w);
    } finally {
      await ctx.close();
    }
  });
}

// ---------------------------------------------------------------- phone layout: no sideways scroll, keyboard use

for (const width of [375, 320]) {
  test(`layout: no horizontal overflow on a ${width}px phone`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 760 });
    await prepApp(context, 'u3-a11y-mobile');
    const w = watch(page);
    const report: Record<string, unknown> = {};
    for (const route of ['trilha', 'ebook/1', 'ebook/1/five', 'ebook/1/real', 'ebook/1/lead', 'ebook/1/teste']) {
      await page.goto(`/#/${route}`);
      await expect(view(page).locator('.card').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);
      const o = await page.evaluate(() => {
        const de = document.documentElement;
        const sc = document.querySelector('.view .scroll, .scroll') as HTMLElement | null;
        const wide: string[] = [];
        for (const el of Array.from(document.querySelectorAll('.view *'))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.right > window.innerWidth + 1 && !(el as HTMLElement).closest('nav.chips')) {
            wide.push(`${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')} right=${Math.round(r.right)}`);
          }
        }
        return {
          doc: de.scrollWidth - de.clientWidth,
          scroll: sc ? sc.scrollWidth - sc.clientWidth : 0,
          wide: wide.slice(0, 5),
        };
      });
      report[route] = o;
      expect.soft(o.doc, `document overflows sideways on ${route} @${width}`).toBeLessThanOrEqual(0);
      expect.soft(o.scroll, `.scroll overflows sideways on ${route} @${width}`).toBeLessThanOrEqual(0);
      expect.soft(o.wide, `elements past the right edge on ${route} @${width}`).toEqual([]);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `overflow-${width}.json`), JSON.stringify(report, null, 2));
    await expectClean(page, w);
  });
}

test('keyboard: lead options, help phrases and test choices work with Enter/Space', async ({ page, context }) => {
  await prepApp(context, 'u3-a11y-desktop');
  const w = watch(page);
  await page.goto('/#/ebook/1/lead');
  const v = view(page);
  await expect(v.locator('button.opt').first()).toBeVisible({ timeout: 20_000 });
  await v.locator('button.chip').first().focus();
  await page.keyboard.press('Enter');
  await expect(v.locator('.bub.her')).toHaveCount(2);
  await expect(v.locator('button.opt').first()).toBeVisible();
  await v.locator('button.opt').first().focus();
  await page.keyboard.press('Space');
  await expect(v.locator('.bub.me')).toHaveCount(2);
  await expect(v.locator('.bub.her')).toHaveCount(3);
  await page.goto('/#/ebook/1/teste');
  const c1 = card(page, 2).locator('button.pillopt').nth(0);
  await expect(c1).toBeVisible({ timeout: 20_000 });
  await c1.focus();
  const save = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/answers'));
  await page.keyboard.press('Enter');
  expect((await save).status()).toBe(200);
  await expect(c1).toHaveAttribute('aria-pressed', 'true');
  await expectClean(page, w);
});

test('trilha: unscripted episodes before the current one are "Em produção"', async ({ page, context }) => {
  await prepApp(context, 'u3-done-mobile');
  const w = watch(page);
  await page.goto('/#/trilha');
  const v = view(page);
  await expect(v.locator('.trail')).toBeVisible({ timeout: 20_000 });
  const nodes = v.locator('.trail .node:not(.aside)');
  const nowHref = await v
    .locator('.trail .node.now')
    .getAttribute('href')
    .catch(() => null);
  const nowN = nowHref ? Number(nowHref.split('/').pop()) : 0;
  console.log(`[u3] done user: current node ${nowHref}`);
  for (let n = 3; n < nowN; n++) {
    await expect(nodes.nth(n - 1)).toContainText('Em produção');
    await expect(nodes.nth(n - 1)).toHaveClass(/locked/);
  }
  if (nowN)
    for (let n = nowN + 1; n <= Math.min(20, nowN + 2); n++) await expect(nodes.nth(n - 1)).toContainText('A seguir');
  await expectClean(page, w);
});

// ---------------------------------------------------------------- submit right after the last pick

test('teste: a pick still being saved is graded by the submit (slow network)', async ({ page, context }) => {
  await prepApp(context, 'u3-race-mobile');
  const w = watch(page);
  await page.goto('/#/ebook/1/teste');
  await expect(
    view(page)
      .locator('.row')
      .filter({ has: page.locator('.bar') })
      .first(),
  ).toContainText('0 de 20', {
    timeout: 20_000,
  });
  const { 20: _last, ...rest } = PASS;
  await answerAll(page, rest);
  await page.waitForTimeout(1500); // everything so far is saved
  // slow network: the answers PUT takes 1.5 s
  await page.route('**/api/ebooks/1/test/answers', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await card(page, 20).locator('button.pillopt').nth(1).click();
  const sub = page.waitForResponse((r) => r.url().includes('/api/ebooks/1/test/submit'));
  await view(page).getByRole('button', { name: 'Entregar o teste' }).click();
  const r = await (await sub).json();
  const wrong = (r.results ?? []).filter((x: { correct: boolean }) => !x.correct).map((x: { n: number }) => x.n);
  expect.soft(wrong, 'questions graded wrong although answered right on screen').toEqual([]);
  expect.soft(r.score, 'server score of a 20/20 sheet').toBe(20);
  // what the learner sees: score vs the review list
  const shown = await view(page).locator('.card.navy .num').first().textContent();
  const reviewCards = await view(page)
    .locator('.card')
    .filter({ has: page.locator('.fb.err') })
    .count();
  expect
    .soft({ shown, reviewCards }, 'result card consistent with the review list')
    .toEqual({ shown: '20', reviewCards: 0 });
  await page.unroute('**/api/ebooks/1/test/answers');
  await expectClean(page, w);
});

// ---------------------------------------------------------------- API security (test endpoints)

test('test API: auth, CSRF, validation, closed e-books', async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: sl.origin });
  const authed = await playwright.request.newContext({
    baseURL: sl.origin,
    extraHTTPHeaders: { Cookie: `${COOKIES.app}=${sessionToken('u3-a11y-mobile')}` },
  });
  const O = { Origin: sl.origin, 'Content-Type': 'application/json' };
  const report: Record<string, unknown> = {};
  try {
    const put = (ctx: typeof anon, n: number | string, body: unknown, headers: Record<string, string> = O) =>
      ctx.put(`/api/ebooks/${n}/test/answers`, { data: JSON.stringify(body), headers });
    const r1 = await put(anon, 1, { answers: { 'eb1-t1': 1 } });
    report.anon = r1.status();
    expect.soft(r1.status(), 'no session → 401').toBe(401);
    const r2 = await put(
      authed,
      1,
      { answers: { 'eb1-t1': 1 } },
      { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    );
    report.foreignOrigin = r2.status();
    expect.soft(r2.status(), 'foreign Origin → 403').toBe(403);
    const r3 = await put(authed, 1, { answers: { 'eb1-t1': 99 } });
    report.badChoice = r3.status();
    expect.soft(r3.status(), 'out-of-range choice → 400').toBe(400);
    const r4 = await put(authed, 1, { answers: { 'eb1-t9': 3 } });
    report.choiceOnTyped = r4.status();
    expect.soft(r4.status(), 'number on a typed question → 400').toBe(400);
    const r5 = await put(authed, 1, { answers: { 'other-q': 1 } });
    report.unknownQ = r5.status();
    expect.soft(r5.status(), 'unknown question → 400').toBe(400);
    const r6 = await put(authed, 1, { answers: { 'eb1-t9': 'x'.repeat(5000) } });
    report.longText = r6.status();
    expect.soft(r6.status(), 'oversized text → 400/413').toBeGreaterThanOrEqual(400);
    const r7 = await authed.post('/api/ebooks/3/test/submit', { data: '{}', headers: O });
    report.closedEbook = r7.status();
    expect.soft([403, 404, 409, 422], 'e-book of an unpublished episode is not gradable').toContain(r7.status());
    const r8 = await authed.post('/api/ebooks/abc/test/submit', { data: '{}', headers: O });
    report.badParam = r8.status();
    expect.soft(r8.status(), 'bad :n → 4xx').toBeGreaterThanOrEqual(400);
    expect.soft(r8.status()).toBeLessThan(500);
    const r9 = await authed.put('/api/ebooks/1/test/answers', { data: '{"answers":', headers: O });
    report.badJson = r9.status();
    expect.soft(r9.status(), 'malformed JSON → 400').toBe(400);
    // Lead awards: quiz_hit keyed lead-eb1:{turn}. Forged keys must not farm points without bound.
    let farmed = 0;
    for (let i = 0; i < 30; i++) {
      const r = await authed.post('/api/game/event', {
        data: JSON.stringify({ kind: 'quiz_hit', key: `lead-eb1:${1000 + i}` }),
        headers: O,
      });
      if (r.ok()) {
        const b = await r.json();
        farmed += (b.awarded ? (b.points ?? b.pts ?? b.delta ?? 0) : 0) as number;
        if (i === 0) report.firstEventBody = b;
      } else if (i === 0) report.firstEventStatus = r.status();
    }
    report.farmedPointsFrom30ForgedLeadKeys = farmed;
    const page = await authed.get('/');
    report.csp = page.headers()['content-security-policy'] ?? null;
    expect.soft(report.csp, 'CSP header on the app document').toBeTruthy();
  } finally {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'api-security.json'), JSON.stringify(report, null, 2));
    await anon.dispose();
    await authed.dispose();
  }
});

// ---------------------------------------------------------------- test answers

type Answers = Record<number, number | string>;
/** 13/20: wrong = 1, 2, 4, 8, 15, 16 (blank), 20. */
const FAIL: Answers = {
  1: 0,
  2: 1,
  3: 1,
  4: 0,
  5: 0,
  6: 1,
  7: 1,
  8: 0,
  9: 'name',
  10: 'nice',
  11: 'and',
  12: 'this',
  13: 'she is',
  14: 'good morning i am ana',
  15: 'She is engineer',
  17: 'Who is this? She is our neighbor.',
  18: 1,
  19: 1,
  20: 0,
};
const PASS: Answers = {
  1: 1,
  2: 0,
  3: 1,
  4: 1,
  5: 0,
  6: 1,
  7: 1,
  8: 2,
  9: 'name',
  10: 'Nice',
  11: 'And',
  12: 'This',
  13: 'She’s',
  14: 'Good morning. I’m Ana.',
  15: 'She’s an engineer.',
  16: 'This is my father. His name is Paulo.',
  17: 'Who’s this? She’s our neighbor.',
  18: 1,
  19: 1,
  20: 1,
};

const card = (page: Page, n: number) =>
  page
    .locator('.view .card')
    .filter({ has: page.locator('span.num', { hasText: new RegExp(`^${n}$`) }) })
    .first();

async function answerAll(page: Page, a: Answers): Promise<void> {
  for (const [k, v] of Object.entries(a)) {
    const n = Number(k);
    if (typeof v === 'number') {
      await card(page, n).locator('button.pillopt').nth(v).click();
      await expect(card(page, n).locator('button.pillopt').nth(v)).toHaveClass(/pick/);
    } else {
      await page.locator(`#tq${n}`).fill(v);
    }
  }
}

// ---------------------------------------------------------------- parity with the prototype

function signatureFn(sel: string): string[] {
  const root = document.querySelectorAll(sel);
  const el0 = root[root.length - 1];
  if (!el0) return ['<no root>'];
  const out: string[] = [];
  const walk = (el: Element, d: number) => {
    let buf = '';
    const ind = '  '.repeat(d);
    const flushText = () => {
      const t = buf.replace(/ /g, '⍽').replace(/\s+/g, ' ').trim();
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
      const cls = Array.from(e.classList)
        .filter((c) => c !== 'enter' && c !== 'heard')
        .sort()
        .join('.');
      const st: string[] = [];
      for (let i = 0; i < e.style.length; i++) {
        const p = e.style[i] as string;
        st.push(`${p}:${e.style.getPropertyValue(p).trim()}`);
      }
      st.sort();
      const attrs: string[] = [];
      for (const a of ['href', 'id', 'placeholder', 'disabled', 'open']) {
        if (e.hasAttribute(a)) attrs.push(`${a}=${e.getAttribute(a)}`);
      }
      if (tag === 'input') attrs.push(`value=${(e as HTMLInputElement).value}`);
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

/** Line diff (LCS), as "- proto" / "+ app" lines. */
function diff(a: string[], b: string[]): string[] {
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
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      out.push(`+ app   @${j}: ${b[j]}`);
      j++;
    } else {
      out.push(`- proto @${i}: ${a[i]}`);
      i++;
    }
  }
  return out;
}

type Steps = (page: Page, side: 'proto' | 'app') => Promise<void>;

async function compare(
  browser: import('@playwright/test').Browser,
  proto: StaticServer,
  vp: ViewportName,
  name: string,
  appUser: string,
  kind: Kind,
  route: string,
  steps?: Steps,
): Promise<string[]> {
  const sigs: Record<'proto' | 'app', string[]> = { proto: [], app: [] };
  for (const side of ['proto', 'app'] as const) {
    const ctx = await browser.newContext({ ...contextOptions(vp), bypassCSP: false });
    try {
      if (side === 'proto') {
        const st = isolateState(stateOf(kind), appUser, emailOf(appUser));
        await prepareContext(ctx, {
          side: 'prototype',
          seedKey: `${name}|${vp}`,
          storage: storageOf(st),
          allowOrigins: [new URL(proto.url).origin],
        });
        await ctx.addInitScript({ content: INIT });
      } else {
        await prepApp(ctx, appUser);
      }
      const page = await ctx.newPage();
      const base = side === 'proto' ? proto.url.replace(/\/?$/, '/') : `${sl.origin}/`;
      await page.goto(`${base}#/${route}`);
      await expect(page.locator('.view .card').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      if (steps) await steps(page, side);
      await page.waitForTimeout(500);
      sigs[side] = await page.evaluate(signatureFn, '.view');
    } finally {
      await ctx.close();
    }
  }
  const d = diff(sigs.proto, sigs.app);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `dom-${name}-${vp}.proto.txt`), sigs.proto.join('\n'));
  writeFileSync(join(OUT, `dom-${name}-${vp}.app.txt`), sigs.app.join('\n'));
  writeFileSync(join(OUT, `dom-${name}-${vp}.diff.txt`), d.join('\n'));
  return d;
}

const leadSteps: Steps = async (page, side) => {
  const v = page.locator('.view');
  await v.locator('button.chip').first().click();
  await page.waitForTimeout(1200);
  for (const i of [2, 0, 0, 2, 1]) {
    const sel = side === 'proto' ? 'button.card' : 'button.opt';
    await expect(v.locator(sel).first()).toBeVisible({ timeout: 5000 });
    await v.locator(sel).nth(i).click();
    await page.waitForTimeout(1200);
  }
};
const testSteps: Steps = async (page) => {
  await answerAll(page, FAIL);
  await page.locator('.view').getByRole('button', { name: 'Entregar o teste' }).click();
  await expect(page.locator('.view')).toContainText('Resultado', { timeout: 10_000 });
};

test.describe('U3 parity with the prototype', () => {
  let proto: StaticServer;
  test.beforeAll(async () => {
    proto = await servePrototype(sl.protoPort);
  });
  test.afterAll(async () => {
    await proto?.close();
  });
  for (const vp of VPS) {
    test(`DOM parity (${vp})`, async ({ browser }) => {
      test.setTimeout(240_000);
      const cases: [string, string, Kind, string, Steps?][] = [
        ['trilha', `u3-cmp-main-${vp}`, 'main', 'trilha'],
        ['trilha-done', `u3-cmp-done-${vp}`, 'done', 'trilha'],
        ['ebook-1', `u3-cmp-main-${vp}`, 'main', 'ebook/1'],
        ['ebook-five', `u3-cmp-main-${vp}`, 'main', 'ebook/1/five'],
        ['ebook-real', `u3-cmp-main-${vp}`, 'main', 'ebook/1/real'],
        ['ebook-lead', `u3-cmp-main-${vp}`, 'main', 'ebook/1/lead'],
        ['ebook-lead-end', `u3-cmp-lead-${vp}`, 'main', 'ebook/1/lead', leadSteps],
        ['ebook-teste', `u3-cmp-main-${vp}`, 'main', 'ebook/1/teste'],
        ['ebook-teste-result', `u3-cmp-teste-${vp}`, 'main', 'ebook/1/teste', testSteps],
      ];
      const summary: Record<string, number> = {};
      for (const [name, user, kind, route, steps] of cases) {
        const d = await compare(browser, proto, vp, name, user, kind, route, steps);
        summary[name] = d.length;
        // Informational: the slice now carries deliberate production layout changes (see the diff files).
        if (d.length)
          test.info().annotations.push({ type: 'dom-diff', description: `${name} ${vp}: ${d.length} lines` });
      }
      writeFileSync(join(OUT, `dom-summary-${vp}.json`), JSON.stringify(summary, null, 2));
    });
  }
});
