// Performance + PWA audit of the student app against a seeded `wrangler dev` (default port 8602).
// Lighthouse is not a dependency of the repo, so this measures the same things with Playwright and the
// Chrome DevTools Protocol, under Lighthouse's mobile settings (412×823 @1.75, 4× CPU, "Slow 4G"
// applied throttling: 562.5 ms request latency, 1.44 Mbps down, 0.59 Mbps up), each URL cold
// (fresh profile, empty caches):
//   - performance: FCP, LCP, CLS, TBT (long tasks after FCP until the page is quiet), transfer bytes,
//     and a Lighthouse-style score from those four metrics (v10+ mobile curves and weights; Speed Index
//     is not measured, so its 10 % weight is spread over the others);
//   - accessibility: a subset of the Lighthouse/axe audits that can run without axe-core (lang, title,
//     zoomable viewport, names of buttons/links/images/fields from the accessibility tree, duplicate
//     ids, positive tabindex, text contrast against the resolved solid background);
//   - best practices: console errors, uncaught exceptions, CSP violations, Chrome issues;
//   - PWA: Chrome's own installability check (Page.getInstallabilityErrors), the manifest, the SW
//     controlling the page, the offline shell (reload offline), and a visited episode's content JSON
//     and media served from the SW caches while offline;
//   - cache headers of the shell, hashed assets, sw.js, content and media.
//
//   npm run perf -w @tie/parity -- [--skip-build] [--runs 3] [--port 8602] [--out <file.json>] [--dist <dir>]
//                                     [--profile applied|rtt150]
//
// Builds apps/app into dist/web-perf (with the service worker), seeds .wrangler/perf-<port>, applies the
// parity fixture users, runs, writes tools/parity/out/perf/report-<port>.json and stops the server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, type CDPSession, chromium, type Page } from '@playwright/test';
import { APP_DIRS, FROZEN_MS, OUT_ROOT, type Slot } from './config';
import { detectChannel, TSX_HELPERS } from './determinism';
import { buildFixtureSql } from './fixture/sql';
import { loadFixture } from './fixture/state';
import { binOf, killAll, runNode } from './proc';
import { applyFixtures, seedSlot } from './seedSlot';
import { ensureDevVars, startDevServer } from './wranglerDev';

// ---------- Options ----------

