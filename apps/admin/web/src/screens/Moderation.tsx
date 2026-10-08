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
import { confirmAction } from '../ui/modal';
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
  pending: ['Pendente', 'gold'],
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
  guard: 'sinalizado pelo filtro de segurança da IA',
  ai_guard: 'sinalizado pelo filtro de segurança da IA',
  report: 'denúncia de um aluno',
};

const REF: Record<string, string> = {
  mic_session: 'uma conversa do Mic',
  mic_turn: 'uma fala do Mic',
  extra: 'um Extra',
  episode: 'um episódio',
  other: 'outro assunto',
};

/** Reason codes a report form or the server may send instead of the learner's own words. */
const REPORT_REASON: Record<string, string> = {
  offensive: 'conteúdo ofensivo',
  inappropriate: 'conteúdo impróprio',
  abuse: 'abuso',
  harassment: 'assédio',
  hate: 'discurso de ódio',
  sexual: 'conteúdo sexual',
  violence: 'violência',
  self_harm: 'autolesão',
  spam: 'spam',
  personal_data: 'dados pessoais expostos',
  privacy: 'privacidade',
  wrong: 'conteúdo errado',
  incorrect: 'conteúdo errado',
  error: 'erro no conteúdo',
  typo: 'erro de digitação',
  translation: 'tradução errada',
  audio: 'problema no áudio',
  bug: 'algo não funciona',
  broken: 'algo não funciona',
  other: 'outro motivo',
};

/** A machine code ("offensive", "self_harm") rather than words a person typed. */
const isCode = (r: string) => /^[a-z][a-z0-9_]*$/.test(r);

/**
 * The reason line: codes in words (an unknown code reads "outro motivo", with the code kept in the
 * tooltip); what a learner typed in a report is quoted as is.
 */
function reasonText(it: ModerationItem): { text: string; title?: string } {
  const r = (it.reason ?? '').trim();
  const known = REASON[r] ?? (it.kind === 'report' ? REPORT_REASON[r.toLowerCase()] : undefined);
  if (known) return { text: known };
  if (isCode(r)) {
    return it.kind === 'report'
      ? { text: 'outro motivo (sem descrição)', title: `Código recebido: ${r}` }
      : { text: 'marcado automaticamente', title: `Código recebido: ${r}` };
  }
  return { text: it.kind === 'report' ? `“${r}”` : r };
}

interface Decision {
  title: string;
  body: string;
  confirm: string;
  done: string;
}

const APPROVE: Decision = {
  title: 'Aprovar este item?',
  body: 'O conteúdo continua como está e o item sai da fila.',
  confirm: 'Aprovar',
  done: 'Aprovado.',
};

const DISMISS: Decision = {
  title: 'Dispensar sem ação?',
  body: 'O item sai da fila sem mudar nada.',
  confirm: 'Dispensar',
  done: 'Dispensado.',
};

/** What "Remover" does to this item, mirroring the server's effects (routes/moderation.ts). */
function removeCopy(it: ModerationItem): Decision {
  const base = { confirm: 'Remover', done: 'Removido.' };
  if (it.refType === 'upload' && it.kind === 'photo') {
    return {
      ...base,
      title: 'Remover esta foto?',
      body: 'A foto sai do perfil do aluno na hora. A equipe continua vendo o arquivo aqui, como registro.',
    };
  }
  if (it.refType === 'upload') {
    return {
      ...base,
      title: 'Remover esta gravação?',
      body: 'A gravação deixa de valer para o aluno. A equipe continua ouvindo o arquivo aqui, como registro.',
    };
  }
  if (it.refType === 'mic_turn') {
    return {
      ...base,
      title: 'Remover esta fala?',
      body: 'Na conversa do aluno, o texto desta fala (e a tradução e a correção dela) vira “[mensagem removida pela moderação]”. As outras falas não mudam.',
    };
  }
  if (it.refType === 'mic_session') {
    return {
      ...base,
      title: 'Remover a conversa inteira?',
      body: 'Todas as falas desta conversa do Mic viram “[mensagem removida pela moderação]” e o relatório da conversa é apagado.',
    };
  }
  return {
    title: 'Aceitar a denúncia?',
    body: `Nada muda sozinho em ${REF[it.refType ?? 'other'] ?? 'outro assunto'}: a denúncia fecha como procedente. Corrija o conteúdo no editor, se for o caso.`,
    confirm: 'Aceitar denúncia',
    done: 'Denúncia aceita.',
  };
}

const decisionCopy = (it: ModerationItem, d: Exclude<Status, 'pending'>): Decision =>
  d === 'approved' ? APPROVE : d === 'dismissed' ? DISMISS : removeCopy(it);

/** "<sessionId>:<idx>" or a session id → the session to open. */
const sessionOf = (it: ModerationItem): string | null => {
  if (!it.refId || !(it.refType === 'mic_turn' || it.refType === 'mic_session')) return null;
  return it.refType === 'mic_turn' ? (it.refId.replace(/:\d+$/, '') ?? null) : it.refId;
};

