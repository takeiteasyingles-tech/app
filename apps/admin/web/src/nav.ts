// The panel's sections, grouped as in the sidebar. Each item names the permission(s) that show it;
// a staff member only sees what their role can open.
import type { Permission } from '@tie/shared/authz';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  perm?: Permission | readonly Permission[];
}

export interface NavGroup {
  label: string | null;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { label: null, items: [{ href: 'painel', label: 'Painel', icon: 'home' }] },
  {
    label: 'Pessoas',
    items: [
      { href: 'usuarios', label: 'Usuários', icon: 'users', perm: 'users.read' },
      { href: 'moderacao', label: 'Moderação', icon: 'flag', perm: 'moderation.manage' },
      { href: 'planos', label: 'Planos', icon: 'coin', perm: 'plans.manage' },
    ],
  },
  {
    label: 'Conteúdo',
    items: [
      { href: 'conteudo/episodios', label: 'Episódios', icon: 'trail', perm: 'content.edit' },
      { href: 'conteudo/ebooks', label: 'E-books', icon: 'book', perm: 'content.edit' },
      { href: 'conteudo/extras', label: 'Extras', icon: 'tv', perm: 'content.edit' },
      { href: 'conteudo/albuns', label: 'Álbuns', icon: 'music', perm: 'content.edit' },
      { href: 'conteudo/assistentes', label: 'Assistentes', icon: 'mic', perm: 'content.edit' },
      { href: 'conteudo/missoes', label: 'Missões do Mic', icon: 'target', perm: 'content.edit' },
      { href: 'conteudo/cadastro', label: 'Cadastro', icon: 'list', perm: 'content.edit' },
      { href: 'conteudo/gamificacao', label: 'Gamificação', icon: 'trophy', perm: 'game.rules' },
      { href: 'midia', label: 'Mídia', icon: 'image', perm: 'media.manage' },
      { href: 'publicacoes', label: 'Publicações', icon: 'rocket', perm: ['content.publish', 'releases.manage'] },
    ],
  },
  {
    label: 'Operação',
    items: [
      { href: 'auditoria', label: 'Auditoria', icon: 'history', perm: 'audit.read' },
      {
        href: 'config',
        label: 'Configurações',
        icon: 'settings',
        perm: ['flags.manage', 'settings.manage', 'ai.prompts'],
      },
    ],
  },
];
