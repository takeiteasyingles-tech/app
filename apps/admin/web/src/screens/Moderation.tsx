// Moderação: the queue of learner photos, Mic turns flagged by the AI guard and learner reports,
// by priority and oldest first. Approve keeps it, remove takes it down (a photo leaves the profile; a
// Mic line is replaced by "[mensagem removida pela moderação]"), dismiss closes a report with no
// action. Decisions are final and audited; listing excerpts is audited too.
import { adminModerationApi, type ModerationItem } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtAgo, fmtDateTime } from '../format';
import { useEmails } from '../people';
import { setQuery } from '../router';
import { can, refreshBadges } from '../session';
import { usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Area, Button, Empty, ErrorBox, Field, FilterChips, MoreButton, Page, Pill, Skeleton } from '../ui/kit';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';
import { TranscriptModal } from './Transcript';

type Status = ModerationItem['status'];
type Kind = ModerationItem['kind'];

const KIND: Record<Kind, [string, string]> = {
  photo: ['Foto de perfil', 'image'],
  transcript: ['Fala no Mic', 'chat'],
  recording: ['Gravação', 'mic'],
  report: ['Denúncia', 'flag'],
};

const STATUS: Record<Status, [string, string]> = {
  pending: ['Pendente', 'or'],
  approved: ['Aprovado', 'gr'],
  removed: ['Removido', 'navy'],
  dismissed: ['Dispensado', ''],
};

const GUARD: Record<string, string> = {
  S1: 'Crimes violentos',
  S2: 'Crimes não violentos',
  S3: 'Crimes sexuais',
  S4: 'Exploração infantil',
  S5: 'Difamação',
  S6: 'Conselho especializado',
  S7: 'Privacidade',
  S8: 'Propriedade intelectual',
  S9: 'Armas',
  S10: 'Ódio',
  S11: 'Autolesão',
  S12: 'Conteúdo sexual',
  S13: 'Eleições',
  S14: 'Abuso de código',
};

const REASON: Record<string, string> = {
  new_profile_photo: 'foto nova no perfil',
  llama_guard: 'sinalizado pelo filtro de segurança da IA',
};

const REF: Record<string, string> = {
  mic_session: 'a conversa',
  mic_turn: 'a fala',
  extra: 'o Extra',
  episode: 'o episódio',
  other: 'outro assunto',
};

/** "<sessionId>:<idx>" or a session id → the session to open. */
const sessionOf = (it: ModerationItem): string | null => {
  if (!it.refId || !(it.refType === 'mic_turn' || it.refType === 'mic_session')) return null;
  return it.refType === 'mic_turn' ? (it.refId.replace(/:\d+$/, '') ?? null) : it.refId;
};