function ItemCard({
  it,
  email,
  onDecided,
}: {
  it: ModerationItem;
  email: (id: string | null) => string | undefined;
  onDecided: (it: ModerationItem) => void;
}) {
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [kLabel, kIcon] = KIND[it.kind];
  const pending = it.status === 'pending';
  // Every decision is final, so each one asks first (the dialog runs the request and shows its error).
  const decide = (decision: Exclude<Status, 'pending'>) => {
    const d = decisionCopy(it, decision);
    const out: { item?: ModerationItem } = {};
    const body = `${d.body} A decisão não pode ser desfeita.`;
    void confirmAction({
      title: d.title,
      body: notes.trim() ? `${body} Nota: “${notes.trim()}”.` : body,
      confirm: d.confirm,
      danger: decision === 'removed',
      run: async () => {
        const res = await call(adminModerationApi.decide, {
          params: { id: it.id },
          body: { decision, notes: notes.trim() || undefined },
        });
        out.item = res.item;
      },
    })
      .then((ok) => {
        if (ok && out.item) {
          toast(d.done);
          onDecided(out.item);
          refreshBadges();
        }
      })
      .catch((e: unknown) => toast(errorMessage(e), 'err'));
  };
  const session = sessionOf(it);
  const nid = `mod-notes-${it.id}`;
  const reason = it.reason ? reasonText(it) : null;
  return (
    <article class="card ad-card ad-mod" aria-label={`${kLabel} de ${email(it.subjectUserId) ?? 'aluno'}`}>
      <div class="ad-mod-h">
        <span class="ad-mod-kind">
          <Icon name={kIcon} size={20} />
        </span>
        <div class="h3 grow">{kLabel}</div>
        <span class="ad-pills">
          {it.priority > 1 ? <Pill label={`Prioridade ${it.priority}`} tone="or" icon="alert" /> : null}
          <Pill label={STATUS[it.status][0]} tone={STATUS[it.status][1]} />
        </span>
        {/* Each part keeps its words together; the line breaks only between parts. */}
        <ul class="xs ad-meta" aria-label="Detalhes do item">
          <li title={fmtDateTime(it.createdAt)}>{fmtAgo(it.createdAt)}</li>
          <li>
            {it.subjectUserId ? (
              <a class="ad-linkbtn" href={`#/usuarios/${it.subjectUserId}`}>
                {email(it.subjectUserId) ?? 'ver aluno'}
              </a>
            ) : (
              'aluno removido'
            )}
          </li>
          {it.reporterUserId ? (
            <li>
              denunciado por{' '}
              {email(it.reporterUserId) ? (
                <a class="ad-linkbtn" href={`#/usuarios/${it.reporterUserId}`}>
                  {email(it.reporterUserId)}
                </a>
              ) : (
                'um aluno'
              )}
            </li>
          ) : null}
        </ul>
      </div>
      {reason ? (
        <p class="sm">
          <b>Motivo:</b> <span title={reason.title}>{reason.text}</span>
          {it.refType && it.kind === 'report' ? ` · sobre ${REF[it.refType] ?? 'outro assunto'}` : ''}
        </p>
      ) : null}
      {it.guardCategories?.length ? (
        <div class="ad-pills">
          <span class="sr">Categorias do filtro de segurança:</span>
          {it.guardCategories.map((c) => (
            <Pill key={c} label={GUARD[c] ? `${c} · ${GUARD[c]}` : c} tone="bl" icon="shield" />
          ))}
        </div>
      ) : null}
      {it.excerpt ? <blockquote class="ad-quote">{it.excerpt}</blockquote> : null}
      {it.mediaUrl && it.kind === 'photo' ? (
        <img class="ad-photo" src={it.mediaUrl} alt="Foto enviada pelo aluno" />
      ) : null}
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
            <Button label="Aprovar" icon="check" kind="green" onClick={() => decide('approved')} />
            <Button
              label={removeCopy(it).confirm}
              icon={removeCopy(it).confirm === 'Remover' ? 'trash' : 'flag'}
              kind="ad-danger"
              onClick={() => decide('removed')}
            />
            <Button label="Dispensar" icon="close" kind="light" onClick={() => decide('dismissed')} />
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
  const status = (
    ['pending', 'approved', 'removed', 'dismissed'].includes(q.status ?? '') ? q.status : 'pending'
  ) as Status;
  const kind = (q.kind ?? '') as Kind | '';
  const page = usePaged(
    (cursor, signal) =>
      call(adminModerationApi.list, { query: { status, kind: kind || undefined, cursor, limit: 20 }, signal }),
    [status, kind],
  );
  const email = useEmails(page.items.flatMap((i) => [i.subjectUserId, i.reporterUserId, i.reviewedBy]));
  return (
    <Page
      title="Moderação"
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
          <FilterChips
            label="Situação"
            showLabel
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
            showLabel
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
        <Icon name="shield" size={18} /> Os trechos são de conversas reais de alunos: abrir esta fila fica registrado na
        auditoria. Decisões não podem ser desfeitas.
      </div>
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={3} height={160} />
      ) : !page.items.length ? (
        <Empty
          icon="check"
          title={status === 'pending' ? 'Fila em dia.' : 'Nada por aqui.'}
          body={
            status === 'pending'
              ? 'Nenhum item esperando decisão.'
              : 'Nenhum item com essa situação e esse tipo. Troque os filtros acima.'
          }
        />
      ) : (
        <>
          {page.items.map((it) => (
            <ItemCard
              key={it.id}
              it={it}
              email={email}
              onDecided={(next) =>
                page.setItems((prev) =>
                  status === 'pending'
                    ? prev.filter((x) => x.id !== next.id)
                    : prev.map((x) => (x.id === next.id ? next : x)),
                )
              }
            />
          ))}
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
    </Page>
  );
}
