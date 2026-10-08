// Take the episode test (testHtml / testPick / testSubmit / testRedo in prototipo/js/screens/curso.js).
// 20 questions in 4 parts (choice, fill-in, translate, pronunciation with an audio button), a sticky
// progress bar, and the result with the wrong answers linked to the step to review.
// Choices are saved at once; typed answers are saved shortly after typing stops (and on blur); every
// save of an e-book goes through one ordered queue (see enqueueSave), and the submit carries the whole
// sheet on screen (so a save still in flight cannot be graded as blank).
// The server grades and awards test_pass; the review list follows its grade.
import { LIMITS } from '@tie/shared/constants';
import type { Ebook, TestQuestion } from '@tie/shared/content/schema';
import type { TestQuestionResult, TestResult } from '@tie/shared/contracts/ebook';
import type { TestAnswer } from '@tie/shared/state';
import { activator, Btn, Icon } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { say } from '../../core/speech';
import { saveTestAnswers, set, state, submitTest } from '../../store';
import { allQuestions, isAnswered, isDesk, isRight, lessonsLabel, PartFrame, testIntro } from './common';

const KICK = 'Take a test';
const TITLE = 'Take the episode test';
/** Typed answers are saved this long after the last keystroke. */
const SAVE_DEBOUNCE_MS = 800;

type Answers = Readonly<Record<string, TestAnswer>>;

/** A desktop question row: the question | the answer, vertically centred. */
const ROW = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
  gap: '12px 24px',
  alignItems: 'center',
  padding: '14px 20px',
};

/** Desktop grid of the review list: two equal columns. */
const DESK_GRID = 'repeat(2, minmax(0, 1fr))';

/** An odd last review card spans the row (nothing on a phone: one column). */
function cell(desk: boolean, j: number, n: number): Record<string, string> {
  return desk && n % 2 === 1 && j === n - 1 ? { gridColumn: '1 / -1' } : {};
}
const scrollTop = () => {
  const sc = document.querySelector('.scroll');
  if (sc) sc.scrollTop = 0;
};

/**
 * Answer saves, per e-book, go out one at a time, in order: what waits is merged (the latest value of
 * a question wins) and sent as one PUT once the previous one has landed. Parallel PUTs could land out
 * of order and leave a stale answer on the server (what a reload shows), and a typed answer still on
 * the wire could land after a "Refazer o teste" reset and bring that answer back.
 */
interface SaveQueue {
  next: Record<string, TestAnswer | null>;
  reset: boolean;
  tail: Promise<void>;
}
const queues = new Map<number, SaveQueue>();

function queueOf(n: number): SaveQueue {
  let q = queues.get(n);
  if (!q) {
    q = { next: {}, reset: false, tail: Promise.resolve() };
    queues.set(n, q);
  }
  return q;
}

/** Queues answers (or a reset, which drops what was queued before it); resolves once it was sent. */
function enqueueSave(n: number, answers: Readonly<Record<string, TestAnswer | null>>, reset = false): Promise<void> {
  const q = queueOf(n);
  if (reset) {
    q.next = {};
    q.reset = true;
  }
  Object.assign(q.next, answers);
  q.tail = q.tail.then(async () => {
    if (!q.reset && !Object.keys(q.next).length) return;
    const a = q.next;
    const r = q.reset;
    q.next = {};
    q.reset = false;
    await saveTestAnswers(n, a, r).catch(() => null);
  });
  return q.tail;
}

/** Resolves once every save queued so far for this e-book has landed. */
const settled = (n: number): Promise<void> => queueOf(n).tail;

/**
 * The server's grade of the last submit of this session, per e-book. The review list is built from
 * it, so the score and "O que revisar" always agree; after a reload (no grade in memory) the saved
 * answers the server graded are used instead.
 */
const graded = new Map<number, TestResult>();

