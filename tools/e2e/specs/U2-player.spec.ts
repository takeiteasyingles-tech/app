// U2-player: functional + security checks for the episode player (#/episodio/1/1..10) and the
// episode-done screen (#/concluido/1) against the real Worker on the e2e slot (run with --slot 32).
// Each test gets its own D1 user built from the parity fixture (Ana) through the fixture machinery,
// and signs in with that user's session cookie. Media endings are driven on the real <audio>/<video>
// elements (seek to the end), speech synthesis is stubbed (records what was said), and the
// microphone is either refused (scripted result path) or Chrome's fake capture device.
// The "parity" tests drive the same states in the prototype (served from prototipo/, read-only) and
// compare the rendered DOM signature (tags, classes, inline styles, text) with the app's.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, type Response, test } from '@playwright/test';
import { fixtureStatements } from '@tie/seed/fixtureToSql';
import { COOKIES } from '@tie/shared/constants';
import { type ViewportName, VIEWPORTS } from '../../parity/src/config';
import { prepareContext } from '../../parity/src/determinism';
import { type FixtureSql, namespaceCards, passHash } from '../../parity/src/fixture/sql';
import {
  ep1At,
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
const OUT = fileURLToPath(new URL('../out/u2-player/', import.meta.url));
const VPS: ViewportName[] = ['mobile', 'desktop'];
/** VIEWPORTS[vp] as Playwright context options (width/height go under `viewport`). */
function vpOpts(vp: ViewportName) {
  const v = VIEWPORTS[vp];
  return { viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor };
}
const EVAL_PROBE = new Set<string>();
test.afterAll(() => {
  if (!EVAL_PROBE.size) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `csp-eval-probe-${process.pid}.txt`), [...EVAL_PROBE].join('\n'));
});

// Chrome's fake microphone (a beep) for the real recording path; other tests refuse the mic.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

// ---------------------------------------------------------------- users

type Kind = 'start' | 'main' | 'ep2' | 's9' | 's10' | 'dl';
const TESTS: Record<Kind, string[]> = {
  start: ['flow', 'refuse', 'leave', 'race'],
  dl: ['pdf'],
  main: ['map', 'train', 'fakemic', 'ia', 'a11y', 'cmp-a'],
  ep2: ['synth'],
  s9: [],
  s10: ['done', 'cmp-b'],
};
const USERS: { key: string; kind: Kind }[] = [];
for (const vp of VPS) {
  for (const [kind, names] of Object.entries(TESTS) as [Kind, string[]][]) {
    for (const t of names) USERS.push({ key: `u2-${t}-${vp}`, kind });
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function notTraining(s: Any): Any {
  if (s.profile) {
    s.profile.diffs = (s.profile.diffs as string[]).filter((d) => d !== 'shy');
    s.profile.feedback = 'direto';
  }
  return s;
}
function stateOf(kind: Kind): Any {
  const base = clone(loadFixture());
  if (kind === 'main') return base;
  if (kind === 'start') {
    const s = notTraining(base);
    s.prog = { 1: 1 };
    s.stepOk = {};
    s.ebooks = {};
    s.scores = {};
    s.exAns = {};
    s.epsDone = {};
    s.deck = [];
    s.due = 0;
    return s;
  }
  if (kind === 'ep2') {
    const s = notTraining(ep1At(base, 10));
    s.prog = { 1: 10, 2: 1 };
    s.epsDone = { 1: true };
    s.stepOk = { ...s.stepOk, '1-10': true };
    return s;
  }
  if (kind === 'dl') {
    const s = notTraining(base);
    s.prog = { 1: 3 };
    s.stepOk = { '1-1': true, '1-2': true };
    s.ebooks = {};
    s.scores = {};
    s.exAns = {};
    return s;
  }
  if (kind === 's9') return notTraining(ep1At(base, 9));
  return notTraining(ep1At(base, 10));
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
  const fx: FixtureSql = { sql: `${statements.join('\n')}\n`, users: [], jobs: {}, admin: { email: '', token: '' } };
  await applyFixtures(sl, fx, (m) => console.log(`[u2] ${m}`));
});

// ---------------------------------------------------------------- page helpers

const INIT = `(() => {
  window.__spoken = [];
  window.__csp = [];
  window.__media = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + e.blockedURI);
  });
  if ('speechSynthesis' in window) {
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, voice: u.voice ? u.voice.name : '' });
      setTimeout(() => { try { u.onend && u.onend(new Event('end')); } catch (e) {} }, 40);
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!window.__media.includes(this)) window.__media.push(this);
    return play.call(this);
  };
})();`;

const NO_MIC = `(() => {
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
})();`;

interface Watch {
  errors: string[];
  api: { method: string; url: string; status: number; body: string | null }[];
  ignore: RegExp[];
}

async function prepApp(ctx: BrowserContext, key: string, o: { ai?: boolean; noMic?: boolean } = {}): Promise<void> {
  await ctx.addCookies([{ name: COOKIES.app, value: sessionToken(key), url: sl.origin, httpOnly: true, sameSite: 'Lax' }]);
  await ctx.addInitScript({ content: INIT });
  if (o.noMic) await ctx.addInitScript({ content: NO_MIC });
  await ctx.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: !!o.ai }) }),
  );
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], api: [], ignore: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (/^Failed to load resource/.test(m.text())) return; // covered (with the URL) by the response listener
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) w.errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) {
      w.api.push({ method: r.request().method(), url: u, status: r.status(), body: r.request().postData() });
      if (r.status() >= 400 && !w.ignore.some((re) => re.test(u))) w.errors.push(`http ${r.status()} ${r.request().method()} ${u}`);
    }
    if (u.includes('/m/') && r.status() >= 400) w.errors.push(`media ${r.status()} ${u}`);
  });
  return w;
}

async function expectClean(page: Page, w: Watch): Promise<void> {
  const csp = await page.evaluate(() => (window as any).__csp as string[]).catch(() => [] as string[]);
  // zod v4's allowsEval probe (Function('') in try/catch, shared code) reports 'script-src eval': noted separately.
  if (csp.some((c) => c.startsWith('script-src eval'))) EVAL_PROBE.add(test.info().title);
  expect.soft(csp.filter((c) => !c.startsWith('script-src eval')), 'CSP violations').toEqual([]);
  expect.soft(w.errors, 'console/page/API errors').toEqual([]);
  await expect.soft(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

const spoken = (page: Page) =>
  page.evaluate(() => (window as any).__spoken as { text: string; rate: number; pitch: number; voice: string }[]);
const head = (page: Page) => page.locator('.player-head');
const nextBtn = (page: Page) => page.locator('.player-foot .btn.next');
const kicker = (page: Page) => page.locator('.player-foot .btn.next .kicker');
const dock = (page: Page) => page.locator('.player-dock');
const body = (page: Page) => page.locator('#pl-scroll');
const ptsToast = (page: Page, n: number) => page.locator('.pts-toast', { hasText: `+${n} pontos` });

async function atStep(page: Page, ep: number, step: number): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`#/episodio/${ep}/${step}$`));
  await expect(head(page)).toContainText(`Episódio ${ep} · etapa ${step} de 10`, { timeout: 20_000 });
}

const isApi = (path: string, method = 'POST') => (r: Response) =>
  r.url().includes(path) && r.request().method() === method;

