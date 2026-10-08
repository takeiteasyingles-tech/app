// Take the episode test (testHtml / testPick / testSubmit / testRedo in prototipo/js/screens/curso.js).
// 20 questions in 4 parts (choice, fill-in, translate, pronunciation with an audio button), a sticky
// progress bar, and the result with the wrong answers linked to the step to review.
// Choices are saved at once; typed answers are saved shortly after typing stops (and on blur), and
// the submit carries the whole sheet on screen (so a save still in flight cannot be graded as blank).
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

/**
 * Columns of a choice question: all options in one row when they are short enough to fit side by
 * side (no orphan option alone on a second row), otherwise one per row (no option wrapping inside its
 * button). A card is ~300px wide on a phone or in a desktop row of three, ~460px in a row of two.
 */
function optCols(opts: readonly string[], wide: boolean): number {
  const longest = Math.max(0, ...opts.map((o) => o.length));
  const fits = wide ? longest <= 13 : longest <= 8;
  return fits ? Math.max(1, Math.min(4, opts.length)) : 1;
}

/**
 * Desktop grid: two equal columns, every card the same width. When a list has an odd count, its last
 * card is "solo": it spans the row and lays out sideways (the question on the left, the answer on the
 * right), so it is neither a lone half-width card nor a stretched one.
 */
const DESK_GRID = 'repeat(2, minmax(0, 1fr))';

const isSolo = (desk: boolean, j: number, n: number): boolean => desk && n % 2 === 1 && j === n - 1;

/** The card's grid placement on desktop (nothing on a phone: one column). */
function cell(desk: boolean, j: number, n: number): Record<string, string> {
  return isSolo(desk, j, n) ? { gridColumn: '1 / -1' } : {};
}

/**
 * Option columns of question j: the two cards of a desktop row use the same option layout (a list
 * next to a list), so a row never pairs a tall card with a short one that is half empty.
 */
function rowCols(qs: readonly TestQuestion[], j: number, desk: boolean): number {
  const q = qs[j];
  if (!q?.opts) return 1;
  if (!desk) return optCols(q.opts, false);
  if (isSolo(desk, j, qs.length)) return optCols(q.opts, true);
  const mate = qs[j % 2 === 0 ? j + 1 : j - 1];
  return mate?.opts && optCols(mate.opts, true) === 1 ? 1 : optCols(q.opts, true);
}

/** The sideways layout of a solo card (desktop): question | answer. */
const SOLO_BODY = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  // 14px grid gap + 2 × 18px card padding + 2 × 1.5px border: the answer column lines up exactly
  // with the answers of the right-hand cards above it.
  gap: '12px 53px',
  alignItems: 'center',
};

const scrollTop = () => {
  const sc = document.querySelector('.scroll');
  if (sc) sc.scrollTop = 0;
};

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
  // Answer saves still on the wire: the submit waits for them, so none lands after the grade.
  const inflight = useRef(new Set<Promise<unknown>>());
  const save = (answers: Record<string, TestAnswer | null>) => {
    const p = saveTestAnswers(eb.num, answers);
    inflight.current.add(p);
    void p.finally(() => inflight.current.delete(p));
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
      takePending();
      graded.delete(eb.num);
      void saveTestAnswers(eb.num, {}, true);
    };
    return <Result eb={eb} ans={ans} score={s.testScore[k] ?? 0} grade={graded.get(eb.num)} onRedo={redo} />;
  }

  const pick = (q: TestQuestion, i: number) => {
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
    await Promise.allSettled([...inflight.current]);
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
      <div
        class="row"
        style={{
          '--gap': '10px',
          position: 'sticky',
          top: '0',
          zIndex: '3',
          background: 'var(--cream)',
          padding: '8px 0',
        }}
      >
        <div class="bar grow">
          <i style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }} />
        </div>
        <span class="sm" style={{ fontWeight: '800', color: 'var(--navy)', whiteSpace: 'nowrap' }}>
          {`${answered} de ${total}`}
        </span>
        {/* Once every question is answered the submit comes up here too, at hand wherever the
            learner is (the prototype only had it at the very end; until then that one is enough). */}
        {answered === total ? (
          <Btn label="Entregar" kind="navy compact" dis={busy} onClick={() => void submit()} />
        ) : null}
      </div>
      {eb.test.map((part) => [
        <div key={`p-${part.title}`} class="lbl or mt8">
          {part.title}
        </div>,
        <div
          key={`g-${part.title}`}
          style={{ display: 'grid', gridTemplateColumns: desk ? DESK_GRID : '1fr', gap: desk ? '14px' : '10px' }}
        >
          {part.qs.map((q, j) => {
            const solo = isSolo(desk, j, part.qs.length);
            return (
              <div
                key={q.id}
                class="card stack"
                style={{ '--gap': '12px', ...cell(desk, j, part.qs.length), ...(solo ? SOLO_BODY : {}) }}
              >
                <div class="row base" style={{ '--gap': '10px' }}>
                  <span class="num" style={{ color: 'var(--orange)', width: '24px' }}>
                    {q.n}
                  </span>
                  <span class="h3">{q.q}</span>
                </div>
                {/* The answer sits at the card's foot, so the inputs and options of cards side by side
                  line up even when one question wraps to two lines. */}
                <div class="stack" style={{ '--gap': '12px', marginTop: solo ? '0' : 'auto' }}>
                  {q.audio ? (
                    <div>
                      {/* A listen control, not an answer: a blue tinted chip with the speaker, unlike
                        the white option pills under it. */}
                      <button
                        type="button"
                        class="chip"
                        style={{
                          background: 'var(--blueT)',
                          borderColor: 'transparent',
                          color: 'var(--blueD)',
                          fontWeight: '800',
                        }}
                        onClick={activator(undefined, () => {
                          void say(q.audio ?? '');
                        })}
                      >
                        <Icon name="speaker" size={18} />
                        Ouvir o áudio
                      </button>
                    </div>
                  ) : null}
                  {q.opts ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${rowCols(part.qs, j, desk)}, minmax(0, 1fr))`,
                        gap: '8px',
                      }}
                    >
                      {q.opts.map((o, i) => (
                        <button
                          key={i}
                          type="button"
                          class={`pillopt${ans[q.id] === i ? ' pick' : ''}`}
                          aria-pressed={ans[q.id] === i ? 'true' : 'false'}
                          style={{
                            width: '100%',
                            fontSize: '1.02rem',
                            letterSpacing: '.01em',
                            lineHeight: '1.25',
                            padding: '8px 12px',
                            borderRadius: '16px',
                          }}
                          onClick={activator(undefined, () => pick(q, i))}
                        >
                          {o}
                        </button>
                      ))}
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
                  )}
                </div>
              </div>
            );
          })}
        </div>,
      ])}
      <Btn label="Entregar o teste" cls="block" dis={busy} onClick={() => void submit()} />
    </PartFrame>
  );
}
