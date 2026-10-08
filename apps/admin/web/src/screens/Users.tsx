// Usuários: search (e-mail, name, id) and filters kept in the URL, a paginated list, and the staff
// invite (admins: editor/moderator; the super_admin also invites admins).
import type { Role } from '@tie/shared/authz';
import { type AdminUserRow, adminPlansApi, adminUsersApi, type LinkRes } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { ApiError, call, errorMessage } from '../api';
import { fmtAgo, fmtDate, fmtDateTime, fmtInt } from '../format';
import { setQuery } from '../router';
import { can, ROLE_LABEL } from '../session';
import { useLoad, usePaged } from '../ui/async';
import {
  Button,
  Empty,
  ErrorBox,
  Field,
  MoreButton,
  OneTimeLink,
  Page,
  Pill,
  SearchBox,
  Sel,
  Skeleton,
  TextIn,
} from '../ui/kit';
import { Modal } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import type { ScreenProps } from './registry';

export const STATUS_LABEL: Record<AdminUserRow['status'], string> = {
  active: 'Ativa',
  suspended: 'Suspensa',
  deleted: 'Excluída',
};
export const STATUS_TONE: Record<AdminUserRow['status'], string> = { active: 'gr', suspended: 'gold', deleted: '' };

export function RolePills({ roles }: { roles: readonly Role[] }) {
  if (!roles.length) return <span class="xs">Aluno</span>;
  return (
    <span class="ad-pills">
      {roles.map((r) => (
        <Pill key={r} label={ROLE_LABEL[r]} tone={r === 'super_admin' || r === 'admin' ? 'navy' : 'bl'} />
      ))}
    </span>
  );
}

const COLS: Col<AdminUserRow>[] = [
  {
    key: 'who',
    label: 'Pessoa',
    cell: (u) => (
      <span class="ad-cell2">
        <span>{u.name || u.email.split('@')[0]}</span>
        <span class="xs">{u.email}</span>
      </span>
    ),
  },
  { key: 'roles', label: 'Papel', cell: (u) => <RolePills roles={u.roles} /> },
  { key: 'plan', label: 'Plano', cell: (u) => u.planSlug ?? '—' },
  { key: 'pts', label: 'Pontos', cls: 'num', cell: (u) => fmtInt(u.points) },
  { key: 'status', label: 'Conta', cell: (u) => <Pill label={STATUS_LABEL[u.status]} tone={STATUS_TONE[u.status]} /> },
  {
    key: 'last',
    label: 'Último acesso',
    cell: (u) => <span title={fmtDateTime(u.lastLoginAt)}>{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'nunca'}</span>,
  },
  { key: 'created', label: 'Criada em', cell: (u) => fmtDate(u.createdAt), desktopOnly: true },
];