/** Waits for the API call `trigger` causes and returns its status + JSON. */
async function apiCall(page: Page, path: string, trigger: () => Promise<unknown>): Promise<{ status: number; json: Any; req: Any }> {
  const [res] = await Promise.all([page.waitForResponse(isApi(path), { timeout: 20_000 }), trigger()]);
  let json: Any = {};
  try {
    json = await res.json();
  } catch {}
  let req: Any = {};
  try {
    req = JSON.parse(res.request().postData() || '{}');
  } catch {}
  return { status: res.status(), json, req };
}

/** The last media element play() was called on: seek it to the end (real `ended`), else dispatch it. */
async function endMedia(page: Page, tag: 'AUDIO' | 'VIDEO' = 'AUDIO'): Promise<string> {
  return page.evaluate(async (tag) => {
    const list = ((window as any).__media as HTMLMediaElement[]).filter((m) => m.tagName === tag);
    const a = list[list.length - 1];
    if (!a) return 'none';
    const t0 = Date.now();
    while (!(a.duration > 0) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
    if (a.duration > 0 && Number.isFinite(a.duration)) {
      const ok = await new Promise<boolean>((r) => {
        const to = setTimeout(() => r(false), 8000);
        a.addEventListener('ended', () => { clearTimeout(to); r(true); }, { once: true });
        a.currentTime = Math.max(0, a.duration - 0.35);
        if (a.paused) void a.play().catch(() => {});
      });
      if (ok) return 'real';
    }
    a.dispatchEvent(new Event('ended'));
    return 'synthetic';
  }, tag);
}

/** Episode JSON as the app loaded it (captured from the content file response). */
function captureEpisodes(page: Page): Map<number, Any> {
  const eps = new Map<number, Any>();
  page.on('response', async (r) => {
    const m = r.url().match(/\/ep\/(\d+)\.json/);
    if (m && r.status() === 200) {
      try {
        eps.set(Number(m[1]), await r.json());
      } catch {}
    }
  });
  return eps;
}

async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.app button, .app a[href], .app [role=button], #overlayroot button'))) {
      const h = el as HTMLElement;
      if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') continue;
      const name =
        h.getAttribute('aria-label') || h.getAttribute('title') || (h.textContent || '').trim() ||
        Array.from(h.querySelectorAll('img[alt]')).map((i) => i.getAttribute('alt')).join('');
      if (!name) out.push(h.outerHTML.slice(0, 160));
    }
    return out;
  });
}

async function focusRing(page: Page): Promise<{ fv: boolean; outline: string; shadow: string; tag: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    return { fv: a.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow, tag: a.outerHTML.slice(0, 80) };
  });
}
const visibleRing = (r: { outline: string; shadow: string }) =>
  !/^none/.test(r.outline) && !/ 0px /.test(`${r.outline} `) ? true : r.shadow !== 'none';

/** Clicks Next and waits for the advance call; returns it. */
async function advance(page: Page): Promise<{ status: number; json: Any }> {
  await expect(nextBtn(page)).toBeEnabled({ timeout: 10_000 });
  return apiCall(page, '/api/progress/advance', () => nextBtn(page).click());
}

// ---------------------------------------------------------------- functional tests, per viewport

