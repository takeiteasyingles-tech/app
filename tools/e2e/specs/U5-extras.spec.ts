// U5-extras functional verification: EXTRA catalog, detail, watch + dub player, música karaokê and the
// Desafio relâmpago, driven against the real Worker (slot N, see src/run.ts). Each test signs up a
// fresh learner so awards (once-per-key) are observable. Selectors follow prototipo/js/screens/extra.js.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Response, test } from '@playwright/test';
import { slot as slotOf } from '../../parity/src/config';
import { SLOT } from '../src/slotEnv';
import { stubTurnstile } from '../src/turnstile';

// ---------- prototype data (the seed is built from it): EN line → PT translation ----------
interface ProtoLine {
  who: string;
  en: string;
  pt: string;
}
interface ProtoExtra {
  id: string;
  title: string;
  dub: string;
  locked?: boolean;
  lines: ProtoLine[];
  vocab: [string, string][];
  format: string;
}
interface ProtoTrack {
  title: string;
  lines?: { en: string; pt: string; gap: string }[];
}
interface ProtoAlbum {
  id: string;
  title: string;
  tracks: ProtoTrack[];
}
const protoSrc = readFileSync(fileURLToPath(new URL('../../../prototipo/js/data/extras.js', import.meta.url)), 'utf8');
const W: { TIE: { data?: { EXTRAS: ProtoExtra[]; ALBUMS: ProtoAlbum[] } } } = { TIE: {} };
new Function('window', 'TIE', protoSrc)(W, W.TIE);
const EXTRAS = W.TIE.data?.EXTRAS ?? [];
const ALBUMS = W.TIE.data?.ALBUMS ?? [];
const PT_OF = new Map<string, string>();
for (const x of EXTRAS) for (const l of x.lines) PT_OF.set(l.en, l.pt);
const WOODS = EXTRAS.find((x) => x.id === 'woods-and-beans') as ProtoExtra;

// ---------- harness ----------
interface Watch {
  errors: string[];
  csp: string[];
  api: { method: string; url: string; status: number; body?: string }[];
}

const SPEECH_STUB = `(() => {
  // Headless Chromium has no voices; finish each utterance quickly so scene playback advances.
  if ('speechSynthesis' in window) {
    const ss = window.speechSynthesis;
    let speaking = false;
    Object.defineProperty(ss, 'speaking', { get: () => speaking, configurable: true });
    ss.speak = (u) => {
      speaking = true;
      setTimeout(() => { try { u.onstart && u.onstart(new Event('start')); } catch (e) {} }, 5);
      setTimeout(() => { speaking = false; try { u.onend && u.onend(new Event('end')); } catch (e) {} }, 250);
    };
    ss.cancel = () => { speaking = false; };
  }
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
  });
})();`;

async function watch(page: Page): Promise<Watch> {
  const w: Watch = { errors: [], csp: [], api: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(m.text());
    if (/Content Security Policy|Refused to/i.test(m.text())) w.csp.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('response', async (r: Response) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/') || r.request().method() === 'GET') return;
    let body: string | undefined;
    try {
      body = (await r.text()).slice(0, 600);
    } catch {
      body = undefined;
    }
    w.api.push({ method: r.request().method(), url: u.pathname, status: r.status(), body });
  });
  await page.addInitScript(SPEECH_STUB);
  return w;
}

async function noProblems(page: Page, w: Watch) {
  const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []).catch(() => []);
  // Known, not owned by this slice: zod v4's allowsEval probe (`new Function('')` in a try/catch,
  // shared schema chunk) trips script-src once per page. Fix belongs in the web entry
  // (z.config({ jitless: true })). Reported as an annotation instead of failing the slice.
  const zodProbe = (v: string) => /^script-src eval .*\/assets\/ai-[\w-]+\.js:1$/.test(v);
  const known = [...w.csp, ...csp].filter(zodProbe);
  if (known.length) test.info().annotations.push({ type: 'known-csp', description: known.join(' | ') });
  expect
    .soft(
      [...w.csp, ...csp].filter((v) => !zodProbe(v)),
      'CSP violations',
    )
    .toEqual([]);
  expect.soft(w.errors, 'console errors').toEqual([]);
  const bad = w.api.filter((a) => a.status >= 400);
  expect.soft(bad, 'failed API writes').toEqual([]);
  await expect.soft(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

const button = (page: Page, name: RegExp) => page.getByRole('button', { name }).first();

/** Fresh learner through the real signup + onboarding (Séries and Animes as formats). */
async function signup(page: Page, w?: Watch): Promise<string> {
  const id = randomBytes(4).toString('hex');
  const email = `u5x-${id}@e2e.test`;
  await page.goto('/#/entrar');
  await page.getByText('Criar conta grátis').first().click();
  await expect(page).toHaveURL(/#\/cadastro\/1$/);
  await page.locator('#onb-fullname').fill('Bia Extra');
  await page.locator('#onb-name').fill('Bia');
  await page.locator('#onb-birth').fill('1995-05-10');
  await page.locator('#onb-email').fill(email);
  await page.locator('#onb-pass').fill(`e2e-${randomBytes(6).toString('hex')}`);
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
  await page.getByText('Viajar sem travar').first().click();
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/3$/);
  const fmt = page.locator('.fmt', { hasText: 'Séries' });
  await page
    .locator('.fmt')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  if (await fmt.count()) {
    await fmt.first().click();
    await page.locator('.fmt', { hasText: 'Animes' }).first().click();
    await button(page, /^Continuar/).click();
  } else await button(page, /^Pular$/).click();
  await expect(page).toHaveURL(/#\/cadastro\/4$/);
  for (const n of [4, 5]) {
    await button(page, /^Pular$/).click();
    await expect(page).toHaveURL(new RegExp(`#\\/cadastro\\/${n + 1}$`));
  }
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/7$/);
  await button(page, /Pular por enquanto|Começar o curso/).click();
  await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
  // Only what happens on the EXTRA screens counts (signup/Hoje noise belongs to other slices).
  if (w) {
    w.errors.length = 0;
    w.csp.length = 0;
    w.api.length = 0;
    await page.evaluate(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
    });
  }
  return email;
}

async function meState(page: Page): Promise<
  Record<string, unknown> & {
    extras: { seen: Record<string, boolean>; best: number; dubs: Record<string, number> };
    deck: { en: string }[];
  }
> {
  return page.evaluate(async () => {
    const r = await fetch('/api/me/state', { credentials: 'same-origin' });
    return r.json();
  });
}

