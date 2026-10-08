// U6-mic functional + security verification: Mic lobby / call (#/maggie) and the report
// (#/maggie/relatorio/:id), driven against the real Worker (slot E2E_SLOT) on mobile and desktop and
// compared with prototipo/js/screens/maggie.js.
//   npm run e2e -- --slot 36 specs/U6-mic.spec.ts
// The Web Speech API is replaced by a deterministic stub (headless Chromium has no recognizer or
// voices), getUserMedia rejects (no microphone → "a nota fica estimada"), /api/health answers ai:false
// (demo mode: the server's demo brain answers /api/tutor and /api/report).
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { slot as slotOf } from '../../parity/src/config';
import { SLOT } from '../src/slotEnv';
import { stubTurnstile } from '../src/turnstile';

const DESKTOP = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

// ---------- prototype data (the seed is built from it) ----------
interface ProtoMaggie {
  MODES: { k: string; t: string; s: string }[];
  MISSIONS: Record<string, { t: string; role: string; goal: string }>;
  PRON: { en: string; tip: string }[];
  HELP: { en: string; pt: string }[];
}
const protoSrc = readFileSync(fileURLToPath(new URL('../../../prototipo/js/data/maggie.js', import.meta.url)), 'utf8');
const PW: { TIE: { data?: { MAGGIE: ProtoMaggie } } } = { TIE: {} };
new Function('window', 'TIE', protoSrc)(PW, PW.TIE);
const MAG = PW.TIE.data?.MAGGIE as ProtoMaggie;
const assistSrc = readFileSync(
  fileURLToPath(new URL('../../../prototipo/js/data/assistants.js', import.meta.url)),
  'utf8',
);

// ---------- page instrumentation ----------
interface Watch {
  errors: string[];
  csp: string[];
  api: { method: string; path: string; status: number; body?: string }[];
}
const watches = new WeakMap<Page, Watch>();

const INIT = `(() => {
  const W = window;
  W.__csp = []; W.__said = []; W.__toasts = []; W.__srStarts = 0;
  document.addEventListener('securitypolicyviolation', (e) => {
    W.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' @ ' + (e.sourceFile || '') + ':' + e.lineNumber);
  });
  // Toast recorder (#fxroot children: .toast / .pts-toast / .confetti).
  const obs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'fxroot') W.__toasts.push((n.className || '') + '|' + (n.textContent || ''));
    }
  });
  const hook = () => { const r = document.getElementById('fxroot'); if (r) obs.observe(r, { childList: true }); else setTimeout(hook, 50); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
  // speechSynthesis: record and finish fast.
  if ('speechSynthesis' in W) {
    const ss = W.speechSynthesis; let speaking = false;
    try { Object.defineProperty(ss, 'speaking', { get: () => speaking, configurable: true }); } catch (e) {}
    ss.speak = (u) => { speaking = true; W.__said.push(u.text);
      setTimeout(() => { try { u.onstart && u.onstart(new Event('start')); } catch (e) {} }, 5);
      setTimeout(() => { speaking = false; try { u.onend && u.onend(new Event('end')); } catch (e) {} }, W.__speakMs || 200); };
    ss.cancel = () => { speaking = false; };
  }
  // No microphone (unless the test asked for Chromium's fake device: sessionStorage __realMic = 1).
  if (sessionStorage.getItem('__realMic') !== '1') {
    try { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); } catch (e) {}
  }
  // SpeechRecognition stub: interim, then final, then end. __srMode: 'say' | 'hang' | 'none'.
  if (W.__noSR || sessionStorage.getItem('__noSR') === '1') { try { delete W.SpeechRecognition; delete W.webkitSpeechRecognition; } catch (e) {} W.SpeechRecognition = undefined; W.webkitSpeechRecognition = undefined; return; }
  class FakeSR {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; this._done = false; }
    _end() { if (this._done) return; this._done = true; try { this.onend && this.onend(); } catch (e) {} }
    start() {
      W.__srStarts++;
      const mode = W.__srMode || 'say';
      const text = W.__srText || 'I would like a coffee, please.';
      if (mode === 'hang') return;
      if (mode === 'deny') { setTimeout(() => { try { this.onerror && this.onerror({ error: 'not-allowed' }); } catch (e) {} this._end(); }, 100); return; }
      if (mode === 'silent') { setTimeout(() => this._end(), 300); return; }
      const half = text.split(' ').slice(0, 2).join(' ');
      setTimeout(() => { if (!this._done && this.onresult) this.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, 0: { transcript: half } } } }); }, 250);
      setTimeout(() => { if (!this._done && this.onresult) this.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } }); }, W.__srFinalMs || 1200);
      setTimeout(() => this._end(), (W.__srFinalMs || 1200) + 100);
    }
    stop() { setTimeout(() => this._end(), 10); }
    abort() { this.stop(); }
  }
  W.SpeechRecognition = FakeSR; W.webkitSpeechRecognition = FakeSR;
})();`;

async function instrument(ctx: BrowserContext, page: Page): Promise<Watch> {
  const w: Watch = { errors: [], csp: [], api: [] };
  watches.set(page, w);
  await ctx.addInitScript(INIT);
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) w.csp.push(t);
    else w.errors.push(`console: ${t}`);
  });
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    let body: string | undefined;
    if (r.request().method() !== 'GET') {
      try {
        body = (await r.text()).slice(0, 2000);
      } catch {
        body = undefined;
      }
    }
    w.api.push({ method: r.request().method(), path: u.pathname, status: r.status(), body });
  });
  return w;
}

const ZOD_PROBE = /^script-src eval @ .*\/assets\/[\w-]+\.js:1/;
const ZOD_PROBE_CONSOLE = /unsafe-eval|'eval'/;

async function assertClean(page: Page) {
  const w = watches.get(page);
  if (!w) return;
  const inPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  // Known, global (not this slice): zod v4's JIT probe `Function('')` trips script-src eval once per load.
  const csp = w.csp.filter((x) => !ZOD_PROBE_CONSOLE.test(x)).concat(inPage.filter((x) => !ZOD_PROBE.test(x)));
  expect.soft(csp, 'CSP violations').toEqual([]);
  // The demo-mode fallback logs console.warn (not error). The signed-out 401 probe is expected.
  expect
    .soft(
      w.errors.filter((e) => !/status of 401/.test(e)),
      'console/page errors',
    )
    .toEqual([]);
  const bad = w.api.filter((a) => a.status >= 400 && !(a.status === 401 && a.path === '/api/me/state'));
  expect.soft(bad, 'failed API calls').toEqual([]);
  await expect.soft(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
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
const btn = (page: Page, name: RegExp | string) => page.getByRole('button', { name }).first();
const apiHits = (page: Page, method: string, re: RegExp) =>
  (watches.get(page)?.api ?? []).filter((a) => a.method === method && re.test(a.path));
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.slice());
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said.slice());
const clearToasts = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __toasts: string[] }).__toasts.length = 0;
  });
async function expectToast(page: Page, re: RegExp, timeout = 8000) {
  await expect
    .poll(async () => (await toasts(page)).some((t) => re.test(t)), { timeout, message: `toast ${re}` })
    .toBe(true);
}