function Result({
  eb,
  ans,
  score,
  grade,
  onRedo,
}: {
  eb: Ebook;
  ans: Answers;
  score: number;
  grade: TestResult | undefined;
  onRedo: () => void;
}) {
  const all = allQuestions(eb);
  const total = all.length;
  const desk = isDesk();
  const passed = score >= eb.passScore;
  const pct = total ? Math.round((eb.passScore / total) * 100) : 70;
  const byId = new Map<string, TestQuestionResult>((grade?.results ?? []).map((r) => [r.questionId, r]));
  const wrong = all.filter((q) => {
    const r = byId.get(q.id);
    return r ? !r.correct : !isRight(q, ans[q.id]);
  });
  const given = (q: TestQuestion): string => {
    const r = byId.get(q.id);
    const v = r ? r.given : ans[q.id];
    if (q.opts) return v != null && typeof v === 'number' ? (q.opts[v] ?? 'Sem resposta') : 'Sem resposta';
    return (v != null && String(v).trim()) || 'Sem resposta';
  };
  const right = (q: TestQuestion): string =>
    byId.get(q.id)?.show || (q.opts ? (q.opts[q.a ?? 0] ?? '') : (q.show ?? q.acc?.[0] ?? ''));
  return (
    <PartFrame kick={KICK} title={TITLE}>
      <div class="card navy stack" style={{ '--gap': '10px' }}>
        <div class="lbl" style={{ color: 'var(--onNavy)' }}>
          Resultado
        </div>
        <div class="row base" style={{ '--gap': '8px' }}>
          <span class="num" style={{ fontSize: '3.6rem' }}>
            {score}
          </span>
          <span class="h2" style={{ color: '#fff' }}>
            {`/${total} · ${total ? Math.round((score / total) * 100) : 0}%`}
          </span>
        </div>
        <div class="h2" style={{ color: '#fff' }}>
          {passed ? 'Acima da nota de corte.' : `Abaixo de ${pct}%.`}
        </div>
        <p class="p">
          {passed
            ? `O e-book ${eb.num} está fechado. Revise os pontos abaixo antes do E-book ${eb.num + 1}.`
            : `A recomendação é repetir as ${lessonsLabel(eb)} antes de seguir. Recomenda, não bloqueia.`}
        </p>
      </div>
      {wrong.length ? <div class="lbl">{`O que revisar · ${wrong.length}`}</div> : null}
      {wrong.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: desk ? DESK_GRID : '1fr', gap: '14px' }}>
          {wrong.map((q, j) => (
            <div key={q.id} class="card stack" style={{ '--gap': '8px', ...cell(desk, j, wrong.length) }}>
              <div class="row base" style={{ '--gap': '10px' }}>
                <span class="num" style={{ color: 'var(--orange)', width: '24px' }}>
                  {q.n}
                </span>
                <span class="h3">{q.q}</span>
              </div>
              <div class="fb err cmp">
                <span class="k" style={{ color: 'var(--red)' }}>
                  VOCÊ
                </span>
                <span>{given(q)}</span>
              </div>
              <div class="fb ok cmp">
                <span class="k" style={{ color: 'var(--green)' }}>
                  CERTO
                </span>
                <b>{right(q)}</b>
              </div>
              <a class="btn link" href={`#/episodio/${q.ep}/${q.step || 7}`} style={{ justifyContent: 'flex-start' }}>
                {`Revisar: ${q.rev}`}
              </a>
            </div>
          ))}
        </div>
      ) : null}
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Btn label="Refazer o teste" kind="ghost" onClick={onRedo} />
        <Btn label="Voltar à trilha" go="trilha" />
      </div>
    </PartFrame>
  );
}