function ItemCard({ it, email, onDecided }: { it: ModerationItem; email: (id: string | null) => string | undefined; onDecided: (it: ModerationItem) => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [kLabel, kIcon] = KIND[it.kind];
  const pending = it.status === 'pending';
  const decide = async (decision: Exclude<Status, 'pending'>) => {
    setBusy(decision);
    try {
      const res = await call(adminModerationApi.decide, { params: { id: it.id }, body: { decision, notes: notes.trim() || undefined } });
      toast(decision === 'approved' ? 'Aprovado.' : decision === 'removed' ? 'Removido.' : 'Dispensado.');
      onDecided(res.item);
      refreshBadges();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  };
  const session = sessionOf(it);
  const nid = `mod-notes-${it.id}`;
  return (
    <article class="card ad-card ad-mod" aria-label={`${kLabel} de ${email(it.subjectUserId) ?? 'aluno'}`}>
      <div class="ad-mod-h">
        <span class="ad-mod-kind">
          <Icon name={kIcon} size={20} />
        </span>
        <div class="grow" style={{ minWidth: '0' }}>
          <div class="h3">{kLabel}</div>
          <div class="xs" title={fmtDateTime(it.createdAt)}>
            {fmtAgo(it.createdAt)} ·{' '}
            {it.subjectUserId ? (
              <a class="ad-linkbtn" href={`#/usuarios/${it.subjectUserId}`}>
                {email(it.subjectUserId) ?? 'ver aluno'}
              </a>
            ) : (
              'aluno removido'
            )}
            {it.reporterUserId ? ` · denunciado por ${email(it.reporterUserId) ?? 'um aluno'}` : ''}
          </div>
        </div>
        <span class="ad-pills">
          {it.priority > 1 ? <Pill label={`Prioridade ${it.priority}`} tone="or" icon="alert" /> : null}
          <Pill label={STATUS[it.status][0]} tone={STATUS[it.status][1]} />
        </span>
      </div>
      {it.reason ? (
        <p class="sm">
          <b>Motivo:</b> {REASON[it.reason] ?? it.reason}
          {it.refType && it.kind === 'report' ? ` · sobre ${REF[it.refType] ?? it.refType}${it.refId ? ` ${it.refId}` : ''}` : ''}
        </p>
      ) : null}
      {it.guardCategories?.length ? (
        <div class="ad-pills" aria-label="Categorias do filtro de segurança">
          {it.guardCategories.map((c) => (
            <Pill key={c} label={GUARD[c] ? `${c} · ${GUARD[c]}` : c} tone="bl" icon="shield" />
          ))}
        </div>
      ) : null}
      {it.excerpt ? <blockquote class="ad-quote">{it.excerpt}</blockquote> : null}
      {it.mediaUrl && it.kind === 'photo' ? <img class="ad-photo" src={it.mediaUrl} alt="Foto enviada pelo aluno" /> : null}
      {it.mediaUrl && it.kind === 'recording' ? (
        // biome-ignore lint/a11y/useMediaCaption: learner recording under review.
        <audio class="ad-maudio" src={it.mediaUrl} controls preload="none" />
      ) : null}
      {session && can('transcripts.read') ? (
        <div>
          <Button label="Ver a conversa inteira" icon="chat" kind="light" onClick={() => setOpen(session)} />
        </div>
      ) : null}
      {pending ? (
        <>
          <Field id={nid} label="Nota da decisão" opt hint="Fica na auditoria e no histórico do item.">
            <Area id={nid} value={notes} onValue={setNotes} rows={2} maxLength={500} />
          </Field>
          <div class="row wrapx" style={{ '--gap': '8px' }}>
            <Button label="Aprovar" icon="check" kind="green" busy={busy === 'approved'} disabled={!!busy} onClick={() => void decide('approved')} />
            <Button label="Remover" icon="trash" kind="ad-danger" busy={busy === 'removed'} disabled={!!busy} onClick={() => void decide('removed')} />
            <Button label="Dispensar" icon="close" kind="light" busy={busy === 'dismissed'} disabled={!!busy} onClick={() => void decide('dismissed')} />
          </div>
        </>
      ) : (
        <div class="fb tip">
          <b>{STATUS[it.status][0]}</b> {it.reviewedAt ? fmtAgo(it.reviewedAt) : ''}
          {it.reviewedBy ? ` por ${email(it.reviewedBy) ?? 'alguém da equipe'}` : ''}
          {it.notes ? ` · ${it.notes}` : ''}
        </div>
      )}
      {open ? <TranscriptModal id={open} onClose={() => setOpen(null)} /> : null}
    </article>
  );
}

export function Moderation({ q }: ScreenProps) {
  const status = (['pending', 'approved', 'removed', 'dismissed'].includes(q.status ?? '') ? q.status : 'pending') as Status;
  const kind = (q.kind ?? '') as Kind | '';
  const page = usePaged(
    (cursor, signal) => call(adminModerationApi.list, { query: { status, kind: kind || undefined, cursor, limit: 20 }, signal }),
    [status, kind],
  );
  const email = useEmails(page.items.flatMap((i) => [i.subjectUserId, i.reporterUserId, i.reviewedBy]));
  return (
    <Page
      title="Moderação"
      kicker="Pessoas"
      actions={<Button label="Atualizar" icon="refresh" kind="light" onClick={page.reload} />}
      bar={
        <div class="ad-filters">
          <FilterChips
            label="Situação"
            value={status}
            onChange={(v) => setQuery({ status: v === 'pending' ? '' : v })}
            options={[
              ['pending', 'Pendentes'],
              ['approved', 'Aprovados'],
              ['removed', 'Removidos'],
              ['dismissed', 'Dispensados'],
            ]}
          />
          <FilterChips
            label="Tipo"
            value={kind}
            onChange={(v) => setQuery({ kind: v })}
            options={[
              ['', 'Todos'],
              ['photo', 'Fotos'],
              ['transcript', 'Falas do Mic'],
              ['recording', 'Gravações'],
              ['report', 'Denúncias'],
            ]}
          />
        </div>
      }
    >
      <div class="ad-note bl">
        <Icon name="shield" size={18} /> Os trechos são de conversas reais de alunos: abrir esta fila fica registrado na auditoria. Decisões não podem ser desfeitas.
      </div>
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={3} height={160} />
      ) : !page.items.length ? (
        <Empty icon="check" title={status === 'pending' ? 'Fila em dia.' : 'Nada por aqui.'} body={status === 'pending' ? 'Nenhum item esperando decisão.' : undefined} />
      ) : (
        <>
          {page.items.map((it) => (
            <ItemCard
              key={it.id}
              it={it}
              email={email}
              onDecided={(next) => page.setItems((prev) => (status === 'pending' ? prev.filter((x) => x.id !== next.id) : prev.map((x) => (x.id === next.id ? next : x))))}
            />
          ))}
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
    </Page>
  );
}
