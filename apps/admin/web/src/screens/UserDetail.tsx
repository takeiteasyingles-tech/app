// Página de um usuário: perfil, conta, progresso, plano e minutos de IA, papéis, foto, ações (suspender,
// link de senha, zerar progresso, excluir) e as conversas do Mic (só sob demanda: cada leitura é
// auditada). Ações que o papel não permite somem; as que o servidor recusaria (a própria conta, alguém
// de papel acima) aparecem desativadas com o motivo.
import { canGrantRole, type Role } from '@tie/shared/authz';
import { type AdminMicSessionRow, adminPlansApi, adminUsersApi, type LinkRes, type UserDetail as UD } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtAgo, fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtLong, fmtMinutes, fromDateInputEnd, toDateInput } from '../format';
import { rememberEmail } from '../people';
import { go } from '../router';
import { auth, can, ROLE_LABEL } from '../session';
import { useBusy, useLoad, usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Card, CopyButton, Empty, ErrorBox, Facts, Field, Meter, MoreButton, OneTimeLink, Page, Pill, Sel, Switch, TextIn } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';
import { MODE_LABEL, TranscriptModal } from './Transcript';
import { RolePills, STATUS_LABEL, STATUS_TONE } from './Users';

const LEVEL_LABEL: Record<string, string> = {
  zero: 'Do zero (A1)',
  basico: 'Sei o básico (A1+)',
  meviro: 'Me viro (A2)',
  avancar: 'Rumo ao avançado (B1)',
};

function canManage(target: readonly Role[]): boolean {
  const mine = auth.value?.user.roles ?? [];
  return target.every((r) => canGrantRole(mine, r));
}

function PlanCard({ u, onChange }: { u: UD; onChange: () => void }) {
  const plans = useLoad(async (signal) => (can('plans.manage') ? (await call(adminPlansApi.list, { signal })).items : null), []);
  const cur = u.plan;
  const [planId, setPlanId] = useState(cur?.plan.id ?? '');
  const [exp, setExp] = useState(toDateInput(cur?.expiresAt ?? null));
  const [busy, run] = useBusy();
  const editable = can('users.plan') && canManage(u.roles) && u.id !== auth.value?.user.id;
  const usedPct = u.quota.limitS ? u.quota.usedS / u.quota.limitS : 0;
  const save = () =>
    void run(async () => {
      try {
        await call(adminUsersApi.assignPlan, {
          params: { id: u.id },
          body: { planId, expiresAt: exp ? fromDateInputEnd(exp) : null },
        });
        toast('Plano atualizado.');
        onChange();
      } catch (e) {
        toast(errorMessage(e), 'err');
      }
    });
  const active = plans.data?.filter((p) => p.active) ?? [];
  return (
    <Card title="Plano e minutos de IA" sub={`Período ${u.quota.period}`}>
      <Facts
        rows={[
          ['Plano atribuído', cur ? `${cur.plan.name} (${cur.plan.slug})` : 'Nenhum: usa o plano padrão'],
          ['Desde', cur ? fmtDate(cur.assignedAt) : '—'],
          ['Validade', cur?.expiresAt ? fmtDate(cur.expiresAt) : cur ? 'Sem validade' : '—'],
        ]}
      />
      <div class="stack" style={{ '--gap': '6px' }}>
        <div class="row between">
          <span class="sm">
            <b>{fmtMinutes(u.quota.usedS)}</b> de {fmtMinutes(u.quota.limitS)} usados
          </span>
          <span class="xs">{fmtMinutes(u.quota.leftS)} restantes</span>
        </div>
        <Meter value={u.quota.usedS} max={u.quota.limitS} tone={usedPct >= 0.9 ? 'or' : ''} />
      </div>
      {editable && plans.data ? (
        <div class="ad-grid">
          <Field id="u-plan" label="Mudar para">
            <Sel id="u-plan" value={planId} onValue={setPlanId} options={[['', 'Escolha um plano'], ...active.map((p) => [p.id, `${p.name} · ${p.aiMinutesMonth} min/mês`] as const)]} />
          </Field>
          <Field id="u-exp" label="Válido até" opt hint="Sem data, não expira.">
            <TextIn id="u-exp" type="date" value={exp} onValue={setExp} min={toDateInput(Date.now() + 86_400_000)} />
          </Field>
          <div class="ad-span">
            <Button label="Salvar plano" icon="check" busy={busy} disabled={!planId} onClick={save} />
          </div>
        </div>
      ) : can('users.plan') && !editable ? (
        <p class="xs">Você não pode mudar o plano desta conta.</p>
      ) : null}
    </Card>
  );
}