/** Every visible button / link with no accessible name. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=button]'))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim();
      const labelled = el.getAttribute('aria-labelledby');
      if (!name && !labelled) out.push(el.outerHTML.slice(0, 160));
    }
    return out;
  });
}

const apiHit = (w: Watch, re: RegExp) => w.api.filter((a) => re.test(a.url));

test.beforeEach(async ({ context }) => {
  await stubTurnstile(context);
  await context.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
  );
});

// =====================================================================================
test('EXTRA catalog (mobile): shelves, coverflow, rails, albums, desafio card, estreias', async ({ page }) => {
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra');
  await expect(page.locator('.on-navy .topbar .h1')).toHaveText('EXTRA');
  await expect(page.locator('.topbar .lbl')).toHaveText('Séries, novelas, filmes, animes e música');
  // Mobile: avatar button in the topbar.
  await expect(page.locator('.on-navy .topbar button, .on-navy .topbar a').first()).toBeVisible();

  const tabs = page.locator('.shelf-tabs button');
  await expect(tabs).toHaveText(['Pra você', 'Séries', 'Novelas', 'Filmes', 'Animes', 'Música', 'Games', /Desafio/]);
  await expect(tabs.first()).toHaveClass(/on/);

  // Coverflow: ≤7 unlocked, front item, arrows step, front click opens.
  const flow = page.locator('#flow-home');
  await expect(flow).toBeVisible();
  const items = flow.locator('.item');
  const n = await items.count();
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThanOrEqual(7);
  const lockedTitles = EXTRAS.filter((x) => x.locked).map((x) => x.title);
  for (const t of lockedTitles) await expect(flow.locator('.cap b', { hasText: t })).toHaveCount(0);
  const front = async () => flow.locator('.item.on .cap b').innerText();
  // The arrows sit under the side covers at phone width (z-index 5 vs 8–10, same CSS and inline
  // z-index as the prototype), so they are exercised by keyboard and a dispatched click; a tap on a
  // side cover brings it to the front.
  const cur = () => flow.evaluate((el) => Number(el.querySelector('.item.on')?.getAttribute('data-i')));
  const step = async (name: string) => {
    const i0 = await cur();
    await flow.getByRole('button', { name }).dispatchEvent('click');
    return { i0, i1: await cur() };
  };
  let s = await step('Próxima');
  expect(s.i1).toBe((s.i0 + 1) % n);
  s = await step('Anterior');
  expect(s.i1).toBe((s.i0 - 1 + n) % n);
  await flow.getByRole('button', { name: 'Próxima' }).focus();
  const k0 = await cur();
  await page.keyboard.press('Enter');
  expect(await cur()).toBe((k0 + 1) % n);
  const side = ((await cur()) + 1) % n;
  const sideEl = flow.locator(`.item[data-i="${side}"]`);
  const box = await sideEl.boundingBox();
  // Its right edge (the left part is under the front cover).
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 12, (box?.y ?? 0) + 80);
  expect(await cur()).toBe(side);
  await expect(page).toHaveURL(/#\/extra$/);
  await expect(flow.locator('.dots i.on')).toHaveCount(1);
  const prof = (await meState(page)).profile as { formats: string[] };
  expect(prof.formats).toEqual(expect.arrayContaining(['series', 'animes']));
  await expect(page.locator('.tc.xs', { hasText: 'Arraste ou toque numa capa' })).toContainText('séries');

  // Rails
  const railTitles = page.locator('section.stack > div > .h2');
  await expect(railTitles.filter({ hasText: 'Música' })).toHaveCount(1);
  await expect(page.getByText('Karaokê com lacunas')).toBeVisible();
  await expect(page.getByText('Os mais parecidos com o seu perfil')).toBeVisible();
  await expect(railTitles.filter({ hasText: /^Séries$/ })).toHaveCount(1);
  await expect(railTitles.filter({ hasText: /^Animes$/ })).toHaveCount(1);
  const albums = page.locator('a[href], button.cover').filter({ has: page.locator('.art[style*="aspect-ratio"]') });
  await expect(albums).toHaveCount(ALBUMS.length);
  const desafioCard = page.locator('a.card[href="#/extra/desafio"]');
  await expect(desafioCard).toContainText('Desafio relâmpago · 60 segundos');
  await expect(desafioCard).toContainText('Recorde: 0 pontos');
  const estreias = page.locator('section', { has: page.locator('.h2', { hasText: 'Estreias sexta' }) });
  await expect(estreias.locator('.cover')).toHaveCount(lockedTitles.length);
  await expect(estreias.locator('.lock .pill')).toHaveCount(lockedTitles.length);

  // Shelves
  await tabs.filter({ hasText: 'Séries' }).click();
  await expect(tabs.filter({ hasText: 'Séries' })).toHaveClass(/on/);
  const series = EXTRAS.filter((x) => x.format === 'series');
  await expect(page.locator('.wrap .cover')).toHaveCount(series.length);
  await tabs.filter({ hasText: 'Música' }).click();
  await expect(page.locator('.wrap .cover')).toHaveCount(ALBUMS.length);
  await tabs.filter({ hasText: 'Games' }).click();
  await expect(page.locator('.wrap .cover')).toHaveCount(EXTRAS.filter((x) => x.format === 'games').length);
  // Shelf survives a round trip to a title page.
  await page.locator('.wrap .cover').first().click();
  await expect(page).toHaveURL(/#\/extra\/level-up-zach$/);
  await page.goBack();
  await expect(tabs.filter({ hasText: 'Games' })).toHaveClass(/on/);
  await tabs.filter({ hasText: 'Pra você' }).click();

  // Coverflow front item opens the title page.
  await expect(flow).toBeVisible();
  const frontTitle = await front();
  await flow.locator('.item.on').click();
  await expect(page).toHaveURL(/#\/extra\/[a-z0-9-]+$/);
  await expect(page.locator('.hero-extra .h1')).toHaveText(frontTitle);
  await page.goBack();

  // Orange Desafio tab
  await tabs.filter({ hasText: 'Desafio' }).click();
  await expect(page).toHaveURL(/#\/extra\/desafio$/);
  await page.goBack();
  await expect(page.locator('#flow-home')).toBeVisible();

  expect.soft(await unnamedControls(page), 'unnamed controls on EXTRA').toEqual([]);

  // Keyboard focus is visible on a shelf tab.
  await tabs.nth(1).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const outline = await tabs.nth(1).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      matches: el.matches(':focus-visible'),
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      shadow: cs.boxShadow,
    };
  });
  expect
    .soft(
      outline.matches && (outline.style !== 'none' || outline.shadow !== 'none'),
      `focus ring ${JSON.stringify(outline)}`,
    )
    .toBe(true);

  await noProblems(page, w);
});

// =====================================================================================
test('coverflow keeps its position across store re-renders (foundation note #2)', async ({ page }) => {
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra');
  const flow = page.locator('#flow-home');
  await expect(flow.locator('.item.on')).toHaveCount(1);
  const arrow = flow.getByRole('button', { name: 'Próxima' });
  await arrow.dispatchEvent('click');
  await arrow.dispatchEvent('click');
  const before = await flow.locator('.item.on').getAttribute('data-i');
  const firstItem = await flow
    .locator('.item')
    .first()
    .evaluate((el) => {
      (window as unknown as { __flowItem: Element }).__flowItem = el;
      return true;
    });
  expect(firstItem).toBe(true);
  // The cover nodes stay the same elements (no remount/reset) while the screen settles (late catalog
  // / state signals re-render Extra); the memoized items are checked in code review.
  await page.waitForTimeout(1500);
  const same = await flow
    .locator('.item')
    .first()
    .evaluate((el) => (window as unknown as { __flowItem: Element }).__flowItem === el);
  expect(same).toBe(true);
  expect(before).not.toBe('0');
  await noProblems(page, w);
});

// =====================================================================================
test('title page: unlocked actions, vocab TTS, locked premiere, unknown id', async ({ page }) => {
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/woods-and-beans');
  await expect(page.locator('.hero-extra .h1')).toHaveText('Woods & Beans');
  await expect(page.locator('.hero-extra .pill')).toHaveText(['Sitcom', 'A1–A2', '8 min']);
  await expect(page.locator('.hero-extra .sm')).toHaveText('T1 · Ep. 3 · The Wrong Order');
  await expect(page.locator('.p-read')).toContainText('A cafeteria da Maggie abre às sete');
  await expect(page.locator('.chips .pill')).toHaveCount(4);
  await expect(button(page, /Assistir com legendas · \+20 pontos/)).toBeVisible();
  await expect(button(page, /Dublar o Lucas · \+10 por fala/)).toBeVisible();
  await expect(button(page, /Conversar com a Maggie sobre isto/)).toBeVisible();
  await expect(page.locator('.listrow')).toHaveCount(WOODS.vocab.length);
  await page.locator('.listrow button').first().click();
  expect.soft(await unnamedControls(page), 'unnamed controls on detail').toEqual([]);
  await button(page, /Dublar o Lucas/).click();
  await expect(page).toHaveURL(/#\/extra\/woods-and-beans\/assistir\?dub=1$/);
  await page.goBack();
  await button(page, /Conversar com a Maggie/).click();
  await expect(page).toHaveURL(/#\/maggie\?modo=extra&x=woods-and-beans$/);

  await page.goto('/#/extra/level-up-zach');
  await expect(page.getByText('Estreia sexta.')).toBeVisible();
  await expect(button(page, /Assistir com legendas/)).toHaveCount(0);
  await button(page, /Me avise quando chegar/).click();
  await expect(page.locator('.toast', { hasText: 'Combinado. Você recebe um aviso na sexta.' })).toBeVisible();
  // A locked title cannot be watched: the player bounces back to its page.
  await page.goto('/#/extra/level-up-zach/assistir');
  await expect(page).toHaveURL(/#\/extra\/level-up-zach$/);

  await page.goto('/#/extra/nao-existe');
  await expect(page).toHaveURL(/#\/extra$/);
  await noProblems(page, w);
});

// =====================================================================================
test('watch: subtitles, tappable word → Revisão, controls, finishScene award, persistence', async ({ page }) => {
  test.setTimeout(120_000);
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/woods-and-beans/assistir');
  const sub = page.locator('.scene .sub');
  await expect(sub.locator('.who')).toHaveText('MAGGIE');
  await expect(sub.locator('.en')).toHaveText(WOODS.lines[0]?.en ?? '');
  await expect(page.locator('.lines .line')).toHaveCount(WOODS.lines.length);
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl0');
  await expect(page.locator('.scene .tag')).toHaveText(WOODS.lines.length ? 'T1 · Ep. 3 · The Wrong Order' : '');

  // Subtitle modes
  const seg = page.locator('.controls .seg button');
  await expect(seg).toHaveText(['EN', 'EN+PT', 'Sem']);
  const initial = await seg.evaluateAll((els) => els.findIndex((e) => e.classList.contains('on')));
  expect(initial).toBeGreaterThanOrEqual(0);
  await seg.nth(0).click();
  await expect(sub.locator('.ptl')).toHaveCount(0);
  await expect(page.locator('.lines .line .pt')).toHaveCount(0);
  await seg.nth(2).click();
  await expect(page.locator('.scene .sub')).toHaveCount(0);
  await seg.nth(1).click();
  await expect(sub.locator('.ptl')).toHaveText(WOODS.lines[0]?.pt ?? '');
  await expect(page.locator('.lines .line .pt')).toHaveCount(WOODS.lines.length);

  // Next → line 1, tap "Got" → sheet with the vocab meaning.
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl1');
  await sub.locator('.w', { hasText: /^Got$/ }).click();
  const sheet = page.locator('.overlay .sheet');
  await expect(sheet.locator('.h1')).toHaveText('Got');
  await expect(sheet.locator('.h3')).toHaveText('got it = entendi');
  await expect(sheet.locator('.card.soft .en')).toHaveText(WOODS.lines[1]?.en ?? '');
  expect.soft(await unnamedControls(page), 'unnamed controls on word sheet').toEqual([]);
  // Close via Fechar, reopen, save.
  await sheet.getByRole('button', { name: 'Fechar' }).click();
  await expect(sheet).toHaveCount(0);
  await sub.locator('.w').first().click();
  await expect(sheet).toBeVisible();
  const save = sheet.getByRole('button', { name: /Levar para a Revisão · \+3/ });
  const [cardsRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/srs/cards') && r.request().method() === 'POST'),
    save.click(),
  ]);
  expect(cardsRes.status()).toBe(200);
  await expect(page.locator('.toast', { hasText: `Levei para a Revisão: “${WOODS.lines[1]?.en}”` })).toBeVisible();
  await expect(page.locator('.pts-toast', { hasText: '+3 pontos' })).toBeVisible();
  // Same line again → already there.
  await sub.locator('.w').first().click();
  await sheet.getByRole('button', { name: /Levar para a Revisão/ }).click();
  await expect(page.locator('.toast', { hasText: 'Essa fala já está na sua Revisão.' })).toBeVisible();
  // Scrim closes.
  await sub.locator('.w').first().click();
  await page.locator('.overlay .scrim').click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);

  // Prev / tap a script line / repeat
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl0');
  await page.locator('#vl3').click();
  await expect(sub.locator('.who')).toHaveText('LUCAS');
  await page.getByRole('button', { name: 'Repetir devagar' }).click();

  // Play advances line by line; pause stops.
  await page.locator('#vl0').click();
  await page.getByRole('button', { name: 'Assistir' }).click();
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await expect(page.locator('.scene .img')).not.toHaveClass(/paused/);
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl2', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByRole('button', { name: 'Assistir' })).toBeVisible();
  await expect(page.locator('.scene .img')).toHaveClass(/paused/);

  // Last line → Próxima = finishScene: end card, `extra` award once.
  const last = WOODS.lines.length - 1;
  await page.locator(`#vl${last}`).click();
  const [seenRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/seen$/.test(r.url())),
    page.getByRole('button', { name: 'Próxima' }).click(),
  ]);
  expect(seenRes.status()).toBe(200);
  const seenBody = (await seenRes.json()) as { award: { awarded: boolean; points: number } | null };
  expect(seenBody.award?.awarded).toBe(true);
  await expect(page.locator('.pts-toast', { hasText: `+${seenBody.award?.points} pontos` })).toBeVisible();
  const end = page.locator('.card.paper', { hasText: 'Fim da cena' });
  await expect(end.locator('.h2')).toHaveText(`Você viu ${WOODS.lines.length} falas e levou 1 palavra para a Revisão.`);
  await expect(end.getByRole('button', { name: /Contar para a Maggie o que aconteceu/ })).toBeVisible();
  await expect(end.getByRole('button', { name: /Desafio com estas falas/ })).toBeVisible();
  await expect(page.locator('.scene .sub')).toHaveCount(0);

  // Watch again → fresh scene; finishing again does not award twice.
  await end.getByRole('button', { name: 'Assistir de novo' }).click();
  await expect(end).toHaveCount(0);
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl0');
  await page.locator(`#vl${last}`).click();
  const [seen2] = await Promise.all([
    page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/seen$/.test(r.url())),
    page.getByRole('button', { name: 'Próxima' }).click(),
  ]);
  const seen2Body = (await seen2.json()) as { award: { awarded: boolean } | null };
  expect(seen2Body.award?.awarded ?? false).toBe(false);

  // Persistence after reload: seen + the saved card.
  await page.reload();
  const st = await meState(page);
  expect(st.extras.seen['woods-and-beans']).toBe(true);
  expect(st.deck.some((c) => c.en === WOODS.lines[1]?.en)).toBe(true);

  // End card → Desafio limited to this title.
  await page.locator(`#vl${last}`).click();
  await page.getByRole('button', { name: 'Próxima' }).click();
  await page.getByRole('button', { name: /Desafio com estas falas/ }).click();
  await expect(page).toHaveURL(/#\/extra\/desafio\?x=woods-and-beans$/);
  await expect(page.getByText('Só com as falas de Woods & Beans')).toBeVisible();
  expect(apiHit(w, /\/api\/srs\/cards$/).length).toBeGreaterThanOrEqual(1);
  await noProblems(page, w);
});

// =====================================================================================
test('dub without a microphone: Sua vez panel, estimated score → /dub, Seguir a cena', async ({ page }) => {
  test.setTimeout(90_000);
  const w = await watch(page);
  await page.addInitScript(() => {
    // No microphone: getUserMedia rejects like a denied prompt.
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    }
  });
  await signup(page, w);
  await page.goto('/#/extra/woods-and-beans/assistir?dub=1');
  await expect(page.locator('.scene .tag')).toContainText('Dublagem');
  await expect(page.locator('button.chip.on', { hasText: 'Dublar o Lucas' })).toBeVisible();
  await expect(page.locator('.lines .line.dub')).toHaveCount(WOODS.lines.filter((l) => l.who === 'Lucas').length);
  await expect(page.locator('.lines .line.dub .who').first()).toHaveText('LUCAS · VOCÊ');
  // Playing stops on Lucas's line.
  await page.getByRole('button', { name: 'Assistir' }).click();
  const panel = page.locator('.card.paper', { hasText: 'Sua vez · a fala é do Lucas' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.scene .sub .mute')).toContainText('Sua vez, Lucas');
  await expect(panel.locator('.h2')).toHaveText(WOODS.lines[1]?.en ?? '');
  await expect(page.getByRole('button', { name: 'Assistir' })).toBeVisible();
  await panel.getByRole('button', { name: /Ouvir antes/ }).click();

  const dubResP = page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/dub$/.test(r.url()), {
    timeout: 20_000,
  });
  await panel.getByRole('button', { name: /Gravar a fala/ }).click();
  await expect(page.locator('.toast', { hasText: 'Sem microfone: a nota fica estimada.' })).toBeVisible();
  const dubRes = await dubResP;
  expect(dubRes.status(), await dubRes.text()).toBe(200);
  const req = dubRes.request().postDataJSON() as { source: string; line: number; score: number };
  expect(req.line).toBe(1);
  expect(req.source).toBe('script');
  await expect(panel.locator('.fb')).toContainText(`${req.score}/10.`);
  const dubBody = (await dubRes.json()) as { award: { awarded: boolean; points: number } | null };
  if (dubBody.award?.awarded)
    await expect(page.locator('.pts-toast', { hasText: `+${dubBody.award.points} pontos` })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Dublar de novo' })).toBeVisible();
  await panel.getByRole('button', { name: /Seguir a cena/ }).click();
  await expect(page.locator('.lines .line.on')).not.toHaveAttribute('id', 'vl1');

  // Pular skips a dub line; toggling dub mode off removes the panel.
  await page.locator('#vl3').click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Pular' }).click();
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl4');
  await page.locator('#vl3').click();
  await page.locator('button.chip', { hasText: 'Dublar o Lucas' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.scene .tag')).not.toContainText('Dublagem');

  await page.reload();
  const st = await meState(page);
  expect(st.extras.dubs['woods-and-beans']).toBe(req.score);
  await noProblems(page, w);
});

test.describe('dub with a (fake) microphone', () => {
  test('records, Parar stops early, demo score → /dub', async ({ page }) => {
    test.setTimeout(90_000);
    const w = await watch(page);
    // A synthetic microphone: an oscillator through a MediaStream destination.
    await page.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      };
    });
    await signup(page, w);
    await page.goto('/#/extra/woods-and-beans/assistir?dub=1');
    await page.locator('#vl1').click();
    const panel = page.locator('.card.paper', { hasText: 'Sua vez · a fala é do Lucas' });
    await panel.getByRole('button', { name: /Gravar a fala/ }).click();
    await expect(panel.locator('.waves.rec')).toBeVisible();
    const dubResP = page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/dub$/.test(r.url()), {
      timeout: 20_000,
    });
    await panel.getByRole('button', { name: 'Parar' }).click();
    const dubRes = await dubResP;
    expect(dubRes.status(), await dubRes.text()).toBe(200);
    const req = dubRes.request().postDataJSON() as { source: string };
    expect(['demo', 'ia']).toContain(req.source);
    await expect(panel.locator('.fb')).toBeVisible();
    // Leaving mid-take releases the microphone (no errors after navigation).
    await panel.getByRole('button', { name: 'Dublar de novo' }).click();
    await expect(panel.locator('.waves.rec')).toBeVisible();
    await page.goto('/#/extra');
    await page.waitForTimeout(5500);
    await noProblems(page, w);
  });
});

// =====================================================================================
test('música: karaokê (synth), gap mode right/wrong → /api/karaoke/gap, tracks, song award', async ({ page }) => {
  test.setTimeout(120_000);
  const w = await watch(page);
  await signup(page, w);
  const album = ALBUMS.find((a) => a.id === 'synth-nights') as ProtoAlbum;
  await page.goto('/#/extra');
  await page.locator('.cover', { hasText: album.title }).first().click();
  await expect(page).toHaveURL(/#\/extra\/musica\/synth-nights$/);
  await expect(page.locator('.topbar')).toContainText('EXTRA · Música · A2');
  const t0 = album.tracks[0] as ProtoTrack;
  await expect(page.locator('.card .h2')).toHaveText(t0.title);
  await expect(page.locator('.card .xs').first()).toHaveText('Original TIE · trilha sintetizada');
  await expect(page.locator('.lyrics .lyric')).toHaveCount(t0.lines?.length ?? 0);

  await page.locator('button.chip', { hasText: 'Completar a letra' }).click();
  await expect(page.locator('.fb.tip')).toContainText('Acertos: 0');
  await expect(page.locator('.fb.tip')).toContainText('+5 cada');
  await expect(page.locator('.lyrics .gap')).toHaveCount(t0.lines?.length ?? 0);

  await page.getByRole('button', { name: 'Tocar' }).click();
  await expect(page.locator('#ly0')).toHaveClass(/on/);
  const opts0 = page.locator('#ly0 .chips .chip');
  await expect(opts0).toHaveCount(3);
  const right0 = t0.lines?.[0]?.gap ?? '';
  const [gapRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/karaoke/gap')),
    opts0.filter({ hasText: new RegExp(`^${right0}$`) }).click(),
  ]);
  expect(gapRes.status()).toBe(200);
  expect(((await gapRes.json()) as { correct: boolean }).correct).toBe(true);
  await expect(page.locator('.pts-toast', { hasText: '+5 pontos' })).toBeVisible();
  await expect(page.locator('.fb.tip b')).toHaveText('1');
  await expect(page.locator('#ly0 .gap.filled')).toHaveText(right0);

  // Next verse: wrong pick → toast + soft, no award.
  await expect(page.locator('#ly1')).toHaveClass(/on/, { timeout: 10_000 });
  const right1 = t0.lines?.[1]?.gap ?? '';
  const wrong = page
    .locator('#ly1 .chips .chip')
    .filter({ hasNotText: new RegExp(`^${right1}$`) })
    .first();
  const [gapRes2] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/karaoke/gap')),
    wrong.click(),
  ]);
  expect(((await gapRes2.json()) as { correct: boolean }).correct).toBe(false);
  await expect(page.locator('.toast', { hasText: `Era “${right1}”. Segue o próximo verso.` })).toBeVisible();
  await expect(page.locator('#ly1 .gap.filled')).toHaveText(right1);
  await expect(page.locator('.fb.tip b')).toHaveText('1');

  // Pause, tracks
  await page.getByRole('button', { name: 'Tocar' }).click();
  const t1 = album.tracks[1] as ProtoTrack;
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.locator('.card .h2')).toHaveText(t1.title);
  await expect(page.locator('.stack .line.on .en')).toHaveText(t1.title);
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(page.locator('.card .h2')).toHaveText(t0.title);
  await page.locator('.stack .line', { hasText: t1.title }).click();
  await expect(page.locator('.card .h2')).toHaveText(t1.title);
  expect.soft(await unnamedControls(page), 'unnamed controls on música').toEqual([]);

  // Play the whole (4-line) track with gap mode off → `song` at the end.
  await page.locator('button.chip', { hasText: 'Completar a letra' }).click();
  await expect(page.locator('.fb.tip')).toHaveCount(0);
  const songP = page.waitForResponse((r) => r.url().endsWith('/api/game/event'), { timeout: 40_000 });
  await page.getByRole('button', { name: 'Tocar' }).click();
  const songRes = await songP;
  expect(songRes.status(), await songRes.text()).toBe(200);
  expect((songRes.request().postDataJSON() as { kind: string }).kind).toBe('song');
  await noProblems(page, w);
});

test('música: episode track plays the real recording', async ({ page }) => {
  test.setTimeout(60_000);
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/musica/season-one');
  await expect(page.locator('.card .h2')).toHaveText('Say Hello');
  await expect(page.locator('.card .xs').first()).toContainText('gravação do episódio');
  const lyr = page.locator('.lyrics .lyric');
  expect(await lyr.count()).toBeGreaterThan(0);
  const mediaP = page.waitForResponse((r) => /\.(mp3|m4a|ogg|wav)(\?|$)/.test(r.url()) || r.url().includes('/m/'), {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Tocar' }).click();
  const media = await mediaP;
  expect([200, 206]).toContain(media.status());
  await expect(page.locator('#ly0')).toHaveClass(/on/);
  // Gap mode on an episode track (EP_GAPS): options for the sung line.
  await page.locator('button.chip', { hasText: 'Completar a letra' }).click();
  await expect(page.locator('.lyric.on .chips .chip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Tocar' }).click();
  await noProblems(page, w);
});

// =====================================================================================
test('desafio: 60s round, combo, wrong toast, /api/extras/challenge, record persists', async ({ page }) => {
  test.setTimeout(150_000);
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/desafio');
  await expect(page.locator('.scroll .h1')).toHaveText('Desafio relâmpago');
  await expect(page.getByText('Recorde: 0')).toBeVisible();
  await button(page, /^Começar$/).click();
  await expect(page.locator('#g-fall')).toBeVisible();
  await expect(page.locator('.pill.or')).toHaveText('x1');
  await expect(page.locator('#g-left')).toHaveText(/^(60|59)s$/);

  const answer = async (right: boolean) => {
    const en = await page.locator('#g-fall').innerText();
    const pt = PT_OF.get(en.trim());
    expect(pt, `PT for "${en}"`).toBeTruthy();
    const opts = page.locator('.quiz-field + .stack button');
    await expect(opts).toHaveCount(3);
    if (right)
      await opts
        .filter({ hasText: pt as string })
        .first()
        .click();
    else
      await opts
        .filter({ hasNotText: pt as string })
        .first()
        .click();
    return { en, pt };
  };
  let expected = 0;
  let combo = 1;
  for (let i = 0; i < 3; i++) {
    await answer(true);
    expected += 10 * combo;
    combo = Math.min(5, combo + 1);
    await expect(page.locator('.row.between .h2').first()).toHaveText(`${expected} pts`);
  }
  await expect(page.locator('.pill.or')).toHaveText(`x${combo}`);
  const miss = await answer(false);
  combo = 1;
  await expect(page.locator('.toast', { hasText: `${miss.en} = ${miss.pt}` })).toBeVisible();
  await expect(page.locator('.pill.or')).toHaveText('x1');
  for (let i = 0; i < 3; i++) {
    await answer(true);
    expected += 10 * combo;
    combo = Math.min(5, combo + 1);
  }
  await expect(page.locator('.row.between .h2').first()).toHaveText(`${expected} pts`);
  // The faller moves down.
  const top1 = await page.locator('#g-fall').evaluate((el) => (el as HTMLElement).offsetTop);
  await page.waitForTimeout(700);
  const top2 = await page.locator('#g-fall').evaluate((el) => (el as HTMLElement).offsetTop);
  expect(top2).toBeGreaterThan(top1);
  expect.soft(await unnamedControls(page), 'unnamed controls on desafio').toEqual([]);

  const chP = page.waitForResponse((r) => r.url().endsWith('/api/extras/challenge'), { timeout: 75_000 });
  const chRes = await chP;
  expect(chRes.status(), await chRes.text()).toBe(200);
  const reqB = chRes.request().postDataJSON() as { score: number; hits: number };
  expect(reqB.hits).toBe(6);
  expect(reqB.score).toBe(expected);
  const body = (await chRes.json()) as { best: number; award: { awarded: boolean; points: number } | null };
  expect(body.best).toBe(expected);
  expect(body.award?.awarded).toBe(true);
  await expect(page.getByText('Tempo esgotado.')).toBeVisible();
  await expect(page.getByText(`${expected} pontos · 6 acertos`)).toBeVisible();
  await expect(page.locator('.pill.gold', { hasText: 'Novo recorde' })).toBeVisible();
  await expect(button(page, /^Jogar de novo$/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Recorde: ${expected}`)).toBeVisible();
  await page.goto('/#/extra');
  await expect(page.locator('a.card[href="#/extra/desafio"]')).toContainText(`Recorde: ${expected} pontos`);
  await noProblems(page, w);
});

// =====================================================================================
// Verifier round 3: flows the earlier rounds did not drive end to end.

test('dub during playback: stops on each dub line, Seguir a cena resumes, scene ends by itself', async ({ page }) => {
  test.setTimeout(120_000);
  const w = await watch(page);
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    }
  });
  await signup(page, w);
  await page.goto('/#/extra/woods-and-beans/assistir?dub=1');
  const lucas = WOODS.lines.map((l, i) => (l.who === 'Lucas' ? i : -1)).filter((i) => i >= 0);
  expect(lucas.length).toBeGreaterThanOrEqual(2);
  const panel = page.locator('.card.paper', { hasText: 'Sua vez · a fala é do Lucas' });
  await page.getByRole('button', { name: 'Assistir' }).click();
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', `vl${lucas[0]}`, { timeout: 15_000 });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assistir' })).toBeVisible();
  // Record (no mic → estimated) then "Seguir a cena": playback resumes until the next dub line.
  const d1 = page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/dub$/.test(r.url()), { timeout: 20_000 });
  await panel.getByRole('button', { name: /Gravar a fala/ }).click();
  expect((await d1).status()).toBe(200);
  await panel.getByRole('button', { name: /Seguir a cena/ }).click();
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', `vl${lucas[1]}`, { timeout: 15_000 });
  await expect(panel).toBeVisible();
  // A second take: running average shown at the end.
  const d2 = page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/dub$/.test(r.url()), { timeout: 20_000 });
  await panel.getByRole('button', { name: /Gravar a fala/ }).click();
  const d2Res = await d2;
  const avg = ((await d2Res.json()) as { avg: number }).avg;
  // Seguir a cena plays on to the end: the scene finishes on its own (vplayFrom past the last line).
  const seenP = page.waitForResponse((r) => /\/api\/extras\/woods-and-beans\/seen$/.test(r.url()), {
    timeout: 60_000,
  });
  await panel.getByRole('button', { name: /Seguir a cena/ }).click();
  // Any later Lucas line: skip it so playback can reach the end.
  for (const i of lucas.slice(2)) {
    await expect(page.locator('.lines .line.on')).toHaveAttribute('id', `vl${i}`, { timeout: 20_000 });
    await panel.getByRole('button', { name: 'Pular' }).click();
    // Pular on the last line finishes the scene; otherwise resume playback.
    if (i < WOODS.lines.length - 1) await page.getByRole('button', { name: 'Assistir', exact: true }).click();
  }
  const seenRes = await seenP;
  expect(seenRes.status()).toBe(200);
  const end = page.locator('.card.paper', { hasText: 'Fim da cena' });
  await expect(end).toBeVisible();
  await expect(end.locator('p.p')).toHaveText(`Média na dublagem: ${avg}/10.`);
  await expect(page.getByRole('button', { name: 'Assistir', exact: true })).toBeVisible();
  await noProblems(page, w);
});

test('desafio ?x=: only that title’s lines, end toast for the award, leaving mid-round stops it', async ({ page }) => {
  test.setTimeout(150_000);
  const w = await watch(page);
  await signup(page, w);
  const woodsEn = new Set(WOODS.lines.map((l) => l.en));
  // Leaving mid-round: no result is posted, no timer keeps running.
  await page.goto('/#/extra/desafio');
  await button(page, /^Começar$/).click();
  await expect(page.locator('#g-fall')).toBeVisible();
  await page.goto('/#/extra');
  await page.waitForTimeout(2500);
  await page.goto('/#/extra/desafio');
  await expect(button(page, /^Começar$/)).toBeVisible();
  expect(apiHit(w, /\/api\/extras\/challenge$/)).toEqual([]);

  // Same screen, new query: the prototype keeps G while the screen stays (leave() is not called), so
  // the in-app way in is from another screen (the player's end card).
  await page.goto('/#/extra');
  await page.goto('/#/extra/desafio?x=woods-and-beans');
  await expect(page.getByText('Só com as falas de Woods & Beans')).toBeVisible();
  await button(page, /^Começar$/).click();
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const en = (await page.locator('#g-fall').innerText()).trim();
    seen.push(en);
    const pt = PT_OF.get(en) as string;
    await page.locator('.quiz-field + .stack button').filter({ hasText: pt }).first().click();
  }
  expect(
    seen.filter((e) => !woodsEn.has(e)),
    'lines outside Woods & Beans',
  ).toEqual([]);
  const chRes = await page.waitForResponse((r) => r.url().endsWith('/api/extras/challenge'), { timeout: 75_000 });
  expect(chRes.status()).toBe(200);
  expect((chRes.request().postDataJSON() as { extraId?: string }).extraId).toBe('woods-and-beans');
  const body = (await chRes.json()) as { award: { awarded: boolean; points: number } | null };
  expect(body.award?.awarded).toBe(true);
  await expect(page.locator('.pts-toast', { hasText: `+${body.award?.points} pontos` })).toBeVisible();
  await expect(page.getByText('Tempo esgotado.')).toBeVisible();
  await noProblems(page, w);
});

test('música: the episode recording plays to the end → song award + points toast', async ({ page }) => {
  test.setTimeout(60_000);
  const w = await watch(page);
  await page.addInitScript(() => {
    // Jump to the last second once the recording is loaded, so `ended` comes quickly.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.addEventListener(
        'loadedmetadata',
        () => {
          if (Number.isFinite(this.duration)) this.currentTime = Math.max(0, this.duration - 0.6);
        },
        { once: true },
      );
      return play.call(this);
    };
  });
  await signup(page, w);
  await page.goto('/#/extra/musica/season-one');
  await expect(page.locator('.card .h2')).toHaveText('Say Hello');
  const evP = page.waitForResponse((r) => r.url().endsWith('/api/game/event'), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Tocar' }).click();
  const ev = await evP;
  expect(ev.status(), await ev.text()).toBe(200);
  expect((ev.request().postDataJSON() as { kind: string }).kind).toBe('song');
  const award = (await ev.json()) as { awarded: boolean; points: number };
  if (award.awarded) await expect(page.locator('.pts-toast', { hasText: `+${award.points} pontos` })).toBeVisible();
  // The last line is the sung one at the end, and play is available again.
  const n = await page.locator('.lyrics .lyric').count();
  await expect(page.locator(`#ly${n - 1}`)).toHaveClass(/on/);
  await noProblems(page, w);
});

test('a11y + chrome (mobile): keyboard words, visible focus, no persona in responses, prototype chrome', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const w = await watch(page);
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.request().method() !== 'GET' || !/json/.test(r.headers()['content-type'] ?? '')) return;
    try {
      bodies.push(await r.text());
    } catch {}
  });
  await signup(page, w);
  await page.goto('/#/extra');
  await expect(page.locator('#flow-home')).toBeVisible();
  await page.goto('/#/extra/woods-and-beans/assistir');
  await expect(page.locator('.scene .sub .w').first()).toBeVisible();
  // Tappable subtitle words should be reachable without a pointer (prototype: plain spans).
  const wordA11y = await page
    .locator('.scene .sub .w')
    .first()
    .evaluate((el) => ({ tab: (el as HTMLElement).tabIndex, role: el.getAttribute('role') }));
  expect.soft(wordA11y.tab >= 0 && !!wordA11y.role, `subtitle word a11y ${JSON.stringify(wordA11y)}`).toBe(true);
  // Visible focus ring on the player's icon buttons when tabbing.
  await page.getByRole('button', { name: 'Anterior' }).focus();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      label: el.getAttribute('aria-label'),
      fv: el.matches(':focus-visible'),
      outline: cs.outlineStyle,
      shadow: cs.boxShadow,
    };
  });
  expect(ring.label).toBe('Assistir');
  expect.soft(ring.fv && (ring.outline !== 'none' || ring.shadow !== 'none'), JSON.stringify(ring)).toBe(true);
  // Enter on a script line selects it.
  await page.locator('#vl2').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.lines .line.on')).toHaveAttribute('id', 'vl2');
  expect.soft(await unnamedControls(page), 'unnamed controls on player').toEqual([]);

  // Chrome: the prototype renders extraPlay / musica / desafio without the tab bar (no `tabs`).
  const tabbar: Record<string, number> = {};
  tabbar.play = await page.locator('.tabbar').count();
  await page.goto('/#/extra/musica/synth-nights');
  await expect(page.locator('.card .h2')).toBeVisible();
  tabbar.musica = await page.locator('.tabbar').count();
  await page.goto('/#/extra/desafio');
  await expect(button(page, /^Começar$/)).toBeVisible();
  tabbar.desafio = await page.locator('.tabbar').count();
  test.info().annotations.push({ type: 'tabbar', description: JSON.stringify(tabbar) });
  expect.soft(tabbar, 'tab bar on immersive EXTRA screens (prototype: none)').toEqual({
    play: 0,
    musica: 0,
    desafio: 0,
  });

  // No assistant persona / server secrets reach the client through JSON responses.
  const leak = bodies.filter((b) => /interior designer and events manager|"persona"\s*:/i.test(b));
  expect(
    leak.map((b) => b.slice(0, 200)),
    'persona in client responses',
  ).toEqual([]);
  await noProblems(page, w);
});

test('evidence screenshots (mobile)', async ({ page }) => {
  const w = await watch(page);
  await signup(page, w);
  const shots: [string, string, string][] = [
    ['catalog', '/#/extra', '#flow-home'],
    ['detail', '/#/extra/woods-and-beans', '.hero-extra'],
    ['play', '/#/extra/woods-and-beans/assistir', '.scene'],
    ['musica', '/#/extra/musica/synth-nights', '.lyrics'],
    ['desafio', '/#/extra/desafio', '.x-des-grid'],
  ];
  for (const [name, url, sel] of shots) {
    await page.goto(url);
    await expect(page.locator(sel).first()).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  }
  await noProblems(page, w);
});

// =====================================================================================
test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test('catalog without avatar, player in two columns, música and desafio render', async ({ page }) => {
    test.setTimeout(90_000);
    const w = await watch(page);
    await signup(page, w);
    await page.goto('/#/extra');
    await expect(page.locator('#flow-home')).toBeVisible();
    await expect(page.locator('.on-navy > .topbar > :not(.ttl)')).toHaveCount(0);
    expect.soft(await unnamedControls(page), 'unnamed controls on EXTRA (desktop)').toEqual([]);
    await page.goto('/#/extra/woods-and-beans/assistir');
    const grid = page.locator('.wrap > div[style*="grid-template-columns"]');
    await expect(grid).toBeVisible();
    const cols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    await expect(grid.locator('> .stack').nth(1).locator('.lbl')).toHaveText('Roteiro da cena');
    await expect(grid.locator('> .stack').nth(0).locator('.scene')).toBeVisible();
    await page.locator('.scene .sub .w').first().click();
    await expect(page.locator('.overlay .sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .locator('.overlay .sheet')
      .getByRole('button', { name: 'Fechar' })
      .click()
      .catch(() => {});
    const sideOnPlay = await page.locator('aside.side').count();
    await page.goto('/#/extra/musica/garage-beacon');
    await expect(page.locator('.card .h2')).toHaveText('First Beat');
    await expect(page.locator('.x-mus-col').first().locator('.lbl', { hasText: 'Faixas' })).toBeVisible();
    const sideOnMusica = await page.locator('aside.side').count();
    test.info().annotations.push({ type: 'side', description: JSON.stringify({ sideOnPlay, sideOnMusica }) });
    expect.soft({ sideOnPlay, sideOnMusica }, 'side nav on immersive EXTRA screens (prototype: none)').toEqual({
      sideOnPlay: 0,
      sideOnMusica: 0,
    });
    await page.goto('/#/extra/desafio');
    await expect(button(page, /^Começar$/)).toBeVisible();
    await noProblems(page, w);
  });
});

// =====================================================================================
// Verifier round 4 (functional + security): flows and guards the earlier rounds left out.

async function apiPost(page: Page, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: b === undefined ? '{}' : JSON.stringify(b),
      });
      return { status: r.status, text: (await r.text()).slice(0, 300) };
    },
    [path, body] as const,
  );
}

test('security: slice source, client bundle, API guards for the EXTRA endpoints', async ({ page }) => {
  test.setTimeout(90_000);
  // No raw HTML sinks in the slice.
  const slice = fileURLToPath(new URL('../../../apps/app/web/src/screens/extra/', import.meta.url));
  for (const f of readdirSync(slice)) {
    const src = readFileSync(join(slice, f), 'utf8');
    expect(src, `${f}: raw HTML sink`).not.toMatch(
      /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write|new Function|\beval\(/,
    );
  }
  // No persona / secrets in the built client.
  const assistSrc = readFileSync(
    fileURLToPath(new URL('../../../prototipo/js/data/assistants.js', import.meta.url)),
    'utf8',
  );
  const personas = [...assistSrc.matchAll(/persona:\s*'([^']{40,})'/g)].map((m) => (m[1] as string).slice(20, 80));
  expect(personas.length).toBeGreaterThan(0);
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
  const leaks: string[] = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const p of personas) if (t.includes(p)) leaks.push(`${f}: persona "${p}"`);
    if (/sk-[A-Za-z0-9]{20,}|CLOUDFLARE_API_TOKEN|TURNSTILE_SECRET|SESSION_SECRET|MEDIA_TOKEN_KEY|-----BEGIN [A-Z ]*PRIVATE KEY/.test(t))
      leaks.push(`${f}: secret-like string`);
  }
  expect(leaks).toEqual([]);

  const w = await watch(page);
  await signup(page, w);
  // The extra file the player loads carries no persona either.
  await page.goto('/#/extra/woods-and-beans/assistir');
  await expect(page.locator('.lines .line')).toHaveCount(WOODS.lines.length);

  // Locked premiere: cannot be marked seen or dubbed.
  expect((await apiPost(page, '/api/extras/level-up-zach/seen')).status).toBe(404);
  expect((await apiPost(page, '/api/extras/nao-existe/seen')).status).toBe(404);
  // Dub: only the dub character's lines, and an "ia" score needs the signed attempt token.
  const maggieLine = WOODS.lines.findIndex((l) => l.who !== WOODS.dub);
  const lucasLine = WOODS.lines.findIndex((l) => l.who === WOODS.dub);
  expect(
    (await apiPost(page, '/api/extras/woods-and-beans/dub', { line: maggieLine, score: 9, source: 'demo' })).status,
  ).toBe(400);
  expect(
    (await apiPost(page, '/api/extras/woods-and-beans/dub', { line: 999, score: 9, source: 'demo' })).status,
  ).toBe(400);
  const forged = await apiPost(page, '/api/extras/woods-and-beans/dub', {
    line: lucasLine,
    score: 10,
    source: 'ia',
    attempt: 'forged.token',
  });
  expect(forged.status, forged.text).toBeGreaterThanOrEqual(400);
  expect(forged.status).toBeLessThan(500);
  expect(
    (await apiPost(page, '/api/extras/woods-and-beans/dub', { line: lucasLine, score: 11, source: 'demo' })).status,
  ).toBe(400);
  // Desafio: implausible results are refused; a plausible one is kept as the record.
  expect((await apiPost(page, '/api/extras/challenge', { score: 5000, hits: 3 })).status).toBe(400);
  expect((await apiPost(page, '/api/extras/challenge', { score: 35, hits: 3 })).status).toBe(400);
  const ok = await apiPost(page, '/api/extras/challenge', { score: 30, hits: 3 });
  expect(ok.status, ok.text).toBe(200);
  expect(JSON.parse(ok.text).best).toBe(30);
  // Karaoke: unknown track.
  expect((await apiPost(page, '/api/karaoke/gap', { trackId: 'nope', line: 0, choice: 'x' })).status).toBe(404);
  // CSRF: a foreign Origin with the learner's cookies is refused.
  const csrf = await page.context().request.post('/api/extras/woods-and-beans/seen', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  // Signed out: 401.
  await page.context().clearCookies();
  expect((await apiPost(page, '/api/extras/woods-and-beans/seen')).status).toBe(401);
  expect((await apiPost(page, '/api/extras/challenge', { score: 10, hits: 1 })).status).toBe(401);
});

test('catalog → detail → watch, with the tab bar where the prototype has it (mobile)', async ({ page }) => {
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra');
  await expect(page.locator('.tabbar .tab.on')).toHaveText('EXTRA');
  // A rail cover opens its title page; the tab bar stays, EXTRA active (prototype nav:'extra').
  await page.locator('section.stack .rail .cover').first().click();
  await expect(page).toHaveURL(/#\/extra\/[a-z0-9-]+$/);
  await expect(page.locator('.tabbar .tab.on')).toHaveText('EXTRA');
  // Back button in the bar returns to the catalog.
  await page.locator('.topbar').getByRole('button', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/#\/extra$/);
  // Album from the catalog's music shelf opens the karaoke; its back returns to the catalog.
  await page.locator('.shelf-tabs button', { hasText: 'Música' }).click();
  await page.locator('.wrap .cover').first().click();
  await expect(page).toHaveURL(/#\/extra\/musica\/[\w-]+$/);
  await expect(page.locator('.lyrics .lyric').first()).toBeVisible();
  await noProblems(page, w);
});

test('música: changing track or leaving mid-song stops it (no late song award)', async ({ page }) => {
  test.setTimeout(90_000);
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/musica/synth-nights');
  await page.getByRole('button', { name: 'Tocar' }).click();
  await expect(page.locator('#ly0')).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.locator('.lyrics .lyric.on')).toHaveCount(0);
  await page.waitForTimeout(6000);
  await expect(page.locator('.lyrics .lyric.on')).toHaveCount(0);
  // Play again, then leave: the timer must not keep advancing nor award `song` after leaving.
  await page.getByRole('button', { name: 'Tocar' }).click();
  await expect(page.locator('#ly0')).toHaveClass(/on/);
  await page.goto('/#/extra');
  await expect(page.locator('#flow-home')).toBeVisible();
  await page.waitForTimeout(25_000);
  expect(apiHit(w, /\/api\/game\/event$/), 'song awarded after leaving').toEqual([]);
  await noProblems(page, w);
});

test('desafio: a line reaching the ground is a miss (combo reset, next line), focus visible on options', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const w = await watch(page);
  await signup(page, w);
  await page.goto('/#/extra/desafio');
  await button(page, /^Começar$/).click();
  const first = (await page.locator('#g-fall').innerText()).trim();
  const pt = PT_OF.get(first) as string;
  await page.locator('.quiz-field + .stack button').filter({ hasText: pt }).first().click();
  await expect(page.locator('.pill.or')).toHaveText('x2');
  const second = (await page.locator('#g-fall').innerText()).trim();
  // 7000 - 10*12 = 6880 ms to fall; wait past it.
  await page.waitForTimeout(7600);
  await expect(page.locator('.pill.or')).toHaveText('x1');
  const third = (await page.locator('#g-fall').innerText()).trim();
  expect(third).not.toBe(second);
  // Keyboard: Tab onto an option shows a focus ring, Enter answers.
  await page.locator('.quiz-field + .stack button').first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { fv: el.matches(':focus-visible'), outline: cs.outlineStyle, shadow: cs.boxShadow, tag: el.tagName };
  });
  expect.soft(ring.fv && (ring.outline !== 'none' || ring.shadow !== 'none'), JSON.stringify(ring)).toBe(true);
  // Leave mid-round: nothing posted.
  await page.goto('/#/extra');
  await page.waitForTimeout(1500);
  expect(apiHit(w, /\/api\/extras\/challenge$/)).toEqual([]);
  await noProblems(page, w);
});

test.describe('desktop (round 4)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test('coverflow drag swipes without opening; detail two-column; Escape closes the word sheet', async ({ page }) => {
    test.setTimeout(90_000);
    const w = await watch(page);
    await signup(page, w);
    await page.goto('/#/extra');
    const flow = page.locator('#flow-home');
    await expect(flow.locator('.item.on')).toHaveCount(1);
    const cur = () => flow.evaluate((el) => Number(el.querySelector('.item.on')?.getAttribute('data-i')));
    const n = await flow.locator('.item').count();
    const i0 = await cur();
    const box = await flow.boundingBox();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 60, cy, { steps: 4 });
    await page.mouse.move(cx - 120, cy, { steps: 4 });
    await page.mouse.up();
    const i1 = await cur();
    expect(i1).not.toBe(i0);
    expect((i1 - i0 + n) % n).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(200);
    await expect(page).toHaveURL(/#\/extra$/);
    // Side nav on the catalog with EXTRA active.
    await expect(page.locator('aside.side a.nav.on')).toHaveText('EXTRA');
    // Front item click opens.
    const title = await flow.locator('.item.on .cap b').innerText();
    await flow.locator('.item.on').click();
    await expect(page.locator('.hero-extra .h1')).toHaveText(title);
    await expect(page.locator('aside.side a.nav.on')).toHaveText('EXTRA');

    await page.goto('/#/extra/woods-and-beans');
    const body = page.locator('.x-det-body');
    await expect(body).toBeVisible();
    await expect(body.locator('.x-vocab .listrow')).toHaveCount(WOODS.vocab.length);
    const cols = await body.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect.soft(cols, 'detail columns on desktop').toBe(2);
    expect.soft(await unnamedControls(page), 'unnamed controls on detail (desktop)').toEqual([]);

    await page.goto('/#/extra/woods-and-beans/assistir');
    await page.locator('.scene .sub .w').first().click();
    const sheet = page.locator('.overlay .sheet');
    await expect(sheet).toBeVisible();
    // The listener is attached by an effect (after paint); a person never presses Esc within a frame.
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Keyboard path to a subtitle word: focus + Enter opens the sheet.
    await page.locator('.scene .sub .w').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Fechar' }).click();
    await expect(sheet).toHaveCount(0);
    await noProblems(page, w);
  });
});