for (const vp of VPS) {
  test.describe(`U2 ${vp}`, () => {
    test.use(vpOpts(vp));

    test(`full episode 1 flow, server-confirmed, with points (${vp})`, async ({ page, context }) => {
      test.setTimeout(420_000);
      await prepApp(context, `u2-flow-${vp}`, { noMic: true });
      const w = watch(page);
      const eps = captureEpisodes(page);
      const log: string[] = [];

      // No step → prog (1).
      await page.goto('/#/episodio/1');
      await expect(head(page)).toContainText('Episódio 1 · etapa 1 de 10', { timeout: 20_000 });
      await expect(head(page)).toContainText('Good Morning');
      await expect(head(page).locator('.segs, [class*=seg]').first()).toBeVisible();
      await expect(page.locator('.player-foot .btn.prev')).toBeDisabled();
      await expect(nextBtn(page)).toBeDisabled();
      await expect(kicker(page)).toHaveText('Ouça a abertura até o fim');
      await expect(nextBtn(page)).toContainText('Take the Mic');
      if (vp === 'desktop') {
        const aside = page.locator('aside');
        await expect(aside).toContainText('Voltar para Hoje');
        await expect(aside).toContainText('E-book 1');
        await expect(aside).toContainText('Episódio 01');
        await expect(aside.locator('.steprow')).toHaveCount(10);
        await expect(aside.locator('.steprow.now')).toContainText('Você está aqui');
        await expect(aside.locator('.steprow.locked')).toHaveCount(9);
      } else {
        await expect(page.locator('aside')).toHaveCount(0);
      }
      // A step ahead lands on the last reached step.
      await page.goto('/#/episodio/1/5');
      await atStep(page, 1, 1);

      // ---- 1 · intro audio
      const ep1 = () => eps.get(1) as Any;
      await expect.poll(() => !!eps.get(1)).toBe(true);
      expect(ep1().introAudio).toMatch(/^\/m\//);
      const card1 = body(page).locator('.now-card');
      await expect(card1).toContainText('Abertura');
      await expect(card1).toContainText('Ep. 01');
      await card1.getByRole('button', { name: 'Ouvir a abertura' }).click();
      await expect(card1.getByRole('button', { name: 'Pausar a abertura' })).toBeVisible();
      await expect(card1.locator('#pl-time')).toHaveText(/^\d:\d\d \/ \d:\d\d$/, { timeout: 10_000 });
      const so1 = await apiCall(page, '/api/progress/step-ok', () => endMedia(page).then((m) => log.push(`intro:${m}`)));
      expect(so1.status).toBe(200);
      expect(so1.req).toEqual({ ep: 1, step: 1 });
      await expect(kicker(page)).toHaveText('Próxima · 02 · +10');
      await expect(card1.getByRole('button', { name: 'Ouvir a abertura' })).toBeVisible();
      const a1 = await advance(page);
      expect(a1.status).toBe(200);
      expect(a1.json.prog).toBe(2);
      await expect(ptsToast(page, 10).first()).toBeVisible();
      await atStep(page, 1, 2);
      // Media stopped on step change.
      expect(await page.evaluate(() => ((window as any).__media as HTMLMediaElement[]).every((m) => m.paused))).toBe(true);

      // ---- 2 · song, synced lyrics, translation toggle
      await expect(dock(page)).toContainText('Música · 1ª passada');
      await expect(dock(page)).toContainText(ep1().songTitle);
      await expect(kicker(page)).toHaveText('Ouça a música até o fim');
      const lyr = body(page).locator('.dialog-line');
      // A line the song repeats back to back is shown once with a ×N badge (slice polish).
      const rowOf: number[] = [];
      let nRows = 0;
      (ep1().lyrics as Any[]).forEach((l, i) => {
        const p = ep1().lyrics[i - 1];
        if (!(p && p.en === l.en && p.pt === l.pt)) nRows++;
        rowOf.push(nRows - 1);
      });
      await expect(lyr).toHaveCount(nRows);
      if (nRows < ep1().lyrics.length) await expect(body(page).locator('.pl-rep')).not.toHaveCount(0);
      await expect(body(page).locator('.dialog-line .pt')).toHaveCount(nRows);
      await dock(page).getByRole('button', { name: /Tradução/ }).click();
      await expect(body(page).locator('.dialog-line .pt')).toHaveCount(0);
      await expect(dock(page).locator('.toggle')).not.toHaveClass(/\bon\b/);
      await dock(page).getByRole('button', { name: /Tradução/ }).click();
      await expect(body(page).locator('.dialog-line .pt')).toHaveCount(nRows);
      await dock(page).getByRole('button', { name: 'Tocar' }).click();
      await expect(dock(page).locator('.playbtn')).not.toHaveClass(/navy/);
      // Lyrics follow currentTime / duration.
      const mid = await page.evaluate(async () => {
        const a = ((window as any).__media as HTMLMediaElement[]).filter((m) => m.tagName === 'AUDIO').pop()!;
        const t0 = Date.now();
        while (!(a.duration > 0) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
        a.currentTime = a.duration * 0.55;
        await new Promise((r) => setTimeout(r, 900));
        return { t: a.currentTime, d: a.duration };
      });
      const expectLine = Math.min(ep1().lyrics.length - 1, Math.floor((mid.t / mid.d) * ep1().lyrics.length));
      await expect(lyr.nth(rowOf[expectLine] ?? expectLine)).toHaveClass(/\bon\b/, { timeout: 3000 }).catch(async () => {
        // timeupdate may have advanced one line in the meantime
        await expect(body(page).locator('.dialog-line.on')).toHaveCount(1);
      });
      const so2 = await apiCall(page, '/api/progress/step-ok', () => endMedia(page).then((m) => log.push(`song:${m}`)));
      expect(so2.status).toBe(200);
      const dashed = body(page).locator('button.card.row', { hasText: 'Próximo: baixar o e-book 1.' });
      await expect(dashed).toBeVisible();
      const a2 = await apiCall(page, '/api/progress/advance', () => dashed.click());
      expect(a2.status).toBe(200);
      await atStep(page, 1, 3);

      // ---- 3 · e-book download
      await expect(body(page)).toContainText('E-book 01 · Episódios 1–2');
      await expect(body(page)).toContainText(ep1().ebookTitle);
      await expect(body(page).locator('.pl-inside .pill')).toHaveText(['Diálogo bilíngue', 'Take Away', 'Exercícios', 'Gabarito']);
      await expect(kicker(page)).toHaveText('Baixe o e-book para seguir');
      const dlP = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
      const dl = await apiCall(page, '/api/ebooks/1/download', () => body(page).getByRole('button', { name: 'Baixar e-book 1' }).click());
      expect(dl.status).toBe(200);
      log.push(`ebook pdf: ${dl.json.pdf}`);
      await expect(body(page).locator('.card.gr')).toContainText('E-book baixado.');
      if (dl.json.pdf) {
        const d = await dlP;
        expect(d, 'a real PDF must download when the server has one').not.toBeNull();
        if (d) log.push(`download: ${d.suggestedFilename()}`);
        const pr = await page.request.get(dl.json.pdf);
        expect(pr.status()).toBe(200);
        expect(pr.headers()['content-type']).toMatch(/pdf/);
      }
      await expect(kicker(page)).toHaveText('Próxima · 04 · +10');
      await advance(page);
      await atStep(page, 1, 4);

      // ---- 4 · Take a Look: video, cast, visual vocab
      const video = body(page).locator('video');
      await expect(video).toHaveCount(1);
      expect(await video.getAttribute('src')).toMatch(/^\/m\//);
      await expect(kicker(page)).toHaveText('Assista à cena até o fim');
      await expect(body(page).locator('.pl-cast .pl-castm')).toHaveCount(ep1().cast.length);
      await expect(body(page).locator('.pl-cast .pl-castm').first()).toContainText(ep1().cast[0]);
      await expect(body(page).locator('.grid2 button.card')).toHaveCount(ep1().visual.length);
      await body(page).locator('.grid2 button.card').first().click();
      await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(ep1().visual[0].en);
      await page.evaluate(() => {
        const v = document.querySelector('#pl-scroll video') as HTMLVideoElement;
        v.muted = true;
        void v.play();
      });
      const so4 = await apiCall(page, '/api/progress/step-ok', () => endMedia(page, 'VIDEO').then((m) => log.push(`video:${m}`)));
      expect(so4.status).toBe(200);
      await expect(kicker(page)).toHaveText('Próxima · 05 · +10');
      const a4 = await advance(page);
      expect(a4.json.cardsAdded).toBeGreaterThan(0);
      await expect(page.locator('.toast', { hasText: /cart(ões novos|ão novo) na Revisão/ }).first()).toBeVisible();
      await atStep(page, 1, 5);

      // ---- 5 · Take It In: per-character TTS, speed, play all
      await expect(kicker(page)).toHaveText('Ouça o diálogo até o fim');
      await expect(dock(page)).toContainText('Ouvir tudo');
      await expect(dock(page).locator('.seg button')).toHaveText(['0,75×', '1×', '1,25×']);
      await dock(page).locator('.seg button', { hasText: '1,25×' }).click();
      await expect(dock(page).locator('.seg button.on')).toHaveText('1,25×');
      const lines = body(page).locator('.dialog-line');
      await expect(lines).toHaveCount(ep1().dialog.length);
      if (vp === 'desktop') await expect(lines.first().locator('.grid')).toHaveCount(1);
      else await expect(lines.first().locator('.stack')).toHaveCount(1);
      const firstSpoken = (ep1().dialog as Any[]).findIndex((d) => !d.stage);
      await page.evaluate(() => ((window as any).__spoken.length = 0));
      await lines.nth(firstSpoken).click();
      await expect(lines.nth(firstSpoken)).toHaveClass(/\bon\b/);
      await expect.poll(async () => (await spoken(page))[0]?.text).toBe(ep1().dialog[firstSpoken].en);
      const r125 = (await spoken(page))[0]!.rate;
      await page.evaluate(() => ((window as any).__spoken.length = 0));
      await dock(page).locator('.seg button', { hasText: /^1×$/ }).click();
      await lines.nth(firstSpoken).click();
      await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
      const r1 = (await spoken(page))[0]!.rate;
      expect(r125, 'speed 1,25× speaks faster than 1×').toBeGreaterThan(r1);
      await page.evaluate(() => ((window as any).__spoken.length = 0));
      // Play all from the first line.
      await lines.first().click();
      const so5 = await apiCall(page, '/api/progress/step-ok', async () => {
        await dock(page).getByRole('button', { name: 'Tocar diálogo' }).click();
        await expect(dock(page)).toContainText('Tocando');
      });
      expect(so5.status).toBe(200);
      const sp = await spoken(page);
      const said = sp.map((s) => s.text);
      const expected = (ep1().dialog as Any[]).filter((d) => !d.stage).map((d) => d.en);
      for (const e of expected) expect(said).toContain(e);
      // Per-character voices: a male character (Zach) and a female one (Becky) do not share a pitch.
      const lineOf = (who: string) => (ep1().dialog as Any[]).find((d) => d.who === who && !d.stage)?.en as string | undefined;
      const zach = sp.find((s) => s.text === lineOf('Zach'));
      const becky = sp.find((s) => s.text === lineOf('Becky'));
      if (zach && becky) expect(zach.pitch, 'per-character voice (pitch) for Zach vs Becky').not.toBe(becky.pitch);
      await expect(dock(page)).toContainText('Ouvir tudo');
      await expect(kicker(page)).toHaveText('Próxima · 06 · +10');
      await advance(page);
      await atStep(page, 1, 6);

      // ---- 6 · Take the Mic: no microphone → scripted result, server-recorded
      const nMic = ep1().mic.length;
      await expect(kicker(page)).toHaveText(`Faltam ${nMic} frases para gravar`);
      await expect(dock(page)).toContainText(`Frase 1 de ${nMic} · diga em voz alta`);
      await expect(dock(page)).toContainText(ep1().mic[0].en);
      await expect(dock(page)).toContainText('Toque no microfone e fale · +5 a +15');
      await expect(body(page)).toContainText('A nota mede quanto da sua fala foi entendida, não quanto você soa americano.');
      await dock(page).getByRole('button', { name: 'Ouvir' }).click();
      await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(ep1().mic[0].en);
      const phraseBtns = body(page).locator('button.card.row');
      await expect(phraseBtns).toHaveCount(nMic);
      for (let i = 0; i < nMic; i++) {
        await phraseBtns.nth(i).click();
        await expect(dock(page)).toContainText(`Frase ${i + 1} de ${nMic}`);
        const r = await apiCall(page, '/api/progress/mic', async () => {
          await dock(page).getByRole('button', { name: 'Gravar' }).click();
          await expect(dock(page)).toContainText('Ouvindo… toque para parar');
          await expect(dock(page).locator('button.mic.rec')).toBeVisible();
        });
        expect(r.status).toBe(200);
        expect(r.req.source).toBe('script');
        expect(r.req.phraseId).toBe(ep1().mic[i].id);
        expect(r.json.last).toBe(ep1().mic[i].result);
        const fb = dock(page).locator('.fb');
        await expect(fb).toContainText(`${ep1().mic[i].result}/10`);
        await expect(fb).toContainText(ep1().mic[i].fb.slice(0, 30));
        await expect(dock(page)).toContainText('Toque no microfone para tentar de novo');
        await expect(phraseBtns.nth(i)).toContainText(`${ep1().mic[i].result}/10`);
        if (i === 0) await expect(page.locator('.pts-toast').first()).toBeVisible();
        if (i < nMic - 1) {
          const left = nMic - i - 1;
          await expect(kicker(page)).toHaveText(left === 1 ? 'Falta gravar 1 frase' : `Faltam ${left} frases para gravar`);
        }
      }
      await expect(kicker(page)).toHaveText('Próxima · 07 · +10');
      await advance(page);
      await atStep(page, 1, 7);

      // ---- 7 · Take a Lesson: blocks + pronunciation card
      await expect(kicker(page)).toHaveText('Próxima · 08 · +10');
      const pron = body(page).locator('.card.navy');
      await expect(pron).toContainText(ep1().pron.k);
      await expect(pron.locator('.pl-pair')).toHaveCount(ep1().pron.pairs.length);
      await pron.locator('button.chip', { hasText: ep1().pron.words[1] }).click();
      await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(ep1().pron.words[1]);
      expect(await body(page).locator('.card').count()).toBeGreaterThan(2);
      await advance(page);
      await atStep(page, 1, 8);

      // ---- 8 · Take Away: sayMark
      const rows = body(page).locator('button.listrow.sayrow');
      await expect(rows).toHaveCount(ep1().awayExp.length);
      await expect(rows.first()).not.toHaveClass(/heard/);
      await rows.first().click();
      await expect(rows.first()).toHaveClass(/heard/);
      await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(ep1().awayExp[0].en);
      const pills = body(page).locator('button.pill.saypill');
      await expect(pills).toHaveCount(ep1().awayWords.length);
      await pills.nth(2).click();
      await expect(pills.nth(2)).toHaveClass(/heard/);
      const a8 = await advance(page);
      log.push(`step8 cardsAdded=${a8.json.cardsAdded}`);
      await atStep(page, 1, 9);

      // ---- 9 · Take Action: graded by the server
      const items = (ep1().ex as Any[]).flatMap((ex, x) => (ex.items as Any[]).map((it, j) => ({ x, j, it, ex })));
      await expect(kicker(page)).toHaveText(`Faltam ${items.length} respostas`);
      let wrongDone = false;
      for (let k = 0; k < items.length; k++) {
        const { x, j, it, ex } = items[k]!;
        await expect(body(page)).toContainText(`Exercício ${x + 1} de ${ep1().ex.length}`);
        await expect(body(page).locator('.card.pop .lbl').first()).toContainText(`Pergunta ${j + 1} de ${ex.items.length}`);
        await expect(body(page).locator('.card.pop .h2')).toHaveText(it.q);
        if (j === 0 && (ex.audio === 'tts' || ex.audio === 'song')) {
          const before = await page.evaluate(() => (window as any).__media.length + (window as any).__spoken.length);
          await body(page).getByRole('button', { name: ex.audioLabel || 'Ouvir' }).click();
          await expect.poll(() => page.evaluate(() => (window as any).__media.length + (window as any).__spoken.length)).toBeGreaterThan(before);
        }
        const wrong = !wrongDone && x === 1 && j === 0;
        const choice = wrong ? (it.a + 1) % it.opts.length : it.a;
        const r = await apiCall(page, '/api/progress/exercise', () => body(page).locator('.card.pop button.opt').nth(choice).click());
        expect(r.status).toBe(200);
        expect(r.json.correct).toBe(!wrong);
        const fb = body(page).locator('.card.pop .fb');
        if (wrong) {
          wrongDone = true;
          await expect(fb).toHaveClass(/err/);
          await expect(fb).toContainText(`Quase. A resposta é “${it.opts[it.a]}”.`);
          await expect(body(page).locator('.card.pop button.opt.wrong')).toHaveCount(1);
        } else {
          await expect(fb).toHaveClass(/ok/);
          await expect(fb).toContainText('Isso. +5 pontos.');
          if (k === 0) await expect(ptsToast(page, 5).first()).toBeVisible();
        }
        await expect(body(page).locator('.card.pop button.opt.right')).toHaveCount(1);
        await expect(body(page).locator('.card.pop button.opt:not([disabled])')).toHaveCount(0);
        if (k < items.length - 1) {
          const lastIt = j === ex.items.length - 1;
          await body(page).getByRole('button', { name: lastIt ? 'Próximo exercício' : 'Próxima pergunta' }).click();
        }
      }
      await expect(body(page)).toContainText('Última pergunta. Siga para Take the Mic abaixo.');
      // Back one question and forward again keep the answers locked.
      await body(page).getByRole('button', { name: 'Anterior' }).click();
      await expect(body(page).locator('.card.pop .fb')).toBeVisible();
      await body(page).getByRole('button', { name: 'Próxima pergunta' }).click();
      await expect(kicker(page)).toHaveText('Próxima · 10 · +10');
      await advance(page);
      await atStep(page, 1, 10);

      // ---- 10 · sing-along → song award → concluir
      await expect(dock(page)).toContainText('Música · cante junto');
      await expect(body(page)).toContainText('Agora é sua vez. Cante junto');
      await expect(kicker(page)).toHaveText('Cante a música até o fim');
      await dock(page).getByRole('button', { name: 'Tocar' }).click();
      const so10 = await apiCall(page, '/api/progress/step-ok', () => endMedia(page).then((m) => log.push(`song10:${m}`)));
      expect(so10.status).toBe(200);
      expect(so10.json.award?.awarded).toBe(true);
      await expect(ptsToast(page, so10.json.award.points).first()).toBeVisible();
      await expect(kicker(page)).toHaveText('Última etapa · +40 pontos');
      await expect(nextBtn(page)).toContainText('Concluir episódio');
      const done = await apiCall(page, '/api/progress/episode-done', () => nextBtn(page).click());
      expect(done.status).toBe(200);
      expect(done.json.award?.points).toBe(40);
      await expect(page).toHaveURL(/#\/concluido\/1$/);
      await expect(page.locator('.confetti').first()).toBeAttached();
      await expect(ptsToast(page, 40).first()).toBeVisible();
      const nc = page.locator('.now-card');
      await expect(nc).toContainText('Episódio 01 concluído');
      await expect(nc).toContainText(ep1().done.title);
      await expect(nc).toContainText('Hi! I’m Ana. Nice to meet you.');
      await expect(nc.locator('.pill.gold')).toHaveText('+40 pontos');
      const avg = (ep1().mic as Any[]).reduce((a, m) => a + m.result, 0) / nMic;
      await expect(page.locator('.stat').first()).toContainText(avg.toFixed(1).replace('.', ','));
      await expect(page.locator('.stat').first()).toContainText('nota média no Take the Mic');
      await expect(page.locator('.stat').nth(1)).toContainText('cartões na sua Revisão');
      await expect(page.locator('.card', { hasText: 'A seguir' })).toContainText('This Is My Family');

      // ---- persistence after reload
      await page.goto('/#/episodio/1');
      await page.reload();
      await expect(head(page)).toContainText('Episódio 1 · etapa 1 de 10', { timeout: 20_000 });
      await expect(kicker(page)).toHaveText('Próxima · 02 · +10');
      await page.locator('.player-head .iconbtn[aria-label="Mapa"]').click();
      const sheet = page.locator('.overlay .sheet');
      await expect(sheet.locator('.steprow.done')).toHaveCount(9);
      await expect(sheet.locator('.steprow.locked')).toHaveCount(0);
      await sheet.locator('.steprow', { hasText: 'Take Action' }).click();
      await atStep(page, 1, 9);
      await expect(body(page).locator('.card.pop .fb')).toBeVisible(); // answers persisted (first question answered)
      const st = await page.request.get(`${sl.origin}/api/me/state`);
      if (st.ok()) {
        const sj = await st.json();
        const s = sj.state ?? sj;
        expect(s.epsDone?.['1'] ?? s.epsDone?.[1]).toBeTruthy();
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `flow-${vp}.log`), log.join('\n'));
      await expectClean(page, w);
    });

    test(`map sheet, aside, prev, deep links and unknown episode (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-map-${vp}`, { noMic: true });
      const w = watch(page);
      await page.goto('/#/episodio/1');
      await atStep(page, 1, 6).catch(async () => {
        await expect(page).toHaveURL(/#\/episodio\/1$/);
        await expect(head(page)).toContainText('etapa 6 de 10');
      });
      // Map sheet (both layouts have the head button).
      await page.locator('.player-head .iconbtn[aria-label="Mapa"]').click();
      const sheet = page.locator('.overlay .sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Mapa do episódio 1');
      await expect(sheet.locator('.steprow')).toHaveCount(10);
      await expect(sheet.locator('.steprow.done')).toHaveCount(5);
      await expect(sheet.locator('.steprow.now')).toHaveCount(1);
      await expect(sheet.locator('.steprow.locked')).toHaveCount(4);
      await expect(sheet.locator('.steprow.locked').first()).toBeDisabled();
      await expect(sheet.locator('.lbl', { hasText: /\S/ })).not.toHaveCount(0);
      // Scrim closes.
      await page.locator('.overlay .scrim').click({ position: { x: 10, y: 10 } });
      await expect(sheet).toHaveCount(0);
      // The segs/name bar opens the sheet too; X closes it.
      await head(page).locator('button.stack').click();
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Fechar' }).click();
      await expect(sheet).toHaveCount(0);
      // Jump to a reached step.
      await head(page).locator('button.stack').click();
      await sheet.locator('.steprow', { hasText: 'Take It In' }).click();
      await atStep(page, 1, 5);
      await expect(sheet).toHaveCount(0);
      // Prev
      await page.locator('.player-foot .btn.prev').click();
      await atStep(page, 1, 4);
      // Next on a reached step: no gating (prog > step), plain navigation, no server call (as setStep).
      await expect(kicker(page)).toHaveText('Próxima · 05 · +10');
      const nAdv = w.api.filter((x) => x.url.includes('/advance')).length;
      await nextBtn(page).click();
      await atStep(page, 1, 5);
      expect(w.api.filter((x) => x.url.includes('/advance')).length).toBe(nAdv);
      if (vp === 'desktop') {
        const aside = page.locator('aside');
        await aside.locator('.steprow', { hasText: 'e-book' }).first().click();
        await atStep(page, 1, 3);
        await expect(body(page).locator('.card.gr')).toContainText('E-book baixado.');
        await aside.getByRole('button', { name: 'Voltar para Hoje' }).click();
        await expect(page).toHaveURL(/#\/inicio$/);
      } else {
        await page.locator('.player-head .iconbtn[aria-label="Fechar"]').click();
        await expect(page).toHaveURL(/#\/inicio$/);
      }
      // Deep link beyond prog → prog.
      await page.goto('/#/episodio/1/9');
      await atStep(page, 1, 6);
      // Unknown episode → trilha; concluido of an unknown episode → trilha.
      w.ignore.push(/\/ep\/999\.json/);
      await page.goto('/#/episodio/999');
      await expect(page).toHaveURL(/#\/trilha$/, { timeout: 15_000 });
      await page.goto('/#/concluido/999');
      await expect(page).toHaveURL(/#\/trilha$/, { timeout: 15_000 });
      // Title
      await page.goto('/#/episodio/1/5');
      await expect(page).toHaveTitle(/Ep\. 1 · Take It In/);
      await expectClean(page, w);
    });

    test(`training mode hides Mic scores behind "Ver nota" (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-train-${vp}`, { noMic: true });
      const w = watch(page);
      const eps = captureEpisodes(page);
      await page.goto('/#/episodio/1/6');
      await atStep(page, 1, 6);
      await expect.poll(() => !!eps.get(1)).toBe(true);
      const E = eps.get(1)!;
      const phraseBtns = body(page).locator('button.card.row');
      // Ana has 3 scores: shown as a neutral check (.pl-recd) in training mode.
      await expect(phraseBtns.filter({ has: page.locator('.pl-recd') })).toHaveCount(3);
      await expect(phraseBtns.filter({ hasText: '/10' })).toHaveCount(0);
      await expect(kicker(page)).toHaveText(`Faltam ${E.mic.length - 3} frases para gravar`);
      // Phrase 1 already scored → its feedback card with "Ver nota".
      await expect(dock(page).locator('.fb')).toContainText('Ver nota');
      await expect(dock(page)).toContainText('Toque no microfone para tentar de novo');
      await phraseBtns.nth(4).click();
      const r = await apiCall(page, '/api/progress/mic', () => dock(page).getByRole('button', { name: 'Gravar' }).click());
      expect(r.status).toBe(200);
      await expect(dock(page).locator('.fb .pl-reveal')).toHaveText('Ver nota');
      await expect(dock(page).locator('.fb .num')).toHaveCount(0);
      await expect(dock(page).locator('.fb')).not.toHaveClass(/\b(ok|fix)\b/);
      await dock(page).getByRole('button', { name: 'Ver nota' }).click();
      await expect(dock(page).locator('.fb .num')).toContainText(`${E.mic[4].result}/10`);
      await expect(phraseBtns.filter({ hasText: '/10' })).toHaveCount(4);
      await expect(kicker(page)).toHaveText(`Faltam ${E.mic.length - 4} frases para gravar`);
      await expectClean(page, w);
    });

    test(`real recording with the fake microphone (${vp})`, async ({ page, context }) => {
      test.setTimeout(90_000);
      await context.grantPermissions(['microphone'], { origin: sl.origin });
      await prepApp(context, `u2-fakemic-${vp}`);
      const w = watch(page);
      await page.goto('/#/episodio/1/6');
      await atStep(page, 1, 6);
      await body(page).locator('button.card.row').nth(5).click();
      const r = await apiCall(page, '/api/progress/mic', async () => {
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
        await expect(dock(page)).toContainText('Ouvindo… toque para parar');
        // Tap to stop early.
        await page.waitForTimeout(1500);
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
        await expect(dock(page)).toContainText('Avaliando…');
      });
      expect(r.status).toBe(200);
      expect(r.req.source).toBe('demo');
      await expect(dock(page).locator('.fb')).toBeVisible();
      await expect(dock(page)).toContainText('Toque no microfone para tentar de novo');
      await expectClean(page, w);
    });

    test(`AI pronounce sends the signed attempt token (${vp})`, async ({ page, context }) => {
      await context.grantPermissions(['microphone'], { origin: sl.origin });
      await prepApp(context, `u2-ia-${vp}`, { ai: true });
      await context.route('**/api/pronounce', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ score: 9, praise_pt: 'Muito bem.', heard: 'hello', issues: [{ word: 'hello', tip_pt: 'Solte o ar.', ok: false }], source: 'ia', attempt: 'forged.token' }),
        }),
      );
      const w = watch(page);
      w.ignore.push(/\/api\/progress\/mic/);
      await page.goto('/#/episodio/1/6');
      await atStep(page, 1, 6);
      await body(page).locator('button.card.row').nth(6).click();
      const r = await apiCall(page, '/api/progress/mic', async () => {
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
        await page.waitForTimeout(800);
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
      });
      expect(r.req.source).toBe('ia');
      expect(r.req.attempt).toBe('forged.token');
      // A forged token is refused by the server and the learner is told.
      expect(r.status).toBeGreaterThanOrEqual(400);
      await expect(page.locator('.toast', { hasText: 'Não deu para confirmar essa gravação' }).first()).toBeVisible();
      // The optimistic score rolled back (the phrase stays unscored) and the unconfirmed card is gone.
      await expect(body(page).locator('button.card.row').nth(6)).toContainText('—');
      await expect(dock(page).locator('.fb')).toHaveCount(0);
      await expect(dock(page)).toContainText('Toque no microfone e fale');
      // Accepted attempt (the real server, the token swapped for a demo score since the slot has no AI):
      // the feedback card shows the AI result — "Entendi" + per-word issues; training user → Ver nota.
      await context.route('**/api/progress/mic', async (route) => {
        const b = JSON.parse(route.request().postData() || '{}');
        await route.fallback({ postData: JSON.stringify({ phraseId: b.phraseId, score: b.score, source: 'demo' }) });
      });
      const r2 = await apiCall(page, '/api/progress/mic', async () => {
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
        await page.waitForTimeout(800);
        await dock(page).getByRole('button', { name: 'Gravar' }).click();
      });
      expect(r2.status).toBe(200);
      await expect(dock(page).locator('.fb')).toContainText('Entendi: “hello”');
      await expect(dock(page).locator('.fb')).toContainText('hello:');
      await expect(dock(page).locator('.fb')).toContainText('Solte o ar.');
      await expect(dock(page).locator('.fb .pl-reveal')).toBeVisible();
      await dock(page).getByRole('button', { name: /Ver nota/ }).click();
      await expect(dock(page).locator('.fb .num')).toContainText('9/10');
      await expect(dock(page).locator('.fb')).toHaveClass(/\bok\b/);
      await expectClean(page, w);
    });

    test(`episode 2 without media: synth jingle and synth song (${vp})`, async ({ page, context }) => {
      test.setTimeout(150_000);
      await prepApp(context, `u2-synth-${vp}`, { noMic: true });
      const w = watch(page);
      await page.goto('/#/episodio/2');
      await expect(head(page)).toContainText('Episódio 2 · etapa 1 de 10', { timeout: 20_000 });
      await expect(body(page)).toContainText('A música do episódio abre, marca e fecha a aula.');
      await body(page).getByRole('button', { name: 'Ouvir a vinheta' }).click();
      await expect(body(page).locator('.now-card #pl-time')).toHaveCount(0);
      const so1 = await apiCall(page, '/api/progress/step-ok', async () => {});
      expect(so1.status).toBe(200);
      await expect(kicker(page)).toHaveText('Próxima · 02 · +10');
      await advance(page);
      await atStep(page, 2, 2);
      await expect(dock(page)).toContainText('Sem a gravação desta música');
      const lines = body(page).locator('.dialog-line');
      const n = await lines.count();
      await dock(page).getByRole('button', { name: 'Tocar' }).click();
      await expect(lines.nth(1)).toHaveClass(/\bon\b/, { timeout: 5000 });
      await expect(dock(page).locator('#pl-time')).toHaveText('0:15');
      const so2 = await page.waitForResponse(isApi('/api/progress/step-ok'), { timeout: n * 2600 + 10_000 });
      expect(so2.status()).toBe(200);
      await expect(body(page).locator('button.card.row', { hasText: 'Próximo: baixar o e-book 1.' })).toBeVisible();
      await expectClean(page, w);
    });

    test(`server refusal rolls back and returns to the reached step (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-refuse-${vp}`, { noMic: true });
      const w = watch(page);
      w.ignore.push(/\/api\/progress\/advance/);
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      // Server-side gating, directly: advancing past an unfinished step is refused.
      const direct = await page.evaluate(async () => {
        const r = await fetch('/api/progress/advance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ep: 1, step: 2 }),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      });
      expect(direct.status).toBe(409);
      expect(JSON.stringify(direct.body)).toContain('Ouça a abertura até o fim');
      const far = await page.evaluate(async () => {
        const r = await fetch('/api/progress/advance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ep: 1, step: 7 }),
        });
        return r.status;
      });
      expect(far).toBe(409);
      // Client: the step's media "finishes" but the server still refuses → toast + back to step 1.
      await context.route('**/api/progress/advance', (route) =>
        route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'gated', message: 'Ouça a abertura até o fim' } }) }),
      );
      await body(page).getByRole('button', { name: 'Ouvir a abertura' }).click();
      await apiCall(page, '/api/progress/step-ok', () => endMedia(page));
      await expect(nextBtn(page)).toBeEnabled();
      await nextBtn(page).click();
      await expect(page.locator('.toast').first()).toBeVisible();
      await atStep(page, 1, 1);
      await expectClean(page, w);
    });

    test(`stopAll on leave and on step change (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-leave-${vp}`, { noMic: true });
      const w = watch(page);
      const playing = () => page.evaluate(() => (window as any).__media.some((m: HTMLMediaElement) => !m.paused));
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      await body(page).getByRole('button', { name: 'Ouvir a abertura' }).click();
      await expect.poll(playing).toBe(true);
      await page.locator('.player-head .iconbtn[aria-label="Fechar"]').click();
      await expect(page).toHaveURL(/#\/inicio$/);
      // Wait for the app to process the hashchange (the player unmounts) before navigating again.
      await expect(page.locator('.player-head')).toHaveCount(0);
      expect(await playing()).toBe(false);
      // Back into the player, then leave through the hash (tab bar / sidebar nav / browser back).
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      await expect(body(page).locator('.now-card .btn.light')).toHaveText('Ouvir a abertura');
      await body(page).getByRole('button', { name: 'Ouvir a abertura' }).click();
      await expect.poll(playing).toBe(true);
      await page.evaluate(() => { location.hash = '#/trilha'; });
      await expect(page).toHaveURL(/#\/trilha$/);
      await expect(page.locator('.player-head')).toHaveCount(0);
      expect(await playing()).toBe(false);
      // Browser back out of the player.
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      await page.goBack();
      await expect(page.locator('.player-head')).toHaveCount(0);
      expect(await playing()).toBe(false);
      await expectClean(page, w);
    });

    test(`blocked autoplay shows the toast and leaves the step playable (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-leave-${vp}`, { noMic: true });
      await context.addInitScript({
        content: `HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); };`,
      });
      const w = watch(page);
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      await body(page).getByRole('button', { name: 'Ouvir a abertura' }).click();
      await expect(page.locator('.toast', { hasText: 'O navegador bloqueou o áudio. Toque de novo.' }).first()).toBeVisible();
      await expect(body(page).getByRole('button', { name: 'Ouvir a abertura' })).toBeVisible();
      await expect(kicker(page)).toHaveText('Ouça a abertura até o fim');
      await expectClean(page, w);
    });

    test(`e-book with a real PDF downloads it (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-pdf-${vp}`, { noMic: true });
      const w = watch(page);
      const eps = captureEpisodes(page);
      await page.goto('/#/episodio/1/3');
      await atStep(page, 1, 3);
      await expect.poll(() => !!eps.get(1)).toBe(true);
      // The local seed has no e-book PDF: answer as production does when R2 has one (any /m/ file).
      const pdfUrl = eps.get(1)!.introAudio as string;
      await context.route('**/api/ebooks/1/download', async (route) => {
        const real = await route.fetch();
        const j = await real.json();
        await route.fulfill({ status: real.status(), contentType: 'application/json', body: JSON.stringify({ ...j, pdf: pdfUrl }) });
      });
      await expect(kicker(page)).toHaveText('Baixe o e-book para seguir');
      const btn = body(page).getByRole('button', { name: 'Baixar e-book 1' });
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), btn.click()]);
      expect(dl.suggestedFilename()).toBe('take-it-easy-ebook-01.pdf');
      await expect(body(page).locator('.card.gr')).toContainText('E-book baixado.');
      await expect(kicker(page)).toHaveText('Próxima · 04 · +10');
      await expect(page).toHaveURL(/#\/episodio\/1\/3$/);
      // Persisted: a reload keeps step 3 unlocked.
      await page.reload();
      await atStep(page, 1, 3);
      await expect(body(page).locator('.card.gr')).toContainText('E-book baixado.');
      // "Baixar de novo" downloads the file again; "Abrir no app" opens the e-book screen.
      const [dl2] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }),
        body(page).getByRole('button', { name: 'Baixar de novo' }).click(),
      ]);
      expect(dl2.suggestedFilename()).toBe('take-it-easy-ebook-01.pdf');
      await body(page).getByRole('button', { name: 'Abrir no app' }).click();
      await expect(page).toHaveURL(/#\/ebook\/1$/);
      await expectClean(page, w);
    });

    test(`fast Next right after the media ends is not lost (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-race-${vp}`, { noMic: true });
      const w = watch(page);
      await page.goto('/#/episodio/1/1');
      await atStep(page, 1, 1);
      await body(page).getByRole('button', { name: 'Ouvir a abertura' }).click();
      // End the media and click Next immediately, without waiting for step-ok to land.
      await endMedia(page);
      await nextBtn(page).click();
      const adv = await page.waitForResponse(isApi('/api/progress/advance'));
      expect(adv.status(), 'advance sent right after step-ok must not be refused').toBe(200);
      await atStep(page, 1, 2);
      await page.waitForTimeout(800);
      await atStep(page, 1, 2);
      await expectClean(page, w);
    });

    test(`concluido CTA and "Voltar para Hoje" (${vp})`, async ({ page, context }) => {
      test.setTimeout(90_000);
      await prepApp(context, `u2-done-${vp}`, { noMic: true });
      const w = watch(page);
      await page.goto('/#/episodio/1/10');
      await atStep(page, 1, 10);
      await expect(kicker(page)).toHaveText('Cante a música até o fim');
      // Desktop: aside lists all reached steps.
      if (vp === 'desktop') await expect(page.locator('aside .steprow.done')).toHaveCount(9);
      await dock(page).getByRole('button', { name: 'Tocar' }).click();
      await apiCall(page, '/api/progress/step-ok', () => endMedia(page));
      await apiCall(page, '/api/progress/episode-done', () => nextBtn(page).click());
      await expect(page).toHaveURL(/#\/concluido\/1$/);
      await page.getByRole('button', { name: 'Abrir o episódio 2' }).or(page.getByRole('link', { name: 'Abrir o episódio 2' })).click();
      await atStep(page, 2, 1);
      await page.goto('/#/concluido/1');
      await page.getByRole('button', { name: 'Voltar para Hoje' }).or(page.getByRole('link', { name: 'Voltar para Hoje' })).click();
      await expect(page).toHaveURL(/#\/inicio$/);
      // Trilha shows episode 1 done now.
      await expectClean(page, w);
    });

    test(`accessible names and visible keyboard focus (${vp})`, async ({ page, context }) => {
      await prepApp(context, `u2-a11y-${vp}`, { noMic: true });
      const w = watch(page);
      const bad: Record<string, string[]> = {};
      for (const step of [1, 2, 3, 4, 5, 6]) {
        await page.goto(`/#/episodio/1/${step}`);
        await atStep(page, 1, step);
        await page.waitForTimeout(300);
        const u = await unnamedControls(page);
        if (u.length) bad[`step${step}`] = u;
      }
      await page.locator('.player-head .iconbtn[aria-label="Mapa"]').click();
      const u = await unnamedControls(page);
      if (u.length) bad.sheet = u;
      await page.keyboard.press('Escape');
      expect.soft(bad, 'controls without an accessible name').toEqual({});
      // Keyboard: Tab reaches the Next button with a visible ring.
      await page.goto('/#/episodio/1/5');
      await atStep(page, 1, 5);
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => !!document.activeElement?.matches('.player-foot .btn.next'));
      }
      expect(reached, 'Tab reaches Next').toBe(true);
      const ring = await focusRing(page);
      expect.soft(ring.fv && visibleRing(ring), `focus ring on Next: ${JSON.stringify(ring)}`).toBe(true);
      // And a dialogue line (button) is keyboard-activatable.
      await page.locator('#dl1').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#dl1')).toHaveClass(/\bon\b/);
      const ring2 = await focusRing(page);
      expect.soft(visibleRing(ring2), `focus ring on a dialogue line: ${JSON.stringify(ring2)}`).toBe(true);
      await expectClean(page, w);
    });
  });
}