async function signup(page: Page, name = 'Bia'): Promise<string> {
  const id = randomBytes(4).toString('hex');
  const email = `u6-${id}@e2e.test`;
  await page.goto('/#/entrar');
  await page.getByText('Criar conta grátis').first().click();
  await expect(page).toHaveURL(/#\/cadastro\/1$/);
  await page.locator('#onb-fullname').fill(`${name} Mic`);
  await page.locator('#onb-name').fill(name);
  await page.locator('#onb-birth').fill('1995-05-10');
  await page.locator('#onb-email').fill(email);
  await page.locator('#onb-pass').fill(`e2e-${randomBytes(6).toString('hex')}`);
  await btn(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });
  await page.getByText('Viajar sem travar').first().click();
  await btn(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/3$/);
  const fmt = page.locator('.fmt', { hasText: 'Séries' });
  if (await fmt.count()) {
    await fmt.first().click();
    await btn(page, /^Continuar/).click();
  } else await btn(page, /^Pular$/).click();
  await expect(page).toHaveURL(/#\/cadastro\/4$/);
  for (const n of [4, 5]) {
    await btn(page, /^Pular$/).click();
    await expect(page).toHaveURL(new RegExp(`#\\/cadastro\\/${n + 1}$`));
  }
  await btn(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/7$/);
  await btn(page, /Pular por enquanto|Começar o curso/).click();
  await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
  return email;
}

interface ApiState {
  profile: { assistant: string; feedback: string };
  game: { points: number };
  deck: { en: string; scene: string }[];
  maggie: {
    secLeft: number;
    sessions: { id: string; mode: string; report: unknown; turns: { who: string; en: string }[] }[];
  };
}
async function apiState(page: Page): Promise<ApiState> {
  return page.evaluate(async () => (await fetch('/api/me/state', { credentials: 'same-origin' })).json());
}

/** Visible buttons/links without an accessible name. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=button], input'))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const lab = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      const name = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        el.innerText ||
        lab?.textContent ||
        ''
      ).trim();
      if (!name && !el.getAttribute('aria-labelledby')) out.push(el.outerHTML.slice(0, 160));
    }
    return out;
  });
}

// Lobby tiles under the CTA (05 "Accepted deviations"): "N de 60 min / restantes no mês" and, in
// training mode, "Modo treino / sem nota". The prototype ran them together in one .xs line.
const minutesTile = (page: Page) =>
  page.locator('.wrap .row', { has: page.locator('.xs', { hasText: /^restantes no mês$/ }) }).first();
const trainingTile = (page: Page) =>
  page.locator('.wrap .row', { has: page.locator('.xs', { hasText: /^sem nota$/ }) });

async function openLobby(page: Page, hash = '/#/maggie') {
  await page.goto(hash);
  await expect(page.locator('.live.on-navy .topbar .lbl').first()).toBeVisible({ timeout: 20_000 });
}

async function startCall(page: Page) {
  await btn(page, 'Começar a conversa · +30 pontos').click();
  await expect
    .poll(() => apiHits(page, 'POST', /^\/api\/mic\/sessions$/).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(apiHits(page, 'POST', /^\/api\/mic\/sessions$/)[0]?.status).toBe(200);
}

async function typeLine(page: Page, text: string) {
  const input = page.locator('#mg-input');
  await expect(input).toBeEnabled({ timeout: 15_000 });
  await input.fill(text);
  const before = apiHits(page, 'POST', /^\/api\/tutor$/).length;
  await input.press('Enter');
  await expect.poll(() => apiHits(page, 'POST', /^\/api\/tutor$/).length, { timeout: 15_000 }).toBe(before + 1);
  await expect(page.locator('.thinking')).toHaveCount(0, { timeout: 15_000 });
}

// =====================================================================================
test.describe('mobile', () => {
  test('lobby: assistant picker, modes, per-mode pickers, minutes, persistence', async ({ page }) => {
    await signup(page);
    await openLobby(page);
    const top = page.locator('.live .topbar');
    await expect(top.locator('.lbl')).toHaveText('Conversa em tempo real');
    await expect(top.locator('.h2')).toHaveText('Maggie');
    await expect(top.getByRole('button', { name: 'Voltar' })).toBeVisible();
    await expect(top.locator('.demo-badge')).toBeVisible();
    // Bottom tabs visible in the lobby (tabs: !inCall).
    await expect(page.locator('.tabs, nav.tabbar, .tabbar').first()).toBeVisible();

    // Stage: avatar-stage with status = assistant full name, video avatar.
    const stage = page.locator('#av-live.avatar-stage');
    await expect(stage).toBeVisible();
    await expect(stage.locator('.status')).toHaveText('Margaret Woods'); // A.full, as AS().full in the prototype
    await expect(stage.locator('.av2d.vid')).toHaveCount(1);
    await expect(stage.locator('.av2d video[data-k="idle"]')).toHaveCount(1);
    await expect(stage.locator('.av2d video.on')).toHaveCount(1);

    // Assistant picker
    const picker = page.getByRole('radiogroup', { name: 'Seu assistente' });
    const radios = picker.getByRole('radio');
    expect(await radios.count()).toBeGreaterThanOrEqual(5);
    await expect(picker.locator('.assist.on')).toHaveCount(1);
    await expect(picker.locator('.assist.on b')).toHaveText('Maggie');
    // Every assistant card carries its style (a.tag) as screen-reader text; under the grid, the
    // prototype's ".xs" line becomes "<b>full</b> [tag pill] role. style" (05 "Accepted deviations").
    await expect(picker.locator('.assist.on span').last()).toHaveText('Acolhedora');
    await expect(page.locator('.wrap .xs b', { hasText: /^Margaret Woods$/ }).first()).toBeVisible();
    await expect(
      page
        .locator('.wrap .xs')
        .filter({ hasText: /^Margaret Woods Acolhedora Designer de interiores · toca a Woods & Beans\./ })
        .first(),
    ).toBeVisible();

    // Modes: 4 cards, Missão on by default.
    const modes = page.locator('.modes .mode');
    await expect(modes).toHaveCount(4);
    await expect(modes.locator('.h3')).toHaveText(MAG.MODES.map((m) => m.t));
    await expect(modes.locator('.xs')).toHaveText(MAG.MODES.map((m) => m.s));
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Missão');

    // Missão picker: "Escolha a cena", goal-first chip marked "· seu objetivo", role + goal card.
    await expect(page.getByText('Escolha a cena')).toBeVisible();
    const chips = page.locator('.chips .chip');
    expect(await chips.count()).toBe(Object.keys(MAG.MISSIONS).length);
    await expect(chips.first()).toContainText('· seu objetivo');
    await expect(chips.first()).toHaveClass(/\bon\b/);
    // On mobile the suffix is an icon plus screen-reader text (its own line in innerText).
    const firstTitle = (await chips.first().innerText()).replace(/\s*·\s*seu objetivo/, '').trim();
    const firstKey = Object.keys(MAG.MISSIONS).find((k) => MAG.MISSIONS[k]?.t === firstTitle) as string;
    expect(firstKey, 'first chip is a prototype mission').toBeTruthy();
    const card = page.locator('.wrap .card').filter({ hasText: 'faz o papel de' });
    await expect(card).toContainText(`A Maggie faz o papel de ${MAG.MISSIONS[firstKey]?.role}.`);
    await expect(card.locator('.h3')).toHaveText(MAG.MISSIONS[firstKey]?.goal as string);
    // Pick another mission.
    const other = chips.nth(2);
    const otherTitle = (await other.innerText()).replace(/\s*·\s*seu objetivo/, '').trim();
    const otherKey = Object.keys(MAG.MISSIONS).find((k) => MAG.MISSIONS[k]?.t === otherTitle) as string;
    await other.click();
    await expect(other).toHaveClass(/\bon\b/);
    await expect(card.locator('.h3')).toHaveText(MAG.MISSIONS[otherKey]?.goal as string);

    // Start button + minutes line + no SR warning (SR stub present).
    await expect(btn(page, 'Começar a conversa · +30 pontos')).toBeVisible();
    await expect(minutesTile(page).locator('b')).toHaveText(/^\d+ de \d+ min$/);
    await expect(trainingTile(page)).toHaveCount(0);
    await expect(page.getByText('Este navegador não reconhece fala.')).toHaveCount(0);

    // Livre
    await modes.filter({ hasText: 'Conversa livre' }).click();
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Conversa livre');
    await expect(
      page.locator('.wrap .xs').filter({ hasText: 'puxa assunto a partir do que você curte:' }),
    ).toBeVisible();
    // Pronúncia
    await modes.filter({ hasText: 'Pronúncia' }).click();
    await expect(page.getByText('Seis frases com os sons que mais travam quem fala português.')).toBeVisible();
    // Extra
    await modes.filter({ hasText: 'Sobre um Extra' }).click();
    await expect(page.getByText('Qual Extra você viu?')).toBeVisible();
    const xchips = page.locator('.chips .chip');
    expect(await xchips.count()).toBeGreaterThan(0);
    await expect(page.locator('.chips .chip.on')).toHaveCount(1);
    await xchips.last().click();
    await expect(xchips.last()).toHaveClass(/\bon\b/);

    // Accessible names on every visible control.
    expect(await unnamedControls(page), 'unnamed controls (lobby)').toEqual([]);

    // Assistant switch → PUT /api/me/profile, introduces itself, persists after reload.
    const second = radios.nth(1);
    const secondName = (await second.locator('b').innerText()).trim();
    await second.click();
    await expect(second).toHaveAttribute('aria-checked', 'true');
    await expect(top.locator('.h2')).toHaveText(secondName);
    await expect.poll(() => apiHits(page, 'PUT', /^\/api\/me\/profile$/).length).toBeGreaterThan(0);
    expect(apiHits(page, 'PUT', /^\/api\/me\/profile$/)[0]?.status).toBe(200);
    await expect.poll(async () => (await said(page)).length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator('.live .topbar .h2')).toHaveText(secondName, { timeout: 20_000 });
    await expect(page.locator('.assist.on b')).toHaveText(secondName);
    // Restore Maggie
    await page.getByRole('radio', { name: /Maggie/ }).click();
    await expect(page.locator('.live .topbar .h2')).toHaveText('Maggie');

    // Deep link ?modo=extra&x=… selects the mode + the extra; ?modo=livre selects livre.
    await page.goto('/#/maggie?modo=livre');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Conversa livre');
    await page.goto(`/#/maggie?modo=missao&m=${otherKey}`);
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Missão');
    await expect(page.locator('.chips .chip.on')).toContainText(MAG.MISSIONS[otherKey]?.t as string);

    // Back (Voltar) leaves the screen.
    await page.goto('/#/inicio');
    await page.goto('/#/maggie');
    await page.locator('.live .topbar').getByRole('button', { name: 'Voltar' }).click();
    await expect(page).toHaveURL(/#\/inicio$/);
  });

  test('call: opener, words → SRS, dock, typed + spoken turns, end → report → save words, persistence', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signup(page);
    const st0 = await apiState(page);
    await openLobby(page);
    await startCall(page);

    // In call: topbar Missão · title, minutes pill, Encerrar; tabs hidden; caption + bubble.
    const top = page.locator('.live .topbar');
    await expect(top.locator('.lbl')).toHaveText(/^Missão · .+/);
    await expect(top.locator('.pill')).toHaveText(/^\d+ min$/);
    await expect(top.getByRole('button', { name: 'Encerrar' })).toHaveCount(2); // close icon + compact btn
    const her = page.locator('#mg-tr .bub.her');
    await expect(her).toHaveCount(1, { timeout: 15_000 });
    await expect(her.first().locator('.en')).not.toBeEmpty();
    await expect(her.first().locator('.pt')).not.toBeEmpty();
    const cap = page.locator('#av-live .caption');
    await expect(cap.locator('.en')).toHaveText(await her.first().locator('.en').innerText());
    await expect(cap.locator('.ptl span')).toHaveText(await her.first().locator('.pt').innerText());
    await expect(page.locator('#av-live .status')).toContainText(/Ao vivo|Pensando|Ouvindo você/);
    // The assistant spoke the opener.
    await expect.poll(async () => (await said(page)).includes(await her.first().locator('.en').innerText())).toBe(true);
    // Session row exists on the server.
    expect(JSON.parse(apiHits(page, 'POST', /^\/api\/mic\/sessions$/)[0]?.body ?? '{}').id).toBeTruthy();

    // Dock content
    const dock = page.locator('.dock');
    await expect(dock.locator('.help button')).toHaveCount(MAG.HELP.length + 4); // help + coach + dica + PT + hands
    for (const h of MAG.HELP) await expect(dock.locator('.help button', { hasText: h.en })).toContainText(h.pt);
    await expect(page.locator('#mg-input')).toHaveAttribute('placeholder', 'Fale no microfone ou digite');
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Falar' })).toBeVisible();
    expect(await unnamedControls(page), 'unnamed controls (call)').toEqual([]);

    // Help "Slowly, please." → me bubble + repeat of the last line (spoken again).
    const nSaid = (await said(page)).length;
    await dock.locator('.help button', { hasText: 'Slowly, please.' }).click();
    await expect(page.locator('#mg-tr .bub.me').last().locator('.en')).toHaveText('Slowly, please.');
    await expect(her).toHaveCount(2);
    await expect.poll(async () => (await said(page)).length).toBeGreaterThan(nSaid);

    // Coach card (PT explanation + suggested answer).
    await dock.getByRole('button', { name: /Me explica em português/ }).click();
    const coach = page.locator('#mg-tr .card.paper').filter({ hasText: 'Coach · em português' });
    await expect(coach).toHaveCount(1);
    await expect(coach).toContainText('A Maggie disse:');
    await expect(coach).toContainText('Você pode responder:');

    // Dica fills the input + toast.
    await clearToasts(page);
    await dock.getByRole('button', { name: /Dica/ }).click();
    await expect(page.locator('#mg-input')).not.toHaveValue('');
    await expectToast(page, /^toast\|Dica: /);
    await expect(page.locator('#mg-input')).toBeFocused();
    await page.locator('#mg-input').fill('');

    // PT toggle.
    await dock.getByRole('button', { name: /Esconder PT/ }).click();
    await expect(page.locator('#mg-tr .bub.her .pt')).toHaveCount(0);
    await expect(page.locator('#av-live .caption .ptl')).toHaveCount(0);
    await dock.getByRole('button', { name: /Mostrar PT/ }).click();
    await expect(page.locator('#mg-tr .bub.her .pt').first()).toBeVisible();

    // Mãos livres toggle → toast.
    await clearToasts(page);
    await dock.getByRole('button', { name: /Mãos livres: não/ }).click();
    await expectToast(page, /Mãos livres: depois de cada fala da Maggie o microfone liga sozinho\./);
    await dock.getByRole('button', { name: /Mãos livres: sim/ }).click();
    await expectToast(page, /Mãos livres desligado\./);

    // Empty Enter does nothing.
    const tutor0 = apiHits(page, 'POST', /^\/api\/tutor$/).length;
    await page.locator('#mg-input').press('Enter');
    await page.waitForTimeout(400);
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).length).toBe(tutor0);

    // Typed turn → /api/tutor (server demo) → feedback chips + reply + points toast.
    await clearToasts(page);
    const p0 = (await apiState(page)).game.points;
    await typeLine(page, 'I would like a coffee, please.');
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).at(-1)?.status).toBe(200);
    const me = page.locator('#mg-tr .bub.me').last();
    await expect(me.locator('.en')).toHaveText('I would like a coffee, please.');
    await expect(page.locator('#mg-tr .fbrow .fbchip').first()).toBeVisible();
    await expect(page.locator('#mg-tr .fbrow .fbchip').first()).toHaveClass(/fbchip (certo|ajuste|natural)/);
    await expect(her).toHaveCount(3);
    await expectToast(page, /^pts-toast\|\+\d+ pontos$/);
    await expect.poll(async () => (await apiState(page)).game.points).toBeGreaterThan(p0);
    await expect(page.locator('#mg-input')).toHaveValue('');

    // A wrong-ish sentence gets an "Ajuste" chip with the corrected line (demo grammar checker).
    await typeLine(page, 'I have 25 years and she dont like coffee.');
    const lastRow = page.locator('#mg-tr .fbrow').last();
    await expect(lastRow.locator('.fbchip').first()).toHaveClass(/ajuste|natural/);

    // Spoken turn via the mic (SpeechRecognition stub: interim → final → send).
    await page.evaluate(() => {
      const W = window as unknown as { __srText: string; __srFinalMs: number };
      W.__srText = 'Thank you so much, see you later.';
      W.__srFinalMs = 1500;
    });
    const before = apiHits(page, 'POST', /^\/api\/tutor$/).length;
    await page.getByRole('button', { name: 'Falar' }).click();
    await expect(page.getByRole('button', { name: 'Parar' })).toHaveClass(/mic rec/);
    await expect(page.locator('#av-live .status')).toContainText('Ouvindo você');
    await expect(page.locator('#av-live .eq')).toBeVisible();
    await expect(page.locator('#mg-interim')).toHaveText(/Thank you|Ouvindo…/);
    await expect.poll(() => apiHits(page, 'POST', /^\/api\/tutor$/).length, { timeout: 10_000 }).toBe(before + 1);
    await expect(page.locator('.thinking')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('#mg-tr .bub.me').filter({ hasText: 'Thank you so much, see you later.' })).toHaveCount(
      1,
    );
    await expect(page.locator('#mg-tr .bub.me.interim')).toHaveCount(0);

    // Mic tap twice = start then stop (no send).
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'hang';
    });
    const b2 = apiHits(page, 'POST', /^\/api\/tutor$/).length;
    await page.getByRole('button', { name: 'Falar' }).click();
    await expect(page.getByRole('button', { name: 'Parar' })).toBeVisible();
    await page.getByRole('button', { name: 'Parar' }).click();
    await expect(page.getByRole('button', { name: 'Falar' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).length).toBe(b2);
    // Silent recognition → "Não ouvi nada" toast.
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'silent';
    });
    await clearToasts(page);
    await page.getByRole('button', { name: 'Falar' }).click();
    await expectToast(page, /Não ouvi nada\. Toque no microfone e fale perto do aparelho\./);
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'say';
    });

    // New-word pills → POST /api/srs/cards, toast, deck persisted, second click = "Já está".
    const pill = page.locator('#mg-tr .bub.her .pill.bl').first();
    await expect(pill, 'assistant bubbles carry new-word pills').toBeVisible();
    const pillText = (await pill.innerText()).trim();
    const wordEn = pillText.split(' · ')[0]?.trim() as string;
    await clearToasts(page);
    await pill.click();
    await expect.poll(() => apiHits(page, 'POST', /^\/api\/srs\/cards$/).length).toBe(1);
    expect(apiHits(page, 'POST', /^\/api\/srs\/cards$/)[0]?.status).toBe(200);
    await expectToast(page, /^pts-toast\|\+\d+ pontos$/); // award 'word' from POST /api/srs/cards
    await expectToast(page, new RegExp(`Levei “${wordEn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}” para a Revisão\\.`));
    await expect.poll(async () => (await apiState(page)).deck.some((d) => d.en === wordEn)).toBe(true);
    expect((await apiState(page)).deck.find((d) => d.en === wordEn)?.scene).toBe('Mic · Maggie');
    await clearToasts(page);
    await pill.click();
    await expectToast(page, /Já está na sua Revisão\./);
    expect(apiHits(page, 'POST', /^\/api\/srs\/cards$/).length).toBe(1);

    await page
      .screenshot({
        path: process.env.U6_SHOTS ? `${process.env.U6_SHOTS}call-mobile.png` : undefined,
        fullPage: false,
      })
      .catch(() => {});
    // Wait for the 15 s minimum so the session earns maggie_session, then end.
    await page.waitForTimeout(Math.max(0, 16_000));
    await clearToasts(page);
    const endResP = page.waitForResponse((r) => /\/api\/mic\/sessions\/[^/]+\/end$/.test(new URL(r.url()).pathname));
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).first().click();
    const endRes = await endResP;
    expect(endRes.status()).toBe(200);
    const endBody = await endRes.json();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    expect(apiHits(page, 'POST', /^\/api\/mic\/sessions\/[^/]+\/end$/)).toHaveLength(1);
    expect(endBody.award?.kind, 'maggie_session awarded').toBe('maggie_session');
    await expectToast(page, /^pts-toast\|\+30 pontos$/);
    const sid = page.url().split('/').pop() as string;
    expect(sid).toBe(endBody.session.id);
    expect(sid.startsWith('local-')).toBe(false);

    // Report: written once via /api/report.
    await expect.poll(() => apiHits(page, 'POST', /^\/api\/report$/).length, { timeout: 15_000 }).toBe(1);
    expect(apiHits(page, 'POST', /^\/api\/report$/)[0]?.status).toBe(200);
    const topR = page.locator('.topbar');
    await expect(topR).toContainText('Relatório');
    await expect(topR.locator('.demo-badge')).toHaveText('Modo demo');
    const head = page.locator('.now-card');
    await expect(head.locator('.kick')).toHaveText(/Relatório/);
    await expect(head.locator('.h1')).not.toBeEmpty();
    await expect(head.locator('.sm')).toHaveText(/^\d+:\d\d de conversa · \d+ falas suas · \+30 pontos$/);
    await expect(head.locator('p.p')).not.toBeEmpty();
    await expect(page.locator('.grid2 .stat')).toHaveCount(2);
    await expect(page.locator('.grid2 .stat').first()).toContainText('falas certas de primeira');
    await expect(page.locator('.grid2 .stat').nth(1)).toContainText('expressões novas');
    await expect(page.locator('.lbl.gr', { hasText: 'O que foi bem' })).toBeVisible();
    await expect(page.locator('.lbl.or', { hasText: 'Próxima meta' })).toBeVisible();
    // "O que ajustar" (the grammar slip above) with said vs better + TTS.
    const fixes = page.locator('.cmp');
    if (await fixes.count()) {
      const n0 = (await said(page)).length;
      await fixes.first().locator('button.en').click();
      await expect.poll(async () => (await said(page)).length).toBeGreaterThan(n0);
    }
    expect(await unnamedControls(page), 'unnamed controls (report)').toEqual([]);
    console.log(
      '[U6] report fixes:',
      await fixes.count(),
      'save btn:',
      await page.getByRole('button', { name: /^Levar \d+ para a Revisão$/ }).count(),
      'head:',
      await head.innerText(),
    );
    console.log('[U6] toasts so far:', JSON.stringify(await toasts(page)));
    if (process.env.U6_SHOTS)
      await page.screenshot({ path: `${process.env.U6_SHOTS}report-mobile.png`, fullPage: true });

    // Words → Revisão.
    const save = page.getByRole('button', { name: /^Levar \d+ para a Revisão$/ });
    if (await save.count()) {
      const deck0 = (await apiState(page)).deck.length;
      await clearToasts(page);
      await save.click();
      await expect.poll(() => apiHits(page, 'POST', /^\/api\/srs\/cards$/).length).toBe(2);
      expect(apiHits(page, 'POST', /^\/api\/srs\/cards$/)[1]?.status).toBe(200);
      await expectToast(page, /(cartões novos|cartão novo) na Revisão\.|Essas palavras já estavam na Revisão\./);
      expect((await apiState(page)).deck.length).toBeGreaterThanOrEqual(deck0);
      await clearToasts(page);
      await save.click();
      await expectToast(page, /Essas palavras já estavam na Revisão\./);
    }

    // Persisted: server session with transcript + report; reload keeps the report (no second write).
    const st = await apiState(page);
    const sess = st.maggie.sessions.find((x) => x.id === sid);
    expect(sess, 'session in /api/me/state').toBeTruthy();
    expect(sess?.report, 'report stored').toBeTruthy();
    expect(sess?.turns.filter((t) => t.who === 'me').length).toBeGreaterThanOrEqual(4);
    expect(st.game.points).toBeGreaterThan(st0.game.points + 30);
    await page.reload();
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(apiHits(page, 'POST', /^\/api\/report$/).length, 'report written once').toBe(1);

    // Conversar de novo → lobby with the same mode/mission.
    await page
      .getByRole('button', { name: /Conversar de novo/ })
      .or(page.getByRole('link', { name: /Conversar de novo/ }))
      .first()
      .click();
    await expect(page).toHaveURL(/#\/maggie\?modo=missao&m=[\w-]+&r=\d+$/);
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Missão');
    await page.goBack();
    await expect(page).toHaveURL(/relatorio/);
    await page
      .getByRole('button', { name: 'Voltar para Hoje' })
      .or(page.getByRole('link', { name: 'Voltar para Hoje' }))
      .first()
      .click();
    await expect(page).toHaveURL(/#\/inicio$/);
  });

  test('call: 9 turns end the scene ("A cena terminou" → Ver o relatório); hands-free re-arms the mic', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=livre');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Conversa livre');
    await startCall(page);
    await expect(page.locator('.live .topbar .lbl')).toHaveText('Conversa livre');
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });

    // Hands-free: after the assistant's reply ends, the mic turns itself on.
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'hang';
    });
    await page
      .locator('.dock')
      .getByRole('button', { name: /Mãos livres: não/ })
      .click();
    const starts0 = await page.evaluate(() => (window as unknown as { __srStarts: number }).__srStarts);
    await typeLine(page, 'I love watching series on weekends.');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __srStarts: number }).__srStarts), { timeout: 10_000 })
      .toBeGreaterThan(starts0);
    await expect(page.getByRole('button', { name: 'Parar' })).toBeVisible();
    await page.getByRole('button', { name: 'Parar' }).click();
    await page
      .locator('.dock')
      .getByRole('button', { name: /Mãos livres: sim/ })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'say';
    });

    for (let i = 2; i <= 9; i++) {
      const input = page.locator('#mg-input');
      if (await input.isDisabled()) break;
      await typeLine(page, `I watched an episode number ${i} yesterday and it was great.`);
    }
    const ended = page.locator('#mg-tr .card.paper.pop');
    await expect(ended).toContainText('A cena terminou');
    await expect(ended).toContainText('Veja o que foi bem e o que ajustar.');
    await expect(page.locator('#mg-input')).toBeDisabled();
    await expect(page.locator('.say .mic')).toBeDisabled();
    // Server stops at micMaxTurns as well: every tutor call succeeded.
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).every((a) => a.status === 200)).toBe(true);
    await ended.getByRole('button', { name: 'Ver o relatório' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator('.now-card .h1')).toHaveText('Conversa livre');
  });

  test('leaving mid-call saves the session (finish on leave)', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'Hello, nice to meet you.');
    // Leave through a hash change (tabs are hidden in the call).
    await page.evaluate(() => {
      location.hash = '#/inicio';
    });
    await expect(page).toHaveURL(/#\/inicio$/);
    await expect
      .poll(() => apiHits(page, 'POST', /^\/api\/mic\/sessions\/[^/]+\/end$/).length, { timeout: 10_000 })
      .toBe(1);
    expect(apiHits(page, 'POST', /^\/api\/mic\/sessions\/[^/]+\/end$/)[0]?.status).toBe(200);
    const st = await apiState(page);
    expect(st.maggie.sessions.length).toBe(1);
  });

  test('pronúncia mode: phrases, Ouvir, record without mic, nav, Encerrar → report; training hides scores', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=pronuncia');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Pronúncia');
    await startCall(page);
    await expect(page.locator('.live .topbar .lbl')).toHaveText('Pronúncia');
    const panel = page.locator('.card.paper.stack.tc');
    await expect(panel.locator('.lbl')).toHaveText(`Frase 1 de ${MAG.PRON.length}`);
    await expect(panel.locator('.h1')).toHaveText(MAG.PRON[0]?.en as string);
    await expect(panel.locator('.fb.tip')).toContainText(`Dica da Maggie: ${MAG.PRON[0]?.tip}`);
    await expect(panel.locator('.sm')).toHaveText('Toque no microfone e diga a frase');
    // Greeting spoken.
    await expect.poll(async () => (await said(page)).some((t) => t.includes('practice some tricky sounds'))).toBe(true);
    // Ouvir
    const n0 = (await said(page)).length;
    await panel.getByRole('button', { name: 'Ouvir' }).click();
    await expect.poll(async () => (await said(page)).slice(n0)).toContain(MAG.PRON[0]?.en as string);
    expect(await unnamedControls(page), 'unnamed controls (pronúncia)').toEqual([]);
    // Gravar without a microphone → toast, then an estimated score.
    await clearToasts(page);
    await panel.getByRole('button', { name: 'Gravar' }).click();
    await expectToast(page, /Sem microfone: a nota fica estimada\./);
    await expect(panel.locator('.num')).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('.h3.muted')).toHaveText('/10');
    await expect(panel.locator('.fb.ok, .fb.fix')).toBeVisible();
    // Próxima frase / Anterior
    await page.getByRole('button', { name: 'Próxima frase' }).click();
    await expect(panel.locator('.lbl')).toHaveText(`Frase 2 de ${MAG.PRON.length}`);
    await expect(panel.locator('.num')).toHaveCount(0);
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(panel.locator('.lbl')).toHaveText(`Frase 1 de ${MAG.PRON.length}`);
    for (let i = 1; i < MAG.PRON.length; i++) await page.getByRole('button', { name: 'Próxima frase' }).click();
    await expect(panel.locator('.lbl')).toHaveText(`Frase ${MAG.PRON.length} de ${MAG.PRON.length}`);
    await page
      .locator('.row .btn', { hasText: /^Encerrar$/ })
      .last()
      .click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card .h1')).toHaveText('Pronúncia');
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator('.grid2 .stat')).toHaveCount(2);
    console.log('[U6] pron report head:', JSON.stringify(await page.locator('.now-card').innerText()));
    console.log('[U6] pron toasts:', JSON.stringify(await toasts(page)));
    const rid = page.url().split('/').pop() as string;

    // Training mode (feedback "suave"): lobby says so, report hides the stats, pronúncia hides the score.
    const put = await page.evaluate(async () => {
      const r = await fetch('/api/me/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ feedback: 'suave' }),
      });
      return r.status;
    });
    expect(put).toBe(200);
    await page.reload();
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 20_000 });
    await expect(page.locator('.grid2 .stat')).toHaveCount(0);
    expect(page.url()).toContain(rid);
    await page.goto('/#/maggie?modo=pronuncia');
    await expect(minutesTile(page).locator('b')).toHaveText(/^\d+ de \d+ min$/);
    await expect(trainingTile(page)).toBeVisible();
    await expect(trainingTile(page).locator('b')).toHaveText('Modo treino');
    await startCall(page);
    await page.locator('.card.paper.stack.tc').getByRole('button', { name: 'Gravar' }).click();
    await expect(page.locator('.card.paper.stack.tc .fb.ok, .card.paper.stack.tc .fb.fix')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.card.paper.stack.tc .num')).toHaveCount(0);
  });

  test('extra mode via deep link and assistant change mid-lobby; Encerrar right away', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=extra');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Sobre um Extra');
    const chip = page.locator('.chips .chip').nth(1);
    await chip.click();
    await startCall(page);
    const startBody = apiHits(page, 'POST', /^\/api\/mic\/sessions$/)[0];
    expect(startBody?.status).toBe(200);
    await expect(page.locator('.live .topbar .lbl')).toHaveText('Sobre um Extra');
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    // Close (X) ends right away → report.
    await page.locator('.live .topbar .iconbtn[aria-label="Encerrar"]').click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card .h1')).toHaveText('Sobre um Extra');
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('no SpeechRecognition: lobby warning, typed placeholder, mic toast', async ({ page }) => {
    await signup(page);
    await page.evaluate(() => sessionStorage.setItem('__noSR', '1'));
    await openLobby(page);
    await page.reload();
    expect(
      await page.evaluate(
        () =>
          'webkitSpeechRecognition' in window &&
          !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition,
      ),
    ).toBe(false);
    await expect(page.locator('.fb.tip')).toHaveText(
      'Este navegador não reconhece fala. Você pode conversar digitando. Para falar, use o Chrome ou o Edge.',
    );
    await startCall(page);
    await expect(page.locator('#mg-input')).toHaveAttribute('placeholder', 'Digite a sua resposta em inglês');
    await clearToasts(page);
    await page.getByRole('button', { name: 'Falar' }).click();
    await expectToast(page, /Este navegador não reconhece fala\. Digite a resposta\./);
    await expect(page.locator('#mg-input')).toBeFocused();
  });

  test('avatar: idle clip at rest, talking clip while the assistant speaks (mood → clip)', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    const on = () => page.locator('#av-live .av2d video.on').getAttribute('data-k');
    await expect.poll(on).toBe('idle');
    const keys = await page
      .locator('#av-live .av2d video')
      .evaluateAll((vs) => vs.map((v) => v.getAttribute('data-k')));
    expect(keys).toEqual(['idle', 'talk', 'talk-happy', 'talk-soft']);
    await page.evaluate(() => {
      (window as unknown as { __speakMs: number }).__speakMs = 4000;
    });
    await startCall(page);
    // Opener (mood happy → talk) while speaking.
    await expect.poll(on, { timeout: 10_000 }).toMatch(/^talk/);
    await expect.poll(on, { timeout: 10_000 }).toBe('idle');
    await page.evaluate(() => {
      (window as unknown as { __speakMs: number }).__speakMs = 200;
    });
  });

  test('start refused (403 plan_required) → back to the lobby with the reason; server down → local demo flow', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await page.route('**/api/mic/sessions', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'plan_required', message: 'Este conteúdo faz parte de outro plano.' },
            }),
          })
        : route.continue(),
    );
    await clearToasts(page);
    await btn(page, 'Começar a conversa · +30 pontos').click();
    await expectToast(page, /Este conteúdo faz parte de outro plano\./);
    await expect(page.locator('.live .topbar .lbl')).toHaveText('Conversa em tempo real');
    await expect(page.locator('.modes .mode')).toHaveCount(4);
    await page.unroute('**/api/mic/sessions');

    // Network failure: the conversation runs on the client (demo brain), the report is local.
    await page.route('**/api/mic/sessions', (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await btn(page, 'Começar a conversa · +30 pontos').click();
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    const tutor0 = apiHits(page, 'POST', /^\/api\/tutor$/).length;
    await page.locator('#mg-input').fill('I would like a window seat, please.');
    await page.locator('#mg-input').press('Enter');
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('#mg-tr .fbrow .fbchip').first()).toBeVisible();
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).length).toBe(tutor0);
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/local-[\w]+$/, { timeout: 15_000 });
    await expect(page.locator('.topbar .demo-badge')).toHaveText('Modo demo', { timeout: 15_000 });
    // A local session (no server) earns no points: no "+30 pontos" in the header.
    await expect(page.locator('.now-card .sm')).toHaveText(/^\d+:\d\d de conversa · 1 fala sua$/);
    expect(apiHits(page, 'POST', /^\/api\/report$/)).toHaveLength(0);
    expect(apiHits(page, 'POST', /\/end$/)).toHaveLength(0);
    await page.unroute('**/api/mic/sessions');
    const w = watches.get(page);
    if (w) {
      w.errors = w.errors.filter((e) => !/Failed to load resource|status of 403|ERR_FAILED/.test(e));
      w.api = w.api.filter((a) => a.status !== 403);
    }
  });

  test('report of an unknown id falls back to the newest session, or back to the Mic with none', async ({ page }) => {
    await signup(page);
    await page.goto('/#/maggie/relatorio/doesnotexist');
    await expect(page).toHaveURL(/#\/maggie$/, { timeout: 15_000 });
    await expect(page.locator('.modes .mode')).toHaveCount(4);
    // Tabs hidden during the call, visible again on the report.
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.tabbar, nav.tabs, .tabs').first()).toBeHidden();
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    const id = page.url().split('/').pop() as string;
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    await page.goto('/#/maggie/relatorio/doesnotexist');
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    expect(id).toBeTruthy();
  });

  test('keyboard focus is visible on lobby controls', async ({ page }) => {
    await signup(page);
    await openLobby(page);
    const ring = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: `${el.tagName}.${el.className}`,
          outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
          shadow: cs.boxShadow !== 'none',
        };
      });
    const seen: { tag: string; outline: boolean; shadow: boolean }[] = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const r = await ring();
      if (r) seen.push(r);
    }
    const inScreen = seen.filter((s) => /assist|mode|chip|btn/.test(s.tag));
    expect(inScreen.length, 'tab reaches Mic controls').toBeGreaterThan(0);
    expect(
      inScreen.filter((s) => !s.outline && !s.shadow),
      'focus ring visible',
    ).toEqual([]);
    // Enter activates a mode card.
    await page.locator('.modes .mode').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText(MAG.MODES[0]?.t as string);
  });
});

