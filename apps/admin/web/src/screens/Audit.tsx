// Auditoria (admin): the append-only log of every staff action and sensitive read, newest first, with
// filters in the URL (action family, actor, target, period) and each entry's diff.
import { adminOpsApi, type AuditEntry } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../api';
import { AUDIT_FAMILIES, auditIcon, auditLabel } from '../auditText';
import { fmtAgo, fmtDateTime, fromDateInputEnd, fromDateInputStart } from '../format';
import { useEmails } from '../people';
import { setQuery } from '../router';
import { ROLE_LABEL } from '../session';
import type { Role } from '@tie/shared/authz';
import { usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Button, Empty, ErrorBox, Facts, Field, MoreButton, Page, Sel, Skeleton, TextIn } from '../ui/kit';
import { Modal } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import type { ScreenProps } from './registry';

function targetHref(e: AuditEntry): string | null {
  if (!e.targetId) return null;
  switch (e.targetType) {
    case 'user':
      return `usuarios/${e.targetId}`;
    case 'episode':
      return `conteudo/episodios/${e.targetId}`;
    case 'extra':
      return `conteudo/extras/${e.targetId}`;
    case 'album':
      return `conteudo/albuns/${e.targetId}`;
    case 'assistant':
      return `conteudo/assistentes/${e.targetId}`;
    case 'mic_mission':
      return `conteudo/missoes/${e.targetId}`;
    case 'ebook':
      return `conteudo/ebooks/${e.targetId}`;
    default:
      return null;
  }
}

function DiffModal({ e, who, onClose }: { e: AuditEntry; who: string; onClose: () => void }) {
  return (
    <Modal title={auditLabel(e.action)} size="lg" onClose={onClose}>
      <Facts
        rows={[
          ['Quando', fmtDateTime(e.at)],
          ['Quem', `${who}${e.actorRole ? ` (${ROLE_LABEL[e.actorRole as Role] ?? e.actorRole})` : ''}`],
          ['Ação', <code class="ad-mono">{e.action}</code>],
          ['Alvo', e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—'],
          ['IP (hash)', e.ipHash ? <code class="ad-mono">{e.ipHash.slice(0, 16)}…</code> : '—'],
          ['Navegador', e.ua ?? '—'],
        ]}
      />
      <div class="lbl">Detalhes</div>
      {e.diff == null ? <p class="sm">Sem detalhes.</p> : <pre class="ad-json">{JSON.stringify(e.diff, null, 2)}</pre>}
    </Modal>
  );
}

export function Audit({ q }: ScreenProps) {
  const action = q.acao ?? '';
  const actor = q.quem ?? '';
  const targetType = q.alvo ?? '';
  const targetId = q.alvoId ?? '';
  const from = q.de ?? '';
  const to = q.ate ?? '';
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const [ft, setFt] = useState({ actor, targetType, targetId });
  const page = usePaged(
    (cursor, signal) =>
      call(adminOpsApi.audit, {
        query: {
          action: action || undefined,
          actor: actor || undefined,
          targetType: targetType || undefined,
          targetId: targetId || undefined,
          from: from ? (fromDateInputStart(from) ?? undefined) : undefined,
          to: to ? (fromDateInputEnd(to) ?? undefined) : undefined,
          cursor,
          limit: 50,
        },
        signal,
      }),
    [action, actor, targetType, targetId, from, to],
  );
  const email = useEmails(page.items.map((e) => e.actorUserId));
  const who = (e: AuditEntry) => (e.actorUserId ? (email(e.actorUserId) ?? e.actorUserId) : 'sistema');
  const cols: Col<AuditEntry>[] = [
    {
      key: 'at',
      label: 'Quando',
      cell: (e) => (
        <span class="ad-cell2" title={fmtDateTime(e.at)}>
          <span>{fmtDateTime(e.at)}</span>
          <span class="xs">{fmtAgo(e.at)}</span>
        </span>
      ),
    },
    {
      key: 'act',
      label: 'Ação',
      cell: (e) => (
        <span class="row" style={{ '--gap': '8px' }}>
          <span class="ad-feed-ic">
            <Icon name={auditIcon(e.action)} size={15} />
          </span>
          <span class="ad-cell2">
            <span>{auditLabel(e.action)}</span>
            <span class="xs ad-mono">{e.action}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'who',
      label: 'Quem',
      cell: (e) => (
        <span class="ad-cell2">
          {e.actorUserId ? (
            <a class="ad-linkbtn" href={`#/usuarios/${e.actorUserId}`}>
              {who(e)}
            </a>
          ) : (
            <span>sistema</span>
          )}
          {e.actorRole ? <span class="xs">{ROLE_LABEL[e.actorRole as Role] ?? e.actorRole}</span> : null}
        </span>
      ),
    },
    {
      key: 'tgt',
      label: 'Alvo',
      cell: (e) => {
        const href = targetHref(e);
        const label = e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—';
        return href ? (
          <a class="ad-linkbtn ad-break" href={`#/${href}`}>
            {label}
          </a>
        ) : (
          <span class="ad-break">{label}</span>
        );
      },
    },
    {
      key: 'd',
      label: 'Detalhes',
      cls: 'shrink',
      cell: (e) => <Button label="Ver" icon="eye" kind="light" onClick={() => setOpen(e)} />,
    },
  ];
  const filtered = !!(action || actor || targetType || targetId || from || to);
  return (
    <Page
      title="Auditoria"
      kicker="Operação"
      bar={
        <div class="ad-filters">
          <Sel ariaLabel="Tipo de ação" value={action} onValue={(v) => setQuery({ acao: v })} options={AUDIT_FAMILIES} />
          <TextIn id="au-de" type="date" aria-label="De" value={from} onValue={(v) => setQuery({ de: v })} style={{ width: 'auto' }} />
          <TextIn id="au-ate" type="date" aria-label="Até" value={to} onValue={(v) => setQuery({ ate: v })} style={{ width: 'auto' }} />
          {filtered ? <Button label="Limpar" kind="link" onClick={() => setQuery({ acao: '', quem: '', alvo: '', alvoId: '', de: '', ate: '' })} /> : null}
        </div>
      }
    >
      <details class="card ad-card">
        <summary class="h3" style={{ cursor: 'pointer' }}>
          Mais filtros
        </summary>
        <form
          class="ad-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ quem: ft.actor.trim(), alvo: ft.targetType.trim(), alvoId: ft.targetId.trim() });
          }}
        >
          <Field id="au-actor" label="Id de quem fez">
            <TextIn id="au-actor" class="ad-mono" value={ft.actor} onValue={(v) => setFt({ ...ft, actor: v })} />
          </Field>
          <Field id="au-tt" label="Tipo de alvo" hint="user, episode, extra, media, plan…">
            <TextIn id="au-tt" class="ad-mono" value={ft.targetType} onValue={(v) => setFt({ ...ft, targetType: v })} />
          </Field>
          <Field id="au-tid" label="Id do alvo">
            <TextIn id="au-tid" class="ad-mono" value={ft.targetId} onValue={(v) => setFt({ ...ft, targetId: v })} />
          </Field>
          <div class="ad-span">
            <Button label="Filtrar" icon="search" type="submit" />
          </div>
        </form>
      </details>
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={10} />
      ) : !page.items.length ? (
        <Empty icon="history" title={filtered ? 'Nada com esses filtros.' : 'Nada registrado ainda.'} />
      ) : (
        <>
          <Table rows={page.items} cols={cols} rowKey={(e) => String(e.id)} caption="Registro de auditoria" />
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
      {open ? <DiffModal e={open} who={who(open)} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}
