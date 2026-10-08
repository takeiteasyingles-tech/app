// Store actions: the prototype's instant local writes (store.s.x = …; store.save(); game.award(k))
// become one API call each. The local change is applied at once (optimistic, as instant as the
// prototype), the server's answer then settles it, and its AwardResult plays the same effects as
// game.award(). Failures roll the optimistic keys back and toast the server's pt-BR message (a
// `gated` advance toasts need()'s message, like gate()). Writes the service worker may queue offline
// carry an Idempotency-Key; a queued write keeps its local change and is replayed later.
//
// Every helper resolves to the server response, or null when the write failed (already toasted)
// or was queued offline (no award to play yet).
import { batch } from '@preact/signals';
import { LIMITS } from '@tie/shared/constants';
import { ebookApi } from '@tie/shared/contracts/ebook';
import { extrasApi } from '@tie/shared/contracts/extras';
import { type AwardResult, type GameEventBody, gameApi } from '@tie/shared/contracts/game';
import type { EndpointDef, ResOf } from '@tie/shared/contracts/http';
import { type ClientTurn, micApi, type StartSessionBody } from '@tie/shared/contracts/mic';
import { type MicScoreSource, progressApi } from '@tie/shared/contracts/progress';
import { type CardSource, type NewCard, srsApi } from '@tie/shared/contracts/srs';
import { gradeCard } from '@tie/shared/domain/srs';
import { stepKey, type TestAnswer, type TieState } from '@tie/shared/state';
import { uiConfig } from '@tie/ui';
import { type CallOptions, call, errorMessage, isOutboxPath, newIdempotencyKey, QueuedError, urlFor } from '../api';
import { type AwardMeta, cardsFx, playAward, runFx, showToast } from './award';
import { syncDeck } from './deck';
import { type Patch, set, state } from './state';

type PatchFn = (s: TieState) => Patch | undefined;

export interface SendOptions<R> {
  /** Applied before the request (the prototype's immediate local write); rolled back on failure. */
  optimistic?: Patch | PatchFn;
  /** Settles the store from the server's answer. */
  apply?: (res: R, s: TieState) => Patch | undefined;
  /** Award meta (Mic seconds) for the response's award. */
  meta?: AwardMeta;
  /** No toast on failure (the caller shows its own). */
  quiet?: boolean;
}

let queuedToastShown = false;

/** Offline outbox: the first queued write of the page tells the learner once. */
function onQueued(err: QueuedError): void {
  if (queuedToastShown) return;
  queuedToastShown = true;
  showToast(err.message, 3200);
}

/**
 * Generic action: optimistic patch → call → apply(res) → award effects → unlocked cards toast.
 * The response's `award` (and `cardsAdded`) are handled here, so screens only render.
 */
export async function send<E extends EndpointDef>(
  ep: E,
  opts: CallOptions<E>,
  o: SendOptions<ResOf<E>> = {},
): Promise<ResOf<E> | null> {
  const before = state.value;
  const patch = typeof o.optimistic === 'function' ? o.optimistic(before) : o.optimistic;
  const keys = patch ? (Object.keys(patch) as (keyof TieState)[]) : [];
  if (patch) set(patch);
  const applied = state.value;
  const callOpts: CallOptions<E> = { ...opts };
  if (ep.method !== 'GET' && !callOpts.idempotencyKey && isOutboxPath(urlFor(ep, opts))) {
    callOpts.idempotencyKey = newIdempotencyKey();
    callOpts.outboxUser = before.user?.id;
  }
  let res: ResOf<E>;
  try {
    res = await call(ep, callOpts);
  } catch (err) {
    if (err instanceof QueuedError) {
      onQueued(err);
      return null;
    }
    const now = state.value;
    const restore: Record<string, unknown> = {};
    for (const k of keys) if (now[k] === applied[k]) restore[k] = before[k];
    if (keys.length) set(restore as Patch);
    if (!o.quiet) showToast(errorMessage(err));
    return null;
  }
  settle(res, o);
  return res;
}

function settle<R>(res: R, o: SendOptions<R>): void {
  const r = res as { award?: AwardResult | null; cardsAdded?: number } | undefined;
  batch(() => {
    if (o.apply) {
      const p = o.apply(res, state.value);
      if (p) set(p);
    }
    if (r?.award) playAward(r.award, o.meta);
  });
  if (r?.cardsAdded) {
    runFx(cardsFx(r.cardsAdded));
    void syncDeck();
  }
}

const rec = <V>(obj: Readonly<Record<string, V>>, k: string | number, v: V): Record<string, V> => ({
  ...obj,
  [String(k)]: v,
});

