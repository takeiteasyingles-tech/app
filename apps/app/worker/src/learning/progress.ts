import {
  type AdvanceBody,
  type AdvanceRes,
  type AwardResult,
  type EpisodeDoneBody,
  type EpisodeDoneRes,
  type ExerciseBody,
  type ExerciseRes,
  gate,
  type MicScoreBody,
  type MicScoreRes,
  PRONOUNCE_GOOD,
  type StepOkBody,
  type StepOkRes,
  stepKey,
} from '@tie/shared';
import { batch, fail, one, q, run } from '@tie/worker-core';
// The attempt token is S7's: POST /api/pronounce (routes/ai.ts) signs every phraseId attempt, mic
// phrases and dub lines alike, with ai/attempt.ts signAttempt; micScore verifies it with the same
// module. test/interop.test.ts runs the real /api/pronounce route and feeds its token to micScore.
import { ATTEMPT_TTL_MS, verifyAttempt } from '../ai';
import { type EpisodeContext, loadEpisodeContext } from './content';
import type { LearningDeps } from './deps';

// Player use cases (spec 01 §6, spec 04 §3). Order inside each write: validate and gate first, then
// the idempotent side effects (SRS unlock, awards keyed per spec 04 §2), then the progress row last,
// so a failure part-way leaves the user where they were and a retry completes the step.
//
// Every write on episode N also needs N open on the trilha: done, or no earlier published episode
// left unfinished (spec 01 §4 "only done and current nodes are clickable"). "Etapas livres" skips
// need() only, never this lock (as in the prototype, where settings.free only feeds gate()).

/** Steps whose completion the client attests when the media ends (mark(n) in player.js). */
export const MEDIA_STEPS: ReadonlySet<number> = new Set([1, 2, 4, 5, 10]);
/** Leaving these steps moves the episode's cards into Revisão (SrsService.unlock). */
export const CARD_STEPS: ReadonlySet<number> = new Set([4, 8]);
/** Steps that hold the scored activities: Take the Mic (record) and Take Action. */
export const MIC_STEP = 6;
export const EXERCISE_STEP = 9;
export const LAST_STEP = 10;

const reached = (r: { prog: number; done: boolean }, step: number) => r.done || r.prog >= step;

function gated(message: string | undefined, details: Record<string, unknown>) {
  return fail('gated', message || undefined, details);
}

/** Refuses writes on an episode the trilha has not opened yet. */
function assertOpen(ctx: EpisodeContext): void {
  if (ctx.lockedBy != null) {
    throw gated(`Termine o episódio ${ctx.lockedBy} para abrir este.`, { lockedBy: ctx.lockedBy });
  }
}

async function contextOrFail(d: LearningDeps, ep: number): Promise<EpisodeContext> {
  const ctx = await loadEpisodeContext(d, ep);
  if (!ctx) throw fail('content_unavailable');
  return ctx;
}

const progressUpsert = (d: LearningDeps, ep: number, step: number, done: boolean) =>
  run(
    d.db,
    `INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(user_id, episode_num) DO UPDATE SET
       furthest_step = MAX(furthest_step, excluded.furthest_step),
       done_at = COALESCE(done_at, excluded.done_at),
       updated_at = excluded.updated_at`,
    d.userId,
    ep,
    step,
    done ? d.now : null,
    d.now,
  );

/** POST /api/progress/step-ok: the media of a reached step played to the end. */
export async function stepOk(d: LearningDeps, body: StepOkBody): Promise<StepOkRes> {
  const { ep, step } = body;
  if (!MEDIA_STEPS.has(step)) throw fail('bad_request', 'Esta etapa não tem mídia para concluir.');
  const ctx = await contextOrFail(d, ep);
  assertOpen(ctx);
  if (!reached(ctx, step)) throw gated(undefined, { prog: ctx.prog, step });
  await run(
    d.db,
    'INSERT OR IGNORE INTO step_completions(user_id, episode_num, step, completed_at) VALUES(?, ?, ?, ?)',
    d.userId,
    ep,
    step,
    d.now,
  );
  const award = step === LAST_STEP ? await d.award.award(d.userId, 'song', `song:${ep}`, { now: d.now }) : null;
  return { stepOk: stepKey(ep, step), award };
}

