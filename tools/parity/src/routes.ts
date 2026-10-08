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
    r('concluido-1', 'concluido/1'),
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

/** Admin shots: the route list is raw hashes (`usuarios,conteudo/episodios`); id = a file-safe slug. */
export function adminRoutes(spec: string): RouteDef[] {
  const hashes = spec
    .split(',')
    .map((s) => s.trim().replace(/^#?\/?/, ''))
    .filter((s) => s && s !== 'all');
  return (hashes.length ? hashes : ['']).map((hash) => ({
    id: hash ? hash.replace(/[^A-Za-z0-9_-]+/g, '_') : 'root',
    hash,
    user: 'main',
  }));
}