// =====================================================================================
test.describe('desktop', () => {
  test.use(DESKTOP);

  test('lobby live-grid + Como funciona; call layout with transcript on the right', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    const grid = page.locator('.live-grid');
    await expect(grid).toBeVisible();
    await expect(grid.locator('.left #av-live')).toBeVisible();
    await expect(grid.locator('.left .modes .mode')).toHaveCount(4);
    const how = grid.locator('.right .transcript .card');
    await expect(how.locator('.h3')).toHaveText('Como funciona');
    await expect(how.locator('.row.top')).toHaveCount(4);
    await expect(how.locator('.row.top .num')).toHaveText(['1', '2', '3', '4']);
    await expect(how).toContainText('A Maggie fala em inglês, no seu nível.');
    await expect(page.locator('#mg-scroll')).toHaveCount(0);
    expect(await unnamedControls(page)).toEqual([]);

    if (process.env.U6_SHOTS) await page.screenshot({ path: `${process.env.U6_SHOTS}lobby-desktop.png` });
    await startCall(page);
    await expect(grid.locator('.left .xs')).toContainText(
      'A legenda mostra a última fala da Maggie. Toque nas palavras azuis para levar para a Revisão.',
    );
    await expect(grid.locator('.right #mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await expect(grid.locator('.right .dock .say #mg-input')).toBeVisible();
    await typeLine(page, 'Good morning, how are you?');
    await expect(grid.locator('.right #mg-tr .bub.me')).toHaveCount(1);
    await expect(grid.locator('#av-live .caption .en')).toHaveText(
      await grid.locator('.right #mg-tr .bub.her').last().locator('.en').innerText(),
    );
    // Scrolled to the newest line.
    const atBottom = await page.evaluate(() => {
      const el = document.getElementById('mg-tr');
      return !el || el.scrollHeight <= el.clientHeight + 2 || el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    });
    expect(atBottom).toBe(true);
    if (process.env.U6_SHOTS) await page.screenshot({ path: `${process.env.U6_SHOTS}call-desktop.png` });
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator('.wrap').first()).toBeVisible();
  });
});

