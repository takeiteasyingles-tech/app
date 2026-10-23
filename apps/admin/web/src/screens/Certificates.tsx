// Certificados (#/certificados), spec 07 feature B: every season certificate issued, newest first, with
// search (code, name on the certificate, e-mail), the PDF the learner downloads, and revoke / reinstate
// (certificates.revoke, with a reason for the audit log). A revoked certificate still verifies, as revoked.
import { CERT_VERIFY_ROUTE } from '@tie/shared/constants';
import { type AdminCertificateRow, adminCertificatesApi } from '@tie/shared/contracts/certificates';
import { call, errorMessage, urlFor } from '../api';
import { fmtDate, fmtDateTime } from '../format';
import { setQuery } from '../router';
import { can } from '../session';
import { usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Button, Empty, ErrorBox, FilterChips, MoreButton, Page, Pill, SearchBox, Skeleton } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';

const API = adminCertificatesApi;

/** The student app's origin for the verification link (tie-admin.* → tie-app.*; local :8788 → :8787). */
function studentOrigin(): string {
  const u = new URL(location.href);
  if (u.port === '8788') u.port = '8787';
  u.hostname = u.hostname.replace(/^tie-admin(?=[.-])/, 'tie-app');
  return u.origin;
}

export function Certificates({ q }: ScreenProps) {
  const search = q.q ?? '';
  const state = (['valid', 'revoked'].includes(q.estado ?? '') ? q.estado : '') as '' | 'valid' | 'revoked';
  // undefined, never NaN: hook deps compare with !==, and NaN would reload on every render.
  const seasonN = Number.parseInt(q.temporada ?? '', 10);
  const season = Number.isFinite(seasonN) && seasonN > 0 ? seasonN : undefined;
  const page = usePaged(
    (cursor, signal) =>
      call(API.list, {
        query: {
          q: search || undefined,
          revoked: state === '' ? undefined : state === 'revoked' ? 'true' : 'false',
          season,
          cursor,
          limit: 30,
        },
        signal,
      }),
    [search, state, season],
  );
  const mayRevoke = can('certificates.revoke');

  const toggle = (c: AdminCertificateRow) => {
    const revoking = c.revokedAt == null;
    const out: { item?: AdminCertificateRow } = {};
    void confirmAction({
      title: revoking ? `Revogar o certificado ${c.code}?` : `Reativar o certificado ${c.code}?`,
      body: revoking
        ? `${c.fullName} deixa de poder baixar o PDF e a página pública passa a mostrar o certificado como revogado.`
        : 'O certificado volta a valer: o aluno baixa o PDF de novo e a página pública mostra que é válido.',
      confirm: revoking ? 'Revogar' : 'Reativar',
      danger: revoking,
      reason: { label: 'Motivo (fica na auditoria)', required: true },
      run: async (reason) => {
        out.item = (await call(API.revoke, { params: { id: c.id }, body: { revoked: revoking, reason } })).item;
      },
    }).then((ok) => {
      if (ok && out.item) {
        const next = out.item;
        toast(revoking ? 'Certificado revogado.' : 'Certificado reativado.');
        page.setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      }
    });
  };

  const cols: Col<AdminCertificateRow>[] = [
    {
      key: 'code',
      label: 'Código',
      cell: (c) => (
        <span class="row" style={{ '--gap': '8px' }}>
          <Icon name="trophy" size={16} />
          <b style={{ whiteSpace: 'nowrap' }}>{c.code}</b>
        </span>
      ),
    },
    {
      key: 'name',
      label: 'Aluno',
      cell: (c) => (
        <span class="stack" style={{ '--gap': '2px' }}>
          <span>{c.fullName}</span>
          {c.userEmail ? (
            <a class="ad-linkbtn xs" href={`#/alunos/${c.userId}`}>
              {c.userEmail}
            </a>
          ) : (
            <span class="xs">conta removida</span>
          )}
        </span>
      ),
    },
    { key: 'season', label: 'Temporada', cell: (c) => `${c.seasonN} · ${c.seasonTitle}` },
    { key: 'score', label: 'Nota', cls: 'num', cell: (c) => `${c.scorePct}%` },
    {
      key: 'issued',
      label: 'Emitido',
      cell: (c) => <span title={fmtDateTime(c.issuedAt)}>{fmtDate(c.issuedAt)}</span>,
    },
    {
      key: 'state',
      label: 'Situação',
      cell: (c) =>
        c.revokedAt ? (
          <span title={c.revokeReason ?? undefined}>
            <Pill label={`Revogado em ${fmtDate(c.revokedAt)}`} tone="" icon="close" />
          </span>
        ) : (
          <Pill label="Válido" tone="gr" icon="check" />
        ),
    },
    {
      key: 'actions',
      label: 'Ações',
      cls: 'shrink',
      cell: (c) => (
        <span class="row wrapx" style={{ '--gap': '6px' }}>
          <a class="btn compact light" href={urlFor(API.pdf, { params: { id: c.id } })} download={`${c.code}.pdf`}>
            <Icon name="download" size={16} />
            <span>PDF</span>
          </a>
          <a
            class="btn compact light"
            href={`${studentOrigin()}/#/${CERT_VERIFY_ROUTE}/${c.code}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Página pública do certificado ${c.code}`}
          >
            <Icon name="link" size={16} />
          </a>
          {mayRevoke ? (
            <Button
              label={c.revokedAt ? 'Reativar' : 'Revogar'}
              kind={c.revokedAt ? 'light' : 'ad-danger'}
              onClick={() => toggle(c)}
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Page
      title="Certificados"
      kicker="Pessoas"
      actions={
        <Button
          label="Atualizar"
          icon="refresh"
          kind="light"
          busy={page.loading && !!page.items.length}
          onClick={page.reload}
        />
      }
      bar={
        <div class="ad-fgroups">
          <SearchBox value={search} onValue={(v) => setQuery({ q: v })} placeholder="Código, nome ou e-mail" />
          <FilterChips
            label="Situação"
            showLabel
            value={state}
            onChange={(v) => setQuery({ estado: v })}
            options={[
              ['', 'Todos'],
              ['valid', 'Válidos'],
              ['revoked', 'Revogados'],
            ]}
          />
        </div>
      }
    >
      <div class="ad-note bl">
        <Icon name="shield" size={18} /> O certificado é emitido sozinho na primeira aprovação no teste da temporada. O
        nome e o título da temporada ficam congelados na emissão.
      </div>
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading && !page.items.length ? (
        <Skeleton rows={5} />
      ) : !page.items.length ? (
        <Empty
          icon="trophy"
          title={search || state ? 'Nenhum certificado com esses filtros.' : 'Nenhum certificado emitido ainda.'}
          body={
            search || state
              ? 'Troque a busca ou os filtros acima.'
              : 'Eles aparecem aqui quando alunos passam no teste da temporada.'
          }
        />
      ) : (
        <>
          <Table rows={page.items} cols={cols} rowKey={(c) => c.id} caption="Certificados emitidos" />
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
      {page.error && page.items.length ? <p class="xs">{errorMessage(page.error)}</p> : null}
    </Page>
  );
}
