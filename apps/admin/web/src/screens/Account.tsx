// #/conta: a conta de quem está no painel. Mostra e-mail, papéis e o que cada papel libera, e troca
// a senha (as outras sessões da conta caem; este aparelho recebe uma sessão nova).
import { MIN_ROLE, PERMISSIONS, type Permission } from '@tie/shared/authz';
import { adminAccountApi, STAFF_PASSWORD_MIN } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { auth, logout, perms, ROLE_LABEL } from '../session';
import { Icon } from '../ui/icons';
import { Button, Card, Facts, Field, Page, Pill } from '../ui/kit';
import { toast } from '../ui/toast';
import { PasswordIn } from './Login';
import type { ScreenProps } from './registry';

const PERM_LABEL: Record<Permission, string> = {
  'users.read': 'Ver alunos e equipe',
  'users.suspend': 'Suspender e reativar contas',
  'transcripts.read': 'Ler conversas do Mic',
  'moderation.manage': 'Decidir a moderação',
  'content.edit': 'Editar conteúdo',
  'content.publish': 'Publicar conteúdo',
  'media.manage': 'Gerenciar a biblioteca de mídia',
  'users.delete': 'Excluir contas',
  'users.plan': 'Mudar o plano de alunos',
  'users.reset_link': 'Gerar link de troca de senha',
  'users.progress_reset': 'Zerar o progresso de alunos',
  'roles.grant_staff': 'Dar papéis de editor e moderador',
  'plans.manage': 'Gerenciar planos',
  'ai.persona': 'Editar a persona dos assistentes',
  'ai.prompts': 'Editar os prompts da IA',
  'game.rules': 'Mudar regras de gamificação',
  'releases.manage': 'Reverter publicações',
  'audit.read': 'Ler a auditoria',
  'flags.manage': 'Ligar e desligar recursos',
  'settings.manage': 'Mudar configurações',
  'stats.read': 'Ver o painel de números',
  'roles.grant_admin': 'Dar o papel admin',
};

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const short = next.length > 0 && next.length < STAFF_PASSWORD_MIN;
  const mismatch = next2.length > 0 && next !== next2;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!cur) return setErr('Digite a senha atual.');
    if (next.length < STAFF_PASSWORD_MIN)
      return setErr(`A senha nova precisa de pelo menos ${STAFF_PASSWORD_MIN} caracteres.`);
    if (next !== next2) return setErr('As duas senhas novas precisam ser iguais.');
    if (next === cur) return setErr('A senha nova precisa ser diferente da atual.');
    setBusy(true);
    try {
      await call(adminAccountApi.password, { body: { currentPassword: cur, newPassword: next } });
      setCur('');
      setNext('');
      setNext2('');
      toast('Senha trocada. As outras sessões foram encerradas.');
    } catch (ex) {
      setErr(errorMessage(ex));
      setCur('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Trocar a senha" sub="Ao trocar, todas as outras sessões desta conta são encerradas">
      <form class="stack" style={{ '--gap': '14px', maxWidth: '440px' }} onSubmit={submit} noValidate>
        <Field id="acc-cur" label="Senha atual">
          <PasswordIn id="acc-cur" value={cur} onValue={setCur} autoComplete="current-password" />
        </Field>
        <Field
          id="acc-new"
          label="Senha nova"
          hint={`Pelo menos ${STAFF_PASSWORD_MIN} caracteres.`}
          err={short ? `Faltam ${STAFF_PASSWORD_MIN - next.length} caracteres.` : null}
        >
          <PasswordIn
            id="acc-new"
            value={next}
            onValue={setNext}
            autoComplete="new-password"
            err={short ? 'x' : null}
          />
        </Field>
        <Field id="acc-new2" label="Repita a senha nova" err={mismatch ? 'As senhas não são iguais.' : null}>
          <PasswordIn
            id="acc-new2"
            value={next2}
            onValue={setNext2}
            autoComplete="new-password"
            err={mismatch ? 'x' : null}
          />
        </Field>
        {err ? (
          <div class="fb err" role="alert">
            {err}
          </div>
        ) : null}
        <div class="row">
          <Button type="submit" label="Trocar a senha" icon="lock" busy={busy} />
        </div>
      </form>
    </Card>
  );
}

export function Account(_: ScreenProps) {
  const me = auth.value;
  const set = perms.value;
  return (
    <Page title="Minha conta" kicker="Equipe" width={880}>
      <Card title="Quem está no painel">
        <Facts
          rows={[
            ['E-mail', <b key="e">{me?.user.email ?? '—'}</b>],
            [
              'Papéis',
              <span key="r" class="row" style={{ '--gap': '6px', flexWrap: 'wrap' }}>
                {(me?.user.roles ?? []).map((r) => (
                  <Pill key={r} label={ROLE_LABEL[r]} tone={r === 'super_admin' || r === 'admin' ? 'gr' : ''} />
                ))}
              </span>,
            ],
          ]}
        />
        <div class="row mt16">
          <Button label="Sair do painel" icon="logout" kind="light" onClick={() => void logout()} />
        </div>
      </Card>
      <Card title="O que você pode fazer" sub="Definido pelos seus papéis; o servidor confere cada ação de novo">
        <ul class="ad-perms" aria-label="Permissões">
          {PERMISSIONS.map((p) => {
            const on = set.has(p);
            return (
              <li key={p} class={on ? 'on' : 'off'}>
                <Icon name={on ? 'check' : 'lock'} size={16} />
                <span class="grow">{PERM_LABEL[p]}</span>
                {on ? null : <span class="xs">{ROLE_LABEL[MIN_ROLE[p]]}</span>}
              </li>
            );
          })}
        </ul>
      </Card>
      <PasswordCard />
    </Page>
  );
}
