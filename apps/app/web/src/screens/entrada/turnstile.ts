// Cloudflare Turnstile for the auth screens (login, signup, reset). The widget runs in
// "interaction-only" mode, so it takes no space unless Cloudflare needs the person to click, and the
// screens keep the prototype's layout. The script (allowed by the CSP: script-src/frame-src
// challenges.cloudflare.com) loads on the first interaction with the form, not on page load.
import { type AuthConfig, authApi } from '@tie/shared/contracts/auth';
import { useEffect, useRef } from 'preact/hooks';
import { call } from '../../api';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Cloudflare's always-pass test sitekey (local dev); its tokens are dummies the server accepts. */
const TEST_SITEKEY = '1x00000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TOKEN_WAIT_MS = 20_000;

export const TURNSTILE_ERROR = 'Não deu para fazer a verificação de segurança. Confira a internet e tente de novo.';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let configP: Promise<AuthConfig> | null = null;

/** GET /api/auth/config (sitekey, terms version, password minimum), fetched once per page. */
export function authConfig(): Promise<AuthConfig> {
  configP ??= call(authApi.config).catch((err: unknown) => {
    configP = null;
    throw err;
  });
  return configP;
}

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
  /** Ref for the (display: contents) holder the widget renders into. */
  ref: { current: HTMLDivElement | null };
  /** Starts loading the widget (first focus in the form); safe to call many times. */
  warm(): void;
  /** A fresh token: waits for the widget (up to 20 s). Rejects with TURNSTILE_ERROR. */
  token(): Promise<string>;
  /** Tokens are single use: call after every request that consumed one. */
  reset(): void;
}

/** One Turnstile widget for a form, with the server-side `action` it is verified against. */
export function useTurnstile(action: 'login' | 'signup' | 'reset'): TurnstileHandle {
  const ref = useRef<HTMLDivElement | null>(null);
  const st = useRef({
    started: false,
    widget: '' as string,
    api: null as TurnstileApi | null,
    token: '',
    dummy: false,
    failed: false,
    waiters: [] as ((t: string | null) => void)[],
  }).current;

  const settle = (t: string | null) => {
    const w = st.waiters.splice(0);
    for (const fn of w) fn(t);
  };

  const start = () => {
    if (st.started) return;
    st.started = true;
    st.failed = false;
    void authConfig()
      .then(async (cfg) => {
        const key = cfg.turnstileSiteKey;
        let api: TurnstileApi;
        try {
          api = await loadScript();
        } catch (err) {
          // Offline local dev with the test key: the server accepts any token there.
          if (key === TEST_SITEKEY || !key) {
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
      })
      .catch(() => {
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
          // Already gone.
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
        const timer = setTimeout(() => {
          st.waiters = st.waiters.filter((w) => w !== done);
          reject(new Error(TURNSTILE_ERROR));
        }, TOKEN_WAIT_MS);
        const done = (t: string | null) => {
          clearTimeout(timer);
          if (t) resolve(t);
          else reject(new Error(TURNSTILE_ERROR));
        };
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
          // The next token() renders again.
        }
      }
    },
  };
}