/**
 * POST /api/progress/advance (setStep): a reached step is plain navigation; the next step needs the
 * shared need()/gate() of the step being left; anything further ahead is refused.
 */
export async function advance(d: LearningDeps, body: AdvanceBody): Promise<AdvanceRes> {
  const { ep, step } = body;
  const ctx = await contextOrFail(d, ep);
  if (ctx.done || step <= ctx.prog) return { prog: ctx.done ? LAST_STEP : ctx.prog, cardsAdded: 0, award: null };
  assertOpen(ctx);
  const from = step - 1;
  if (from !== ctx.prog) {
    const msg = gate(ctx.episode, ctx.state, ctx.prog);
    throw gated(msg, { prog: ctx.prog, step });
  }
  const msg = gate(ctx.episode, ctx.state, from);
  if (msg) throw gated(msg, { prog: ctx.prog, step });

  const cardsAdded = CARD_STEPS.has(from) ? (await d.srs.unlock(d.userId, ep, from)).length : 0;
  const award = await d.award.award(d.userId, 'step', `step:${ep}:${step}`, { now: d.now });
  await progressUpsert(d, ep, step, false);
  return { prog: step, cardsAdded, award };
}

/** POST /api/progress/episode-done (plNext on step 10). Replays are harmless: the award is keyed. */
export async function episodeDone(d: LearningDeps, body: EpisodeDoneBody): Promise<EpisodeDoneRes> {
  const { ep } = body;
  const ctx = await contextOrFail(d, ep);
  if (!ctx.done) {
    assertOpen(ctx);
    if (ctx.prog < LAST_STEP) throw gated(gate(ctx.episode, ctx.state, ctx.prog), { prog: ctx.prog, step: LAST_STEP });
    const msg = gate(ctx.episode, ctx.state, LAST_STEP);
    if (msg) throw gated(msg, { prog: ctx.prog, step: LAST_STEP });
  }
  // First completion re-runs both unlocks (idempotent, they return only new cards) so a deck that
  // missed an unlock heals here.
  let cardsAdded = 0;
  if (!ctx.done) for (const s of CARD_STEPS) cardsAdded += (await d.srs.unlock(d.userId, ep, s)).length;
  const award = await d.award.award(d.userId, 'episode', `episode:${ep}`, { now: d.now });
  if (!ctx.done) await progressUpsert(d, ep, LAST_STEP, true);
  return { epsDone: true, cardsAdded, award };
}

/**
 * POST /api/progress/exercise: graded against the published answer key (the one the client was
 * shown); the first answer is final.
 */
export async function exercise(d: LearningDeps, body: ExerciseBody): Promise<ExerciseRes> {
  const owner = await one<{ episode_num: number }>(
    d.db,
    'SELECT x.episode_num FROM exercise_items i JOIN exercises x ON x.id = i.exercise_id WHERE i.id = ?',
    body.itemId,
  );
  const ctx = owner ? await loadEpisodeContext(d, owner.episode_num) : null;
  const item = ctx?.items.get(body.itemId);
  if (!ctx || !item) throw fail('not_found');
  if (body.choice >= item.opts) {
    throw fail('validation_failed', undefined, {
      issues: [{ path: 'choice', code: 'too_big', message: `choice must be < ${item.opts}` }],
    });
  }
  assertOpen(ctx);
  if (!reached(ctx, EXERCISE_STEP)) throw gated(undefined, { prog: ctx.prog, step: EXERCISE_STEP });

  const [, stored] = await batch(d.db, [
    q(
      d.db,
      `INSERT OR IGNORE INTO exercise_answers(user_id, item_id, choice_idx, correct, answered_at)
       VALUES(?, ?, ?, ?, ?)`,
      d.userId,
      body.itemId,
      body.choice,
      body.choice === item.answer,
      d.now,
    ),
    q<{ choice_idx: number; correct: number }>(
      d.db,
      'SELECT choice_idx, correct FROM exercise_answers WHERE user_id = ? AND item_id = ?',
      d.userId,
      body.itemId,
    ),
  ] as const);
  const row = stored[0];
  if (!row) throw new Error('exercise answer was not stored');
  // Grade the stored choice against the current key (a replay after a content fix stays consistent).
  const correct = row.choice_idx === item.answer;
  const award: AwardResult | null = correct
    ? await d.award.award(d.userId, 'ex_right', `ex:${body.itemId}`, { now: d.now })
    : null;
  return { itemId: body.itemId, choice: row.choice_idx, correct, answer: item.answer, fix: item.fix, award };
}