// =====================================================================================
// Round 3 additions: gaps not covered above.
const CLIP_FOR: Record<string, string> = { encouraging: 'talk-happy', thinking: 'talk-soft', correcting: 'talk-soft' };

test.describe('round 3 · mobile', () => {
  test('report shows "está escrevendo o seu relatório…" while /api/report runs; double Encerrar ends once', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'Hello, I am going to Lisbon.');
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route('**/api/report', async (route) => {
      await gate;
      await route.continue();
    });
    const enc = page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).first();
    await enc.dblclick();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.getByText('A Maggie está escrevendo o seu relatório…')).toBeVisible();
    await expect(page.locator('.now-card .h1')).not.toBeEmpty();
    await expect(page.locator('.grid2 .stat')).toHaveCount(0);
    // One learner turn, a few seconds: the server gave no maggie_session, so no "+30 pontos".
    await expect(page.locator('.now-card .sm')).toHaveText(/^\d+:\d\d de conversa · 1 fala sua$/);
    release();
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.getByText('A Maggie está escrevendo o seu relatório…')).toHaveCount(0);
    expect(apiHits(page, 'POST', /^\/api\/mic\/sessions\/[^/]+\/end$/), 'one /end').toHaveLength(1);
    expect(apiHits(page, 'POST', /^\/api\/report$/), 'one report').toHaveLength(1);
    // Topbar back → the Mic.
    await page.locator('.topbar').getByRole('button', { name: 'Voltar' }).first().click();
    await expect(page).toHaveURL(/#\/maggie(\?.*)?$/);
    await page.unroute('**/api/report');
  });

  test('tutor mood drives the talking clip; dock controls show a visible focus ring', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await expect
      .poll(() => page.locator('#av-live .av2d video.on').getAttribute('data-k'), { timeout: 10_000 })
      .toBe('idle');
    for (const line of ['I have 25 years and she dont like coffee.', 'Thank you so much, that is great!']) {
      await page.evaluate(() => {
        (window as unknown as { __speakMs: number }).__speakMs = 3000;
      });
      const resP = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tutor');
      await page.locator('#mg-input').fill(line);
      await page.locator('#mg-input').press('Enter');
      const body = await (await resP).json();
      const want = CLIP_FOR[body.mood as string] ?? 'talk';
      await expect
        .poll(() => page.locator('#av-live .av2d video.on').getAttribute('data-k'), { timeout: 8000 })
        .toBe(want);
      console.log('[U6] tutor mood', body.mood, '→ clip', want);
      await page.evaluate(() => {
        (window as unknown as { __speakMs: number }).__speakMs = 200;
      });
      await expect
        .poll(() => page.locator('#av-live .av2d video.on').getAttribute('data-k'), { timeout: 8000 })
        .toBe('idle');
    }
    // Keyboard focus through the dock.
    await page.locator('#mg-input').focus();
    const ring = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: `${el.tagName}.${el.className}|${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20)}`,
          ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
        };
      });
    const seen: { tag: string; ok: boolean }[] = [];
    const r0 = await ring();
    if (r0) seen.push(r0);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const r = await ring();
      if (r) seen.push(r);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const r = await ring();
      if (r) seen.push(r);
    }
    console.log('[U6] call focus:', JSON.stringify(seen));
    expect(seen.length).toBeGreaterThan(3);
    expect(
      seen.filter((s) => !s.ok),
      'focus ring visible in the call',
    ).toEqual([]);
  });

  test('ownership: another user cannot end, tutor, report or read my Mic session', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    const sid = JSON.parse(apiHits(page, 'POST', /^\/api\/mic\/sessions$/)[0]?.body ?? '{}').id as string;
    expect(sid).toBeTruthy();
    const ctx2 = await browser.newContext({ baseURL: page.url().split('#')[0], ...DESKTOP });
    await stubTurnstile(ctx2);
    const p2 = await ctx2.newPage();
    await signup(p2, 'Caio');
    const res = await p2.evaluate(async (id) => {
      const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const out: Record<string, number> = {};
      out.get = (await fetch(`/api/mic/sessions/${id}`, { credentials: 'same-origin' })).status;
      out.tutor = (
        await fetch('/api/tutor', {
          method: 'POST',
          credentials: 'same-origin',
          headers: h,
          body: JSON.stringify({ session_id: id, text: 'hello there', turn: 0 }),
        })
      ).status;
      out.end = (
        await fetch(`/api/mic/sessions/${id}/end`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: h,
          body: JSON.stringify({ turns: [] }),
        })
      ).status;
      out.report = (
        await fetch('/api/report', {
          method: 'POST',
          credentials: 'same-origin',
          headers: h,
          body: JSON.stringify({ session_id: id }),
        })
      ).status;
      return out;
    }, sid);
    console.log('[U6] cross-user statuses', JSON.stringify(res));
    expect(res.get).toBe(404);
    expect(res.tutor).toBe(404);
    expect(res.end).toBe(404);
    expect(res.report).toBe(404);
    await ctx2.close();
    // My own session is still open and can be ended by me.
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/maggie/relatorio/${sid}$`), { timeout: 15_000 });
  });
});

test.describe('round 3 · desktop', () => {
  test.use(DESKTOP);

  test('lobby aside: help phrases speak, recent conversations open the report; desktop report columns', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signup(page);
    await openLobby(page);
    const right = page.locator('.live-grid .right');
    const left = page.locator('.live-grid .left');
    // Help phrases under the modes (left), so both columns end at about the same height.
    await expect(left.getByText('Se travar, é só pedir')).toBeVisible();
    await expect(
      right.getByText('Quando você terminar a primeira conversa com a Maggie, o relatório fica guardado aqui.'),
    ).toBeVisible();
    // Start button + minutes in the right column on desktop.
    await expect(right.getByRole('button', { name: 'Começar a conversa · +30 pontos' })).toBeVisible();
    await expect(right.locator('.row', { has: page.locator('.xs', { hasText: /^restantes no mês$/ }) })).toBeVisible();
    const n0 = (await said(page)).length;
    await left.getByRole('button', { name: /Slowly, please\./ }).click();
    await expect.poll(async () => (await said(page)).slice(n0)).toContain('Slowly, please.');
    // One conversation → listed → opens its report.
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'I have 25 years and she dont like coffee.');
    await typeLine(page, 'I would like a window seat, please.');
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    const sid = page.url().split('/').pop() as string;
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    // Two columns on desktop: stats, "O que foi bem" and "Palavras novas" left; "O que ajustar",
    // pronúncia and "Próxima meta" right.
    const good = await page
      .locator('.card', { has: page.locator('.lbl.gr') })
      .first()
      .boundingBox();
    const goal = await page.locator('.card.or').first().boundingBox();
    const fixCard = page.locator('.card', { has: page.locator('.lbl.bl', { hasText: 'O que ajustar' }) }).first();
    await expect(fixCard).toBeVisible();
    const fb = await fixCard.boundingBox();
    expect(fb && good && fb.x > good.x + 100, '"O que ajustar" in the right column').toBe(true);
    // "Próxima meta" is the full-width peach footer under both columns, with the buttons at its right
    // (05 "Accepted deviations", Relatório desktop).
    expect(
      goal && fb && good && Math.abs(goal.x - good.x) < 2 && goal.x + goal.width >= fb.x + fb.width - 2,
      '"Próxima meta" spans both columns',
    ).toBe(true);
    expect(goal && fb && goal.y >= fb.y + fb.height, '"Próxima meta" below the cards').toBe(true);
    const goalCard = page.locator('.card.or').first();
    await expect(
      goalCard
        .getByRole('button', { name: /Conversar de novo/ })
        .or(goalCard.getByRole('link', { name: /Conversar de novo/ })),
    ).toHaveCount(1);
    await expect(
      goalCard
        .getByRole('button', { name: 'Voltar para Hoje' })
        .or(goalCard.getByRole('link', { name: 'Voltar para Hoje' })),
    ).toHaveCount(1);
    const wordsCard = page.locator('.card', { has: page.locator('.lbl.or', { hasText: 'Palavras novas' }) }).first();
    if (await wordsCard.count()) {
      const wb = await wordsCard.boundingBox();
      expect(wb && good && Math.abs(wb.x - good.x) < 2, '"Palavras novas" in the left column').toBe(true);
    }
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noHScroll).toBe(true);
    expect(await unnamedControls(page)).toEqual([]);
    if (process.env.U6_SHOTS)
      await page.screenshot({ path: `${process.env.U6_SHOTS}report-desktop.png`, fullPage: true });
    // Words → Revisão on desktop.
    const save = page.getByRole('button', { name: /^Levar \d+ para a Revisão$/ });
    if (await save.count()) {
      await clearToasts(page);
      await save.click();
      await expectToast(page, /(cartões novos|cartão novo) na Revisão\.|Essas palavras já estavam na Revisão\./);
    }
    // Back to the lobby: the conversation is listed and opens its report.
    await page.goto('/#/maggie');
    const row = page.locator('.live-grid .right button.row').filter({ hasText: 'Relatório' });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText(/No check-in do aeroporto|Missão|.+/);
    await expect(row).toContainText(/2 falas suas/);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`#/maggie/relatorio/${sid}$`));
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
  });
});

