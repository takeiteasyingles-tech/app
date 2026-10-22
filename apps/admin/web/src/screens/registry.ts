// Lazy screen registry: each route loads its own chunk; `perm` is what the screen needs (any of the
// list), `nav` the sidebar item it lights.
import type { Permission } from '@tie/shared/authz';
import type { FunctionComponent } from 'preact';
import type { RouteName, RouteParams } from '../router';

export interface ScreenProps {
  params: RouteParams;
  q: Readonly<Record<string, string>>;
}

export interface ScreenDef {
  load: () => Promise<FunctionComponent<ScreenProps>>;
  perm?: Permission | readonly Permission[];
  nav: string;
}

const m =
  <K extends string>(imp: () => Promise<Record<K, FunctionComponent<ScreenProps>>>, name: K) =>
  () =>
    imp().then((mod) => mod[name]);

export const SCREENS: Partial<Record<RouteName, ScreenDef>> = {
  dashboard: { load: m(() => import('./Dashboard'), 'Dashboard'), nav: 'painel' },
  users: { load: m(() => import('./Users'), 'Users'), perm: 'users.read', nav: 'usuarios' },
  user: { load: m(() => import('./UserDetail'), 'UserDetail'), perm: 'users.read', nav: 'usuarios' },
  plans: { load: m(() => import('./Plans'), 'Plans'), perm: 'plans.manage', nav: 'planos' },
  episodes: {
    load: m(() => import('./content/Episodes'), 'Episodes'),
    perm: 'content.edit',
    nav: 'conteudo/episodios',
  },
  episode: {
    load: m(() => import('./content/EpisodeEdit'), 'EpisodeEdit'),
    perm: 'content.edit',
    nav: 'conteudo/episodios',
  },
  ebooks: { load: m(() => import('./content/Ebooks'), 'Ebooks'), perm: 'content.edit', nav: 'conteudo/ebooks' },
  ebook: { load: m(() => import('./content/Ebooks'), 'EbookEdit'), perm: 'content.edit', nav: 'conteudo/ebooks' },
  extras: { load: m(() => import('./content/Extras'), 'Extras'), perm: 'content.edit', nav: 'conteudo/extras' },
  extra: { load: m(() => import('./content/Extras'), 'ExtraEdit'), perm: 'content.edit', nav: 'conteudo/extras' },
  albums: { load: m(() => import('./content/Albums'), 'Albums'), perm: 'content.edit', nav: 'conteudo/albuns' },
  album: { load: m(() => import('./content/Albums'), 'AlbumEdit'), perm: 'content.edit', nav: 'conteudo/albuns' },
  assistants: {
    load: m(() => import('./content/Assistants'), 'Assistants'),
    perm: 'content.edit',
    nav: 'conteudo/assistentes',
  },
  assistant: {
    load: m(() => import('./content/Assistants'), 'AssistantEdit'),
    perm: 'content.edit',
    nav: 'conteudo/assistentes',
  },
  missions: { load: m(() => import('./content/Missions'), 'Missions'), perm: 'content.edit', nav: 'conteudo/missoes' },
  mission: {
    load: m(() => import('./content/Missions'), 'MissionEdit'),
    perm: 'content.edit',
    nav: 'conteudo/missoes',
  },
  onboarding: {
    load: m(() => import('./content/Onboarding'), 'Onboarding'),
    perm: 'content.edit',
    nav: 'conteudo/cadastro',
  },
  gamification: {
    load: m(() => import('./content/Gamification'), 'Gamification'),
    perm: 'game.rules',
    nav: 'conteudo/gamificacao',
  },
  seasons: { load: m(() => import('./content/Seasons'), 'Seasons'), perm: 'content.edit', nav: 'conteudo/temporadas' },
  season: {
    load: m(() => import('./content/Seasons'), 'SeasonEdit'),
    perm: 'content.edit',
    nav: 'conteudo/temporadas',
  },
  media: { load: m(() => import('./Media'), 'Media'), perm: 'media.manage', nav: 'midia' },
  moderation: { load: m(() => import('./Moderation'), 'Moderation'), perm: 'moderation.manage', nav: 'moderacao' },
  feedbacks: { load: m(() => import('./Feedbacks'), 'Feedbacks'), perm: 'feedback.read', nav: 'feedbacks' },
  // v1 (spec 07, feature B).
  seasonTest: {
    load: m(() => import('./content/SeasonTest'), 'SeasonTestEditor'),
    perm: 'content.edit',
    nav: 'conteudo/temporadas',
  },
  certificates: { load: m(() => import('./Certificates'), 'Certificates'), perm: 'users.read', nav: 'certificados' },
  audit: { load: m(() => import('./Audit'), 'Audit'), perm: 'audit.read', nav: 'auditoria' },
  releases: {
    load: m(() => import('./Releases'), 'Releases'),
    perm: ['content.publish', 'releases.manage'],
    nav: 'publicacoes',
  },
  settings: {
    load: m(() => import('./Settings'), 'Settings'),
    perm: ['flags.manage', 'settings.manage', 'ai.prompts'],
    nav: 'config',
  },
  account: { load: m(() => import('./Account'), 'Account'), nav: 'conta' },
};