// ---------- Player (progress) ----------

/** mark(n): a step's media/dialogue finished (step 10 also awards `song`). */
export const markStep = (ep: number, step: number) =>
  send(
    progressApi.stepOk,
    { body: { ep, step } },
    { optimistic: (s) => ({ stepOk: rec(s.stepOk, stepKey(ep, step), true) }) },
  );

/**
 * setStep(n, true): move on to `step`. The server runs need() for the step being left (409 gated →
 * the need() message is toasted and prog rolls back), awards `step` past prog, and unlocks the
 * Take a Look / Take Away cards (toast "N cartões novos na Revisão." + deck refresh).
 */
export const advanceStep = (ep: number, step: number) =>
  send(
    progressApi.advance,
    { body: { ep, step } },
    {
      optimistic: (s) => ({ prog: rec(s.prog, ep, Math.max(s.prog[ep] || 1, step)) }),
      apply: (r, s) => ({ prog: rec(s.prog, ep, Math.max(s.prog[ep] || 1, r.prog)) }),
    },
  );

/** plNext on step 10: prog 10, epsDone, award `episode` (the screen adds its own confetti, as plNext did). */
export const finishEpisode = (ep: number) =>
  send(
    progressApi.episodeDone,
    { body: { ep } },
    { optimistic: (s) => ({ prog: rec(s.prog, ep, 10), epsDone: rec(s.epsDone, ep, true) }) },
  );

/**
 * plEx: answer an exercise item. The choice shows at once; the server grades it, a right answer
 * awards ex_right and a wrong one plays the soft sfx (the first answer is final).
 */
export const answerExercise = (itemId: string, choice: number) =>
  send(
    progressApi.exercise,
    { body: { itemId, choice } },
    {
      optimistic: (s) => ({ exAns: rec(s.exAns, itemId, choice) }),
      apply: (r, s) => {
        if (!r.correct) uiConfig.sfx('soft');
        return { exAns: rec(s.exAns, r.itemId, r.choice) };
      },
    },
  );

/** Take the Mic score: mic_good (≥ 8, signed AI attempt only) or mic_try. */
export const saveMicScore = (phraseId: string, score: number, source: MicScoreSource, attempt?: string) =>
  send(
    progressApi.mic,
    { body: { phraseId, score, source, ...(attempt ? { attempt } : {}) } },
    {
      optimistic: (s) => ({ scores: rec(s.scores, phraseId, score) }),
      apply: (r, s) => ({ scores: rec(s.scores, r.phraseId, r.last) }),
    },
  );

// ---------- E-book ----------

/** ebDownload: unlocks step 3; resolves with the real PDF URL when the e-book has one. */
export const downloadEbook = (n: number) =>
  send(ebookApi.download, { params: { n } }, { optimistic: (s) => ({ ebooks: rec(s.ebooks, n, true) }) });

/** Saves test answers (null clears one); `reset` is testRedo (answers and the done flag cleared). */
export const saveTestAnswers = (n: number, answers: Readonly<Record<string, TestAnswer | null>>, reset = false) =>
  send(
    ebookApi.testAnswers,
    { body: { answers: { ...answers }, ...(reset ? { reset } : {}) }, params: { n } },
    {
      optimistic: (s) => {
        const cur: Record<string, TestAnswer> = reset ? {} : { ...(s.testAns[n] ?? {}) };
        for (const [k, v] of Object.entries(answers)) {
          if (v === null) delete cur[k];
          else cur[k] = v;
        }
        return { testAns: rec(s.testAns, n, cur), ...(reset ? { testDone: rec(s.testDone, n, false) } : {}) };
      },
    },
  );

/** testSubmit: done + score; passing awards test_pass, failing plays the soft sfx. */
export const submitTest = (n: number, answers?: Readonly<Record<string, TestAnswer | null>>) =>
  send(
    ebookApi.testSubmit,
    { params: { n }, body: answers ? { answers: { ...answers } } : {} },
    {
      apply: (r, s) => {
        if (!r.passed) uiConfig.sfx('soft');
        return { testDone: rec(s.testDone, n, true), testScore: rec(s.testScore, n, r.score) };
      },
    },
  );

// ---------- Revisão (SRS) ----------

/**
 * review.add (+ game.award('word')): saves cards; duplicates (by norm(en)) are skipped. Resolves with
 * how many were added so the screen picks its copy ("Levei para a Revisão…" / "já está…").
 */
