// Hash routing for the admin SPA (#/usuarios/ID?q=...), same model as the student app's router:
// a ROUTES table of regexes, a `route` signal, and navigate/replace from @tie/ui. Filters live in the
// hash query so a list view can be linked and survives a reload.
import { signal } from '@preact/signals';
import { navigate, onNavigate, replace as uiReplace } from '@tie/ui/nav';

export type RouteName =
  | 'login'
  | 'invite'
  | 'dashboard'
  | 'users'
  | 'user'
  | 'plans'
  | 'episodes'
  | 'episode'
  | 'ebooks'
  | 'ebook'
  | 'extras'
  | 'extra'
  | 'albums'
  | 'album'
  | 'assistants'
  | 'assistant'
  | 'missions'
  | 'mission'
  | 'onboarding'
  | 'gamification'
  | 'media'
  | 'moderation'
  | 'audit'
  | 'releases'
  | 'settings'
  | 'account'
  | 'notFound';

const ID = '([A-Za-z0-9][\\w-]{0,119})';

export const ROUTES: readonly (readonly [RegExp, RouteName, (readonly string[])?])[] = [
  [/^(?:painel)?$/, 'dashboard'],
  [/^entrar$/, 'login'],
  [/^convite\/([\w-]{16,200})$/, 'invite', ['token']],
  [/^usuarios$/, 'users'],
  [new RegExp(`^usuarios/${ID}$`), 'user', ['id']],
  [/^planos$/, 'plans'],
  [/^conteudo(?:\/episodios)?$/, 'episodes'],
  [/^conteudo\/episodios\/(\d{1,9})$/, 'episode', ['num']],
  [/^conteudo\/ebooks$/, 'ebooks'],
  [/^conteudo\/ebooks\/(\d{1,9})$/, 'ebook', ['num']],
  [/^conteudo\/extras$/, 'extras'],
  [new RegExp(`^conteudo/extras/${ID}$`), 'extra', ['id']],
  [/^conteudo\/albuns$/, 'albums'],
  [new RegExp(`^conteudo/albuns/${ID}$`), 'album', ['id']],
  [/^conteudo\/assistentes$/, 'assistants'],
  [new RegExp(`^conteudo/assistentes/${ID}$`), 'assistant', ['key']],
  [/^conteudo\/missoes$/, 'missions'],
  [new RegExp(`^conteudo/missoes/${ID}$`), 'mission', ['key']],
  [/^conteudo\/cadastro$/, 'onboarding'],
  [/^conteudo\/gamificacao$/, 'gamification'],
  [/^midia$/, 'media'],
  [/^moderacao$/, 'moderation'],
  [/^auditoria$/, 'audit'],
  [/^publicacoes$/, 'releases'],
  [/^config$/, 'settings'],
  [/^conta$/, 'account'],
];

export type RouteParams = Readonly<Record<string, string | undefined>>;

export interface Route {
  name: RouteName;
  params: RouteParams;
  q: Readonly<Record<string, string>>;
  /** Hash path without "#/" and without the query. */
  path: string;
}

export function parseHash(hash: string): Route {
  const raw = (hash || '').replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  let path = qi < 0 ? raw : raw.slice(0, qi);
  const qs = qi < 0 ? '' : raw.slice(qi + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    path = '';
  }
  const q: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) q[k] = v;
  for (const [re, name, keys] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    const params: Record<string, string | undefined> = {};
    (keys ?? []).forEach((k, i) => {
      params[k] = m[i + 1];
    });
    return { name, params, q, path };
  }
  return { name: 'notFound', params: {}, q, path };
}

export const parse = (): Route => parseHash(typeof location === 'undefined' ? '' : location.hash);

export const route = signal<Route>(parse());

/** Called before leaving a screen with unsaved edits; return false to stay. */
let leaveGuard: (() => boolean) | null = null;
export function setLeaveGuard(fn: (() => boolean) | null): void {
  leaveGuard = fn;
}

let current = typeof location === 'undefined' ? '' : location.hash;

function sync(): void {
  const next = parse();
  if (leaveGuard && next.path !== route.value.path && !leaveGuard()) {
    // Stay: put the previous hash back without a new history entry.
    history.replaceState(null, '', current || '#/');
    return;
  }
  current = location.hash;
  route.value = next;
}

let started = false;
export function startRouter(): void {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', sync);
  onNavigate(sync);
}

/** Path + optional query object → "path?k=v" (empty values dropped). */
export function withQuery(path: string, q: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export const go = (path: string): void => navigate(path);
export const replace = (path: string): void => uiReplace(path);

/** Rewrites the current route's query (filters) without a new history entry. */
export function setQuery(patch: Record<string, string | number | undefined | null>): void {
  const r = route.value;
  replace(withQuery(r.path, { ...r.q, ...patch }));
}