function RolesCard({ u, onRoles }: { u: UD; onRoles: (r: Role[]) => void }) {
  const [busy, setBusy] = useState<Role | null>(null);
  const mine = auth.value?.user.roles ?? [];
  const self = u.id === auth.value?.user.id;
  const manage = canManage(u.roles);
  const list: Role[] = ['admin', 'editor', 'moderator'];
  const toggle = async (r: Role, on: boolean) => {
    setBusy(r);
    try {
      const res = await call(on ? adminUsersApi.grantRole : adminUsersApi.revokeRole, { params: { id: u.id, role: r } });
      onRoles(res.roles);
      toast(on ? `Papel ${ROLE_LABEL[r]} concedido.` : `Papel ${ROLE_LABEL[r]} removido.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Papéis na equipe" sub="Quem pode entrar no painel e o que pode fazer">
      {u.roles.includes('super_admin') ? (
        <div class="ad-note bl">
          <Icon name="shield" size={18} /> Super admin: o papel não muda pelo painel.
        </div>
      ) : null}
      <div class="stack" style={{ '--gap': '10px' }}>
        {list.map((r) => {
          const on = u.roles.includes(r);
          const allowed = canGrantRole(mine, r) && manage && !self && u.status === 'active';
          return (
            <div key={r} class="ad-bool">
              <Switch id={`role-${r}`} on={on} label={`Papel ${ROLE_LABEL[r]}`} disabled={!allowed || busy !== null} onChange={(v) => void toggle(r, v)} />
              <label for={`role-${r}`} class="grow">
                <span class="ad-bool-l">{ROLE_LABEL[r]}</span>
                <small class="xs">
                  {r === 'admin' ? 'Tudo, menos dar o papel admin.' : r === 'editor' ? 'Conteúdo, mídia e publicação.' : 'Usuários, suspensões e moderação.'}
                </small>
              </label>
            </div>
          );
        })}
      </div>
      {self ? (
        <p class="xs">Seus próprios papéis não mudam por aqui.</p>
      ) : !manage ? (
        <p class="xs">Esta conta tem um papel acima do seu.</p>
      ) : u.status !== 'active' ? (
        <p class="xs">Reative a conta antes de dar papéis.</p>
      ) : null}
    </Card>
  );
}

function ActionsCard({ u, reload, onLink }: { u: UD; reload: () => void; onLink: (l: LinkRes) => void }) {
  const self = u.id === auth.value?.user.id;
  const manage = canManage(u.roles);
  const blocked = self ? 'Use a sua conta pela página Minha conta.' : !manage ? 'Esta conta tem um papel acima do seu.' : null;
  const [linkBusy, runLink] = useBusy();
  const suspended = u.status === 'suspended';
  const suspend = () =>
    void confirmAction({
      title: suspended ? 'Reativar esta conta?' : 'Suspender esta conta?',
      body: suspended
        ? 'A pessoa volta a entrar no app (e no painel, se tiver papel).'
        : 'A pessoa sai na hora de todos os aparelhos e não consegue entrar até ser reativada.',
      confirm: suspended ? 'Reativar' : 'Suspender',
      danger: !suspended,
      reason: { label: 'Motivo (vai para a auditoria)', required: true },
      run: (reason) => call(adminUsersApi.suspend, { params: { id: u.id }, body: { suspended: !suspended, reason } }),
    }).then((ok) => {
      if (ok) {
        toast(suspended ? 'Conta reativada.' : 'Conta suspensa.');
        reload();
      }
    });
  const resetLink = () =>
    void runLink(async () => {
      try {
        onLink(await call(adminUsersApi.resetLink, { params: { id: u.id } }));
      } catch (e) {
        toast(errorMessage(e), 'err');
      }
    });
  const progressReset = () =>
    void confirmAction({
      title: 'Zerar o progresso?',
      body: 'Apaga episódios, notas, respostas, baralho, pontos e conversas do Mic (as sinalizadas ficam, como prova da moderação). Conta, perfil e plano continuam.',
      confirm: 'Zerar progresso',
      danger: true,
      reason: { label: 'Motivo (vai para a auditoria)', required: true },
      run: (reason) => call(adminUsersApi.progressReset, { params: { id: u.id }, body: { reason } }),
    }).then((ok) => {
      if (ok) {
        toast('Progresso zerado.');
        reload();
      }
    });
  const remove = () =>
    void confirmAction({
      title: 'Excluir esta conta para sempre?',
      body: 'Apaga a conta, o perfil, o progresso e os arquivos enviados (LGPD). Não dá para desfazer.',
      confirm: 'Excluir conta',
      danger: true,
      reason: { label: 'Motivo (vai para a auditoria)', required: true },
      typeToConfirm: u.email,
      run: (reason) => call(adminUsersApi.remove, { params: { id: u.id }, body: { reason } }),
    }).then((ok) => {
      if (ok) {
        toast('Conta excluída.');
        go('usuarios');
      }
    });
  const any = can('users.suspend') || can('users.reset_link') || can('users.progress_reset') || can('users.delete');
  if (!any) return null;
  return (
    <Card title="Ações na conta" sub="Cada ação pede confirmação e fica na auditoria">
      {blocked ? (
        <div class="ad-note bl">
          <Icon name="lock" size={18} /> {blocked}
        </div>
      ) : null}
      <div class="stack" style={{ '--gap': '8px' }}>
        {can('users.suspend') ? (
          <Button label={suspended ? 'Reativar conta' : 'Suspender conta'} icon={suspended ? 'check' : 'lock'} kind="light" disabled={!!blocked} onClick={suspend} />
        ) : null}
        {can('users.reset_link') ? (
          <Button label="Gerar link de nova senha" icon="key" kind="light" busy={linkBusy} disabled={!!blocked || suspended} onClick={resetLink} />
        ) : null}
        {can('users.progress_reset') ? (
          <Button label="Zerar progresso" icon="refresh" kind="light" disabled={!manage && !self} onClick={progressReset} />
        ) : null}
        {can('users.delete') ? <Button label="Excluir conta" icon="trash" kind="ad-danger-l" disabled={!!blocked} onClick={remove} /> : null}
      </div>
    </Card>
  );
}

const MIC_COLS = (open: (id: string) => void): Col<AdminMicSessionRow>[] => [
  {
    key: 'when',
    label: 'Conversa',
    cell: (s) => (
      <button type="button" class="ad-rowlink" onClick={() => open(s.id)}>
        {fmtDateTime(s.startedAt)}
      </button>
    ),
  },
  { key: 'mode', label: 'Modo', cell: (s) => MODE_LABEL[s.mode] },
  { key: 'asst', label: 'Assistente', cell: (s) => s.assistant },
  { key: 'dur', label: 'Duração', cls: 'num', cell: (s) => fmtDuration(s.secs * 1000) },
  { key: 'turns', label: 'Falas', cls: 'num', cell: (s) => fmtInt(s.turns) },
  { key: 'flag', label: 'Sinal', cell: (s) => (s.flagged ? <Pill label="Sinalizada" tone="or" icon="flag" /> : '—') },
];

function MicSessions({ userId }: { userId: string }) {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const page = usePaged(
    async (cursor, signal) => (shown ? call(adminUsersApi.micSessions, { query: { userId, cursor, limit: 20 }, signal }) : { items: [], nextCursor: null }),
    [shown, userId],
  );
  return (
    <Card
      title="Conversas do Mic"
      sub="Transcrições das conversas com as assistentes"
      actions={!shown ? <Button label="Mostrar conversas" icon="eye" kind="light" onClick={() => setShown(true)} /> : null}
    >
      {!shown ? (
        <p class="sm">
          Por privacidade, a lista só abre quando você pede. Listar e abrir conversas fica registrado na auditoria.
        </p>
      ) : page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <span class="ad-skel" style={{ height: '120px' }} />
      ) : !page.items.length ? (
        <Empty icon="mic" title="Nenhuma conversa." />
      ) : (
        <>
          <Table rows={page.items} cols={MIC_COLS(setOpen)} rowKey={(s) => s.id} caption="Conversas do Mic" />
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
      {open ? <TranscriptModal id={open} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

export function UserDetail({ params }: ScreenProps) {
  const id = params.id ?? '';
  const load = useLoad(async (signal) => {
    const u = await call(adminUsersApi.get, { params: { id }, signal });
    rememberEmail(u.id, u.email);
    return u;
  }, [id]);
  const [link, setLink] = useState<LinkRes | null>(null);
  const u = load.data;
  const title = u ? u.profile?.name || u.email : 'Usuário';
  return (
    <Page title={title} kicker="Usuário" back="usuarios">
      <Async load={load} rows={6}>
        {(u) => (
          <>
            <section class="card ad-card" aria-label="Resumo">
              <div class="row wrapx" style={{ '--gap': '14px' }}>
                {u.photo && u.photo.status === 'active' ? (
                  <img class="ad-photo" style={{ width: '64px', height: '64px', borderRadius: '50%' }} src={u.photo.url} alt="Foto do aluno" />
                ) : (
                  <span class="ad-me-av" style={{ width: '64px', height: '64px', fontSize: '1.6rem' }} aria-hidden="true">
                    {u.email.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div class="grow stack" style={{ '--gap': '4px', minWidth: '200px' }}>
                  <div class="h2 ad-break" style={{ wordBreak: 'normal' }}>
                    {u.email}
                  </div>
                  <div class="row wrapx" style={{ '--gap': '6px' }}>
                    <Pill label={STATUS_LABEL[u.status]} tone={STATUS_TONE[u.status]} />
                    <RolePills roles={u.roles} />
                    {u.lockedUntil && u.lockedUntil > Date.now() ? <Pill label="Bloqueada por tentativas" tone="or" icon="lock" /> : null}
                  </div>
                </div>
                <div class="row" style={{ '--gap': '6px' }}>
                  <CopyButton text={u.id} label="Copiar id" />
                </div>
              </div>
            </section>
            {link ? <OneTimeLink url={link.url} expiresAt={link.expiresAt} note="Envie só para o dono da conta: o link troca a senha dele. Um link novo anula o anterior." /> : null}
            <div class="ad-cols">
              <div class="stack" style={{ '--gap': '18px' }}>
                <Card title="Perfil" sub={u.profile ? undefined : 'Cadastro ainda não começou'}>
                  {u.profile ? (
                    <Facts
                      rows={[
                        ['Nome', u.profile.name ?? '—'],
                        ['Nome completo', u.profile.fullName ?? '—'],
                        ['Faixa etária', u.profile.ageBand ?? '—'],
                        ['Nível', LEVEL_LABEL[u.profile.level] ?? u.profile.level],
                        ['Cadastro', u.profile.onbCompletedAt ? `Concluído em ${fmtDate(u.profile.onbCompletedAt)}` : `Na etapa ${u.profile.onbStep} de 7`],
                      ]}
                    />
                  ) : (
                    <p class="sm">Sem perfil.</p>
                  )}
                </Card>
                <Card title="Progresso">
                  <div class="ad-kpis">
                    <div class="ad-kpi">
                      <span class="lbl">Pontos</span>
                      <span class="num ad-kpi-v">{fmtInt(u.stats.points)}</span>
                    </div>
                    <div class="ad-kpi">
                      <span class="lbl">Sequência</span>
                      <span class="num ad-kpi-v">{fmtInt(u.stats.streak)}</span>
                      <span class="xs">{u.stats.lastDay ? `último dia ${u.stats.lastDay}` : 'sem dias ainda'}</span>
                    </div>
                    <div class="ad-kpi">
                      <span class="lbl">Conversas</span>
                      <span class="num ad-kpi-v">{fmtInt(u.micSessions)}</span>
                    </div>
                  </div>
                </Card>
                <Card title="Conta">
                  <Facts
                    rows={[
                      ['Criada', fmtLong(u.createdAt)],
                      ['Último login', u.lastLoginAt ? `${fmtDateTime(u.lastLoginAt)} (${fmtAgo(u.lastLoginAt)})` : 'Nunca'],
                      ['Fuso', u.tz],
                      ['Tentativas erradas', String(u.failedLogins)],
                      ['Bloqueada até', u.lockedUntil ? fmtDateTime(u.lockedUntil) : '—'],
                      ['Termos', u.termsVersion ? `${u.termsVersion} · ${fmtDate(u.termsAcceptedAt)}` : 'Não aceitos'],
                      ['Id', <code class="ad-mono">{u.id}</code>],
                    ]}
                  />
                </Card>
              </div>
              <div class="stack" style={{ '--gap': '18px' }}>
                <ActionsCard u={u} reload={load.reload} onLink={setLink} />
                <PlanCard u={u} onChange={load.reload} />
                {can('roles.grant_staff') ? (
                  <RolesCard u={u} onRoles={(roles) => load.setData((prev) => ({ ...(prev as UD), roles }))} />
                ) : null}
                {u.photo ? (
                  <Card title="Foto de perfil" actions={can('moderation.manage') ? <a class="btn compact light" href="#/moderacao?kind=photo">Moderação</a> : null}>
                    <div class="row wrapx" style={{ '--gap': '14px' }}>
                      <img class="ad-photo" src={u.photo.url} alt="Foto enviada pelo aluno" />
                      <Pill label={u.photo.status === 'active' ? 'Visível' : 'Removida pela moderação'} tone={u.photo.status === 'active' ? 'gr' : 'gold'} />
                    </div>
                  </Card>
                ) : null}
              </div>
            </div>
            {can('transcripts.read') ? <MicSessions userId={u.id} /> : null}
          </>
        )}
      </Async>
    </Page>
  );
}
