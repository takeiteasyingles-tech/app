import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/fixture/state';
import { ADMIN_ROUTES, adminRoutes, appRoutes, hashOf, selectRoutes } from '../src/routes';

const fixture = loadFixture();
const all = appRoutes(fixture);

describe('route table', () => {
  it('has every route id of the spec, unique', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const want = [
      'entrar',
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `cadastro-${n}`),
      'inicio',
      'trilha',
      'ebook-1',
      'ebook-five',
      'ebook-real',
      'ebook-lead',
      'ebook-teste',
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `ep1-${n}`),
      'concluido-1',
      'extra',
      'extra-detail',
      'extra-play',
      'extra-musica',
      'extra-desafio',
      'maggie',
      'maggie-relatorio',
      'revisao',
      'perfil',
      'conquistas',
    ];
    expect(ids.sort()).toEqual(want.sort());
  });

  it('users: signed out on entrar, fresh with its onbStep on cadastro-N, ep1 steps 7..10 advanced', () => {
    const by = Object.fromEntries(all.map((r) => [r.id, r]));
    expect(by.entrar?.user).toBe('none');
    expect(by['cadastro-4']).toMatchObject({ user: 'fresh', onbStep: 4, hash: 'cadastro/4' });
    expect(by['ep1-6']?.user).toBe('main');
    expect(by['ep1-7']?.user).toBe('ep1-s7');
    expect(by['ep1-10']).toMatchObject({ user: 'ep1-s10', hash: 'episodio/1/10' });
    expect(by['extra-detail']?.hash).toBe('extra/woods-and-beans');
    expect(by['extra-musica']?.hash).toBe('extra/musica/season-one');
  });

  it('maggie-relatorio follows the session id of the state it is captured with', () => {
    const r = all.find((x) => x.id === 'maggie-relatorio');
    if (!r) throw new Error('missing maggie-relatorio');
    expect(r.hash).toBe(`maggie/relatorio/${fixture.maggie.sessions[0].id}`);
    expect(hashOf(r, { maggie: { sessions: [{ id: 'zzz1234' }] } })).toBe('maggie/relatorio/zzz1234');
    expect(hashOf(r, null)).toBe(r.hash);
    const inicio = all.find((x) => x.id === 'inicio');
    if (!inicio) throw new Error('missing inicio');
    expect(hashOf(inicio, fixture)).toBe('inicio');
  });
});

describe('selectRoutes', () => {
  it('all / empty → the whole table', () => {
    expect(selectRoutes(all, 'all')).toBe(all);
    expect(selectRoutes(all, '')).toBe(all);
    expect(selectRoutes(all, 'inicio,all')).toBe(all);
  });

  it('keeps the requested order and trims', () => {
    expect(selectRoutes(all, ' inicio , entrar ').map((r) => r.id)).toEqual(['inicio', 'entrar']);
  });

  it('unknown ids are an error that lists the valid ones', () => {
    expect(() => selectRoutes(all, 'inicio,nope,also-nope')).toThrow(
      /unknown route id\(s\): nope, also-nope[\s\S]*valid: entrar/,
    );
  });
});

describe('adminRoutes', () => {
  it('has the admin route ids, unique, with the staff fixture of each', () => {
    const ids = ADMIN_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const want of [
      'login',
      'dashboard',
      'users',
      'user-detail',
      'plans',
      'content-episodes',
      'content-episode-edit',
      'content-extras',
      'content-assistants',
      'content-onboarding',
      'media',
      'moderation',
      'audit',
      'releases',
      'settings',
    ])
      expect(ids).toContain(want);
    const by = Object.fromEntries(ADMIN_ROUTES.map((r) => [r.id, r]));
    expect(by.login).toMatchObject({ hash: 'entrar', staff: 'none' });
    expect(by['user-detail']?.hash).toBe('usuarios/U_PARITY');
    expect(by['content-episode-edit']).toMatchObject({ hash: 'conteudo/episodios/1', staff: 'super_admin' });
    expect(by['editor-content-episode-edit']).toMatchObject({ hash: 'conteudo/episodios/1', staff: 'editor' });
  });

  it('ids select from the table, in order; all / empty → the whole table', () => {
    expect(adminRoutes('settings, login').map((x) => x.id)).toEqual(['settings', 'login']);
    expect(adminRoutes('all')).toHaveLength(ADMIN_ROUTES.length);
    expect(adminRoutes('')).toHaveLength(ADMIN_ROUTES.length);
  });

  it('anything else is a raw hash with a file-safe id, captured as the super_admin', () => {
    const r = adminRoutes('#/usuarios/U_X, conteudo/extras/abc,/planos/z');
    expect(r.map((x) => [x.id, x.hash, x.staff])).toEqual([
      ['usuarios_U_X', 'usuarios/U_X', 'super_admin'],
      ['conteudo_extras_abc', 'conteudo/extras/abc', 'super_admin'],
      ['planos_z', 'planos/z', 'super_admin'],
    ]);
  });
});
