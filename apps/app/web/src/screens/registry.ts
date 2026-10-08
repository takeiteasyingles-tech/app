// TIE.screens: one lazy chunk per screen, with the chrome its prototype render() returned
// (tabs / theme / nav). Screens refine it at runtime with useChrome().
import type { Chrome, ScreenProps } from '../frame';
import type { RouteName } from '../router';
import { type LazyComponent, lazy } from './lazy';

export interface ScreenDef {
  component: LazyComponent<ScreenProps>;
  chrome: Chrome;
}

type ScreenName = Exclude<RouteName, 'raiz'>;

export const SCREENS: Readonly<Record<ScreenName, ScreenDef>> = {
  entrar: { component: lazy(() => import('./entrada/Entrar')), chrome: { theme: 'cream' } },
  cadastro: { component: lazy(() => import('./cadastro/Cadastro')), chrome: {} },
  inicio: { component: lazy(() => import('./inicio/Inicio')), chrome: { tabs: true } },
  trilha: { component: lazy(() => import('./trilha/Trilha')), chrome: { tabs: true } },
  ebook: { component: lazy(() => import('./ebook/Ebook')), chrome: { tabs: true, nav: 'trilha' } },
  ebookx: { component: lazy(() => import('./ebook/EbookPart')), chrome: { tabs: false } },
  player: { component: lazy(() => import('./player/Player')), chrome: {} },
  concluido: { component: lazy(() => import('./concluido/Concluido')), chrome: {} },
  extra: { component: lazy(() => import('./extra/Extra')), chrome: { tabs: true, theme: 'navy' } },
  extraDetail: {
    component: lazy(() => import('./extra/ExtraDetail')),
    chrome: { tabs: true, theme: 'navy', nav: 'extra' },
  },
  extraPlay: { component: lazy(() => import('./extra/ExtraPlay')), chrome: { theme: 'navy' } },
  musica: { component: lazy(() => import('./extra/Musica')), chrome: { theme: 'navy' } },
  desafio: { component: lazy(() => import('./extra/Desafio')), chrome: { theme: 'navy' } },
  maggie: { component: lazy(() => import('./maggie/Maggie')), chrome: { tabs: true, theme: 'navy', nav: 'maggie' } },
  relatorio: { component: lazy(() => import('./maggie/Relatorio')), chrome: { tabs: true, nav: 'maggie' } },
  revisao: { component: lazy(() => import('./revisao/Revisao')), chrome: { tabs: true } },
  perfil: { component: lazy(() => import('./perfil/Perfil')), chrome: { tabs: true } },
  conquistas: { component: lazy(() => import('./conquistas/Conquistas')), chrome: { tabs: true } },
};

export function screenFor(name: RouteName): ScreenDef | undefined {
  return name === 'raiz' ? undefined : SCREENS[name];
}

/** The prototype's SECTION(): which nav item a route lights up. */
export const SECTION: Readonly<Partial<Record<RouteName, string>>> = {
  inicio: 'inicio',
  trilha: 'trilha',
  ebook: 'trilha',
  ebookx: 'trilha',
  player: 'trilha',
  concluido: 'trilha',
  extra: 'extra',
  extraDetail: 'extra',
  extraPlay: 'extra',
  musica: 'extra',
  desafio: 'extra',
  maggie: 'maggie',
  relatorio: 'maggie',
  revisao: 'revisao',
  perfil: 'perfil',
  conquistas: 'conquistas',
};
