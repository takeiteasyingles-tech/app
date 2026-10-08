// Hash routing, verbatim port of the ROUTES table and TIE.router from prototipo/js/core/store.js.
// URLs match the prototype (#/episodio/1/5) so the parity harness hits the same route on both.
import { signal } from '@preact/signals';
import { navigate, onNavigate, replace as uiReplace } from '@tie/ui';

export type RouteName =
  | 'raiz'
  | 'entrar'
  | 'cadastro'
  | 'inicio'
  | 'trilha'
  | 'player'
  | 'concluido'
  | 'ebook'
  | 'ebookx'
  | 'extra'
  | 'musica'
  | 'desafio'
  | 'extraDetail'
  | 'extraPlay'
  | 'maggie'
  | 'relatorio'
  | 'revisao'
  | 'perfil'
  | 'conquistas';

export const ROUTES: readonly (readonly [RegExp, RouteName, (readonly string[])?])[] = [
  [/^$/, 'raiz'],
  [/^entrar$/, 'entrar'],
  [/^cadastro(?:\/(\d+))?$/, 'cadastro', ['step']],
  [/^inicio$/, 'inicio'],
  [/^trilha$/, 'trilha'],
  [/^episodio\/(\d+)(?:\/(\d+))?$/, 'player', ['ep', 'step']],
  [/^concluido\/(\d+)$/, 'concluido', ['ep']],
  [/^ebook\/1$/, 'ebook'],
  [/^ebook\/1\/(five|real|lead|teste)$/, 'ebookx', ['part']],
  [/^extra$/, 'extra'],
  [/^extra\/musica\/([\w-]+)$/, 'musica', ['id']],
  [/^extra\/desafio$/, 'desafio'],
  [/^extra\/([\w-]+)$/, 'extraDetail', ['id']],
  [/^extra\/([\w-]+)\/assistir$/, 'extraPlay', ['id']],
  [/^maggie$/, 'maggie'],
  [/^maggie\/relatorio(?:\/([\w-]+))?$/, 'relatorio', ['id']],
  [/^revisao$/, 'revisao'],
  [/^perfil$/, 'perfil'],
  [/^conquistas$/, 'conquistas'],
];

/** Params are undefined when an optional group did not match (cadastro without a step). */
export type RouteParams = Readonly<Record<string, string | undefined>>;

export interface Route {
  name: RouteName;
  params: RouteParams;
  /** Query after "?" inside the hash (#/maggie?mode=livre). */
  q: Readonly<Record<string, string>>;
  /** Path without "#/" and without the query; changes of this re-enter the view. */
  path: string;
}

export function parseHash(hash: string): Route {
  let raw: string;
  try {
    raw = decodeURIComponent((hash || '').replace(/^#\/?/, ''));
  } catch {
    raw = '';
  }
  const [path = '', qs = ''] = raw.split('?');
  const q: Record<string, string> = {};
  for (const kv of qs.split('&').filter(Boolean)) {
    const [k = '', v] = kv.split('=');
    q[k] = v || '';
  }
  for (const [re, name, keys] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    const params: Record<string, string | undefined> = {};
    (keys ?? []).forEach((k, i) => {
      params[k] = m[i + 1];
    });
    return { name, params, q, path };
  }
  return { name: 'raiz', params: {}, q, path };
}

/** TIE.router.parse() on the current location. */
export const parse = (): Route => parseHash(typeof location === 'undefined' ? '' : location.hash);

/** The current route; the shell re-renders when it changes. */
export const route = signal<Route>(parse());

/** Bumped on every navigation, even to the same path (TIE.router.go re-renders in that case). */
export const navTick = signal(0);

function sync(): void {
  route.value = parse();
  navTick.value++;
}

let started = false;
/** Starts listening to hashchange and to @tie/ui navigations (same-hash go, replace). */
export function startRouter(onHashChange?: () => void): void {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => {
    sync();
    onHashChange?.();
  });
  onNavigate(sync);
}

/** TIE.router.go */
export const go = (path: string): void => navigate(path);
/** TIE.router.replace */
export const replace = (path: string): void => uiReplace(path);