// =====================================================================================
// Round 4 additions: hostile input, bad deep links, mic permission denied, reload/back mid-call, overflow.
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('round 4 · mobile', () => {
  test('bad deep links (unknown mission / extra) keep a valid selection and the call starts', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=missao&m=bogus-mission');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Missão');
    const onChips = await page.locator('.chips .chip.on').count();
    console.log('[U6] bogus mission → chips on:', onChips);
    await expect(page.locator('.wrap .card').filter({ hasText: 'faz o papel de' })).toBeVisible();
    await clearToasts(page);
    await btn(page, 'Começar a conversa · +30 pontos').click();
    await page.waitForTimeout(2500);
    const st = apiHits(page, 'POST', /^\/api\/mic\/sessions$/);
    console.log('[U6] bogus mission start:', JSON.stringify(st.map((a) => [a.status, a.body?.slice(0, 160)])));
    console.log('[U6] bogus mission toasts:', JSON.stringify(await toasts(page)));
    console.log('[U6] bogus mission lbl:', await page.locator('.live .topbar .lbl').innerText());
    expect(onChips, 'one mission chip selected for an unknown ?m=').toBe(1);
    expect(st.every((a) => a.status === 200)).toBe(true);
    const w = watches.get(page);
    if (w) w.api = w.api.filter((a) => !(a.path === '/api/mic/sessions' && a.status === 400));
  });

  test('bad extra deep link keeps a valid selection', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=extra&x=nope-extra');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Sobre um Extra');
    const onChips = await page.locator('.chips .chip.on').count();
    console.log('[U6] bogus extra → chips on:', onChips);
    await btn(page, 'Começar a conversa · +30 pontos').click();
    await page.waitForTimeout(2500);
    const st = apiHits(page, 'POST', /^\/api\/mic\/sessions$/);
    console.log('[U6] bogus extra start:', JSON.stringify(st.map((a) => [a.status, a.body?.slice(0, 160)])));
    console.log('[U6] bogus extra toasts:', JSON.stringify(await toasts(page)));
    expect(onChips, 'one extra chip selected for an unknown ?x=').toBe(1);
    expect(st.every((a) => a.status === 200)).toBe(true);
    const w = watches.get(page);
    if (w) w.api = w.api.filter((a) => !(a.path === '/api/mic/sessions' && a.status >= 400));
  });

  test('hostile + long input is rendered as text; mic permission denied toast; no horizontal scroll', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    expect(await noHScroll(page), 'lobby no h-scroll').toBe(true);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    const evil = '<img src=x onerror="window.__xss=1"> I like <b>coffee</b>';
    await typeLine(page, evil);
    await expect(page.locator('#mg-tr .bub.me .en').last()).toHaveText(evil);
    expect(await page.locator('#mg-tr img, #mg-tr b:has-text("coffee")').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    const long = `${'I really like to travel and see new places '.repeat(16)}end.`;
    expect(long.length).toBeGreaterThan(600);
    await typeLine(page, long);
    expect(apiHits(page, 'POST', /^\/api\/tutor$/).every((a) => a.status === 200)).toBe(true);
    expect(await noHScroll(page), 'call no h-scroll').toBe(true);
    // Microphone permission denied by the recognizer.
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'deny';
    });
    await clearToasts(page);
    await page.getByRole('button', { name: 'Falar' }).click();
    await expectToast(page, /O microfone está bloqueado\. Libere nas permissões do navegador ou digite\./);
    await expect(page.getByRole('button', { name: 'Falar' })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __srMode: string }).__srMode = 'say';
    });
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    expect(await noHScroll(page), 'report no h-scroll').toBe(true);
    // Report bottom tabs are visible (tabs: true).
    await expect(page.locator('.tabbar, nav.tabs, .tabs').first()).toBeVisible();
    // Report shows the hostile text as text too (in "O que ajustar" if present).
    expect(await page.locator('.scroll img[src="x"]').count()).toBe(0);
  });

  test('browser Back mid-call saves the session; reload mid-call returns to a clean lobby', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await page.goto('/#/inicio');
    await openLobby(page, '/#/maggie');
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'Hello, I need a taxi to the airport.');
    await page.goBack();
    await expect(page).toHaveURL(/#\/inicio$/);
    await expect
      .poll(() => apiHits(page, 'POST', /^\/api\/mic\/sessions\/[^/]+\/end$/).length, { timeout: 10_000 })
      .toBe(1);
    // Reload in the middle of a new call.
    await openLobby(page, '/#/maggie');
    await btn(page, 'Começar a conversa · +30 pontos').click();
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await page.reload();
    await expect(page.locator('.modes .mode')).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.live .topbar .lbl')).toHaveText('Conversa em tempo real');
    const st = await apiState(page);
    console.log(
      '[U6] sessions after back+reload:',
      JSON.stringify(
        st.maggie.sessions.map((x) => ({ id: x.id, turns: x.turns.length, report: !!x.report, mode: x.mode })),
      ),
    );
    expect(st.maggie.sessions.length).toBeGreaterThanOrEqual(1);
    // The abandoned (never ended) session: what does its report do?
    const open = st.maggie.sessions[0];
    if (open) {
      await page.goto(`/#/maggie/relatorio/${open.id}`);
      await page.waitForTimeout(3000);
      console.log('[U6] open-session report head:', JSON.stringify(await page.locator('.now-card').innerText()));
      console.log(
        '[U6] open-session report api:',
        JSON.stringify(apiHits(page, 'POST', /^\/api\/report$/).map((a) => [a.status, a.body?.slice(0, 200)])),
      );
    }
  });
});