interface Opts {
  port: number;
  runs: number;
  skipBuild: boolean;
  out: string | null;
  /** Serve another build (implies --skip-build), e.g. a baseline for before/after numbers. */
  dist: string | null;
  profile: Profile;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { port: 8602, runs: 3, skipBuild: false, out: null, dist: null, profile: 'applied' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--runs') o.runs = Math.max(1, Number(argv[++i]));
    else if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--out') o.out = argv[++i] ?? null;
    else if (a === '--profile') {
      const p = argv[++i] ?? '';
      if (!(p in PROFILES)) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`);
      o.profile = p as Profile;
    } else if (a === '--dist') {
      o.dist = resolve(argv[++i] ?? '');
      o.skipBuild = true;
    } else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** A slot-like environment on an arbitrary port (slots are 0..99 on 8200+N). */
function perfSlot(port: number, dist: string | null): Slot {
  const persistRel = `.wrangler/perf-${port}`;
  const n = port - 8200;
  return {
    n,
    protoPort: 0,
    appPort: port,
    inspectorPort: port + 1000,
    persistRel,
    persistAbs: join(APP_DIRS.app, persistRel),
    genDir: (app) => join(OUT_ROOT, 'slots', `slot${n}`, app),
    distDir: (app) => dist ?? join(APP_DIRS[app], 'dist', 'web-perf'),
    origin: `http://localhost:${port}`,
    protoOrigin: '',
  };
}

// ---------- Lighthouse-style scoring ----------

/** Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7), as precise as the score needs. */
function erf(x: number): number {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}

/** Lighthouse's log-normal metric score (lighthouse-core/lib/statistics.js getLogNormalScore). */
function logNormalScore(p10: number, median: number, value: number): number {
  if (value <= 0) return 1;
  const INVERSE_ERFC_ONE_FIFTH = 0.9061938024368232;
  const xLogRatio = Math.log(Math.max(Number.MIN_VALUE, value / median));
  const p10LogRatio = -Math.log(Math.max(Number.MIN_VALUE, p10 / median));
  const standardizedX = (xLogRatio * INVERSE_ERFC_ONE_FIFTH) / p10LogRatio;
  const score = (1 - erf(standardizedX)) / 2;
  return Math.min(1, Math.max(0, score));
}

/** Lighthouse v10+ mobile curves and weights (SI not measured: weights renormalized over the rest). */
const CURVES = {
  fcp: { p10: 1800, median: 3000, weight: 10 },
  lcp: { p10: 2500, median: 4000, weight: 25 },
  tbt: { p10: 200, median: 600, weight: 30 },
  cls: { p10: 0.1, median: 0.25, weight: 25 },
} as const;

interface PerfMetrics {
  fcp: number;
  lcp: number;
  lcpEl: string;
  /** Resource timings of the run (start-end ms, initiator, path). */
  waterfall: string[];
  cls: number;
  tbt: number;
  longTasks: number;
  domContentLoaded: number;
  load: number;
  transferBytes: number;
  requests: number;
  jsTransferBytes: number;
  score: number;
}

function perfScore(m: Pick<PerfMetrics, 'fcp' | 'lcp' | 'cls' | 'tbt'>): number {
  let sum = 0;
  let weights = 0;
  for (const [k, c] of Object.entries(CURVES) as [keyof typeof CURVES, (typeof CURVES)[keyof typeof CURVES]][]) {
    sum += logNormalScore(c.p10, c.median, m[k]) * c.weight;
    weights += c.weight;
  }
  return Math.round((sum / weights) * 100);
}

// ---------- Browser ----------

const MOBILE = {
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
} as const;

/**
 * Network profiles, both with 4x CPU:
 * - applied: Lighthouse's devtools preset mobileSlow4G (562.5 ms per request: 150 ms RTT × 3.75 for a
 *   new connection's handshakes, applied to every request). Pessimistic here: wrangler dev speaks
 *   HTTP/1.1 (6 connections), production HTTP/2+ on one warm connection;
 * - rtt150: the RTT and throughput Lighthouse's default (simulated) mode models, applied per request.
 */
const PROFILES = {
  applied: { latency: 562.5, down: 1474.56, up: 607.5 },
  rtt150: { latency: 150, down: 1638.4, up: 675 },
} as const;
type Profile = keyof typeof PROFILES;
let profile: Profile = 'applied';

async function throttle(cdp: CDPSession): Promise<void> {
  const p = PROFILES[profile];
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: p.latency,
    downloadThroughput: (p.down * 1024) / 8,
    uploadThroughput: (p.up * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

/** Observers installed before any page script: paint/LCP/CLS/long tasks and CSP reports. */
const OBSERVERS = `(() => {
  const w = window;
  w.__perf = { lcp: 0, cls: 0, longTasks: [] };
  w.__csp = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { w.__perf.lcp = Math.max(w.__perf.lcp, e.renderTime || e.loadTime || e.startTime); w.__perf.lcpEl = (e.element ? e.element.tagName.toLowerCase() + '.' + String(e.element.className).split(' ')[0] : '') + (e.url ? ' ' + e.url.split('/').pop() : ''); } })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) w.__perf.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__perf.longTasks.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
  document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + e.sourceFile + ':' + e.lineNumber));
})();`;

interface PageWatch {
  consoleErrors: string[];
  pageErrors: string[];
  issues: string[];
  requests: { url: string; status: number; fromSw: boolean; bytes: number; type: string }[];
}

function watch(page: Page, cdp: CDPSession | null): PageWatch {
  const w: PageWatch = { consoleErrors: [], pageErrors: [], issues: [], requests: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => w.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('response', (r) => {
    w.requests.push({
      url: r.url(),
      status: r.status(),
      fromSw: r.fromServiceWorker(),
      bytes: 0,
      type: r.request().resourceType(),
    });
  });
  if (cdp) {
    void cdp.send('Audits.enable').catch(() => {});
    cdp.on('Audits.issueAdded', (e: { issue: { code: string; details: unknown } }) => {
      w.issues.push(`${e.issue.code} ${JSON.stringify(e.issue.details).slice(0, 300)}`);
    });
  }
  return w;
}

async function quiet(page: Page, ms = 2500, max = 30_000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: max }).catch(() => {});
  await page.waitForTimeout(ms);
}

// ---------- Performance (cold, throttled) ----------

async function measureLoad(
  ctxFactory: () => Promise<BrowserContext>,
  url: string,
  ready: (page: Page) => Promise<void>,
): Promise<PerfMetrics & { watch: PageWatch }> {
  const ctx = await ctxFactory();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await throttle(cdp);
  const w = watch(page, cdp);
  let transferBytes = 0;
  let jsTransferBytes = 0;
  let requests = 0;
  const types = new Map<string, string>();
  cdp.on('Network.responseReceived', (e: { requestId: string; type: string }) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    requests++;
    transferBytes += e.encodedDataLength;
    if (types.get(e.requestId) === 'Script') jsTransferBytes += e.encodedDataLength;
  });
  await page.addInitScript(OBSERVERS);
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await ready(page);
  await quiet(page, 5000, 60_000);
  const m = await page.evaluate(() => {
    const w = window as unknown as {
      __perf: { lcp: number; lcpEl?: string; cls: number; longTasks: [number, number][] };
    };
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const tbt = w.__perf.longTasks.filter(([start]) => start >= fcp).reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
    return {
      fcp,
      lcp: w.__perf.lcp || fcp,
      lcpEl: w.__perf.lcpEl ?? '',
      cls: w.__perf.cls,
      tbt,
      longTasks: w.__perf.longTasks.length,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      load: nav?.loadEventEnd ?? 0,
      waterfall: [
        `${Math.round(nav?.requestStart ?? 0)}-${Math.round(nav?.responseEnd ?? 0)} document`,
        ...(performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(
          (e) =>
            `${Math.round(e.startTime)}-${Math.round(e.responseEnd)} ${e.initiatorType} ${new URL(e.name).pathname}${new URL(e.name).search}`,
        ),
      ],
    };
  });
  await ctx.close();
  const metrics = { ...m, transferBytes, jsTransferBytes, requests };
  return { ...metrics, score: perfScore(metrics), watch: w };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

// ---------- Accessibility subset ----------

interface A11yResult {
  failures: string[];
  checks: number;
}

async function a11y(page: Page, cdp: CDPSession): Promise<A11yResult> {
  const failures: string[] = [];
  const dom = await page.evaluate(() => {
    const out: string[] = [];
    const html = document.documentElement;
    if (!html.lang) out.push('html-has-lang: <html> has no lang');
    if (!document.title.trim()) out.push('document-title: empty <title>');
    const vp = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
    if (/user-scalable\s*=\s*(no|0)/i.test(vp)) out.push('meta-viewport: user-scalable=no');
    const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(vp);
    if (max && Number(max[1]) < 5) out.push(`meta-viewport: maximum-scale=${max[1]}`);
    const ids = new Map<string, number>();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    for (const [id, n] of ids) if (n > 1) out.push(`duplicate-id: #${id} ×${n}`);
    for (const el of document.querySelectorAll('[tabindex]')) {
      if (Number(el.getAttribute('tabindex')) > 0)
        out.push(`tabindex: positive tabindex on <${el.tagName.toLowerCase()}>`);
    }
    for (const img of document.querySelectorAll('img')) {
      if (!img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation') {
        out.push(`image-alt: <img src=${(img.getAttribute('src') ?? '').slice(0, 60)}> has no alt`);
      }
    }
    // Text contrast against the first solid background up the tree (skipped over images/gradients).
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = (m[1] as string)
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r as number) + 0.7152 * f(g as number) + 0.0722 * f(b as number);
    };
    const bgOf = (el: Element | null): [number, number, number] | 'complex' => {
      let layers: [number, number, number, number][] = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none') return 'complex';
        const c = parse(cs.backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      layers = layers.reverse();
      let acc: [number, number, number] = [255, 255, 255];
      for (const [r, g, b, a] of layers)
        acc = [r * a + acc[0] * (1 - a), g * a + acc[1] * (1 - a), b * a + acc[2] * (1 - a)];
      return acc;
    };
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden=true], [disabled], button:disabled')) continue;
      const fg = parse(cs.color);
      const bg = bgOf(el);
      if (!fg || bg === 'complex') continue;
      const fgBlend: [number, number, number] = [
        fg[0] * fg[3] + bg[0] * (1 - fg[3]),
        fg[1] * fg[3] + bg[1] * (1 - fg[3]),
        fg[2] * fg[3] + bg[2] * (1 - fg[3]),
      ];
      const [l1, l2] = [lum(fgBlend), lum(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = Number.parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio + 0.01 < need) {
        const key = `${text.slice(0, 40)}|${ratio.toFixed(2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(
            `color-contrast: "${text.slice(0, 40)}" ${ratio.toFixed(2)}:1 < ${need}:1 (${cs.color} on rgb(${bg.map(Math.round).join(',')}), ${size}px)`,
          );
        }
      }
    }
    return out;
  });
  failures.push(...dom);

  // Names from Chrome's accessibility tree (what assistive tech gets).
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: { ignored: boolean; role?: { value: string }; name?: { value: string }; backendDOMNodeId?: number }[];
  };
  const NEEDS_NAME = new Set([
    'button',
    'link',
    'textbox',
    'combobox',
    'checkbox',
    'radio',
    'slider',
    'switch',
    'img',
    'menuitem',
    'tab',
    'searchbox',
    'spinbutton',
    'listbox',
  ]);
  let named = 0;
  for (const n of nodes) {
    const role = n.role?.value ?? '';
    if (n.ignored || !NEEDS_NAME.has(role)) continue;
    named++;
    if (!(n.name?.value ?? '').trim())
      failures.push(`${role}-name: a ${role} without an accessible name (backend node ${n.backendDOMNodeId})`);
  }
  return { failures, checks: 6 + named };
}

// ---------- PWA ----------

async function pwaChecks(
  newCtx: () => Promise<BrowserContext>,
  origin: string,
  token: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // 1. Signed out: installability, SW, offline shell.
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${origin}/#/entrar`, { waitUntil: 'load' });
    out.swActive = await page.evaluate(async () => {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((r) => setTimeout(() => r(null), 20_000)),
      ]);
      return Boolean(reg?.active);
    });
    await page.reload({ waitUntil: 'load' });
    out.swControlling = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[] };
    out.manifestUrl = manifest.url;
    out.manifestErrors = manifest.errors.map((e) => e.message);
    const inst = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
    out.installabilityErrors = inst.installabilityErrors.map((e) => e.errorId);
    out.installable = inst.installabilityErrors.length === 0;
    const precached = await page.evaluate(async () => {
      const names = await caches.keys();
      const pre = names.find((n) => n.includes('precache'));
      return { caches: names, precacheEntries: pre ? (await (await caches.open(pre)).keys()).length : 0 };
    });
    Object.assign(out, precached);

    const w = watch(page, null);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' }).catch((e) => (out.offlineReloadError = String(e)));
    await page.waitForSelector('#stage > *', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    out.offlineShell = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      return {
        rendered: Boolean(stage && stage.children.length > 0 && !stage.querySelector('.noscript')),
        text: (stage?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
      };
    });
    out.offlineShellRequests = w.requests.map(
      (r) => `${r.status} ${r.fromSw ? 'sw' : 'net'} ${new URL(r.url).pathname}`,
    );
    await ctx.close();
  }

