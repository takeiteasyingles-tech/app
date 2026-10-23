// Teste da temporada (#/conteudo/temporadas/<n>/teste), spec 07 feature B. The questions of one
// season's test: drafts written by Workers AI (or by an agent over MCP, or typed here), reviewed by
// staff (approve / reject, one by one or in bulk), edited, and the test opened to learners once enough
// questions are approved. Learners only ever see approved questions of a published test, live.
import { LIMITS } from '@tie/shared/constants';
import { adminContentApi } from '@tie/shared/contracts/admin';
import {
  adminSeasonTestApi,
  type SeasonTestAdmin,
  type SeasonTestQuestionRow,
  type SeasonTestQuestionStatus,
} from '@tie/shared/contracts/seasonTest';
import { useState } from 'preact/hooks';
import { call, errorMessage, issuesOf } from '../../api';
import { fmtAgo, fmtDateTime, plural } from '../../format';
import { setQuery } from '../../router';
import { can } from '../../session';
import { useBusy, useLoad } from '../../ui/async';
import { Icon } from '../../ui/icons';
import {
  Area,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  FilterChips,
  LinkButton,
  Page,
  Pill,
  Sel,
  Skeleton,
  TextIn,
} from '../../ui/kit';
import { confirmAction, Modal } from '../../ui/modal';
import { toast } from '../../ui/toast';
import type { ScreenProps } from '../registry';

const API = adminSeasonTestApi;
type Status = SeasonTestQuestionStatus;
type Q = SeasonTestQuestionRow;

const STATUS: Record<Status, [string, string]> = {
  draft: ['Rascunho', 'gold'],
  approved: ['Aprovada', 'gr'],
  rejected: ['Recusada', ''],
};
const SOURCE: Record<Q['source'], string> = { ai: 'IA', agent: 'Agente (MCP)', staff: 'Equipe' };

// ---------- Editor ----------

interface Draft {
  partTitle: string;
  q: string;
  kind: 'choice' | 'typed';
  opts: string;
  answerIdx: string;
  accept: string;
  show: string;
  audio: string;
  rev: string;
  epNum: string;
  sort: string;
}

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function toDraft(q: Q | null): Draft {
  return {
    partTitle: q?.partTitle ?? '',
    q: q?.q ?? '',
    kind: q && !q.opts ? 'typed' : 'choice',
    opts: (q?.opts ?? []).join('\n'),
    answerIdx: String(q?.answerIdx ?? 0),
    accept: (q?.accept ?? []).join('\n'),
    show: q?.show ?? '',
    audio: q?.audio ?? '',
    rev: q?.rev ?? '',
    epNum: q?.epNum != null ? String(q.epNum) : '',
    sort: q ? String(q.sort) : '',
  };
}

function toBody(d: Draft) {
  const opts = lines(d.opts);
  const choice = d.kind === 'choice';
  const ep = Number.parseInt(d.epNum, 10);
  const sort = Number.parseInt(d.sort, 10);
  return {
    partTitle: d.partTitle.trim(),
    q: d.q.trim(),
    opts: choice ? opts : null,
    answerIdx: choice ? Number.parseInt(d.answerIdx, 10) || 0 : null,
    accept: choice ? null : lines(d.accept),
    show: d.show.trim() || null,
    audio: d.audio.trim() || null,
    rev: d.rev.trim() || null,
    epNum: Number.isFinite(ep) && ep > 0 ? ep : null,
    ...(Number.isFinite(sort) && sort >= 0 ? { sort } : {}),
  };
}

