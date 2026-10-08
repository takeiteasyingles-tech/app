// One screenshot of one route, at one viewport, on one side. Never throws: a screen that errors, hangs
// or redirects still yields a PNG (the page as it is, or a placeholder), plus the errors seen. The page
// is grown to its content height first (expandToContent), so the full-page shot is really full.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ViewportName } from './config';
import { contextOptions, type PageLog, prepareContext, type Side, settle, watchPage } from './determinism';
import type { RouteDef, SetupStep } from './routes';

export interface ShotTarget {
  side: Side;
  /** Origin to load (prototype static server or wrangler dev). */
  origin: string;
  route: RouteDef;
  /** Hash to load (defaults to route.hash); per-job when the route depends on the user's state. */
  hash?: string;
  viewport: ViewportName;
  /** Prototype: localStorage to inject. */
  storage?: Record<string, string> | null;
  /** App/admin: session cookie to set. */
  cookie?: { name: string; value: string } | null;
}

export interface ShotResult {
  png: Buffer;
  finalUrl: string;
  errors: string[];
  ms: number;
  placeholder: boolean;
  /** CSS-px viewport height the shot was taken at (grown to fit inner scrollers; see expandToContent). */
  contentHeight: number;
  /** The content was taller than the screenshot cap and was cut. */
  capped: boolean;
}

/**
 * Inner scrollers that overflow: visible elements with overflow-y auto/scroll whose content is taller
 * than their box. Each gets a stable data-parity-scroll id; all are scrolled back to the top.
 * Runs in the page.
 */
function measureScrollers(): { id: string; over: number }[] {
  const root = document.documentElement;
  let n = Number(root.dataset.parityScrollN || 0);
  const out: { id: string; over: number }[] = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!(el instanceof HTMLElement) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over <= 1) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (!el.dataset.parityScroll) el.dataset.parityScroll = String(++n);
    el.scrollTop = 0;
    out.push({ id: el.dataset.parityScroll, over });
  }
  root.dataset.parityScrollN = String(n);
  return out;
}

const afterResize = async (page: Page) => {
  await page
    .evaluate(
      () =>
        new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(), 50)))),
    )
    .catch(() => {});
};

/** Tallest CSS height we grow to: Chromium cannot capture images taller than ~16k device px. */
export const maxContentHeight = (dsf: number) => Math.floor(16_000 / dsf);

/**
 * Full-page screenshots only see the document. The prototype (and the app, which kept its layout)
 * pins `.app` to 100dvh and scrolls inside `.scroll` / the live-grid panes, so a plain full-page shot
 * is just the first screen. This grows the viewport height until no inner scroller that grows with it
 * overflows any more (a fixed-height scroller, e.g. a capped list, is detected and ignored), up to the
 * cap. The same steps run on both sides; the final height goes into the key.
 */
export async function expandToContent(
  page: Page,
  base: { width: number; height: number },
  dsf: number,
): Promise<{ height: number; capped: boolean }> {
  const cap = maxContentHeight(dsf);
  const ignore = new Set<string>();
  let h = base.height;
  let capped = false;
  for (let i = 0; i < 8; i++) {
    const cand = (await page.evaluate(measureScrollers)).filter((x) => !ignore.has(x.id));
    if (!cand.length) break;
    let extra = Math.ceil(Math.max(...cand.map((x) => x.over)));
    if (h + extra > cap) {
      extra = cap - h;
      capped = true;
    }
    if (extra <= 0) break;
    await page.setViewportSize({ width: base.width, height: h + extra });
    await afterResize(page);
    const now = new Map((await page.evaluate(measureScrollers)).map((x) => [x.id, x.over]));
    const helped = cand.filter((c) => (now.get(c.id) ?? 0) < c.over - 1);
    for (const c of cand) if (!helped.includes(c)) ignore.add(c.id);
    if (!helped.length) {
      // Nothing grew with the viewport: undo this step.
      await page.setViewportSize({ width: base.width, height: h });
      await afterResize(page);
      capped = false;
      continue;
    }
    h += extra;
    if (capped) break;
  }
  return { height: h, capped };
}

