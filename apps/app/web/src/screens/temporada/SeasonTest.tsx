// Teste da temporada (#/temporada/:n/teste), spec 07 feature B (PROD, no prototype counterpart). The
// e-book test's layout (screens/ebook/Teste.tsx): parts, a sticky progress strip, choice tiles or a
// typed answer, an audio button, one submit; then the result with the review and, once passed, the
// certificate. The questions come live from GET /api/seasons/:n/test (approved questions of a published
// test, without the answer key); the server grades, awards season_pass and issues the certificate.
import { LIMITS } from '@tie/shared/constants';
import type {
  SeasonTestQuestionPublic,
  SeasonTestQuestionResult,
  SeasonTestResult,
  SeasonTestView,
} from '@tie/shared/contracts/seasonTest';
import { seasonsApi } from '@tie/shared/contracts/seasonTest';
import type { TestAnswer } from '@tie/shared/state';
import { activator, Btn, confetti, Icon, Topbar } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { say } from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { catalog } from '../../store';
import { saveSeasonAnswers, submitSeasonTest } from '../../store/season';
import { DESK_WRAP, DeskHead, isDesk, pad2, seasonCefr } from '../ebook/common';
import { CertificateCard } from './CertificateCard';

const TITLE = 'Teste da temporada';
const SAVE_DEBOUNCE_MS = 800;

type Answers = Readonly<Record<string, TestAnswer>>;

const ROW = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
  gap: '12px 24px',
  alignItems: 'center',
  padding: '14px 20px',
};

const scrollTop = () => {
  const sc = document.querySelector('.scroll');
  if (sc) sc.scrollTop = 0;
};

const isAnswered = (q: SeasonTestQuestionPublic, v: TestAnswer | undefined): boolean =>
  q.kind === 'choice' ? v != null : !!(v != null && String(v).trim());

/** One ordered save queue per season (see Teste.tsx enqueueSave: later saves never overtake). */
const queues = new Map<number, { next: Record<string, TestAnswer | null>; reset: boolean; tail: Promise<void> }>();
function enqueueSave(n: number, answers: Readonly<Record<string, TestAnswer | null>>, reset = false): Promise<void> {
  let q = queues.get(n);
  if (!q) {
    q = { next: {}, reset: false, tail: Promise.resolve() };
    queues.set(n, q);
  }
  const queue = q;
  if (reset) {
    queue.next = {};
    queue.reset = true;
  }
  Object.assign(queue.next, answers);
  queue.tail = queue.tail.then(async () => {
    if (!queue.reset && !Object.keys(queue.next).length) return;
    const a = queue.next;
    const r = queue.reset;
    queue.next = {};
    queue.reset = false;
    await saveSeasonAnswers(n, a, r).catch(() => null);
  });
  return queue.tail;
}

/** The last grade of this session per season (the review list is built from it). */
const graded = new Map<number, SeasonTestResult>();

function Frame({ n, intro, children }: { n: number; intro?: string; children?: ComponentChildren }) {
  const desk = isDesk();
  const kicker = `Temporada ${n} · ${seasonCefr(catalog.value, n)}`;
  return (
    <>
      {desk ? null : <Topbar back="trilha" kicker={kicker} title={TITLE} />}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': desk ? DESK_WRAP : '760px', '--gap': '14px' }}>
          {desk ? <DeskHead back="trilha" kicker={kicker} title={TITLE} intro={intro} /> : null}
          {intro && !desk ? <p class="p-read">{intro}</p> : null}
          {children}
        </div>
      </div>
    </>
  );
}

