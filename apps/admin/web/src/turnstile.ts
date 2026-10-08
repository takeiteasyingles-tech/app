// Cloudflare Turnstile for the admin login and invite accept (Worker actions 'login' / 'invite').
// Same approach as the student app (apps/app/web/src/screens/entrada/turnstile.ts): the widget runs
// "interaction-only", the script (allowed by the CSP) loads on the first focus in the form, and on
// localhost the always-pass test key stands in, with a dummy token when the script is unreachable.
// The admin Worker has no public config endpoint, so the sitekey is a build-time value
// (VITE_TURNSTILE_SITEKEY, the same value as the Worker's TURNSTILE_SITEKEY var).
import { useEffect, useRef } from 'preact/hooks';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TEST_SITEKEY = '1x00000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TOKEN_WAIT_MS = 20_000;

export const TURNSTILE_ERROR = 'Não deu para fazer a verificação de segurança. Confira a internet e tente de novo.';

const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(location.hostname);

export function siteKey(): string {
  const k = import.meta.env.VITE_TURNSTILE_SITEKEY;
  if (k) return k;
  return isLocal() ? TEST_SITEKEY : '';
}

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let scriptP: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  scriptP ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => {
      s.remove();
      scriptP = null;
      reject(new Error('turnstile script failed'));
    };
    document.head.appendChild(s);
  });
  return scriptP;
}

export interface TurnstileHandle {
  ref: { current: HTMLDivElement | null };
  warm(): void;
  token(): Promise<string>;
  reset(): void;
}

export function useTurnstile(action: 'login' | 'invite'): TurnstileHandle {
  const ref = useRef<HTMLDivElement | null>(null);
  const st = useRef({
    started: false,
    widget: '',
    api: null as TurnstileApi | null,
    token: '',
    dummy: false,
    failed: false,
    waiters: [] as ((t: string | null) => void)[],
  }).current;

  const settle = (t: string | null) => {
    for (const fn of st.waiters.splice(0)) fn(t);
  };

  const start = () => {
    if (st.started) return;
    st.started = true;
    st.failed = false;
    const key = siteKey();
    void (async () => {
      if (!key) throw new Error('no sitekey');
      let api: TurnstileApi;
      try {
        api = await loadScript();
      } catch (err) {
        if (key === TEST_SITEKEY) {
          st.dummy = true;
          st.token = DUMMY_TOKEN;
          settle(DUMMY_TOKEN);
          return;
        }
        throw err;
      }
      const el = ref.current;
      if (!el) throw new Error('turnstile holder gone');
      st.api = api;
      st.widget = api.render(el, {
        sitekey: key,
        action,
        appearance: 'interaction-only',
        language: 'pt-br',
        'refresh-expired': 'auto',
        callback: (t: string) => {
          st.token = t;
          settle(t);
        },
        'expired-callback': () => {
          st.token = '';
        },
        'error-callback': () => {
          st.token = '';
          settle(null);
        },
      });
    })().catch(() => {
      st.started = false;
      st.failed = true;
      settle(null);
    });
  };

  useEffect(
    () => () => {
      if (st.api && st.widget) {
        try {
          st.api.remove(st.widget);
        } catch {
          // already gone
        }
      }
      settle(null);
    },
    [],
  );

  return {
    ref,
    warm: start,
    token() {
      if (st.token) return Promise.resolve(st.token);
      if (st.failed) st.started = false;
      start();
      return new Promise<string>((resolve, reject) => {
        const done = (t: string | null) => {
          clearTimeout(timer);
          if (t) resolve(t);
          else reject(new Error(TURNSTILE_ERROR));
        };
        const timer = setTimeout(() => {
          st.waiters = st.waiters.filter((w) => w !== done);
          reject(new Error(TURNSTILE_ERROR));
        }, TOKEN_WAIT_MS);
        st.waiters.push(done);
      });
    },
    reset() {
      if (st.dummy) return;
      st.token = '';
      if (st.api && st.widget) {
        try {
          st.api.reset(st.widget);
        } catch {
          // the next token() renders again
        }
      }
    },
  };
}
