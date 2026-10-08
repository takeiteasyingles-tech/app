// Parity route table. The prototype hash and the app hash are the same (the app kept the prototype's
// ROUTES), so each route is one hash plus the fixture user it is captured as, and optional setup steps
// that run identically on both sides after the first settle.
import type { Any } from '@tie/seed/loadPrototype';
import type { UserKey } from './fixture/state';

export type SetupStep =
  | { click: string; nth?: number }
  | { fill: string; value: string }
  | { press: string }
  | { scrollTo: string }
  | { waitFor: string; timeoutMs?: number }
  | { wait: number };

export interface RouteDef {
  id: string;
  hash: string;
  user: UserKey;
  /** Admin shots only: the staff fixture the shot is taken as (default super_admin). */
  staff?: StaffKey;
  /** For 'fresh' users: the prototype's onbStep (the app user simply has no profile yet). */
  onbStep?: number;
  setup?: SetupStep[];
  /**
   * The hash for the state a job is captured with, when it depends on it (each job's user has its own
   * Mic session ids). Falls back to `hash`.
   */
  hashFor?: (state: Any) => string;
}

/** The hash a job loads on both sides: route.hashFor(state) when given, else route.hash. */
export function hashOf(route: RouteDef, state: Any | null): string {
  return route.hashFor && state ? route.hashFor(state) : route.hash;
}

const firstSessionId = (state: Any): string => String(state?.maggie?.sessions?.[0]?.id ?? '');

export function appRoutes(fixture: Any): RouteDef[] {
  const sessionId = firstSessionId(fixture);
  const r = (id: string, hash: string, user: UserKey = 'main', extra: Partial<RouteDef> = {}): RouteDef => ({
    id,
    hash,
    user,
    ...extra,
  });
  const ep1User = (n: number): UserKey => (n <= 6 ? 'main' : (`ep1-s${n}` as UserKey));
  return [
    r('entrar', 'entrar', 'none'),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => r(`cadastro-${n}`, `cadastro/${n}`, 'fresh', { onbStep: n })),
    r('inicio', 'inicio'),
    r('trilha', 'trilha'),
    r('ebook-1', 'ebook/1'),
    r('ebook-five', 'ebook/1/five'),
    r('ebook-real', 'ebook/1/real'),
    r('ebook-lead', 'ebook/1/lead'),
    r('ebook-teste', 'ebook/1/teste'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => r(`ep1-${n}`, `episodio/1/${n}`, ep1User(n))),
    // Only reachable once episode 1 is done (the prototype's player sends you there from step 10).
    r('concluido-1', 'concluido/1', 'ep1-done'),
    r('extra', 'extra'),
    r('extra-detail', 'extra/woods-and-beans'),
    r('extra-play', 'extra/woods-and-beans/assistir'),
    r('extra-musica', 'extra/musica/season-one'),
    r('extra-desafio', 'extra/desafio'),
    r('maggie', 'maggie'),
    r('maggie-relatorio', `maggie/relatorio/${sessionId}`, 'main', {
      hashFor: (s) => `maggie/relatorio/${firstSessionId(s)}`,
    }),
    r('revisao', 'revisao'),
    r('perfil', 'perfil'),
    r('conquistas', 'conquistas'),
  ];
}

/** `--routes a,b|all` against the table; unknown ids are an error listing the valid ones. */
export function selectRoutes(all: RouteDef[], spec: string): RouteDef[] {
  const want = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!want.length || want.includes('all')) return all;
  const byId = new Map(all.map((x) => [x.id, x]));
  const unknown = want.filter((w) => !byId.has(w));
  if (unknown.length)
    throw new Error(`unknown route id(s): ${unknown.join(', ')}\nvalid: ${all.map((x) => x.id).join(', ')}`);
  return want.map((w) => byId.get(w) as RouteDef);
}

/** Admin shots: who the shot is taken as (the fixture super_admin, the fixture editor, or signed out). */
export type StaffKey = 'super_admin' | 'editor' | 'none';

/** The student whose page the admin user-detail shot opens (Ana, the canonical fixture user). */
export const ADMIN_DETAIL_USER_ID = 'U_PARITY';

const a = (id: string, hash: string, staff: StaffKey = 'super_admin'): RouteDef => ({ id, hash, user: 'main', staff });

/**
 * Admin route table. Ids are what `--routes` takes; the `editor-*` ids are the same screens seen by
 * the fixture editor (role-aware UI: no Usuários / Planos / Auditoria, publish only).
 */
export const ADMIN_ROUTES: readonly RouteDef[] = [
  a('login', 'entrar', 'none'),
  a('dashboard', 'painel'),
  a('users', 'usuarios'),
  a('user-detail', `usuarios/${ADMIN_DETAIL_USER_ID}`),
  a('plans', 'planos'),
  a('content-episodes', 'conteudo/episodios'),
  a('content-episode-edit', 'conteudo/episodios/1'),
  a('content-ebooks', 'conteudo/ebooks'),
  a('content-extras', 'conteudo/extras'),
  a('content-albums', 'conteudo/albuns'),
  a('content-assistants', 'conteudo/assistentes'),
  a('content-missions', 'conteudo/missoes'),
  a('content-onboarding', 'conteudo/cadastro'),
  a('content-gamification', 'conteudo/gamificacao'),
  a('media', 'midia'),
  a('moderation', 'moderacao'),
  a('audit', 'auditoria'),
  a('releases', 'publicacoes'),
  a('settings', 'config'),
  a('account', 'conta'),
  a('editor-dashboard', 'painel', 'editor'),
  a('editor-content-episodes', 'conteudo/episodios', 'editor'),
  a('editor-content-episode-edit', 'conteudo/episodios/1', 'editor'),
  a('editor-releases', 'publicacoes', 'editor'),
  a('editor-users', 'usuarios', 'editor'),
];

/**
 * `--app admin --routes`: ids of ADMIN_ROUTES (`all` or empty: the whole table). Anything that is not
 * an id is taken as a raw hash (`#/conteudo/extras/xyz`) captured as the super_admin, id = file-safe slug.
 */
export function adminRoutes(spec: string): RouteDef[] {
  const want = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!want.length || want.includes('all')) return [...ADMIN_ROUTES];
  const byId = new Map(ADMIN_ROUTES.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const out: RouteDef[] = [];
  for (const w of want) {
    const known = byId.get(w);
    const hash = w.replace(/^#?\/?/, '');
    const r = known ?? a(hash ? hash.replace(/[^A-Za-z0-9_-]+/g, '_') : 'root', hash);
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