/** Unpublished, locked or unreachable: one card that says why, and the way back. */
function Notice({ icon, title, body, cta }: { icon: string; title: string; body: ComponentChildren; cta?: string }) {
  return (
    <div class="card stack" style={{ '--gap': '12px' }}>
      <div class="row" style={{ '--gap': '12px' }}>
        <span
          aria-hidden="true"
          style={{
            width: '44px',
            height: '44px',
            flex: 'none',
            borderRadius: '14px',
            background: 'var(--blueT)',
            color: 'var(--blueD)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={22} />
        </span>
        <div class="h3">{title}</div>
      </div>
      <div class="p">{body}</div>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Btn label={cta ?? 'Voltar à trilha'} kind="navy" go="trilha" />
      </div>
    </div>
  );
}

function Result({
  n,
  view,
  grade,
  ans,
  onRedo,
}: {
  n: number;
  view: SeasonTestView;
  grade: SeasonTestResult | undefined;
  ans: Answers;
  onRedo: () => void;
}) {
  const desk = isDesk();
  const pct = grade?.scorePct ?? view.result?.scorePct ?? 0;
  const passed = grade ? grade.passed : !!view.result?.passed;
  const cert = grade?.certificate ?? view.certificate;
  const byId = new Map<string, SeasonTestQuestionResult>((grade?.results ?? []).map((r) => [r.questionId, r]));
  const wrong = grade ? view.questions.filter((q) => byId.get(q.id)?.correct === false) : [];
  const given = (q: SeasonTestQuestionPublic): string => {
    const v = byId.get(q.id)?.given ?? ans[q.id];
    if (q.opts) return typeof v === 'number' ? (q.opts[v] ?? 'Sem resposta') : 'Sem resposta';
    return (v != null && String(v).trim()) || 'Sem resposta';
  };
  return (
    <Frame n={n}>
      <div class="card navy stack" style={{ '--gap': '10px' }}>
        <div class="lbl" style={{ color: 'var(--onNavy)' }}>
          Resultado
        </div>
        <div class="row base" style={{ '--gap': '8px' }}>
          <span class="num" style={{ fontSize: '3.6rem' }}>{`${pct}%`}</span>
          {grade ? <span class="h2" style={{ color: '#fff' }}>{`${grade.score}/${grade.total}`}</span> : null}
        </div>
        <div class="h2" style={{ color: '#fff' }}>
          {passed ? 'Aprovado na temporada.' : `Abaixo de ${view.passPct}%.`}
        </div>
        <p class="p">
          {passed
            ? `Você fechou a Temporada ${n} · ${view.season.title}.${cert && !cert.revoked ? ' Seu certificado está pronto.' : ''}`
            : `A nota para aprovar é ${view.passPct}%. Revise os pontos abaixo e tente de novo quando quiser.`}
        </p>
      </div>
      {cert ? <CertificateCard cert={cert} /> : null}
      {wrong.length ? <div class="lbl">{`O que revisar · ${wrong.length}`}</div> : null}
      {wrong.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: desk ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: '14px' }}>
          {wrong.map((q) => {
            const r = byId.get(q.id);
            const idx = view.questions.indexOf(q) + 1;
            return (
              <div key={q.id} class="card stack" style={{ '--gap': '8px' }}>
                <div class="row base" style={{ '--gap': '10px' }}>
                  <span class="num" style={{ color: 'var(--orange)', width: '26px', flex: 'none' }}>
                    {idx}
                  </span>
                  <span class="h3">{q.q}</span>
                </div>
                <div class="fb err cmp">
                  <span class="k" style={{ color: 'var(--red)' }}>
                    VOCÊ
                  </span>
                  <span>{given(q)}</span>
                </div>
                {r?.show ? (
                  <div class="fb ok cmp">
                    <span class="k" style={{ color: 'var(--green)' }}>
                      CERTO
                    </span>
                    <b>{r.show}</b>
                  </div>
                ) : null}
                {q.epNum ? (
                  <a class="btn link" href={`#/episodio/${q.epNum}/1`} style={{ justifyContent: 'flex-start' }}>
                    {`Revisar: ${r?.rev || `Episódio ${pad2(q.epNum)}`}`}
                  </a>
                ) : r?.rev ? (
                  <span class="sm">{`Revisar: ${r.rev}`}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Btn label="Refazer o teste" kind="ghost" onClick={onRedo} />
        <Btn label="Voltar à trilha" go="trilha" />
      </div>
    </Frame>
  );
}

function Sheet({
  n,
  view,
  ans,
  setAns,
  onGraded,
}: {
  n: number;
  view: SeasonTestView;
  ans: Answers;
  setAns: (f: (a: Answers) => Answers) => void;
  onGraded: (r: SeasonTestResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef<Record<string, TestAnswer | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const takePending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = {};
    return p;
  };
  const flush = () => {
    const p = takePending();
    if (Object.keys(p).length) void enqueueSave(n, p);
  };
  useEffect(() => () => flush(), []);

  const all = view.questions;
  const total = all.length;
  const answered = all.filter((q) => isAnswered(q, ans[q.id])).length;
  const desk = isDesk();

  const pick = (q: SeasonTestQuestionPublic, i: number) => {
    setAns((a) => ({ ...a, [q.id]: i }));
    void enqueueSave(n, { [q.id]: i });
  };
  const type = (q: SeasonTestQuestionPublic, typed: string) => {
    const v = typed.slice(0, LIMITS.freeTextMax);
    setAns((a) => ({ ...a, [q.id]: v }));
    pending.current[q.id] = v.trim() ? v : null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    takePending();
    await queues.get(n)?.tail;
    const sheet: Record<string, TestAnswer | null> = {};
    for (const q of all) {
      const v = ans[q.id];
      sheet[q.id] = v != null && isAnswered(q, v) ? v : null;
    }
    const res = await submitSeasonTest(n, sheet);
    setBusy(false);
    if (res) {
      if (res.passed && res.award?.awarded) confetti();
      onGraded(res);
      scrollTop();
    }
  };

  // Parts in order of their first question.
  const parts: { title: string; qs: SeasonTestQuestionPublic[] }[] = [];
  for (const q of all) {
    const last = parts[parts.length - 1];
    if (last && last.title === q.partTitle) last.qs.push(q);
    else parts.push({ title: q.partTitle, qs: [q] });
  }
  let num = 0;
  const intro = `${total} questões sobre os episódios da Temporada ${n}. Para aprovar: ${view.passPct}% de acertos. Aprovado, você ganha o certificado.`;
  return (
    <Frame n={n} intro={intro}>
      <div style={{ position: 'sticky', top: '0', zIndex: '3', background: 'var(--cream)', padding: '6px 0' }}>
        <div
          class="row"
          style={{
            '--gap': '14px',
            padding: answered === total ? '6px 6px 6px 16px' : '10px 16px',
            minHeight: '48px',
            borderRadius: '16px',
            background: '#fff',
            border: '1.5px solid var(--line)',
          }}
        >
          <div class="bar grow">
            <i style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }} />
          </div>
          <span class="sm" style={{ fontWeight: '800', color: 'var(--navy)', whiteSpace: 'nowrap' }}>
            {`${answered} de ${total}`}
            {desk || answered < total ? (
              <span style={{ fontWeight: '600', color: 'var(--muted)' }}> respondidas</span>
            ) : null}
          </span>
          {answered === total ? (
            <Btn label="Entregar" kind="navy compact" dis={busy} onClick={() => void submit()} />
          ) : null}
        </div>
      </div>
      {parts.map((part, pi) => [
        part.title ? (
          <div key={`p-${pi}`} class="lbl or mt8">
            {part.title}
          </div>
        ) : null,
        <div key={`g-${pi}`} class="stack" style={{ '--gap': '10px' }}>
          {part.qs.map((q) => {
            num++;
            const listen = q.audio ? (
              <button
                type="button"
                class="chip"
                style={{
                  alignSelf: 'flex-start',
                  minHeight: '44px',
                  padding: '0 18px 0 12px',
                  gap: '8px',
                  background: 'var(--blue)',
                  borderColor: 'var(--blue)',
                  color: '#fff',
                  fontWeight: '800',
                  fontSize: '.98rem',
                  boxShadow: '0 4px 12px -6px rgba(31,94,255,.6)',
                }}
                onClick={activator(undefined, () => {
                  void say(q.audio ?? '');
                })}
              >
                <Icon name="speaker" size={20} />
                <span>Ouvir o áudio</span>
              </button>
            ) : null;
            const head = (
              <div class="stack" style={{ '--gap': '10px' }}>
                <div class="row base" style={{ '--gap': '10px' }}>
                  <span class="num" style={{ color: 'var(--orange)', width: '26px', flex: 'none' }}>
                    {num}
                  </span>
                  <span class="h3 grow" style={{ textWrap: 'pretty' }}>
                    {q.q}
                  </span>
                </div>
                {listen ? <div style={{ paddingLeft: '36px', display: 'flex' }}>{listen}</div> : null}
              </div>
            );
            const answer = q.opts ? (
              <div
                style={
                  desk
                    ? {
                        display: 'grid',
                        // Four options as 2 × 2 (a 3-column grid left one alone on a second row).
                        gridTemplateColumns: `repeat(${q.opts.length === 4 ? 2 : 3}, minmax(0, 1fr))`,
                        gap: '8px',
                      }
                    : { display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }
                }
              >
                {q.opts.map((o, i) => {
                  const on = ans[q.id] === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      class={`pillopt${on ? ' pick' : ''}`}
                      aria-pressed={on ? 'true' : 'false'}
                      style={
                        desk
                          ? {
                              minHeight: '48px',
                              padding: '6px 12px',
                              fontSize: '1.02rem',
                              lineHeight: '1.25',
                              borderRadius: '16px',
                              textWrap: 'balance',
                              textAlign: 'center',
                            }
                          : {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              width: '100%',
                              minHeight: '46px',
                              padding: '6px 14px 6px 8px',
                              fontSize: '1rem',
                              lineHeight: '1.25',
                              borderRadius: '14px',
                              textAlign: 'left',
                            }
                      }
                      onClick={activator(undefined, () => pick(q, i))}
                    >
                      {desk ? null : (
                        <span
                          aria-hidden="true"
                          style={{
                            width: '30px',
                            height: '30px',
                            flex: 'none',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '.85rem',
                            background: on ? 'rgba(255,255,255,.16)' : 'var(--blueT)',
                            color: on ? '#fff' : 'var(--blueD)',
                          }}
                        >
                          {String.fromCharCode(65 + i)}
                        </span>
                      )}
                      {desk ? o : <span style={{ minWidth: '0' }}>{o}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                class="input"
                placeholder="Escreva em inglês"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                aria-label={`Questão ${num}`}
                maxLength={LIMITS.freeTextMax}
                value={typeof ans[q.id] === 'string' ? (ans[q.id] as string) : ''}
                onInput={(e) => type(q, (e.currentTarget as HTMLInputElement).value)}
                onBlur={flush}
              />
            );
            return desk ? (
              <div key={q.id} class="card" style={ROW}>
                {head}
                {answer}
              </div>
            ) : (
              <div key={q.id} class="card stack" style={{ '--gap': '12px' }}>
                {head}
                {answer}
              </div>
            );
          })}
        </div>,
      ])}
      <Btn label="Entregar o teste" cls="block" dis={busy} onClick={() => void submit()} />
    </Frame>
  );
}

export default function SeasonTest({ params }: ScreenProps) {
  const n = Number(params.n) || 1;
  useChrome({ tabs: true, nav: 'trilha', title: TITLE });
  const [view, setView] = useState<SeasonTestView | null>(null);
  const [error, setError] = useState('');
  const [ans, setAns] = useState<Answers>({});
  const [grade, setGrade] = useState<SeasonTestResult | undefined>(graded.get(n));

  useEffect(() => {
    let live = true;
    call(seasonsApi.test, { params: { n } })
      .then((v) => {
        if (!live) return;
        setView(v);
        setAns(v.answers);
      })
      .catch((err) => {
        if (live) setError(errorMessage(err));
      });
    return () => {
      live = false;
    };
  }, [n]);

  if (error) {
    return (
      <Frame n={n}>
        <Notice icon="bulb" title="Não deu para abrir o teste agora." body={error} />
      </Frame>
    );
  }
  if (!view) return <Frame n={n} />;

  if (!view.published) {
    return (
      <Frame n={n}>
        <Notice
          icon="clock"
          title="O teste desta temporada está em preparação."
          body={`Assim que ele abrir, você faz por aqui, depois dos ${view.episodes.published.length || 20} episódios.`}
        />
      </Frame>
    );
  }
  if (!view.unlocked) {
    const total = view.episodes.published.length;
    const done = total - view.episodes.missing.length;
    return (
      <Frame n={n}>
        <Notice
          icon="lock"
          title={`Termine os ${total} episódios para abrir o teste.`}
          cta="Continuar a trilha"
          body={
            <span class="stack" style={{ '--gap': '10px', display: 'flex' }}>
              <span>{`Você concluiu ${done} de ${total}. Faltam: ${view.episodes.missing.map(pad2).join(', ')}.`}</span>
              <span class="bar" style={{ display: 'block' }}>
                <i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
              </span>
            </span>
          }
        />
      </Frame>
    );
  }
  if (!view.questions.length) {
    return (
      <Frame n={n}>
        <Notice icon="clock" title="O teste desta temporada está em preparação." body="Volte daqui a pouco." />
      </Frame>
    );
  }

  const submitted = grade ? true : (view.result?.submittedAt ?? 0) > 0;
  if (submitted) {
    const redo = () => {
      graded.delete(n);
      setGrade(undefined);
      setAns({});
      setView({ ...view, answers: {}, result: view.result ? { ...view.result, submittedAt: 0 } : null });
      void enqueueSave(n, {}, true);
    };
    return <Result n={n} view={view} grade={grade} ans={ans} onRedo={redo} />;
  }
  return (
    <Sheet
      n={n}
      view={view}
      ans={ans}
      setAns={(f) => setAns(f)}
      onGraded={(r) => {
        graded.set(n, r);
        setGrade(r);
        setView({
          ...view,
          result: { scorePct: r.scorePct, passed: r.passed, attempts: r.attempts, submittedAt: Date.now() },
          certificate: r.certificate ?? view.certificate,
        });
      }}
    />
  );
}
