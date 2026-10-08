// Determinism applied identically to the prototype and the new app: fixed clock, seeded Math.random
// (mulberry32), reduced motion, /api/health → {ai:false}, self-hosted fonts for the prototype's
// Google Fonts, no #devtoggle, transparent caret, paused videos, and a settle step before each shot.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContext, type BrowserContextOptions, chromium, type Page } from '@playwright/test';
import { FONTS_CSS, FONTS_DIR, FROZEN_MS, VIEWPORTS, type ViewportName } from './config';

export function contextOptions(vp: ViewportName): BrowserContextOptions {
  const v = VIEWPORTS[vp];
  return {
    viewport: { width: v.width, height: v.height },
    screen: { width: v.width, height: v.height },
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    deviceScaleFactor: v.deviceScaleFactor,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    // The app's CSP (style-src 'self') would block the injected determinism <style>; the page itself
    // is unaffected otherwise. Applied to both sides.
    bypassCSP: true,
    acceptDownloads: false,
  };
}

/** 32-bit seed from any string (route + viewport), so both sides draw the same random sequence. */
export function rngSeed(s: string): number {
  return createHash('sha1').update(s).digest().readUInt32LE(0);
}

interface InitArgs {
  seed: number;
  /** localStorage entries written once per context before the first page script runs. */
  storage: Record<string, string> | null;
}

/** Runs in the page before any of its scripts (every navigation). */
function initScript(args: InitArgs) {
  let a = args.seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const css =
    '#devtoggle{display:none!important}' +
    '*,*::before,*::after{caret-color:transparent!important}' +
    'input,textarea{caret-color:transparent!important}';
  const add = () => {
    if (document.getElementById('__parity_css')) return;
    const st = document.createElement('style');
    st.id = '__parity_css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };
  if (document.documentElement) add();
  document.addEventListener('DOMContentLoaded', add);
  try {
    if (args.storage && !sessionStorage.getItem('__parity_storage')) {
      localStorage.clear();
      for (const [k, v] of Object.entries(args.storage)) localStorage.setItem(k, v);
      sessionStorage.setItem('__parity_storage', '1');
    }
  } catch {
    // storage blocked: the page renders its signed-out state
  }
}

let fontsCss: string | null = null;
const FONT_HOST = 'https://fonts.gstatic.com/tie-parity/';

/** fonts.css from @tie/ui with its url(../fonts/x.woff2) pointing at a routed host. */
function googleFontsCss(): string {
  fontsCss ??= readFileSync(FONTS_CSS, 'utf8').replace(/url\(\.\.\/fonts\/([\w.-]+)\)/g, `url(${FONT_HOST}$1)`);
  return fontsCss;
}

export type Side = 'prototype' | 'app';

/**
 * tsx (esbuild keepNames) wraps named functions in `__name(fn, "x")`; functions shipped to the page
 * (init scripts, page.evaluate) need that helper there too. It only returns its argument.
 */
export const TSX_HELPERS = 'globalThis.__name = globalThis.__name || function (f) { return f; };';

export interface PrepareOpts {
  side: Side;
  seedKey: string;
  storage?: Record<string, string> | null;
  /** Origins the page may talk to; everything else is aborted (no network flakiness). */
  allowOrigins: string[];
  /** Answer /api/health with {ai:false} (both sides in parity runs). */
  healthOff?: boolean;
  /** Extra route handlers (e2e Turnstile stub). */
  extraRoutes?: (ctx: BrowserContext) => Promise<void>;
}

export async function prepareContext(ctx: BrowserContext, o: PrepareOpts): Promise<void> {
  await ctx.clock.install({ time: FROZEN_MS });
  await ctx.clock.setFixedTime(FROZEN_MS);
  await ctx.addInitScript({ content: TSX_HELPERS });
  await ctx.addInitScript(initScript, { seed: rngSeed(o.seedKey), storage: o.storage ?? null } satisfies InitArgs);
  // Playwright runs matching routes newest-first: the catch-all goes first, specific handlers after.
  await ctx.route(
    (url) => !o.allowOrigins.includes(url.origin) && /^https?:$/.test(url.protocol),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'fonts.googleapis.com') {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: googleFontsCss() });
        return;
      }
      if (url.href.startsWith(FONT_HOST)) {
        const file = url.pathname.split('/').pop() ?? '';
        if (/^[\w.-]+\.woff2$/.test(file)) {
          try {
            await route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(join(FONTS_DIR, file)) });
            return;
          } catch {
            // fall through to abort
          }
        }
      }
      await route.abort('blockedbyclient');
    },
  );
  if (o.healthOff !== false) {
    await ctx.route('**/api/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
    );
  }
  if (o.extraRoutes) await o.extraRoutes(ctx);
}