function EditModal({
  n,
  q,
  onClose,
  onSaved,
}: {
  n: number;
  q: Q | null;
  onClose: () => void;
  onSaved: (q: Q) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(q));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));
  const opts = lines(d.opts);
  const save = () =>
    run(async () => {
      setErrs({});
      try {
        const body = toBody(d);
        const res = q
          ? await call(API.update, { params: { n, id: q.id }, body })
          : await call(API.create, { params: { n }, body });
        toast(q ? 'Questão salva.' : 'Questão criada como rascunho.');
        onSaved(res.item);
      } catch (e) {
        const issues = issuesOf(e);
        if (issues.length) setErrs(Object.fromEntries(issues.map((i) => [i.path.split('.')[0] ?? '', i.message])));
        else toast(errorMessage(e), 'err');
      }
    });
  const id = (k: string) => `stq-${k}`;
  return (
    <Modal
      title={q ? 'Editar questão' : 'Nova questão'}
      size="lg"
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} disabled={busy} />
          <Button label="Salvar" icon="check" busy={busy} onClick={() => void save()} />
        </>
      }
    >
      {q && q.status === 'approved' ? (
        <div class="ad-note gold">
          <Icon name="alert" size={18} /> Esta questão já está aprovada: a edição vale para os alunos na hora.
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Field id={id('part')} label="Parte" opt hint="Agrupa as questões no teste (ex.: Vocabulário).">
          <TextIn id={id('part')} value={d.partTitle} onValue={set('partTitle')} maxLength={120} />
        </Field>
        <Field id={id('kind')} label="Tipo de resposta">
          <Sel
            id={id('kind')}
            value={d.kind}
            onValue={(v) => setD((x) => ({ ...x, kind: v as Draft['kind'] }))}
            options={[
              ['choice', 'Múltipla escolha'],
              ['typed', 'Resposta digitada (em inglês)'],
            ]}
          />
        </Field>
      </div>
      <Field id={id('q')} label="Pergunta" err={errs.q}>
        <Area id={id('q')} value={d.q} onValue={set('q')} rows={2} maxLength={LIMITS.seasonTestQuestionMax} />
      </Field>
      {d.kind === 'choice' ? (
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Field id={id('opts')} label="Opções (uma por linha, de 2 a 6)" err={errs.opts}>
            <Area id={id('opts')} value={d.opts} onValue={set('opts')} rows={4} />
          </Field>
          <Field id={id('ans')} label="Resposta certa" err={errs.answerIdx}>
            <Sel
              id={id('ans')}
              value={d.answerIdx}
              onValue={set('answerIdx')}
              options={(opts.length ? opts : ['—']).map((o, i) => [String(i), `${String.fromCharCode(65 + i)} · ${o}`])}
            />
          </Field>
        </div>
      ) : (
        <Field
          id={id('acc')}
          label="Respostas aceitas (uma por linha)"
          hint="Comparadas sem maiúsculas, acentos e pontuação. Liste as variações (com e sem contração, com e sem artigo)."
          err={errs.accept ?? errs.opts}
        >
          <Area id={id('acc')} value={d.accept} onValue={set('accept')} rows={3} />
        </Field>
      )}
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Field id={id('show')} label="Resposta mostrada na revisão" opt err={errs.show}>
          <TextIn id={id('show')} value={d.show} onValue={set('show')} maxLength={300} />
        </Field>
        <Field id={id('audio')} label="Áudio (texto lido em inglês)" opt err={errs.audio}>
          <TextIn id={id('audio')} value={d.audio} onValue={set('audio')} maxLength={LIMITS.ttsTextMax} />
        </Field>
        <Field id={id('rev')} label="Onde revisar" opt hint="Ex.: Ep. 3 · Take a Look" err={errs.rev}>
          <TextIn id={id('rev')} value={d.rev} onValue={set('rev')} maxLength={300} />
        </Field>
        <Field id={id('ep')} label="Episódio" opt err={errs.epNum}>
          <TextIn id={id('ep')} value={d.epNum} onValue={set('epNum')} inputMode="numeric" />
        </Field>
        <Field id={id('sort')} label="Ordem" opt hint="Vazio: no fim." err={errs.sort}>
          <TextIn id={id('sort')} value={d.sort} onValue={set('sort')} inputMode="numeric" />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- AI draft ----------

function DraftModal({ t, onClose, onDone }: { t: SeasonTestAdmin; onClose: () => void; onDone: (n: number) => void }) {
  const n = t.season.n;
  const [count, setCount] = useState(String(Math.min(t.season.questionCount, LIMITS.seasonTestDraftMax)));
  const [instructions, setInstructions] = useState('');
  const [part, setPart] = useState('');
  const [busy, run] = useBusy();
  const go = () =>
    run(async () => {
      try {
        const c = Math.max(1, Math.min(LIMITS.seasonTestDraftMax, Number.parseInt(count, 10) || 1));
        const res = await call(API.draft, {
          params: { n },
          body: { count: c, instructions: instructions.trim() || undefined, partTitle: part.trim() || undefined },
        });
        toast(
          res.source === 'ia'
            ? `${plural(res.items.length, 'rascunho gerado', 'rascunhos gerados')} pela IA.`
            : `IA indisponível: ${plural(res.items.length, 'rascunho gerado', 'rascunhos gerados')} pelo modo demonstração.`,
          res.source === 'ia' ? 'ok' : 'warn',
        );
        onDone(res.items.length);
      } catch (e) {
        toast(errorMessage(e), 'err');
      }
    });
  return (
    <Modal
      title="Gerar rascunho com IA"
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} disabled={busy} />
          <Button label={busy ? 'Gerando…' : 'Gerar'} icon="sparkle" busy={busy} onClick={() => void go()} />
        </>
      }
    >
      <p class="p">
        A IA escreve questões a partir dos episódios publicados desta temporada (diálogo, Take a Look, lição e Take
        Away). Elas entram como <b>rascunho</b>: nada chega aos alunos antes da sua aprovação.
      </p>
      <Field id="dr-count" label="Quantas questões" hint={`De 1 a ${LIMITS.seasonTestDraftMax} por vez.`}>
        <TextIn id="dr-count" value={count} onValue={setCount} inputMode="numeric" />
      </Field>
      <Field id="dr-part" label="Parte" opt hint="Deixe vazio para a IA agrupar (Vocabulário, Expressões, Diálogo…).">
        <TextIn id="dr-part" value={part} onValue={setPart} maxLength={120} />
      </Field>
      <Field id="dr-ins" label="Orientações para a IA" opt>
        <Area
          id="dr-ins"
          value={instructions}
          onValue={setInstructions}
          rows={3}
          maxLength={LIMITS.seasonTestInstructionsMax}
          placeholder="Ex.: mais questões de escuta; foque nos episódios 5 a 8."
        />
      </Field>
    </Modal>
  );
}