  // 2. Signed in: visit an episode online, then reload it offline.
  {
    const ctx = await newCtx();
    await ctx.addCookies([{ name: 'tie_s', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await ctx.newPage();
    await page.goto(`${origin}/#/inicio`, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' });
    await quiet(page, 1500);
    const online = watch(page, null);
    await page.goto(`${origin}/#/episodio/1/1`, { waitUntil: 'load' });
    await quiet(page, 4000);
    // Let the media elements fetch what they show (posters, images, the start of a video).
    out.episodeOnline = {
      content: online.requests
        .filter((r) => r.url.includes('/api/content/'))
        .map((r) => `${r.status} ${new URL(r.url).pathname}`),
      media: online.requests
        .filter((r) => r.url.includes('/m/'))
        .map((r) => `${r.status} ${r.type} ${new URL(r.url).pathname}`),
    };
    out.cachesAfterVisit = await page.evaluate(async () => {
      const res: Record<string, string[]> = {};
      for (const n of await caches.keys()) {
        if (n.includes('precache')) continue;
        res[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname);
      }
      return res;
    });
    const off = watch(page, null);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' }).catch((e) => (out.offlineEpisodeReloadError = String(e)));
    await quiet(page, 4000, 10_000);
    out.episodeOffline = {
      rendered: await page.evaluate(() => {
        const stage = document.getElementById('stage');
        return (stage?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200);
      }),
      media: await page.evaluate(() =>
        [...document.querySelectorAll('video, audio, img')].map((el) => {
          if (el instanceof HTMLMediaElement)
            return `${el.tagName.toLowerCase()} readyState=${el.readyState} ${el.currentSrc.slice(-60)}`;
          const img = el as HTMLImageElement;
          return `img ${img.complete && img.naturalWidth > 0 ? 'loaded' : 'broken'} ${img.currentSrc.slice(-60)}`;
        }),
      ),
      requests: off.requests.map((r) => `${r.status} ${r.fromSw ? 'sw' : 'net'} ${r.type} ${new URL(r.url).pathname}`),
    };
    await ctx.close();
  }
  return out;
}

// ---------- Cache headers ----------

async function headerChecks(origin: string, token: string): Promise<Record<string, Record<string, string | number>>> {
  const html = await (await fetch(`${origin}/`)).text();
  const entry = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const css = /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
  const font = /href="(\/assets\/[^"]+\.woff2)"/.exec(html)?.[1];
  const cookie = `tie_s=${token}`;
  const me = await fetch(`${origin}/api/me/state`, { headers: { cookie } });
  const setCookie = me.headers.getSetCookie?.() ?? [];
  const mediaCookie = setCookie.map((c) => c.split(';')[0]).filter((c) => c?.startsWith('tie_m='));
  const state = (await me.json()) as { contentVersion?: string };
  const manifest = await fetch(`${origin}/api/content/manifest`, { headers: { cookie } });
  const mf = (await manifest.clone().json()) as { version?: string };
  const ver = state.contentVersion ?? mf.version;
  const allCookies = [cookie, ...mediaCookie].join('; ');
  const ep = ver ? await fetch(`${origin}/api/content/v/${ver}/ep/1.json`, { headers: { cookie: allCookies } }) : null;
  const epText = ep ? await ep.clone().text() : '';
  const media = /"(\/m\/media\/[^"]+\.(?:webp|jpg|png|mp4|mp3|webm))"/.exec(epText)?.[1];
  const targets: Record<string, [string, Record<string, string>]> = {
    '/': ['/', {}],
    '/index.html': ['/index.html', {}],
    'SPA fallback /x': ['/does-not-exist', {}],
    '/sw.js': ['/sw.js', {}],
    '/manifest.webmanifest': ['/manifest.webmanifest', {}],
    'entry JS': [entry ?? '', {}],
    'entry CSS': [css ?? '', {}],
    font: [font ?? '', {}],
    '/icons/icon-192.png': ['/icons/icon-192.png', {}],
    '/img/login.webp': ['/img/login.webp', {}],
    '/api/me/state': ['/api/me/state', { cookie }],
    '/api/content/manifest': ['/api/content/manifest', { cookie }],
    'content ep/1.json': [ver ? `/api/content/v/${ver}/ep/1.json` : '', { cookie: allCookies }],
    'media (from ep 1)': [media ?? '', { cookie: allCookies }],
  };
  const res: Record<string, Record<string, string | number>> = {};
  for (const [label, [path, headers]] of Object.entries(targets)) {
    if (!path) {
      res[label] = { error: 'not found in the page/content' };
      continue;
    }
    const r = await fetch(origin + path, { headers: { 'accept-encoding': 'br, gzip', ...headers } });
    res[label] = {
      path,
      status: r.status,
      'cache-control': r.headers.get('cache-control') ?? '',
      etag: r.headers.get('etag') ?? '',
      'content-type': r.headers.get('content-type') ?? '',
      'content-encoding': r.headers.get('content-encoding') ?? '',
    };
    await r.arrayBuffer();
  }
  return res;
}