export async function addCards(
  cards: readonly { en: string; pt: string; scene: string; note?: string }[],
  source: Exclude<CardSource, 'ep_visual' | 'ep_away'>,
): Promise<{ added: number; skipped: number } | null> {
  const body = {
    cards: cards.slice(0, LIMITS.srsCardsBatchMax).map((c): NewCard => ({ ...c, source })),
  };
  const r = await send(
    srsApi.addCards,
    { body },
    { apply: (res, s) => ({ deck: [...res.added, ...s.deck], due: res.due }) },
  );
  return r ? { added: r.added.length, skipped: r.skipped } : null;
}

/** grade(i) + game.award('card'): reschedules the card at once, the server confirms it. */
export const gradeCardAction = (cardId: string, grade: number) =>
  send(
    srsApi.grade,
    { params: { id: cardId }, body: { grade } },
    {
      optimistic: (s) => {
        const now = Date.now();
        return {
          deck: s.deck.map((c) => {
            if (c.id !== cardId) return c;
            const next = gradeCard(c, grade, now);
            return next ? { ...c, ...next } : c;
          }),
        };
      },
      apply: (r, s) => ({ deck: s.deck.map((c) => (c.id === r.card.id ? r.card : c)), due: r.due }),
    },
  );

// ---------- Extras ----------

/** finishScene: seen + lastId, awards `extra` once per id. */
export const markExtraSeen = (id: string) =>
  send(
    extrasApi.seen,
    { params: { id } },
    { optimistic: (s) => ({ extras: { ...s.extras, seen: rec(s.extras.seen, id, true), lastId: id } }) },
  );

/** One dubbed line: running average + `dub`. */
export const saveDub = (id: string, line: number, score: number, source: MicScoreSource, attempt?: string) =>
  send(
    extrasApi.dub,
    { params: { id }, body: { line, score, source, ...(attempt ? { attempt } : {}) } },
    {
      optimistic: (s) => {
        const d = s.extras.dubs[id];
        return { extras: { ...s.extras, dubs: rec(s.extras.dubs, id, d ? Math.round((d + score) / 2) : score) } };
      },
      apply: (r, s) => ({ extras: { ...s.extras, dubs: rec(s.extras.dubs, id, r.avg) } }),
    },
  );

/** Desafio end: record + ex_right when hits ≥ 5 (the screen plays sfx.done, as the prototype did). */
export const saveChallenge = (score: number, hits: number, extraId?: string) =>
  send(
    extrasApi.challenge,
    { body: { score, hits, ...(extraId ? { extraId } : {}) } },
    {
      optimistic: (s) => ({ extras: { ...s.extras, best: Math.max(s.extras.best, score) } }),
      apply: (r, s) => ({ extras: { ...s.extras, best: r.best } }),
    },
  );

/** Karaoke gap pick: right → ex_right; wrong → soft sfx (the screen toasts "Era “…”."). */
export const pickKaraokeGap = (trackId: string, line: number, choice: string) =>
  send(
    extrasApi.karaokeGap,
    { body: { trackId, line, choice } },
    {
      apply: (r) => {
        if (!r.correct) uiConfig.sfx('soft');
        return undefined;
      },
    },
  );

/**
 * Soft, capped awards: song (karaokê do fim), quiz_hit, word. The endpoint answers with a bare
 * AwardResult (not `{ award }`), so it is played here: state.game mirrors it and the +N toast runs.
 */
export async function gameEvent(kind: GameEventBody['kind'], key: string): Promise<AwardResult | null> {
  const r = await send(gameApi.event, { body: { kind, key } });
  if (r) playAward(r);
  return r;
}

// ---------- Mic ----------

/** mgCall: opens a server session (opener + quota). */
export const startMicSession = (body: StartSessionBody) =>
  send(micApi.start, { body }, { apply: (r, s) => ({ maggie: { ...s.maggie, secLeft: r.quotaLeftS } }) });

/**
 * finish(): ends the session (client-side demo turns appended), stores it newest-first (12 kept),
 * updates the seconds left and plays maggie_session.
 */
export const endMicSession = (id: string, turns?: readonly ClientTurn[]) =>
  send(
    micApi.end,
    { params: { id }, body: turns?.length ? { turns: turns.slice(0, LIMITS.micEndTurnsMax) } : {} },
    {
      apply: (r, s) => ({
        maggie: {
          ...s.maggie,
          secLeft: r.secLeft,
          sessions: [r.session, ...s.maggie.sessions.filter((x) => x.id !== r.session.id)].slice(
            0,
            LIMITS.micSessionsKept,
          ),
        },
      }),
    },
  );
