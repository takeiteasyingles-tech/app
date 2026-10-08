// The hash router and guards must behave exactly like TIE.router.parse() and draw() in the prototype.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { freshState, type Profile } from '@tie/shared/state';
import { describe, expect, it } from 'vitest';
import { guard, resolveView } from '../src/guard';
import { parseHash, ROUTES } from '../src/router';
import { SCREENS } from '../src/screens/registry';

// biome-ignore lint/suspicious/noExplicitAny: prototype globals are untyped JS
type Any = any;

/** Runs prototipo/js/core/store.js with a fake location and returns TIE.router. */
function prototypeRouter(): { parse(): Any; setHash(h: string): void } {
  const loc = { hash: '', search: '', pathname: '/' };
  const sandbox: Any = {
    location: loc,
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sandbox.window = sandbox;
  const src = readFileSync(fileURLToPath(new URL('../../../../prototipo/js/core/store.js', import.meta.url)), 'utf8');
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'store.js' });
  return {
    parse: () => sandbox.TIE.router.parse(),
    setHash: (h) => {
      loc.hash = h;
    },
  };
}

const HASHES = [
  '',
  '#/',
  '#/entrar',
  '#/cadastro',
  '#/cadastro/4',
  '#/inicio',
  '#/trilha',
  '#/episodio/1',
  '#/episodio/1/5',
  '#/concluido/2',
  '#/ebook/1',
  '#/ebook/1/five',
  '#/ebook/1/teste',
  '#/ebook/2',
  '#/extra',
  '#/extra/woods-and-beans',
  '#/extra/woods-and-beans/assistir',
  '#/extra/musica/season-one',
  '#/extra/desafio',
  '#/maggie',
  '#/maggie?mode=livre&x',
  '#/maggie/relatorio',
  '#/maggie/relatorio/abc123',
  '#/revisao',
  '#/perfil',
  '#/conquistas',
  '#/nao-existe',
  '#/extra%2Fdesafio',
];

describe('router', () => {
  const proto = prototypeRouter();

  it.each(HASHES.map((h) => [h]))('parses %j like the prototype', (hash) => {
    proto.setHash(hash);
    // The prototype yields undefined params for unmatched optional groups, same as ours.
    expect(JSON.parse(JSON.stringify(parseHash(hash)))).toEqual(JSON.parse(JSON.stringify(proto.parse())));
  });

  it('has a lazy screen for every route but raiz', () => {
    const names = ROUTES.map(([, n]) => n).filter((n) => n !== 'raiz');
    expect(Object.keys(SCREENS).sort()).toEqual([...new Set(names)].sort());
  });
});

describe('guards (draw)', () => {
  const route = (h: string) => parseHash(h);
  const profile = { name: 'Ana' } as Profile;
  const anon = freshState();
  const onboarding = { ...freshState(), user: { id: 'u', email: 'a@b.c', name: 'Ana', fullName: '' }, onbStep: 3 };
  const ready = { ...onboarding, profile };

  it('sends visitors to entrar, except entrar and cadastro', () => {
    expect(guard(route('#/inicio'), anon)).toBe('entrar');
    expect(guard(route(''), anon)).toBe('entrar');
    expect(guard(route('#/entrar'), anon)).toBeNull();
    expect(guard(route('#/cadastro/1'), anon)).toBeNull();
  });

  it('keeps a signed-in user without profile in cadastro/<onbStep>', () => {
    expect(guard(route('#/inicio'), onboarding)).toBe('cadastro/3');
    expect(guard(route('#/entrar'), onboarding)).toBe('cadastro/3');
    expect(guard(route('#/cadastro/5'), onboarding)).toBeNull();
  });

  it('sends onboarded users from raiz, entrar and cadastro to inicio', () => {
    expect(guard(route(''), ready)).toBe('inicio');
    expect(guard(route('#/entrar'), ready)).toBe('inicio');
    expect(guard(route('#/cadastro/2'), ready)).toBe('inicio');
    expect(guard(route('#/nao-existe'), ready)).toBe('inicio');
    expect(guard(route('#/episodio/1/5'), ready)).toBeNull();
  });
});

describe('resolveView (shell)', () => {
  const route = (h: string) => parseHash(h);
  const profile = { name: 'Ana' } as Profile;
  const user = { id: 'u', email: 'a@b.c', name: 'Ana', fullName: '' };
  const ready = { ...freshState(), user, profile };

  it('renders no screen and no redirect while /api/me/state is loading', () => {
    for (const h of ['#/inicio', '#/episodio/1/5', '#/maggie/relatorio/abc', '#/perfil', '', '#/entrar']) {
      expect(resolveView('loading', route(h), freshState())).toEqual({ kind: 'blank' });
      expect(resolveView('loading', route(h), ready)).toEqual({ kind: 'blank' });
    }
  });

  it('keeps the session and shows the retry card when the load fails for another reason', () => {
    expect(resolveView('error', route('#/inicio'), freshState())).toEqual({ kind: 'failed' });
    expect(resolveView('offline', route('#/inicio'), freshState())).toEqual({ kind: 'failed' });
  });

  it('guards and renders once ready', () => {
    expect(resolveView('ready', route('#/inicio'), freshState())).toEqual({ kind: 'redirect', to: 'entrar' });
    const view = resolveView('ready', route('#/inicio'), ready);
    expect(view.kind).toBe('screen');
    expect(view.kind === 'screen' && view.def).toBe(SCREENS.inicio);
  });
});