async function runStep(page: Page, step: SetupStep): Promise<void> {
  if ('click' in step)
    await page
      .locator(step.click)
      .nth(step.nth ?? 0)
      .click({ timeout: 10_000 });
  else if ('fill' in step) await page.locator(step.fill).first().fill(step.value, { timeout: 10_000 });
  else if ('press' in step) await page.keyboard.press(step.press);
  else if ('scrollTo' in step) await page.locator(step.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  else if ('waitFor' in step)
    await page
      .locator(step.waitFor)
      .first()
      .waitFor({ timeout: step.timeoutMs ?? 10_000 });
  else if ('wait' in step) await page.waitForTimeout(step.wait);
}

/** A flat gray PNG of the viewport size, used when even a screenshot is impossible. */
export function placeholderPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(0x80);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 0xff;
  return PNG.sync.write(png);
}

export async function shoot(browser: Browser, t: ShotTarget): Promise<ShotResult> {
  const t0 = Date.now();
  const log: PageLog = { errors: [] };
  let ctx: BrowserContext | null = null;
  let finalUrl = '';
  const o = contextOptions(t.viewport);
  const dsf = o.deviceScaleFactor ?? 1;
  const vp = { width: o.viewport?.width ?? 375, height: o.viewport?.height ?? 812 };
  let contentHeight = vp.height;
  let capped = false;
  try {
    ctx = await browser.newContext(contextOptions(t.viewport));
    await prepareContext(ctx, {
      side: t.side,
      seedKey: `${t.route.id}|${t.viewport}`,
      storage: t.storage ?? null,
      allowOrigins: [t.origin],
    });
    if (t.cookie) {
      await ctx.addCookies([
        { name: t.cookie.name, value: t.cookie.value, url: t.origin, httpOnly: true, sameSite: 'Lax' },
      ]);
    }
    const page = await ctx.newPage();
    watchPage(page, log);
    try {
      await page.goto(`${t.origin}/#/${t.hash ?? t.route.hash}`, { waitUntil: 'load', timeout: 30_000 });
    } catch (err) {
      log.errors.push(`goto: ${(err as Error).message.split('\n')[0]}`);
    }
    await settle(page);
    if (t.route.setup?.length) {
      for (const step of t.route.setup) {
        try {
          await runStep(page, step);
        } catch (err) {
          log.errors.push(`setup ${JSON.stringify(step)}: ${(err as Error).message.split('\n')[0]}`);
        }
      }
      await settle(page);
    }
    try {
      const text = await page.evaluate(() => document.body?.innerText ?? '');
      if (/Algo deu errado nesta tela/.test(text)) log.errors.push('screen error card rendered');
    } catch {
      // page gone
    }
    finalUrl = page.url();
    try {
      const grown = await expandToContent(page, vp, dsf);
      contentHeight = grown.height;
      capped = grown.capped;
      if (grown.height !== vp.height) await settle(page, { idleMs: 5_000 });
    } catch (err) {
      log.errors.push(`expand: ${(err as Error).message.split('\n')[0]}`);
    }
    let png: Buffer | null = null;
    try {
      png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', timeout: 30_000 });
    } catch (err) {
      log.errors.push(`screenshot(fullPage): ${(err as Error).message.split('\n')[0]}`);
      try {
        png = await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 15_000 });
      } catch (err2) {
        log.errors.push(`screenshot: ${(err2 as Error).message.split('\n')[0]}`);
      }
    }
    if (png)
      return { png, finalUrl, errors: log.errors, ms: Date.now() - t0, placeholder: false, contentHeight, capped };
  } catch (err) {
    log.errors.push(`capture: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await ctx?.close().catch(() => {});
  }
  return {
    png: placeholderPng(vp.width * dsf, vp.height * dsf),
    finalUrl,
    errors: log.errors,
    ms: Date.now() - t0,
    placeholder: true,
    contentHeight: vp.height,
    capped: false,
  };
}
