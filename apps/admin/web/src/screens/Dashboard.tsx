// Painel: what needs attention, by role. Admins get the learner and AI numbers (stats), the
// moderation backlog and the latest audit rows; editors get the publish status (a dry-run preview);
// everyone gets shortcuts to the sections their role opens.
import { adminContentApi, adminOpsApi, type AdminStats, type AuditEntry, type PreviewRes } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../api';
import { auditIcon, auditLabel } from '../auditText';
import { fmtAgo, fmtDateTime, fmtInt, fmtLong, fmtPct } from '../format';
import { NAV_GROUPS } from '../nav';
import { useEmails } from '../people';
import { auth, can, pendingModeration, ROLE_LABEL } from '../session';
import { useBusy, useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Card, Empty, ErrorBox, Kpi, LinkButton, Page, Pill, Skeleton } from '../ui/kit';
import type { ScreenProps } from './registry';

function hello(): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(Date.now()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function StatsBlock({ s }: { s: AdminStats }) {
  const u = s.users;
  const ai = s.ai;
  const activeShare = u.total ? u.active7d / u.total : 0;
  const failTone = ai.failureRate24h >= 0.1 ? 'or' : '';
  return (
    <>
      <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="k-alunos">
        <h2 class="lbl" id="k-alunos">
          Alunos
        </h2>
        <div class="ad-kpis">
          <Kpi label="Alunos" value={fmtInt(u.total)} sub={`${fmtInt(u.new7d)} novos em 7 dias`} icon="users" tone="navy" href="usuarios" />
          <Kpi label="Ativos hoje" value={fmtInt(u.activeToday)} sub="desde a meia-noite" icon="fire" tone="or" />
          <Kpi label="Ativos em 7 dias" value={fmtInt(u.active7d)} sub={`${fmtPct(activeShare)} da base`} icon="chart" tone="bl" />
          <Kpi label="Ativos em 30 dias" value={fmtInt(u.active30d)} icon="clock" />
          <Kpi label="Suspensos" value={fmtInt(u.suspended)} icon="lock" href="usuarios?status=suspended" />
        </div>
      </section>
      <div class="ad-cols">
        <Card title="Uso da IA" sub="Workers AI: conversa, pronúncia e voz" actions={<Icon name="mic" size={20} />}>
          <div class="row wrapx" style={{ '--gap': '22px', alignItems: 'flex-end' }}>
            <div>
              <div class="num ad-kpi-v">{fmtInt(ai.minutesThisMonth)}</div>
              <div class="xs">minutos neste mês</div>
            </div>
            <div>
              <div class="num ad-kpi-v" style={{ fontSize: '1.6rem' }}>
                {fmtInt(ai.calls24h)}
              </div>
              <div class="xs">chamadas em 24 h</div>
            </div>
            <div>
              <div class={`num ad-kpi-v ${failTone ? 'ad-err-t' : ''}`} style={{ fontSize: '1.6rem' }}>
                {fmtPct(ai.failureRate24h)}
              </div>
              <div class="xs">{fmtInt(ai.errors24h)} falhas em 24 h</div>
            </div>
          </div>
          <div class="stack" style={{ '--gap': '6px' }}>
            <div class="ad-stack-bar" role="img" aria-label={`${fmtInt(ai.calls24h - ai.errors24h)} chamadas ok e ${fmtInt(ai.errors24h)} falhas nas últimas 24 horas`}>
              <i style={{ width: `${ai.calls24h ? ((ai.calls24h - ai.errors24h) / ai.calls24h) * 100 : 0}%`, background: 'var(--green)' }} />
              <i style={{ width: `${ai.calls24h ? (ai.errors24h / ai.calls24h) * 100 : 0}%`, background: 'var(--adErr)' }} />
            </div>
            <div class="ad-legend">
              <span>
                <i style={{ background: 'var(--green)' }} /> respondidas
              </span>
              <span>
                <i style={{ background: 'var(--adErr)' }} /> com falha (o app cai no modo demo)
              </span>
            </div>
          </div>
        </Card>
        <Card
          title="Moderação"
          sub="Fotos, conversas sinalizadas e denúncias"
          actions={<LinkButton href="moderacao" label="Abrir fila" icon="flag" />}
        >
          <div class="row wrapx" style={{ '--gap': '22px' }}>
            <div>
              <div class={`num ad-kpi-v ${s.moderation.pending ? '' : 'muted'}`} style={{ color: s.moderation.pending ? 'var(--orange)' : undefined }}>
                {fmtInt(s.moderation.pending)}
              </div>
              <div class="xs">itens esperando decisão</div>
            </div>
            <div>
              <div class="num ad-kpi-v" style={{ fontSize: '1.6rem' }}>
                {fmtInt(s.moderation.flaggedSessions)}
              </div>
              <div class="xs">conversas do Mic sinalizadas</div>
            </div>
          </div>
          {s.moderation.pending ? (
            <div class="ad-note">
              <Icon name="alert" size={18} /> Há itens na fila. Decida os mais antigos primeiro: a fila já vem por prioridade.
            </div>
          ) : (
            <div class="ad-note bl">
              <Icon name="check" size={18} /> Fila em dia.
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function AuditFeed() {
  const load = useLoad((signal) => call(adminOpsApi.audit, { query: { limit: 8 }, signal }), []);
  const email = useEmails(load.data?.items.map((e) => e.actorUserId) ?? []);
  return (
    <Card title="Atividade recente" sub="Últimas ações registradas na auditoria" actions={<LinkButton href="auditoria" label="Ver tudo" icon="history" />}>
      <Async load={load} rows={4}>
        {(d) =>
          d.items.length ? (
            <ul class="ad-feed">
              {d.items.map((e: AuditEntry) => (
                <li key={e.id}>
                  <span class="ad-feed-ic">
                    <Icon name={auditIcon(e.action)} size={17} />
                  </span>
                  <div class="grow" style={{ minWidth: '0' }}>
                    <div class="h3" style={{ fontSize: '.95rem' }}>
                      {auditLabel(e.action)}
                    </div>
                    <div class="xs ad-ell">
                      {email(e.actorUserId) ?? e.actorUserId ?? 'sistema'}
                      {e.targetType ? ` · ${e.targetType} ${e.targetId ?? ''}` : ''}
                    </div>
                  </div>
                  <span class="xs" title={fmtDateTime(e.at)} style={{ whiteSpace: 'nowrap' }}>
                    {fmtAgo(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="history" title="Nada registrado ainda." />
          )
        }
      </Async>
    </Card>
  );
}

function PublishCard({ current }: { current?: AdminStats['content'] }) {
  const [busy, run] = useBusy();
  const [p, setP] = useState<PreviewRes | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const check = () =>
    void run(async () => {
      setErr(null);
      try {
        setP(await call(adminContentApi.preview));
      } catch (e) {
        setP(null);
        setErr(e);
      }
    });
  return (
    <Card
      title="Conteúdo publicado"
      sub={current?.current ? `Versão ${current.current.slice(0, 10)} · ${fmtLong(current.publishedAt)}` : 'O que os alunos veem agora'}
      actions={<LinkButton href="publicacoes" label="Publicações" icon="rocket" />}
    >
      {p ? (
        p.errors.length ? (
          <div class="ad-note">
            <Icon name="alert" size={18} /> {p.errors.length} problema(s) impedem publicar. Veja em Publicações.
          </div>
        ) : p.changed.length ? (
          <div class="ad-note bl">
            <Icon name="pen" size={18} /> {p.changed.length} arquivo(s) mudaram desde a última publicação.
          </div>
        ) : (
          <div class="ad-note bl">
            <Icon name="check" size={18} /> Tudo publicado: o rascunho é igual ao que os alunos veem.
          </div>
        )
      ) : err ? (
        <ErrorBox error={err} />
      ) : (
        <p class="sm">Confira se há edições esperando publicação. A verificação compila o conteúdo sem publicar nada.</p>
      )}
      <div>
        <Button label={p ? 'Verificar de novo' : 'Verificar mudanças'} icon="refresh" kind="light" busy={busy} onClick={check} />
      </div>
    </Card>
  );
}

export function Dashboard(_: ScreenProps) {
  const a = auth.value;
  const stats = useLoad<AdminStats | null>(
    async (signal) => {
      if (!can('stats.read')) return null;
      const s = await call(adminOpsApi.stats, { signal });
      pendingModeration.value = s.moderation.pending;
      return s;
    },
    [],
  );
  const name = a?.user.email.split('@')[0] ?? '';
  const quick = NAV_GROUPS.flatMap((g) => g.items).filter((it) => it.href !== 'painel' && (!it.perm || can(it.perm)));
  return (
    <Page
      title={`${hello()}, ${name}`}
      kicker="Painel"
      actions={
        can('stats.read') ? <Button label="Atualizar" icon="refresh" kind="light" onClick={stats.reload} busy={stats.loading && !!stats.data} /> : null
      }
    >
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        {(a?.user.roles ?? []).map((r) => (
          <Pill key={r} label={ROLE_LABEL[r]} tone="navy" icon="shield" />
        ))}
        <span class="xs">Cada ação no painel fica registrada na auditoria.</span>
      </div>
      {can('stats.read') ? (
        stats.error && !stats.data ? (
          <ErrorBox error={stats.error} retry={stats.reload} />
        ) : stats.data ? (
          <StatsBlock s={stats.data} />
        ) : (
          <Skeleton rows={3} height={110} />
        )
      ) : null}
      <div class="ad-cols">
        {can('content.publish') ? <PublishCard current={stats.data?.content} /> : null}
        {can('moderation.manage') && !can('stats.read') ? (
          <Card title="Moderação" sub="Fotos, conversas sinalizadas e denúncias" actions={<LinkButton href="moderacao" label="Abrir fila" icon="flag" />}>
            <p class="sm">A fila vem por prioridade e, dentro dela, pelos itens mais antigos.</p>
          </Card>
        ) : null}
        {can('audit.read') ? <AuditFeed /> : null}
      </div>
      {quick.length ? (
        <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="atalhos">
          <h2 class="lbl" id="atalhos">
            Atalhos
          </h2>
          <nav class="ad-quick" aria-label="Atalhos">
            {quick.map((it) => (
              <a key={it.href} href={`#/${it.href}`}>
                <Icon name={it.icon} size={20} />
                <span>{it.label}</span>
              </a>
            ))}
          </nav>
        </section>
      ) : null}
    </Page>
  );
}