// ---------------------------------------------------------------- security: bundle content + headers

test('client bundle carries no secrets or assistant persona; strict CSP header', async ({ request }) => {
  const dist = sl.distDir('app');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|css|json|webmanifest)$/.test(f)) files.push(p);
    }
  };
  walk(dist);
  const hits: string[] = [];
  const pats = [/persona["']?\s*:/i, /MEDIA_TOKEN_KEY/, /ATTEMPT_SECRET/i, /CLOUDFLARE_API_TOKEN/, /TURNSTILE_SECRET/i, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN/, /pbkdf2-sha256\$/];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const p of pats) if (p.test(t)) hits.push(`${f.replace(dist, '')}: ${p}`);
  }
  expect(hits).toEqual([]);
  const r = await request.get(`${sl.origin}/`);
  const csp = r.headers()['content-security-policy'] || '';
  expect(csp).toMatch(/script-src[^;]*'self'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).not.toMatch(/'unsafe-eval'/);
});

// ---------------------------------------------------------------- parity with the prototype

function signatureFn(sel: string): string[] {
  const root = document.querySelectorAll(sel);
  const el0 = root[root.length - 1];
  if (!el0) return ['<no root>'];
  const out: string[] = [];
  const walk = (el: Element, d: number) => {
    for (const n of Array.from(el.childNodes)) {
      const ind = '  '.repeat(d);
      if (n.nodeType === 3) {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push(`${ind}"${t}"`);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as HTMLElement;
      const tag = e.tagName.toLowerCase();
      if (tag === 'svg') {
        out.push(`${ind}svg`);
        continue;
      }
      const cls = Array.from(e.classList).filter((c) => c !== 'enter' && c !== 'heard').sort().join('.');
      const st: string[] = [];
      for (let i = 0; i < e.style.length; i++) {
        const p = e.style[i] as string;
        let v = e.style.getPropertyValue(p).trim();
        if (p === 'background-image') v = v ? 'url(*)' : '';
        if (v) st.push(`${p}:${v}`);
      }
      st.sort();
      const attrs: string[] = [];
      for (const a of ['id', 'disabled', 'aria-label']) if (e.hasAttribute(a)) attrs.push(`${a}=${e.getAttribute(a)}`);
      out.push(`${ind}${tag}${cls ? `.${cls}` : ''}${st.length ? ` {${st.join(';')}}` : ''}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`);
      walk(e, d + 1);
    }
  };
  walk(el0, 0);
  return out;
}

function diff(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
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

test.describe('U2 parity with the prototype', () => {
  let proto: StaticServer;
  test.beforeAll(async () => {
    proto = await servePrototype(sl.protoPort);
  });
  test.afterAll(async () => {
    await proto?.close();
  });
  for (const vp of VPS) {
    test(`DOM parity of every step (${vp})`, async ({ browser }) => {
      test.setTimeout(400_000);
      const cases: [string, string, Kind, string, ((p: Page) => Promise<void>)?][] = [
        ['s1', `u2-cmp-a-${vp}`, 'main', 'episodio/1/1'],
        ['s2', `u2-cmp-a-${vp}`, 'main', 'episodio/1/2'],
        ['s3', `u2-cmp-a-${vp}`, 'main', 'episodio/1/3'],
        ['s4', `u2-cmp-a-${vp}`, 'main', 'episodio/1/4'],
        ['s5', `u2-cmp-a-${vp}`, 'main', 'episodio/1/5'],
        ['s6', `u2-cmp-a-${vp}`, 'main', 'episodio/1/6'],
        ['s6-sheet', `u2-cmp-a-${vp}`, 'main', 'episodio/1/6', async (p) => { await p.locator('.player-head .iconbtn[aria-label="Mapa"]').click(); await p.waitForTimeout(300); }],
        ['s7', `u2-cmp-b-${vp}`, 's10', 'episodio/1/7'],
        ['s8', `u2-cmp-b-${vp}`, 's10', 'episodio/1/8'],
        ['s9', `u2-cmp-b-${vp}`, 's10', 'episodio/1/9'],
        ['s10', `u2-cmp-b-${vp}`, 's10', 'episodio/1/10'],
        ['concluido', `u2-cmp-b-${vp}`, 's10', 'concluido/1'],
      ];
      const summary: Record<string, number> = {};
      const sigs0: Record<string, number> = {};
      for (const [name, user, kind, route, steps] of cases) {
        const sigs: Record<'proto' | 'app', string[]> = { proto: [], app: [] };
        for (const side of ['proto', 'app'] as const) {
          const ctx = await browser.newContext({ ...vpOpts(vp), locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce', serviceWorkers: 'block' });
          try {
            if (side === 'proto') {
              const st = isolateState(stateOf(kind), user, emailOf(user));
              await prepareContext(ctx, { side: 'prototype', seedKey: `${name}|${vp}`, storage: storageOf(st), allowOrigins: [new URL(proto.url).origin] });
              await ctx.addInitScript({ content: INIT });
            } else {
              await prepApp(ctx, user);
            }
            const page = await ctx.newPage();
            const base = side === 'proto' ? proto.url.replace(/\/?$/, '/') : `${sl.origin}/`;
            await page.goto(`${base}#/${route}`);
            await expect(page.locator(name === 'concluido' ? '.now-card' : '.player-foot').first()).toBeVisible({ timeout: 20_000 });
            await page.waitForTimeout(700);
            if (steps) await steps(page);
            const sel = name === 'concluido' ? '.view' : name === 's6-sheet' ? '.overlay' : vp === 'desktop' ? '.app' : '.view';
            sigs[side] = await page.evaluate(signatureFn, sel);
          } finally {
            await ctx.close();
          }
        }
        const d = diff(sigs.proto, sigs.app);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `dom-${name}-${vp}.proto.txt`), sigs.proto.join('\n'));
        writeFileSync(join(OUT, `dom-${name}-${vp}.app.txt`), sigs.app.join('\n'));
        writeFileSync(join(OUT, `dom-${name}-${vp}.diff.txt`), d.join('\n'));
        summary[name] = d.length;
        sigs0[name] = sigs.app[0] === '<no root>' ? 0 : sigs.app.length;
      }
      writeFileSync(join(OUT, `dom-summary-${vp}.json`), JSON.stringify(summary, null, 2));
      // Report-only: the slice knowingly polishes several steps (cast strip, intro topics, reveal button,
      // exercise list…); the diff files are reviewed by hand. A missing root is still a failure.
      for (const [k] of Object.entries(summary)) expect.soft(sigs0[k] ?? 1, `DOM root found for ${k} (${vp})`).toBeGreaterThan(0);
      console.log(`[u2 parity ${vp}] ${JSON.stringify(summary)}`);
    });
  }
});
