// Offline stand-in for the Turnstile script (challenges.cloudflare.com/turnstile/v0/api.js) used with
// the local test sitekey: it renders a small box and hands the page Cloudflare's documented dummy
// token right away. The Worker accepts it because local dev pairs the test sitekey with the
// always-pass test secret. Set E2E_REAL_TURNSTILE=1 to load the real script instead.
import type { BrowserContext } from '@playwright/test';

export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const STUB = `(() => {
  const TOKEN = ${JSON.stringify(DUMMY_TOKEN)};
  let n = 0;
  const widgets = new Map();
  function render(el, opts) {
    const host = typeof el === 'string' ? document.querySelector(el) : el;
    const o = Object.assign({}, host && host.dataset ? {
      sitekey: host.dataset.sitekey, callback: host.dataset.callback, action: host.dataset.action,
    } : {}, opts || {});
    const id = 'tie-ts-' + (++n);
    if (host) {
      const box = document.createElement('div');
      box.className = 'tie-turnstile-stub';
      box.textContent = 'Turnstile (teste)';
      box.style.cssText = 'font:12px sans-serif;padding:8px;border:1px dashed #999;border-radius:6px';
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'cf-turnstile-response'; input.value = TOKEN;
      host.appendChild(box); host.appendChild(input);
    }
    widgets.set(id, o);
    const cb = typeof o.callback === 'function' ? o.callback : (o.callback && window[o.callback]);
    setTimeout(() => { if (typeof cb === 'function') cb(TOKEN); }, 0);
    return id;
  }
  window.turnstile = {
    render, ready: (fn) => setTimeout(fn, 0), reset: () => {}, remove: (id) => widgets.delete(id),
    getResponse: () => TOKEN, isExpired: () => false,
    execute: (el, opts) => { const id = render(el, opts); return id; },
  };
  const me = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src) : null;
  const onload = me && me.searchParams.get('onload');
  const auto = () => document.querySelectorAll('.cf-turnstile').forEach((el) => { if (!el.dataset.tieStub) { el.dataset.tieStub = '1'; render(el); } });
  if (onload && typeof window[onload] === 'function') setTimeout(() => window[onload](), 0);
  if (!me || me.searchParams.get('render') !== 'explicit') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
  }
})();`;

export async function stubTurnstile(ctx: BrowserContext): Promise<void> {
  if (process.env.E2E_REAL_TURNSTILE === '1') return;
  await ctx.route('https://challenges.cloudflare.com/**', (route) => {
    const url = route.request().url();
    if (/\/turnstile\/v0\/api\.js/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: STUB });
    }
    return route.fulfill({ status: 204, body: '' });
  });
}
