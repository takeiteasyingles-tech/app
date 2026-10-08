// Mic conversation viewer (moderators): the transcript as the learner saw it (bubbles, feedback chips,
// pronunciation tips) plus the report. Opening it writes transcripts.read to the audit log.
import { type AdminMicSession, type AdminMicSessionRow, adminUsersApi } from '@tie/shared/contracts/admin';
import { Fragment } from 'preact';
import { call } from '../api';
import { fmtDateTime, fmtDuration } from '../format';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Facts, Pill } from '../ui/kit';
import { Modal } from '../ui/modal';

export const MODE_LABEL: Record<AdminMicSessionRow['mode'], string> = {
  livre: 'Conversa livre',
  missao: 'Missão',
  pronuncia: 'Pronúncia',
  extra: 'Extra',
};

const FB_LABEL: Record<string, string> = { certo: 'Certo', ajuste: 'Ajuste', natural: 'Mais natural' };

function Turns({ s }: { s: AdminMicSession }) {
  if (!s.turnsList.length) return <p class="sm">Esta conversa não tem falas registradas.</p>;
  return (
    <section class="ad-chat" aria-label="Transcrição">
      {s.turnsList.map((t) => (
        <Fragment key={t.idx}>
          <div class={`bub ${t.who === 'me' ? 'me' : t.who === 'coach' ? 'coach' : 'her'}`}>
            <div class="en">{t.en}</div>
            {t.pt ? <div class="pt">{t.pt}</div> : null}
            <div class="meta">
              {t.who === 'me' ? 'Aluno' : t.who === 'coach' ? 'Dica' : 'Assistente'} · {fmtDateTime(t.createdAt)}
              {t.source ? ` · ${t.source === 'ia' ? 'IA' : t.source}` : ''}
            </div>
          </div>
          {t.feedback && t.who === 'me' ? (
            <div class={`fbchip ${t.feedback.status}`}>
              <Icon name={t.feedback.status === 'certo' ? 'check' : 'pen'} size={16} />
              <span>
                <b>{FB_LABEL[t.feedback.status] ?? t.feedback.status}</b>
                {t.feedback.status !== 'certo' ? <span class="fix-line">{t.feedback.corrected}</span> : null}
                {t.feedback.explain_pt}
              </span>
            </div>
          ) : null}
          {t.pron?.length ? (
            <div class="fbchip natural">
              <Icon name="ear" size={16} />
              <span>{t.pron.map((p) => `${p.word}: ${p.tip_pt}`).join(' · ')}</span>
            </div>
          ) : null}
        </Fragment>
      ))}
    </section>
  );
}

function Report({ s }: { s: AdminMicSession }) {
  const r = s.report;
  if (!r) return null;
  return (
    <section class="card soft stack" style={{ '--gap': '10px' }} aria-label="Relatório">
      <div class="row between">
        <span class="lbl">Relatório</span>
        <Pill label={r.source === 'ia' ? 'IA' : 'Demo'} tone={r.source === 'ia' ? 'gr' : 'bl'} />
      </div>
      <p class="p">{r.summary_pt}</p>
      {r.strengths.length ? (
        <div>
          <div class="lbl gr">O que foi bem</div>
          <ul class="sm">
            {r.strengths.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.fixes.length ? (
        <div>
          <div class="lbl bl">O que ajustar</div>
          <ul class="sm">
            {r.fixes.map((f) => (
              <li key={f.said}>
                <s>{f.said}</s> → <b>{f.better}</b> · {f.why_pt}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.next_goal_pt ? <p class="sm">Próxima meta: {r.next_goal_pt}</p> : null}
    </section>
  );
}

export function TranscriptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const load = useLoad((signal) => call(adminUsersApi.micSession, { params: { id }, signal }), [id]);
  return (
    <Modal title="Conversa do Mic" size="lg" onClose={onClose}>
      <div class="ad-note bl">
        <Icon name="shield" size={18} /> Esta leitura fica registrada na auditoria. Use só para moderação ou suporte.
      </div>
      <Async load={load} rows={6}>
        {({ session: s }) => (
          <>
            <div class="row wrapx" style={{ '--gap': '6px' }}>
              <Pill label={MODE_LABEL[s.mode]} tone="navy" />
              <Pill label={s.assistant} />
              {s.flagged ? <Pill label="Sinalizada" tone="or" icon="flag" /> : null}
            </div>
            <Facts
              rows={[
                ['Aluno', s.userEmail],
                ['Início', fmtDateTime(s.startedAt)],
                ['Duração', fmtDuration(s.secs * 1000)],
                ['Falas', String(s.turns)],
                ...(s.mission ? ([['Missão', s.mission]] as const) : []),
                ...(s.extraId ? ([['Extra', s.extraId]] as const) : []),
              ]}
            />
            <Turns s={s} />
            <Report s={s} />
          </>
        )}
      </Async>
    </Modal>
  );
}