export function Teste({ eb }: { eb: Ebook }) {
  const k = String(eb.num);
  const s = state.value;
  const ans: Answers = s.testAns[k] ?? {};
  const done = !!s.testDone[k];
  const [busy, setBusy] = useState(false);

  // Typed answers not saved yet (question id → value), flushed after a pause, on blur and on submit.
  const pending = useRef<Record<string, TestAnswer | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const takePending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = {};
    return p;
  };
  const save = (answers: Record<string, TestAnswer | null>) => {
    void enqueueSave(eb.num, answers);
  };
  const flush = () => {
    const p = takePending();
    if (Object.keys(p).length) save(p);
  };
  useEffect(() => () => flush(), []);

  const all = allQuestions(eb);
  const total = all.length;

  if (done) {
    const redo = () => {
      // Typed answers not sent yet are dropped; the reset goes after every save already on the wire.
      takePending();
      graded.delete(eb.num);
      void enqueueSave(eb.num, {}, true);
    };
    return <Result eb={eb} ans={ans} score={s.testScore[k] ?? 0} grade={graded.get(eb.num)} onRedo={redo} />;
  }

  const pick = (q: TestQuestion, i: number) => {
    // Shown at once (a save queued behind another one would otherwise show only when it goes out).
    set((st) => ({ testAns: { ...st.testAns, [k]: { ...(st.testAns[k] ?? {}), [q.id]: i } } }));
    save({ [q.id]: i });
  };
  const type = (q: TestQuestion, typed: string) => {
    // data-model="testAns.n": the store holds what is typed; the server gets it after a pause. The
    // input caps it at the server's limit (a paste cannot make every save and the submit fail).
    const v = typed.slice(0, LIMITS.freeTextMax);
    set((st) => ({ testAns: { ...st.testAns, [k]: { ...(st.testAns[k] ?? {}), [q.id]: v } } }));
    pending.current[q.id] = v.trim() ? v : null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    takePending();
    // Answer saves still queued or on the wire land first, so none lands after the grade.
    await settled(eb.num);
    // The whole sheet on screen goes with the submit (null for the unanswered ones): every answer is
    // graded as the learner sees it, never as blank because its own save had not landed yet.
    const cur = state.value.testAns[k] ?? {};
    const sheet: Record<string, TestAnswer | null> = {};
    for (const q of all) {
      const v = cur[q.id];
      sheet[q.id] = v != null && isAnswered(q, v) ? v : null;
    }
    const res = await submitTest(eb.num, sheet);
    if (res) graded.set(eb.num, res);
    if (!res && typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Offline: the submit waits in the outbox; show the result graded here (the server's grade
      // replaces it on the next load).
      const score = all.filter((q) => isRight(q, sheet[q.id] ?? undefined)).length;
      set((st) => ({ testDone: { ...st.testDone, [k]: true }, testScore: { ...st.testScore, [k]: score } }));
    }
    setBusy(false);
    scrollTop();
  };

  const answered = all.filter((q) => isAnswered(q, ans[q.id])).length;
  const desk = isDesk();
  return (
    <PartFrame kick={KICK} title={TITLE} intro={testIntro(eb)}>
      {/* The sticky progress sits on its own white strip (inset from the edges, the count with room
          around it), over the cream band that hides the questions scrolling under it. */}
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
          {/* Once every question is answered the submit comes up here too, at hand wherever the
            learner is (the prototype only had it at the very end; until then that one is enough). */}
          {answered === total ? (
            <Btn label="Entregar" kind="navy compact" dis={busy} onClick={() => void submit()} />
          ) : null}
        </div>
      </div>
      {eb.test.map((part) => [
        <div key={`p-${part.title}`} class="lbl or mt8">
          {part.title}
        </div>,
        // Phone: one card per question, the answer under it. Desktop: one row per question (the
        // question on the left, the answer on the right), the same for every question, so a part with
        // an odd count never leaves an orphan card or a question laid out differently from the rest.
        <div key={`g-${part.title}`} class="stack" style={{ '--gap': '10px' }}>
          {part.qs.map((q) => {
            // A listen control, not an answer: a small soft-blue button with the speaker under the
            // question (the prototype's "Ouvir o áudio" button), apart from the options.
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
            // The number in a fixed column, so a question that wraps keeps its own left edge.
            const head = (
              <div class="stack" style={{ '--gap': '10px' }}>
                <div class="row base" style={{ '--gap': '10px' }}>
                  <span class="num" style={{ color: 'var(--orange)', width: '26px', flex: 'none' }}>
                    {q.n}
                  </span>
                  <span class="h3 grow" style={{ textWrap: 'pretty' }}>
                    {q.q}
                  </span>
                </div>
                {listen ? <div style={{ paddingLeft: '36px', display: 'flex' }}>{listen}</div> : null}
              </div>
            );
            // Desktop: every choice question on one 3-column grid of equal tiles (two options take two
            // of its cells), so the tiles line up from question to question; a long option wraps,
            // balanced, inside its tile. Phone: every choice question the same way, one full-width row
            // per option with its letter (mixing rows of tiles and stacked rows read as inconsistent).
            const answer = q.opts ? (
              <div
                style={
                  desk
                    ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }
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
                id={`tq${q.n}`}
                placeholder="Escreva em inglês"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                aria-label={`Questão ${q.n}`}
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
      ])}{' '}
      <Btn label="Entregar o teste" cls="block" dis={busy} onClick={() => void submit()} />
    </PartFrame>
  );
}
