// Client TieState v7 (the prototype's TIE.store.s) as a signal. The server is the source of truth:
// load() pulls GET /api/me/state, setters update the signal at once (optimistic) and the slice's
// API call confirms or rolls back. Each write replaces the top-level object so subscribers re-render.
import { batch, signal } from '@preact/signals';
import { meApi } from '@tie/shared/contracts/me';
import { ApiError } from '@tie/shared/errors';
import { freshState, type Settings, type TieState } from '@tie/shared/state';
import { toast } from '@tie/ui';
import { call, errorMessage, NetworkError, onUnauthorized } from '../api';

export const state = signal<TieState>(freshState());

/**
 * 'loading' until /api/me/state answers (or says 401); the shell renders no screen before.
 * 'offline' / 'error' mean the state could not load for another reason: the session is kept and
 * the shell offers a retry instead of sending a signed-in user to #/entrar.
 */
export type LoadStatus = 'loading' | 'ready' | 'offline' | 'error';
export const status = signal<LoadStatus>('loading');

/** pt-BR reason shown with the retry when status is 'offline' or 'error'. */
export const loadError = signal('');

export type Patch = Partial<TieState>;

/** TIE.store.set without the render call: the shell re-renders from the signal. */
export function set(patch: Patch | ((s: TieState) => Patch | undefined)): void {
  const p = typeof patch === 'function' ? patch(state.value) : patch;
  if (p) state.value = { ...state.value, ...p };
}

/**
 * Applies `patch` now, runs `request`, and restores the patched keys if it fails (unless something
 * else changed them meanwhile). Errors toast their pt-BR message and are rethrown.
 */
export async function optimistic<T>(patch: Patch, request: () => Promise<T>): Promise<T> {
  const before = state.value;
  const keys = Object.keys(patch) as (keyof TieState)[];
  set(patch);
  const applied = state.value;
  try {
    return await request();
  } catch (err) {
    const now = state.value;
    const restore: Record<string, unknown> = {};
    for (const k of keys) if (now[k] === applied[k]) restore[k] = before[k];
    set(restore as Patch);
    if (typeof document !== 'undefined') toast(errorMessage(err));
    throw err;
  }
}

// settings.phone was the prototype's dev layout toggle (not shipped): always false in production,
// so the layout follows the window width alone. settings.free comes from the dev.free_steps flag.

/** PATCH /api/me/settings, applied optimistically. */
export function patchSettings(p: Partial<Omit<Settings, 'phone' | 'free'>>): Promise<unknown> {
  return optimistic({ settings: { ...state.value.settings, ...p } }, () => call(meApi.settings, { body: p }));
}

/** Signed out (or session expired): back to the fresh state; the shell guard routes to #/entrar. */
export function signedOut(): void {
  state.value = freshState();
}

const isSignedOutError = (err: unknown): boolean =>
  err instanceof ApiError && (err.code === 'unauthorized' || err.code === 'session_expired');

/**
 * GET /api/me/state. Only unauthorized/session_expired mean "nobody signed in"; any other failure
 * (network, 5xx, rate limit) leaves the session alone and sets 'offline' / 'error'.
 */
export async function load(): Promise<void> {
  try {
    const s = await call(meApi.state);
    s.settings = { ...s.settings, phone: false };
    batch(() => {
      state.value = s;
      loadError.value = '';
      status.value = 'ready';
    });
  } catch (err) {
    batch(() => {
      if (isSignedOutError(err)) {
        signedOut();
        loadError.value = '';
        status.value = 'ready';
        return;
      }
      loadError.value = errorMessage(err);
      status.value = err instanceof NetworkError ? 'offline' : 'error';
    });
  }
}

/** The shell's "Tentar de novo": back to 'loading' (blank) and fetch the state again. */
export function retryLoad(): Promise<void> {
  status.value = 'loading';
  return load();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (status.value === 'offline') void retryLoad();
  });
}

onUnauthorized(() => {
  if (state.value.user) signedOut();
});