test.describe('round 4 · desktop', () => {
  test.use(DESKTOP);

  test('abandoning a call with only the opener (Back) leaves no phantom conversation in the list', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await page.goto('/#/inicio');
    await openLobby(page, '/#/maggie');
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/#\/inicio$/);
    await page.waitForTimeout(1500);
    console.log('[U6] /end after opener-only back:', apiHits(page, 'POST', /\/end$/).length);
    await page.reload();
    await openLobby(page, '/#/maggie');
    const rows = page.locator('.live-grid .right button.row').filter({ hasText: 'Relatório' });
    await page.waitForTimeout(1000);
    const texts = await rows.allInnerTexts();
    console.log('[U6] lobby list after opener-only back:', JSON.stringify(texts));
    if (process.env.U6_SHOTS) await page.screenshot({ path: `${process.env.U6_SHOTS}phantom-desktop.png` });
    expect(texts, 'no phantom "0 falas suas" conversation').toEqual([]);
  });
});

// =====================================================================================
// Round 5 additions: "· visto" + lastId preselection, pronúncia tap-to-stop, report TTS + focus, 1024 px.
test.describe('round 5 · mobile', () => {
  test('extra chips: a seen Extra is marked "· visto" and preselected (lastId)', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=extra');
    const chips = page.locator('.chips .chip');
    expect(await chips.count()).toBeGreaterThan(1);
    await expect(page.locator('.chips .chip', { hasText: '· visto' })).toHaveCount(0);
    const lastChip = chips.last();
    const title = (await lastChip.innerText()).trim();
    // Find that Extra's id in the catalog the client loaded.
    const id = await page.evaluate(async (t) => {
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => /\/api\/content\/v\//.test(u));
      for (const u of urls) {
        const j = await (await fetch(u, { credentials: 'same-origin' })).json().catch(() => null);
        const ex = (j && (j.extras || j.catalog?.extras)) as { id: string; title: string }[] | undefined;
        const hit = ex?.find((x) => x.title === t);
        if (hit) return hit.id;
      }
      return null;
    }, title);
    expect(id, 'extra id from the catalog').toBeTruthy();
    const st = await page.evaluate(async (x) => {
      const r = await fetch(`/api/extras/${x}/seen`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      return r.status;
    }, id);
    expect(st).toBe(200);
    await page.goto('/#/inicio');
    await page.reload();
    await openLobby(page, '/#/maggie?modo=extra&r=1');
    const seen = page.locator('.chips .chip', { hasText: '· visto' });
    await expect(seen).toHaveCount(1);
    await expect(seen).toContainText(title);
    await expect(seen).toHaveClass(/\bon\b/);
    await expect(seen).toHaveAttribute('aria-pressed', 'true');
  });

  test('pronúncia: tapping the mic again stops the take once; Próxima frase speaks the new phrase', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page, '/#/maggie?modo=pronuncia');
    await startCall(page);
    const panel = page.locator('.card.paper.stack.tc');
    await expect(panel.locator('.lbl')).toHaveText(`Frase 1 de ${MAG.PRON.length}`);
    await panel.getByRole('button', { name: 'Gravar' }).click();
    await expect(panel.locator('.sm').first()).toHaveText('Ouvindo… toque para parar');
    await expect(panel.locator('button.mic.rec')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Gravar' }).click();
    await expect(panel.locator('.fb.ok, .fb.fix')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000); // the 1.5 s auto-stop must not add a second take
    const me = await page.evaluate(() => document.querySelectorAll('.fb.ok, .fb.fix').length);
    expect(me).toBe(1);
    const n0 = (await said(page)).length;
    await page.getByRole('button', { name: 'Próxima frase' }).click();
    await expect.poll(async () => (await said(page)).slice(n0)).toContain(MAG.PRON[1]?.en as string);
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    // One take = one learner line on the server.
    const sid = page.url().split('/').pop() as string;
    const sess = (await apiState(page)).maggie.sessions.find((x) => x.id === sid);
    expect(sess?.turns.filter((t) => t.who === 'me').length).toBe(1);
  });

  test('report: words and pronunciation pills speak; buttons show a focus ring', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'I have 25 years and she dont like coffee.');
    await typeLine(page, 'I would like a window seat, please.');
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    // Each new word is a tile button: the English term (.en) over its translation.
    const wordBtns = page
      .locator('.card', { has: page.locator('.lbl.or', { hasText: 'Palavras novas' }) })
      .locator('button:has(.en)');
    const nW = await wordBtns.count();
    console.log('[U6] r5 report words:', nW, 'pron pills:', await page.locator('button.pill.navy').count());
    if (nW) {
      const w = (await wordBtns.first().locator('.en').innerText()).trim();
      const n0 = (await said(page)).length;
      await wordBtns.first().click();
      await expect.poll(async () => (await said(page)).slice(n0)).toContain(w);
    }
    const pills = page.locator('button.pill.navy');
    if (await pills.count()) {
      const w = (await pills.first().innerText()).trim();
      const n0 = (await said(page)).length;
      await pills.first().click();
      await expect.poll(async () => (await said(page)).slice(n0)).toContain(w);
    }
    // Focus ring on the report's buttons.
    const bad: string[] = [];
    for (const loc of [
      page.getByRole('button', { name: /^Levar \d+ para a Revisão$/ }),
      page.getByRole('button', { name: /Conversar de novo/ }).or(page.getByRole('link', { name: /Conversar de novo/ })),
      page.locator('.topbar').getByRole('button', { name: 'Voltar' }),
    ]) {
      if (!(await loc.count())) continue;
      await loc.first().focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: `${el.tagName}.${el.className}`,
          ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
        };
      });
      if (r && !r.ok) bad.push(r.tag);
    }
    expect(bad, 'report focus ring').toEqual([]);
  });
});