export interface PageLog {
  errors: string[];
}

export function watchPage(page: Page, log: PageLog): void {
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`.slice(0, 500)));
  page.on('console', (m) => {
    if (m.type() === 'error') log.errors.push(`console: ${m.text()}`.slice(0, 500));
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    if (!/blockedbyclient|ERR_ABORTED/i.test(f)) log.errors.push(`requestfailed: ${r.url()} ${f}`.slice(0, 300));
  });
}

const swallow = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    // a screen that never settles still gets its screenshot
  }
};

/** Fonts, network idle, toasts gone, videos paused at 0, then two animation frames. */
export async function settle(page: Page, opts: { idleMs?: number } = {}): Promise<void> {
  await swallow(page.waitForLoadState('load', { timeout: 15_000 }));
  await swallow(page.waitForLoadState('networkidle', { timeout: opts.idleMs ?? 10_000 }));
  await swallow(
    page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await Promise.race([document.fonts.ready, wait(5000)]);
      // Toasts, point pops and confetti remove themselves after ~2.6 s: wait them out (bounded).
      for (let i = 0; i < 50; i++) {
        if (!document.querySelector('.toast, .pts-toast, .confetti')) break;
        await wait(100);
      }
      const media = [...document.querySelectorAll('video, audio')] as HTMLMediaElement[];
      await Promise.all(
        media.map(async (m) => {
          try {
            m.autoplay = false;
            m.pause();
            if (m.currentTime !== 0) m.currentTime = 0;
            if (m instanceof HTMLVideoElement && m.readyState < 2 && m.src) {
              await Promise.race([new Promise((r) => m.addEventListener('loadeddata', r, { once: true })), wait(4000)]);
              m.pause();
              m.currentTime = 0;
            }
          } catch {
            // ignore broken media
          }
        }),
      );
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }),
  );
}

const CHANNEL_PATHS: Record<'chrome' | 'msedge', string[]> = {
  chrome: [
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ],
  msedge: [
    join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/opt/microsoft/msedge/msedge',
  ],
};

/**
 * The Playwright `channel` to use without launching anything (for configs): PARITY_BROWSER_CHANNEL,
 * else the bundled Chromium (undefined) when installed, else Chrome, else Edge when found on disk.
 */
export function detectChannel(): string | undefined {
  if (process.env.PARITY_BROWSER_CHANNEL) return process.env.PARITY_BROWSER_CHANNEL;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // no bundled browser
  }
  for (const ch of ['chrome', 'msedge'] as const) if (CHANNEL_PATHS[ch].some((p) => p && existsSync(p))) return ch;
  return 'chrome';
}

/** Installed Playwright Chromium if present, else the system Chrome, else Edge (no download needed). */
export async function launchBrowser(): Promise<Browser> {
  const channel = process.env.PARITY_BROWSER_CHANNEL;
  const tries: (string | undefined)[] = channel ? [channel] : [undefined, 'chrome', 'msedge'];
  let last: unknown;
  for (const ch of tries) {
    try {
      return await chromium.launch({ channel: ch, headless: process.env.PARITY_HEADED !== '1' });
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`could not launch Chromium/Chrome/Edge: ${(last as Error)?.message}`);
}
