import type { TieState } from '@tie/shared/state';
import type { Route } from './router';
import { type ScreenDef, screenFor } from './screens/registry';
import type { LoadStatus } from './store/state';

/** Route guards (draw() lines 1-4). Returns the path to replace() with, or null to render. */
export function guard(r: Route, s: TieState): string | null {
  if (!s.user && r.name !== 'entrar' && r.name !== 'cadastro') return 'entrar';
  if (s.user && !s.profile && r.name !== 'cadastro') return `cadastro/${s.onbStep || 1}`;
  if (r.name === 'raiz' || (s.profile && (r.name === 'entrar' || r.name === 'cadastro')))
    return s.profile ? 'inicio' : 'entrar';
  if (!screenFor(r.name)) return 'inicio';
  return null;
}

export type View =
  /** /api/me/state has not answered: nothing renders, so no screen ever sees freshState(). */
  | { kind: 'blank' }
  /** The state could not load (offline, 5xx, 429): retry card, cookie session kept. */
  | { kind: 'failed' }
  | { kind: 'redirect'; to: string }
  | { kind: 'screen'; def: ScreenDef };

/** What the shell shows for a load status, route and state. Guards only run on a loaded state. */
export function resolveView(status: LoadStatus, r: Route, s: TieState): View {
  if (status === 'loading') return { kind: 'blank' };
  if (status !== 'ready') return { kind: 'failed' };
  const to = guard(r, s);
  if (to !== null) return { kind: 'redirect', to };
  const def = screenFor(r.name);
  return def ? { kind: 'screen', def } : { kind: 'blank' };
}