/**
 * POST /api/progress/mic. 'ia' scores count only through a valid attempt token that /api/pronounce
 * (S7, ai/attempt.ts) signed for this user and phrase; its score wins over the body's. Tokens live
 * ATTEMPT_TTL_MS (10 min): an outbox replay after that gets token_invalid. 'script' stores the
 * phrase's scripted result. 'demo' (the client scored it locally, no AI) stores the client's number
 * as is, flagged by mic_scores.source = 'demo'. Neither 'script' nor 'demo' ever awards more than mic_try.
 *
 * Replays of an 'ia' attempt (outbox replay, a reused token) are no-ops on the stats: the attempt's
 * identity is its token's issue time (exp − ATTEMPT_TTL_MS), stored as mic_scores.updated_at, and an
 * 'ia' write whose issue time is not after the row's last write counts nothing (attempts and last
 * stay; best is a MAX, so it is safe either way). Awards are keyed, so replaying them is harmless.
 * 'demo'/'script' writes carry no server-issued identity and still count as a new try each time.
 */
export async function micScore(d: LearningDeps, body: MicScoreBody): Promise<MicScoreRes> {
  const owner = await one<{ episode_num: number }>(
    d.db,
    'SELECT episode_num FROM mic_phrases WHERE id = ?',
    body.phraseId,
  );
  const ctx = owner ? await loadEpisodeContext(d, owner.episode_num) : null;
  const phrase = ctx?.phrases.get(body.phraseId);
  if (!ctx || !phrase) throw fail('not_found');

  let score = body.score;
  let verified = false;
  /** When this attempt happened: the token's issue time for 'ia', else now. */
  let stamp = d.now;
  if (body.source === 'ia') {
    const claims = await verifyAttempt(d.attemptSecret, body.attempt, d.now);
    if (!claims || claims.userId !== d.userId || claims.phraseId !== body.phraseId) {
      throw fail('token_invalid', 'Não deu para confirmar essa gravação. Grave de novo.');
    }
    score = claims.score;
    verified = true;
    stamp = Math.min(d.now, claims.exp - ATTEMPT_TTL_MS);
  } else if (body.source === 'script') {
    score = phrase.result;
  }

  assertOpen(ctx);
  if (!reached(ctx, MIC_STEP)) throw gated(undefined, { prog: ctx.prog, step: MIC_STEP });

  // In DO UPDATE every expression reads the row as it was before this statement, so `fresh` is
  // evaluated once against the old updated_at for all columns.
  const fresh = "NOT (excluded.source = 'ia' AND mic_scores.updated_at >= excluded.updated_at)";
  const row = await one<{ last_score: number; best_score: number; attempts: number }>(
    d.db,
    `INSERT INTO mic_scores(user_id, phrase_id, last_score, best_score, attempts, source, updated_at)
     VALUES(?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, phrase_id) DO UPDATE SET
       last_score = CASE WHEN ${fresh} THEN excluded.last_score ELSE mic_scores.last_score END,
       best_score = MAX(mic_scores.best_score, excluded.best_score),
       attempts = mic_scores.attempts + CASE WHEN ${fresh} THEN 1 ELSE 0 END,
       source = CASE WHEN ${fresh} THEN excluded.source ELSE mic_scores.source END,
       updated_at = MAX(mic_scores.updated_at, excluded.updated_at)
     RETURNING last_score, best_score, attempts`,
    d.userId,
    body.phraseId,
    score,
    score,
    body.source,
    stamp,
  );
  if (!row) throw new Error('mic score was not stored');

  const good = verified && score >= PRONOUNCE_GOOD;
  const kind = good ? 'mic_good' : 'mic_try';
  const award = await d.award.award(d.userId, kind, `${kind}:${body.phraseId}`, { now: d.now });
  return { phraseId: body.phraseId, last: row.last_score, best: row.best_score, attempts: row.attempts, award };
}
