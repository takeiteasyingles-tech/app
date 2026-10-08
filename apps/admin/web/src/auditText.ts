// pt-BR descriptions of audit_log actions (apps/admin/worker writes them; unknown ones show raw).
const FIXED: Record<string, string> = {
  'admin.auth.login': 'Entrou no painel',
  'admin.auth.login_denied': 'Tentou entrar sem papel de equipe',
  'admin.auth.lockout': 'Conta bloqueada por tentativas',
  'admin.auth.password_change': 'Trocou a própria senha',
  'admin.auth.invite_accept': 'Aceitou um convite',
  'users.suspend': 'Suspendeu uma conta',
  'users.unsuspend': 'Reativou uma conta',
  'users.delete': 'Excluiu uma conta',
  'users.plan': 'Mudou o plano de alguém',
  'users.reset_link': 'Gerou link de nova senha',
  'users.progress_reset': 'Zerou o progresso de alguém',
  'roles.grant': 'Deu um papel',
  'roles.revoke': 'Tirou um papel',
  'roles.invite': 'Convidou para a equipe',
  'transcripts.list': 'Listou conversas do Mic',
  'transcripts.read': 'Leu uma conversa do Mic',
  'moderation.excerpts_read': 'Viu trechos na moderação',
  'moderation.decide': 'Decidiu um item da moderação',
  'plans.create': 'Criou um plano',
  'plans.update': 'Editou um plano',
  'plans.deactivate': 'Desativou um plano',
  'content.publish': 'Publicou o conteúdo',
  'content.rollback': 'Voltou a uma publicação anterior',
  'content.blobs.put': 'Editou um bloco de conteúdo',
  'content.option_lists.put': 'Editou uma lista do cadastro',
  'media.upload': 'Enviou um arquivo',
  'media.delete': 'Excluiu um arquivo',
  'ai.persona': 'Editou a persona de uma assistente',
  'ai.prompt': 'Editou um prompt da IA',
  'game.rules': 'Editou a gamificação',
  'flags.set': 'Mudou uma flag',
  'settings.set': 'Mudou uma configuração',
};

const ENTITY: Record<string, string> = {
  episodes: 'episódio',
  'mic-phrases': 'frase do Mic',
  exercises: 'exercício',
  items: 'questão de exercício',
  ebooks: 'e-book',
  'test-questions': 'questão de teste',
  extras: 'Extra',
  albums: 'álbum',
  tracks: 'faixa',
  assistants: 'assistente',
  missions: 'missão do Mic',
};

const OP: Record<string, string> = { create: 'Criou', update: 'Editou', delete: 'Excluiu' };

export function auditLabel(action: string): string {
  const fixed = FIXED[action];
  if (fixed) return fixed;
  const m = /^content\.([\w-]+)\.(create|update|delete)$/.exec(action);
  if (m?.[1] && m[2]) return `${OP[m[2]]} ${ENTITY[m[1]] ?? m[1]}`;
  return action;
}

/** Icon for an action family. */
export function auditIcon(action: string): string {
  if (action.startsWith('admin.auth')) return 'key';
  if (action.startsWith('users.') || action.startsWith('roles.')) return 'users';
  if (action.startsWith('transcripts.') || action.startsWith('moderation.')) return 'shield';
  if (action.startsWith('content.publish') || action.includes('rollback')) return 'rocket';
  if (action.startsWith('content.')) return 'pen';
  if (action.startsWith('media.')) return 'image';
  if (action.startsWith('plans.')) return 'coin';
  if (action.startsWith('flags.') || action.startsWith('settings.')) return 'settings';
  if (action.startsWith('ai.')) return 'mic';
  if (action.startsWith('game.')) return 'trophy';
  return 'history';
}

/** Action prefixes the audit filter offers. */
export const AUDIT_FAMILIES: readonly (readonly [string, string])[] = [
  ['', 'Todas as ações'],
  ['admin.auth.', 'Acesso ao painel'],
  ['users.', 'Contas de usuários'],
  ['roles.', 'Papéis e convites'],
  ['transcripts.', 'Leitura de conversas'],
  ['moderation.', 'Moderação'],
  ['content.', 'Conteúdo'],
  ['media.', 'Mídia'],
  ['plans.', 'Planos'],
  ['ai.', 'IA'],
  ['game.', 'Gamificação'],
  ['flags.', 'Flags'],
  ['settings.', 'Configurações'],
];