// ---------- Question card ----------

function QuestionCard({
  q,
  idx,
  selected,
  onSelect,
  onReview,
  onEdit,
  onDelete,
}: {
  q: Q;
  idx: number;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onReview: (s: Status) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [label, tone] = STATUS[q.status];
  return (
    <article class="card ad-card stack" style={{ '--gap': '10px' }} aria-label={`Questão ${idx}`}>
      <div class="row wrapx" style={{ '--gap': '10px' }}>
        <label class="row" style={{ '--gap': '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect((e.currentTarget as HTMLInputElement).checked)}
            aria-label={`Selecionar a questão ${idx}`}
            style={{ width: '18px', height: '18px' }}
          />
          <span class="num" style={{ color: 'var(--orange)', minWidth: '24px' }}>
            {idx}
          </span>
        </label>
        <span class="ad-pills grow">
          <Pill label={label} tone={tone} />
          <Pill label={SOURCE[q.source]} tone="bl" icon={q.source === 'staff' ? 'users' : 'sparkle'} />
          {q.partTitle ? <Pill label={q.partTitle} tone="" /> : null}
          {q.epNum ? <Pill label={`Ep. ${q.epNum}`} tone="navy" /> : null}
        </span>
        <span class="xs" title={fmtDateTime(q.updatedAt)}>
          {fmtAgo(q.updatedAt)}
        </span>
      </div>
      <div class="h3" style={{ textWrap: 'pretty' }}>
        {q.q}
      </div>
      {q.audio ? (
        <div class="sm row" style={{ '--gap': '6px' }}>
          <Icon name="speaker" size={16} /> Áudio: <i>{q.audio}</i>
        </div>
      ) : null}
      {q.opts ? (
        <ol
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '6px',
            listStyle: 'none',
            padding: '0',
            margin: '0',
          }}
        >
          {q.opts.map((o, i) => {
            const right = i === q.answerIdx;
            return (
              <li
                key={i}
                class="row"
                style={{
                  '--gap': '10px',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: `1.5px solid ${right ? 'var(--green)' : 'var(--line)'}`,
                  background: right ? 'var(--greenT)' : 'var(--paper)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '24px',
                    height: '24px',
                    flex: 'none',
                    borderRadius: '7px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '.8rem',
                    fontWeight: '800',
                    background: right ? 'var(--green)' : 'var(--blueT)',
                    color: right ? '#fff' : 'var(--blueD)',
                  }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span class="grow" style={{ fontWeight: right ? '800' : '500' }}>
                  {o}
                </span>
                {right ? (
                  <span class="xs" style={{ color: 'var(--green)', fontWeight: '800' }}>
                    certa
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div class="fb ok cmp">
          <span class="k">ACEITAS</span>
          <span>{(q.accept ?? []).join(' · ')}</span>
        </div>
      )}
      {q.show || q.rev ? (
        <div class="xs">
          {q.show ? `Na revisão: ${q.show}` : ''}
          {q.show && q.rev ? ' · ' : ''}
          {q.rev ? `Revisar: ${q.rev}` : ''}
        </div>
      ) : null}
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        {q.status !== 'approved' ? (
          <Button label="Aprovar" icon="check" kind="green" onClick={() => onReview('approved')} />
        ) : null}
        {q.status !== 'rejected' ? (
          <Button label="Recusar" icon="close" kind="light" onClick={() => onReview('rejected')} />
        ) : null}
        {q.status !== 'draft' ? (
          <Button label="Voltar a rascunho" kind="light" onClick={() => onReview('draft')} />
        ) : null}
        <Button label="Editar" icon="pen" kind="light" onClick={onEdit} />
        <Button label="Apagar" icon="trash" kind="light" onClick={onDelete} />
      </div>
    </article>
  );
}

// ---------- Screen ----------

function SeasonTestSettings({ t, onSaved }: { t: SeasonTestAdmin; onSaved: () => void }) {
  const [passPct, setPassPct] = useState(String(t.season.passPct));
  const [count, setCount] = useState(String(t.season.questionCount));
  const [busy, run] = useBusy();
  return (
    <Card
      title="Configuração da avaliação da temporada"
      sub="Esta avaliação existente também é gerenciada dentro do episódio."
    >
      <form
        class="ad-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            try {
              await call(adminContentApi.seasons.update, {
                params: { id: String(t.season.n) },
                body: { testPassPct: Number(passPct), testQuestionCount: Number(count) },
              });
              toast('Configuração salva.');
              onSaved();
            } catch (error) {
              toast(errorMessage(error), 'err');
            }
          });
        }}
      >
        <Field id="season-test-pass" label="Nota para passar (%)">
          <TextIn id="season-test-pass" type="number" min="0" max="100" value={passPct} onValue={setPassPct} />
        </Field>
        <Field id="season-test-count" label="Questões aprovadas necessárias">
          <TextIn id="season-test-count" type="number" min="1" max="100" value={count} onValue={setCount} />
        </Field>
        <Button label="Salvar configuração" type="submit" busy={busy} />
      </form>
    </Card>
  );
}

export function SeasonTestEditor({ params, q }: ScreenProps) {
  const n = Number(params.n) || 1;
  const filter = (['draft', 'approved', 'rejected'].includes(q.status ?? '') ? q.status : '') as Status | '';
  const load = useLoad((signal) => call(API.get, { params: { n }, query: {}, signal }), [n]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Q | null | 'new'>(null);
  const [drafting, setDrafting] = useState(false);
  const [busy, run] = useBusy();
  const t = load.data;

  const review = (ids: string[], status: Status) =>
    run(async () => {
      try {
        await call(API.review, { params: { n }, body: { ids, status } });
        toast(
          `${plural(ids.length, 'questão', 'questões')} ${status === 'approved' ? 'aprovada(s)' : status === 'rejected' ? 'recusada(s)' : 'de volta a rascunho'}.`,
        );
        setSel(new Set());
        load.reload();
      } catch (e) {
        toast(errorMessage(e), 'err');
      }
    });

  const remove = (x: Q) =>
    void confirmAction({
      title: 'Apagar esta questão?',
      body: 'Ela sai do teste de vez. Se algum aluno já respondeu, recuse em vez de apagar.',
      confirm: 'Apagar',
      danger: true,
      run: () => call(API.remove, { params: { n, id: x.id } }),
    }).then((ok) => {
      if (ok) {
        toast('Questão apagada.');
        load.reload();
      }
    });

  const publish = (on: boolean) =>
    void confirmAction({
      title: on ? 'Abrir o teste para os alunos?' : 'Fechar o teste?',
      body: on
        ? `As ${t?.counts.approved ?? 0} questões aprovadas passam a valer na hora para quem concluiu a temporada. Quem passar ganha o certificado e os pontos da aprovação.`
        : 'O teste some para os alunos. Resultados e certificados já emitidos continuam valendo.',
      confirm: on ? 'Abrir o teste' : 'Fechar o teste',
      danger: !on,
      run: () => call(API.publish, { params: { n }, body: { published: on } }),
    }).then((ok) => {
      if (ok) {
        toast(on ? 'Teste aberto.' : 'Teste fechado.');
        load.reload();
      }
    });

  const actions = t ? (
    <>
      <Button label="Nova questão" icon="plus" kind="light" onClick={() => setEdit('new')} />
      <Button label="Gerar rascunho com IA" icon="sparkle" kind="blue" onClick={() => setDrafting(true)} />
      {can('content.publish') ? (
        t.season.published ? (
          <Button label="Fechar o teste" icon="lock" kind="light" onClick={() => publish(false)} />
        ) : (
          <Button
            label="Abrir o teste"
            icon="rocket"
            disabled={t.publishProblems.length > 0}
            title={t.publishProblems.join(' ') || undefined}
            onClick={() => publish(true)}
          />
        )
      ) : null}
    </>
  ) : null;

  const list = t ? (filter ? t.questions.filter((x) => x.status === filter) : t.questions) : [];
  const order = new Map((t?.questions ?? []).map((x, i) => [x.id, i + 1]));
  const selIds = list.filter((x) => sel.has(x.id)).map((x) => x.id);

  return (
    <Page
      title={`Teste da Temporada ${n}`}
      kicker={t ? `Conteúdo · ${t.season.title}` : 'Conteúdo'}
      back={params.ep ? `conteudo/episodios/${params.ep}` : `conteudo/temporadas/${n}`}
      actions={actions}
      width={1080}
      bar={
        t ? (
          <div class="ad-fgroups">
            <FilterChips
              label="Situação"
              showLabel
              value={filter}
              onChange={(v) => setQuery({ status: v })}
              options={[
                ['', 'Todas', t.questions.length],
                ['draft', 'Rascunhos', t.counts.draft],
                ['approved', 'Aprovadas', t.counts.approved],
                ['rejected', 'Recusadas', t.counts.rejected],
              ]}
            />
          </div>
        ) : undefined
      }
    >
      {load.error && !t ? (
        <ErrorBox error={load.error} retry={load.reload} />
      ) : !t ? (
        <Skeleton rows={4} height={120} />
      ) : (
        <>
          <SeasonTestSettings
            key={`${t.season.n}:${t.season.passPct}:${t.season.questionCount}`}
            t={t}
            onSaved={load.reload}
          />
          <Card
            title={
              <span class="row wrapx" style={{ '--gap': '8px' }}>
                Situação do teste
                {t.season.published ? (
                  <Pill label="Aberto para os alunos" tone="gr" icon="check" />
                ) : (
                  <Pill label="Fechado" tone="" icon="lock" />
                )}
              </span>
            }
            sub={
              t.season.published && t.season.publishedAt
                ? `Aberto em ${fmtDateTime(t.season.publishedAt)}.`
                : 'Os alunos veem o teste depois de concluir todos os episódios publicados da temporada.'
            }
            actions={<LinkButton href={`conteudo/temporadas/${n}`} label="Alterar nota e meta" icon="sliders" />}
          >
            <div class="row wrapx" style={{ '--gap': '8px' }}>
              <Pill label={`Aprova com ${t.season.passPct}%`} tone="navy" />
              <Pill label={`Meta: ${t.season.questionCount} aprovadas`} tone="" />
              <Pill label={`${t.counts.approved} aprovadas`} tone="gr" />
              <Pill label={`${t.counts.draft} rascunhos`} tone="gold" />
              <Pill label={`${t.counts.rejected} recusadas`} tone="" />
            </div>
            {t.publishProblems.length ? (
              <div class="ad-note gold mt8">
                <Icon name="alert" size={18} />
                <span>{t.publishProblems.join(' ')}</span>
              </div>
            ) : null}
          </Card>

          {list.length ? (
            <div
              class="row wrapx"
              style={{
                '--gap': '8px',
                position: 'sticky',
                top: '0',
                zIndex: '2',
                padding: '8px 12px',
                borderRadius: '14px',
                background: 'var(--paper)',
                border: '1.5px solid var(--line)',
              }}
            >
              <label class="row sm" style={{ '--gap': '8px', cursor: 'pointer', fontWeight: '700' }}>
                <input
                  type="checkbox"
                  style={{ width: '18px', height: '18px' }}
                  checked={selIds.length > 0 && selIds.length === list.length}
                  onChange={(e) =>
                    setSel((e.currentTarget as HTMLInputElement).checked ? new Set(list.map((x) => x.id)) : new Set())
                  }
                />
                {selIds.length ? `${selIds.length} selecionada(s)` : 'Selecionar todas'}
              </label>
              <span class="grow" />
              <Button
                label="Aprovar"
                icon="check"
                kind="green"
                disabled={!selIds.length}
                busy={busy}
                onClick={() => void review(selIds, 'approved')}
              />
              <Button
                label="Recusar"
                icon="close"
                kind="light"
                disabled={!selIds.length || busy}
                onClick={() => void review(selIds, 'rejected')}
              />
            </div>
          ) : null}

          {!list.length ? (
            <Empty
              icon="sparkle"
              title={t.questions.length ? 'Nenhuma questão com essa situação.' : 'Este teste ainda não tem questões.'}
              body={
                t.questions.length
                  ? 'Troque o filtro acima.'
                  : 'Gere um rascunho com a IA a partir dos episódios publicados, ou escreva as questões uma a uma.'
              }
              action={
                t.questions.length ? null : (
                  <Button label="Gerar rascunho com IA" icon="sparkle" kind="blue" onClick={() => setDrafting(true)} />
                )
              }
            />
          ) : (
            list.map((x) => (
              <QuestionCard
                key={x.id}
                q={x}
                idx={order.get(x.id) ?? 0}
                selected={sel.has(x.id)}
                onSelect={(on) =>
                  setSel((s) => {
                    const next = new Set(s);
                    if (on) next.add(x.id);
                    else next.delete(x.id);
                    return next;
                  })
                }
                onReview={(s) => void review([x.id], s)}
                onEdit={() => setEdit(x)}
                onDelete={() => remove(x)}
              />
            ))
          )}
        </>
      )}
      {edit ? (
        <EditModal
          n={n}
          q={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            load.reload();
          }}
        />
      ) : null}
      {drafting && t ? (
        <DraftModal
          t={t}
          onClose={() => setDrafting(false)}
          onDone={() => {
            setDrafting(false);
            setQuery({ status: 'draft' });
            load.reload();
          }}
        />
      ) : null}
    </Page>
  );
}