test.describe('round 5 · mobile scroll', () => {
  test('mobile call keeps the newest line in view (scroll to bottom, like after() in the prototype)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    for (const l of ['I would like a window seat, please.', 'Here is my passport.', 'Thank you very much.']) {
      await typeLine(page, l);
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => {
        const sc = document.getElementById('mg-scroll');
        const last = Array.from(document.querySelectorAll('#mg-tr .bub.her')).at(-1) as HTMLElement | undefined;
        const r = last?.getBoundingClientRect();
        return {
          sc: sc ? { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight } : null,
          doc: { top: document.scrollingElement?.scrollTop, h: document.scrollingElement?.scrollHeight },
          lastTop: r?.top,
          lastBottom: r?.bottom,
          vh: innerHeight,
        };
      });
      console.log('[U6] r5 mobile scroll', JSON.stringify(info));
    }
    if (process.env.U6_SHOTS) await page.screenshot({ path: `${process.env.U6_SHOTS}call-mobile-scroll.png` });
    await expect(page.locator('#mg-tr .bub.her').last()).toBeInViewport({ ratio: 0.3 });
  });
});

test.describe('round 5 · narrow desktop', () => {
  test.use({ viewport: { width: 1024, height: 700 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('1024 px: lobby, call and report fit without horizontal scroll; named controls', async ({ page }) => {
    test.setTimeout(120_000);
    await signup(page);
    await openLobby(page);
    expect(await noHScroll(page), 'lobby').toBe(true);
    expect(await unnamedControls(page)).toEqual([]);
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'Good afternoon, I would like to check in.');
    expect(await noHScroll(page), 'call').toBe(true);
    await expect(page.locator('#mg-input')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Falar' })).toBeInViewport();
    expect(await unnamedControls(page)).toEqual([]);
    if (process.env.U6_SHOTS) await page.screenshot({ path: `${process.env.U6_SHOTS}call-1024.png` });
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    expect(await noHScroll(page), 'report').toBe(true);
  });
});

// =====================================================================================
// Round 6: API abuse around the Mic endpoints (closed sessions, replays, CSRF, anonymous, bad input).
test.describe('round 6 · api', () => {
  test('closed-session, replay, CSRF, anonymous and malformed requests are refused', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signup(page);
    const origin = new URL(page.url()).origin;
    const J = { 'Content-Type': 'application/json', Accept: 'application/json', Origin: origin };
    const post = (path: string, data: unknown, headers: Record<string, string> = J) =>
      page.request.post(path, { headers, data: JSON.stringify(data), failOnStatusCode: false });

    // Malformed start bodies.
    expect((await post('/api/mic/sessions', { assistant: 'margaret', mode: 'karaoke' })).status()).toBe(400);
    expect((await post('/api/mic/sessions', { assistant: '../etc', mode: 'livre' })).status()).toBeGreaterThanOrEqual(
      400,
    );
    expect((await post('/api/mic/sessions', { assistant: 'margaret', mode: 'missao', mission: 'nope' })).status()).toBe(
      400,
    );

    // CSRF: a foreign Origin and a form content type are refused.
    const evil = await post(
      '/api/mic/sessions',
      { assistant: 'margaret', mode: 'livre' },
      { ...J, Origin: 'https://evil.example' },
    );
    expect(evil.status()).toBe(403);
    const form = await page.request.post('/api/mic/sessions', {
      headers: { Origin: origin, 'Content-Type': 'text/plain' },
      data: JSON.stringify({ assistant: 'margaret', mode: 'livre' }),
      failOnStatusCode: false,
    });
    expect(form.status()).toBeGreaterThanOrEqual(400);

    // Anonymous.
    const anon = await browser.newContext({ baseURL: origin });
    const ar = await anon.request.post('/api/mic/sessions', {
      headers: J,
      data: JSON.stringify({ assistant: 'margaret', mode: 'livre' }),
      failOnStatusCode: false,
    });
    expect(ar.status()).toBe(401);
    await anon.close();

    // A real session: report before end → 409; tutor works; end; tutor after end → 409; replay → no award.
    const st = await post('/api/mic/sessions', { assistant: 'margaret', mode: 'livre' });
    expect(st.status()).toBe(200);
    const sid = (await st.json()).id as string;
    expect((await post('/api/report', { session_id: sid })).status()).toBe(409);
    const long = 'I like coffee very much. '.repeat(400);
    const t1 = await post('/api/tutor', { session_id: sid, text: long, turn: 0 });
    console.log('[U6] r6 long tutor status', t1.status());
    expect([200, 413]).toContain(t1.status());
    const e1 = await post(`/api/mic/sessions/${sid}/end`, { turns: [] });
    expect(e1.status()).toBe(200);
    const e2 = await post(`/api/mic/sessions/${sid}/end`, { turns: [{ who: 'me', en: 'forged', fb: null, pron: [] }] });
    expect(e2.status()).toBe(200);
    const e2b = await e2.json();
    expect(e2b.award).toBeNull();
    expect(
      (e2b.session.turns as { en: string }[]).some((t) => t.en === 'forged'),
      'replay appends nothing',
    ).toBe(false);
    expect((await post('/api/tutor', { session_id: sid, text: 'hello again', turn: 1 })).status()).toBe(409);
    // Pronúncia sessions refuse tutor turns.
    const ps = await post('/api/mic/sessions', { assistant: 'margaret', mode: 'pronuncia' });
    const pid = (await ps.json()).id as string;
    expect((await post('/api/tutor', { session_id: pid, text: 'hello', turn: 0 })).status()).toBe(400);
    // Session ids are validated.
    expect(
      (await page.request.get('/api/mic/sessions/..%2F..%2Fx', { failOnStatusCode: false })).status(),
    ).toBeGreaterThanOrEqual(400);
    // These deliberate 4xx are not page errors.
    const w = watches.get(page);
    if (w) w.api = [];
  });
});

// =====================================================================================
test('static: no innerHTML in the slice, no persona/secrets in the client bundle or catalog', async ({ page }) => {
  const slice = fileURLToPath(new URL('../../../apps/app/web/src/screens/maggie/', import.meta.url));
  for (const f of readdirSync(slice)) {
    const src = readFileSync(join(slice, f), 'utf8');
    expect(src, `${f} innerHTML`).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|outerHTML\s*=/);
  }
  // Persona sentences from the prototype (server-only).
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
    if (/"persona"\s*:|persona:\s*"/.test(t)) leaks.push(`${f}: persona field`);
    if (
      /sk-[A-Za-z0-9]{20,}|CLOUDFLARE_API_TOKEN|TURNSTILE_SECRET|SESSION_SECRET|-----BEGIN [A-Z ]*PRIVATE KEY/.test(t)
    )
      leaks.push(`${f}: secret-like string`);
  }
  expect(leaks).toEqual([]);
  // The catalog the client loads must not carry personas either.
  await signup(page);
  await openLobby(page);
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  const contentUrls = urls.filter((u) => /\/api\/content\/v\//.test(u));
  expect(contentUrls.length, 'content files loaded').toBeGreaterThan(0);
  for (const u of contentUrls) {
    const body = await page.evaluate(async (x) => {
      const r = await fetch(x, { credentials: 'same-origin' });
      return `${r.status} ${await r.text()}`;
    }, u);
    for (const p of personas) expect(body.includes(p), `content persona ${p} in ${u}`).toBe(false);
    expect(body, u).not.toMatch(/"persona"/);
  }
});

// =====================================================================================
// Round 7: /api/health says ai:true (AI path wired) on a Worker whose AI binding is absent; a fake
// microphone (Chromium's fake capture device) so Pronúncia records real audio → POST /api/pronounce.
// Whatever the server answers, the call must degrade to the demo scorer without breaking the screen.
test.describe('round 7 · ai on + fake mic', () => {
  test('pronúncia records audio and posts /api/pronounce; tutor/report/tts degrade cleanly', async ({
    playwright,
    baseURL,
  }, testInfo) => {
    test.setTimeout(150_000);
    // launchOptions cannot change inside a describe: a browser of its own with the fake capture device.
    const browser2 = await playwright.chromium.launch({
      channel: testInfo.project.use.channel,
      headless: process.env.PARITY_HEADED !== '1',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    const context = await browser2.newContext({
      baseURL,
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      permissions: ['microphone'],
    });
    await stubTurnstile(context);
    await context.route('**/api/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
    );
    const page = await context.newPage();
    await instrument(context, page);
    await signup(page);
    await page.evaluate(() => sessionStorage.setItem('__realMic', '1'));
    await context.unroute('**/api/health');
    await context.route('**/api/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: true }) }),
    );
    await openLobby(page, '/#/maggie?modo=pronuncia');
    await page.reload();
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Pronúncia', { timeout: 20_000 });
    expect(await page.evaluate(() => typeof navigator.mediaDevices?.getUserMedia)).toBe('function');
    await startCall(page);
    const panel = page.locator('.card.paper.stack.tc');
    await expect(panel.locator('.lbl')).toHaveText(`Frase 1 de ${MAG.PRON.length}`);
    await clearToasts(page);
    await panel.getByRole('button', { name: 'Gravar' }).click();
    await expect(panel.locator('.sm').first()).toHaveText('Ouvindo… toque para parar');
    await page.waitForTimeout(1500);
    await panel.getByRole('button', { name: 'Gravar' }).click();
    await expect(panel.locator('.fb.ok, .fb.fix')).toBeVisible({ timeout: 20_000 });
    const pr = apiHits(page, 'POST', /^\/api\/pronounce$/);
    console.log('[U6] r7 /api/pronounce:', JSON.stringify(pr.map((a) => [a.status, a.body?.slice(0, 200)])));
    console.log('[U6] r7 toasts:', JSON.stringify(await toasts(page)));
    expect(pr.length, 'audio take posted to /api/pronounce').toBe(1);
    expect(await toasts(page)).not.toContain('toast|Sem microfone: a nota fica estimada.');
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });

    // A spoken-mode call with ai:true: tutor + report + (maybe) /api/tts.
    await page.goto('/#/maggie?modo=livre&r=7');
    await expect(page.locator('.modes .mode.on .h3')).toHaveText('Conversa livre');
    await startCall(page);
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(1, { timeout: 15_000 });
    await typeLine(page, 'I love watching series on weekends.');
    await expect(page.locator('#mg-tr .bub.her')).toHaveCount(2);
    await page.locator('.live .topbar .btn', { hasText: 'Encerrar' }).click();
    await expect(page).toHaveURL(/#\/maggie\/relatorio\/[\w-]+$/, { timeout: 15_000 });
    await expect(page.locator('.now-card p.p')).not.toBeEmpty({ timeout: 15_000 });
    const w = watches.get(page);
    const ai = (w?.api ?? []).filter((a) => /^\/api\/(tutor|report|tts|pronounce)$/.test(a.path));
    console.log('[U6] r7 ai calls:', JSON.stringify(ai.map((a) => [a.method, a.path, a.status])));
    console.log('[U6] r7 errors:', JSON.stringify(w?.errors ?? []));
    // A 5xx from an AI endpoint without the binding is the server's business; the screen must not
    // break (no pageerror) and must not show the error boundary. Browser "Failed to load" lines for
    // those endpoints are expected.
    if (w) {
      expect(
        w.errors.filter((e) => e.startsWith('pageerror')),
        'page errors',
      ).toEqual([]);
      w.errors = w.errors.filter((e) => !/Failed to load resource/.test(e));
      w.api = w.api.filter((a) => !(/^\/api\/(tts|pronounce)$/.test(a.path) && a.status >= 500));
    }
    await assertClean(page);
    await browser2.close();
  });
});