// ---------- Main ----------

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const sl = perfSlot(o.port, o.dist);
  profile = o.profile;
  const log = (m: string) => console.log(`[perf] ${m}`);
  ensureDevVars('app');
  if (!o.skipBuild) {
    log('build: vite build --outDir dist/web-perf');
    await runNode(binOf('vite', join('bin', 'vite.js')), ['build', '--outDir', 'dist/web-perf'], {
      cwd: APP_DIRS.app,
      tag: null,
    });
  }
  await seedSlot(sl, { log });
  const fixtures = buildFixtureSql(loadFixture(), FROZEN_MS, []);
  await applyFixtures(sl, fixtures, log);
  const main = fixtures.users.find((u) => u.key === 'main');
  if (!main) throw new Error('fixture user "main" missing');
  log(`wrangler dev on ${sl.origin}…`);
  const dev = await startDevServer({ app: 'app', slot: sl, clockAnchor: Date.now() });
  const browser = await chromium.launch({ channel: detectChannel(), headless: process.env.PARITY_HEADED !== '1' });
  try {
    const newCtx = async () => {
      const ctx = await browser.newContext({ ...MOBILE, serviceWorkers: 'allow' });
      // tsx compiles the page.evaluate callbacks with esbuild's __name helper.
      await ctx.addInitScript(TSX_HELPERS);
      return ctx;
    };
    const signedIn = async () => {
      const ctx = await newCtx();
      await ctx.addCookies([{ name: 'tie_s', value: main.token, url: sl.origin, httpOnly: true, sameSite: 'Lax' }]);
      return ctx;
    };
    const pages = [
      { id: 'entrar', url: `${sl.origin}/#/entrar`, ctx: newCtx, ready: '.app, form, input' },
      { id: 'inicio', url: `${sl.origin}/#/inicio`, ctx: signedIn, ready: '.app .scroll' },
    ];
    const report: Record<string, unknown> = {
      origin: sl.origin,
      runs: o.runs,
      profile: o.profile,
      at: new Date().toISOString(),
    };
    for (const p of pages) {
      const runs: (PerfMetrics & { watch: PageWatch })[] = [];
      for (let i = 0; i < o.runs; i++) {
        runs.push(
          await measureLoad(p.ctx, p.url, async (page) => {
            await page.waitForSelector(p.ready, { timeout: 60_000 }).catch(() => {});
          }),
        );
        log(
          `${p.id} run ${i + 1}: score ${runs[i]?.score} FCP ${Math.round(runs[i]?.fcp ?? 0)} LCP ${Math.round(runs[i]?.lcp ?? 0)} TBT ${Math.round(runs[i]?.tbt ?? 0)} CLS ${(runs[i]?.cls ?? 0).toFixed(3)}`,
        );
      }
      const pick = (k: keyof PerfMetrics) => median(runs.map((r) => r[k] as number));
      const perf = {
        score: pick('score'),
        fcp: Math.round(pick('fcp')),
        lcp: Math.round(pick('lcp')),
        tbt: Math.round(pick('tbt')),
        cls: Number(pick('cls').toFixed(4)),
        longTasks: pick('longTasks'),
        load: Math.round(pick('load')),
        transferKB: Number((pick('transferBytes') / 1000).toFixed(1)),
        jsTransferKB: Number((pick('jsTransferBytes') / 1000).toFixed(1)),
        requests: pick('requests'),
        scores: runs.map((r) => r.score),
        lcpElement: runs[0]?.lcpEl ?? '',
        waterfall: runs[0]?.waterfall ?? [],
      };
      // Accessibility + best practices on an unthrottled load.
      const ctx = await p.ctx();
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const w = watch(page, cdp);
      await page.addInitScript(OBSERVERS);
      await page.goto(p.url, { waitUntil: 'load' });
      await page.waitForSelector(p.ready, { timeout: 30_000 }).catch(() => {});
      await quiet(page, 2000);
      const a = await a11y(page, cdp);
      const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
      await ctx.close();
      report[p.id] = {
        performance: perf,
        accessibility: a,
        bestPractices: {
          consoleErrors: w.consoleErrors,
          pageErrors: w.pageErrors,
          cspViolations: csp,
          chromeIssues: w.issues,
          failedRequests: w.requests
            .filter((r) => r.status >= 400)
            .map((r) => `${r.status} ${new URL(r.url).pathname}`),
        },
      };
      log(
        `${p.id}: perf ${perf.score} (median of ${perf.scores.join('/')}), a11y failures ${a.failures.length}, console errors ${w.consoleErrors.length}`,
      );
    }
    log('PWA checks…');
    // A real profile: Chrome reports every incognito context as not installable (in-incognito).
    const profiles: string[] = [];
    const persistentCtx = async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tie-perf-'));
      profiles.push(dir);
      const ctx = await chromium.launchPersistentContext(dir, {
        ...MOBILE,
        serviceWorkers: 'allow',
        channel: detectChannel(),
        headless: process.env.PARITY_HEADED !== '1',
      });
      await ctx.addInitScript(TSX_HELPERS);
      return ctx;
    };
    try {
      report.pwa = await pwaChecks(persistentCtx, sl.origin, main.token);
    } finally {
      for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
    }
    log('cache headers…');
    report.headers = await headerChecks(sl.origin, main.token);
    const outFile = o.out ?? join(OUT_ROOT, 'perf', `report-${o.port}.json`);
    mkdirSync(join(outFile, '..'), { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
    log(`report: ${outFile}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await dev.stop();
    killAll();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  killAll();
  process.exitCode = 1;
});