export function grantableRoles(): Role[] {
  const out: Role[] = [];
  if (can('roles.grant_admin')) out.push('admin');
  if (can('roles.grant_staff')) out.push('editor', 'moderator');
  return out;
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const roles = grantableRoles();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('editor') ? 'editor' : (roles[0] ?? 'editor'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; userId?: string } | null>(null);
  const [link, setLink] = useState<LinkRes | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      setLink(await call(adminUsersApi.invite, { body: { email: email.trim(), role: role as Exclude<Role, 'super_admin'> } }));
    } catch (ex) {
      const userId =
        ex instanceof ApiError && ex.details && typeof ex.details === 'object' && 'userId' in ex.details
          ? String((ex.details as { userId: unknown }).userId)
          : undefined;
      setErr({ msg: errorMessage(ex), userId });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Convidar para a equipe"
      onClose={onClose}
      locked={busy}
      foot={
        link ? (
          <Button label="Pronto" onClick={onClose} />
        ) : (
          <>
            <Button label="Cancelar" kind="light" onClick={onClose} />
            <Button label="Gerar convite" icon="mail" type="submit" form="invite-form" busy={busy} disabled={!email.trim()} />
          </>
        )
      }
    >
      {link ? (
        <OneTimeLink url={link.url} expiresAt={link.expiresAt} note="Envie o link só para a pessoa convidada: ele cria a senha dela." />
      ) : (
        <form id="invite-form" class="stack" onSubmit={submit} noValidate>
          <p class="sm">
            O convite gera um link de uso único, válido por 7 dias. A pessoa cria a própria senha (pelo menos 10 caracteres) e já entra com o papel escolhido.
          </p>
          <Field id="inv-email" label="E-mail">
            <TextIn id="inv-email" type="email" value={email} onValue={setEmail} autoComplete="off" data-autofocus />
          </Field>
          <Field id="inv-role" label="Papel" hint={role === 'editor' ? 'Edita e publica conteúdo e mídia.' : role === 'moderator' ? 'Lê usuários, suspende contas e decide a moderação.' : 'Tudo, menos dar o papel admin.'}>
            <Sel id="inv-role" value={role} onValue={(v) => setRole(v as Role)} options={roles.map((r) => [r, ROLE_LABEL[r]] as const)} />
          </Field>
          {err ? (
            <div class="fb err" role="alert">
              {err.msg}
              {err.userId ? (
                <>
                  {' '}
                  <a class="ad-linkbtn" href={`#/usuarios/${err.userId}`}>
                    Abrir a página dela
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

export function Users({ q }: ScreenProps) {
  const search = q.q ?? '';
  const status = (q.status ?? '') as AdminUserRow['status'] | '';
  const role = (q.role ?? '') as Role | '';
  const plan = q.plan ?? '';
  const [inviting, setInviting] = useState(false);
  const plans = useLoad(async (signal) => (can('plans.manage') ? (await call(adminPlansApi.list, { signal })).items : []), []);
  const page = usePaged(
    (cursor, signal) =>
      call(adminUsersApi.list, {
        query: { q: search || undefined, status: status || undefined, role: role || undefined, plan: plan || undefined, cursor, limit: 50 },
        signal,
      }),
    [search, status, role, plan],
  );
  const filtered = !!(search || status || role || plan);
  return (
    <Page
      title="Usuários"
      kicker="Pessoas"
      actions={can('roles.grant_staff') ? <Button label="Convidar para a equipe" icon="mail" onClick={() => setInviting(true)} /> : null}
      bar={
        <div class="ad-filters">
          <SearchBox value={search} onValue={(v) => setQuery({ q: v })} placeholder="Buscar por e-mail, nome ou id" id="users-q" />
          <Sel
            ariaLabel="Situação da conta"
            value={status}
            onValue={(v) => setQuery({ status: v })}
            options={[
              ['', 'Toda situação'],
              ['active', 'Ativas'],
              ['suspended', 'Suspensas'],
            ]}
          />
          <Sel
            ariaLabel="Papel"
            value={role}
            onValue={(v) => setQuery({ role: v })}
            options={[
              ['', 'Todo papel'],
              ['super_admin', 'Super admin'],
              ['admin', 'Admin'],
              ['editor', 'Editor'],
              ['moderator', 'Moderador'],
            ]}
          />
          {plans.data?.length ? (
            <Sel
              ariaLabel="Plano"
              value={plan}
              onValue={(v) => setQuery({ plan: v })}
              options={[['', 'Todo plano'], ...plans.data.map((p) => [p.slug, p.name] as const)]}
            />
          ) : null}
          {filtered ? <Button label="Limpar" kind="link" onClick={() => setQuery({ q: '', status: '', role: '', plan: '' })} /> : null}
        </div>
      }
    >
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={8} />
      ) : !page.items.length ? (
        <Empty
          icon="users"
          title={filtered ? 'Ninguém com esses filtros.' : 'Ainda não há usuários.'}
          body={filtered ? 'Tente outra busca ou limpe os filtros.' : 'Os alunos aparecem aqui quando criam conta no app.'}
        />
      ) : (
        <>
          <Table rows={page.items} cols={COLS} rowKey={(u) => u.id} href={(u) => `usuarios/${u.id}`} caption="Usuários" />
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
          {page.error ? <ErrorBox error={page.error} retry={page.more} /> : null}
        </>
      )}
      {inviting ? <InviteModal onClose={() => setInviting(false)} /> : null}
    </Page>
  );
}
