// S7: GET /api/health, POST /api/tutor, /api/report, /api/pronounce, /api/tts (spec 03 §B, spec 04 §3.1).
// Mounted at '/' by worker/src/index.ts. NOTE for integration (I1): index.ts still registers its own
// placeholder GET /api/health ({ai:false}) before mounting this module; remove it so this one answers.
//
// Deliberate deviations from spec 04 §3.1 (for the spec owner and S8, the client):
// - A tutor turn bills min(now − billed_until, 120) s but at least TUTOR_TURN_MIN_S (5 s); the
//   prepaid part moves billed_until ahead, so over a session the total stays ≈ wall clock.
// - /api/report is metered too (by transcript size, reportSeconds), not only tutor/pronounce/TTS;
//   when the quota cannot cover it the demo report answers (never 429).
// - /api/report answers 409 on an open session: the client must call /api/mic/sessions/:id/end
//   first (the stored report is final once written).
// - /api/tutor answers 409 after LIMITS.micMaxTurns learner turns and 400 in a pronuncia session.
// - maggie_session also needs a session of ≥ MIN_AWARD_SESSION_SECS (15 s), and at most
//   MAX_SESSION_AWARDS_PER_DAY (8) of them land per rolling 24 h (counted in point_ledger).
// - maggie_turn is held to MAX_TURN_AWARDS_PER_DAY (100) per rolling 24 h on every path (model,
//   server-side demo, pronunciation), on top of the per-session cap; point_rules.daily_cap (S4
//   seed) for maggie_turn / maggie_session may be stricter.
// - Client-side demo turns appended at /end never earn maggie_turn. Their Mic time (20 s per
//   learner turn, ≤ the session's wall-clock length) rides on the maggie_session award's
//   maggieSec, so a demo-mode session moves the daily maggieSec mission only when it qualifies
//   for maggie_session (≥ 2 spoken learner turns, ≥ 15 s).
// - Retention pins flagged sessions in two budgets (Llama Guard 10, self-reports 5; ai/context.ts).
// - /api/mic/sessions refuses a locked (teaser) extraId (400), like routes/extras.ts.
import {
  AI_LIMITS,
  aiApi,
  demoReply,
  demoReport,
  FLAGS,
  type Health,
  LIMITS,
  PLAN_FEATURES,
  type PronounceResult,
  PronounceResult as PronounceResultSchema,
  type ReportResult,
  scorePronunciation,
  script,
  type TutorReply,
  type TutorTurnRes,
} from '@tie/shared';
import {
  type AppEnv,
  type Env,
  fail,
  fromBase64,
  fromJson,
  isLocalOrigin,
  loadFlags,
  one,
  rateLimit,
  requireUser,
  run,
  type Services,
  type SessionInfo,
  sessionOf,
  vJson,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { signAttempt } from '../ai/attempt';
import { MAGGIE_SEC_PRONOUNCE, MAGGIE_SEC_TURN, MAX_TURN_AWARDS_PER_DAY, recentAwards, tryAward } from '../ai/award';
import {
  appendedIdx,
  catalogOf,
  claimBillWindow,
  countOf,
  demoSession,
  learnerProfile,
  learnerTurnCount,
  ownedSession,
  promptTemplate,
  recentTurns,
  resolvePhrase,
  type SessionRow,
  SILENT_TURN,
  safeTutorContext,
  scriptContent,
  sessionAssistant,
  sessionTurns,
  storedReport,
  TURN_SOURCE,
  turnAppend,
} from '../ai/context';
import { background, flagSubject } from '../ai/http';
import { aiEnabled, hasAiBinding, loadModels, runJson, synthesize, transcribe } from '../ai/models';
import { moderateTurn } from '../ai/moderation';
import {
  buildTutorMessages,
  clampFeedback,
  clampTips,
  clampWords,
  cleanText,
  coerceReport,
  coerceTutorReply,
  fillTemplate,
  learnerProfileJson,
  REPORT_JSON_SCHEMA,
  sanitizeLearnerText,
  TUTOR_JSON_SCHEMA,
  transcriptMessage,
} from '../ai/prompt';
import {
  type AiQuotaService,
  quotaOf,
  type ReserveResultWithEvent,
  reserveOrThrow,
  type UsageOutcome,
} from '../ai/quota';
import { cacheGet, cachePut, r2Get, r2Put, resolveSpeaker, ttsKey, ttsSeconds } from '../ai/tts';
import { billedAudioSeconds, inspectWav } from '../ai/wav';

const routes = new Hono<AppEnv>();

/** Spec 04 §3.1: a tutor turn bills min(now − billed_until, 120) s. */
export const TUTOR_BILL_CAP_S = 120;
/**
 * ...but never less than this: every model-answered turn costs at least TUTOR_TURN_MIN_S, so a
 * fresh session per turn (whose window is ~0 s) cannot get the 70B model for free. The prepaid
 * part moves billed_until ahead (claimBillWindow), so spaced-out turns are not billed twice.
 */
export const TUTOR_TURN_MIN_S = 5;

/** Session modes that hold a tutor conversation (pronuncia only takes /api/pronounce tries). */
const TUTOR_MODES: ReadonlySet<string> = new Set(['livre', 'missao', 'extra']);

/**
 * An AI report is metered by transcript size: ceil(chars / REPORT_CHARS_PER_S) s, at least
 * REPORT_MIN_S. The transcript keeps the newest turns up to REPORT_TRANSCRIPT_MAX chars.
 */
export const REPORT_CHARS_PER_S = 50;
export const REPORT_MIN_S = 5;
export const REPORT_MAX_TURNS = 40;
export const REPORT_TRANSCRIPT_MAX = 6000;

export const reportSeconds = (transcriptChars: number): number =>
  Math.max(REPORT_MIN_S, Math.ceil(transcriptChars / REPORT_CHARS_PER_S));

const logWarn = (msg: string, err: unknown) =>
  console.error(JSON.stringify({ level: 'warn', msg, error: String(err) }));

// ---------- GET /api/health ----------

// Public and per-deployment: `ai` is the GLOBAL switch (ai.enabled flag on, at any rollout, and
// the AI binding present). Whether a given user gets the AI (rollout_pct, rules) is in
// TieState.flags; the routes evaluate the flag per user and answer demo/503 when it is off.
routes.get(aiApi.health.path, async (c) => {
  let ai = false;
  let model = '';
  try {
    if (hasAiBinding(c.env) && (await loadFlags(c.env.DB)).get(FLAGS.aiEnabled)?.enabled) {
      ai = true;
      model = (await loadModels(c.env.DB)).tutor;
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'health check failed', error: String(err) }));
    ai = false;
    model = '';
  }
  return c.json({ ai, model } satisfies Health, 200, { 'Cache-Control': 'no-store' });
});

// ---------- POST /api/tutor ----------

routes.post(aiApi.tutor.path, requireUser(), rateLimit('RL_AI'), vJson(aiApi.tutor.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const text = sanitizeLearnerText(body.text);
  if (!text) throw fail('validation_failed', undefined, { field: 'text' });
  const turn = Math.min(body.turn, LIMITS.micMaxTurns);
  const db = c.env.DB;
  const services = c.get('services');

  const row = await ownedSession(db, body.session_id, s.userId);
  if (row.status !== 'open') throw fail('conflict', 'Esta conversa já terminou.');
  // A pronuncia session has no conversation (its tries go through /api/pronounce, billed by audio).
  if (!TUTOR_MODES.has(row.mode)) {
    throw fail('validation_failed', undefined, { field: 'session_id', reason: 'not_conversation' });
  }
  const [assistant, catalog, profile, spoken] = await Promise.all([
    sessionAssistant(db, row.assistant_key),
    catalogOf(services),
    learnerProfile(db, s.userId),
    one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM mic_turns WHERE session_id = ? AND who = 'me'", row.id),
  ]);
  // The conversation ends after LIMITS.micMaxTurns learner turns (the reply to the last one has
  // end=true): later turns are refused before anything is billed or awarded.
  if (Number(spoken?.n ?? 0) >= LIMITS.micMaxTurns) throw fail('conflict', 'Esta conversa chegou ao fim.');
  const content = scriptContent(catalog);
  const sess = demoSession(row, assistant, profile, turn);
  const demo = (): TutorReply => {
    try {
      return demoReply(sess, text, content);
    } catch {
      throw fail('content_unavailable');
    }
  };

  let reply: TutorReply;
  const on = await aiEnabled(c.env, flagSubject(s));
  const quota = quotaOf(c.env, services);
  const models = on ? await loadModels(db) : null;
  let reservation: Awaited<ReturnType<typeof reserveOrThrow>> | null = null;
  let outcome: UsageOutcome | null = null;
  if (models) {
    // Claim the un-billed window first (compare-and-set on billed_until), then reserve it. Two
    // concurrent turns can never bill the same seconds; a denied reservation gives the window back.
    const win = await claimBillWindow(db, row.id, row.billed_until, Date.now(), {
      capS: TUTOR_BILL_CAP_S,
      minS: TUTOR_TURN_MIN_S,
    });
    if (!win) throw fail('conflict', 'Esta conversa já terminou.');
    let r: Awaited<ReturnType<typeof reserveOrThrow>>;
    try {
      r = await reserveOrThrow(quota, s.userId, win.seconds, { kind: 'tutor', model: models.tutor, sessionId: row.id });
    } catch (err) {
      await win.release();
      throw err;
    }
    reservation = r;

    let lines: string[] = [];
    try {
      lines = script(sess, content).map((l) => l.en);
    } catch {
      lines = [];
    }
    const m = row.mode === 'missao' ? catalog.mic.missions.find((x) => x.k === row.mission_key) : undefined;
    const [template, history] = await Promise.all([
      promptTemplate(db, 'tutor'),
      recentTurns(db, row.id, LIMITS.micHistoryTurns),
    ]);
    const messages = buildTutorMessages({
      template,
      assistantName: assistant.name,
      persona: assistant.persona,
      mode: row.mode,
      mission: m ? `Mission: ${m.t}. Your role: ${m.role}. Learner goal: ${m.goal}.` : '',
      script: lines,
      turn,
      ctx: safeTutorContext(profile, catalog),
      history,
      text,
    });
    const started = Date.now();
    try {
      const res = await runJson(c.env, models, {
        messages,
        schema: TUTOR_JSON_SCHEMA,
        accept: (raw) => coerceTutorReply(raw, text, turn),
        maxTokens: 700,
      });
      reply = res.value;
      // Recorded once the turn is stored (a turn that cannot be stored is refunded instead).
      outcome = { ok: true, latencyMs: res.latencyMs, model: res.model };
    } catch (err) {
      logWarn('tutor fell back to demo', err);
      reply = demo();
      // The model produced nothing usable: the learner gets a demo turn, not a billed AI turn.
      background(c, quota.refund(s.userId, r, { latencyMs: Date.now() - started }));
    }
  } else {
    reply = demo();
  }

  // Persist the learner turn and the reply. idx is taken inside SQL and only while the session is
  // still open, so a concurrent turn or /end can never collide with this write.
  const now = Date.now();
  const source = reply.source === 'ia' ? TURN_SOURCE.tutor : TURN_SOURCE.demo;
  const [meRes, , countRes, dayRes] = await db.batch([
    turnAppend(
      db,
      row.id,
      { who: 'me', en: text, feedback: reply.feedback, pron: reply.pron_watch, source, at: now },
      { requireOpen: true },
    ),
    turnAppend(
      db,
      row.id,
      { who: 'her', en: reply.reply_en, pt: reply.reply_pt, words: reply.new_words, source, at: now },
      { requireOpen: true },
    ),
    learnerTurnCount(db, row.id),
    recentAwards(db, s.userId, 'maggie_turn', now),
  ]);
  const meIdx = appendedIdx(meRes);
  if (meIdx === null) {
    // /end won the race while the model was answering: nothing can be stored any more. The reply is
    // not delivered either (409, as for a turn on an ended session), so its seconds are given back.
    // Delivering it unbilled would reopen the free-turn hole (start, tutor, end at once).
    if (reservation)
      await quota.refund(s.userId, reservation, { latencyMs: outcome?.latencyMs, model: outcome?.model });
    throw fail('conflict', 'Esta conversa já terminou.');
  }
  if (reservation && outcome) background(c, quota.finish(reservation.eventId, outcome));

  // Concurrent turns can pass the limit check above together: only turns within the limit earn.
  // Demo turns (AI off for this user, or a fallback) earn too (spec 03 §B), but cost no quota, so
  // every path is also held to MAX_TURN_AWARDS_PER_DAY per rolling 24 h.
  const award =
    countOf(countRes) <= Math.min(LIMITS.micMaxTurns, LIMITS.micTurnAwardsPerSession) &&
    countOf(dayRes) < MAX_TURN_AWARDS_PER_DAY
      ? await tryAward(services, s.userId, 'maggie_turn', `mturn:${row.id}:${meIdx}`, { maggieSec: MAGGIE_SEC_TURN })
      : null;

  if (models) {
    // The guard classifies what the learner wrote (never the tutor's reply).
    background(
      c,
      moderateTurn(c.env, { userId: s.userId, sessionId: row.id, turnIdx: meIdx, text, model: models.guard }, quota),
    );
  }

  return c.json({ ...reply, award } satisfies TutorTurnRes);
});

// ---------- POST /api/report ----------

// Only for ended sessions (nothing can be appended after /end, so the stored report is final).
// The AI writes it only for sessions that actually used a server AI call (tutor or pronounce
// turns), and it is metered by transcript size; otherwise, when denied or on failure, demoReport.
routes.post(aiApi.report.path, requireUser(), rateLimit('RL_AI'), vJson(aiApi.report.body), async (c) => {
  const s = sessionOf(c);
  const { session_id } = c.req.valid('json');
  const db = c.env.DB;
  const services = c.get('services');
  const row = await ownedSession(db, session_id, s.userId);
  if (row.status !== 'ended') throw fail('conflict', 'Termine a conversa antes de ver o relatório.');
  const existing = storedReport(row);
  if (existing) return c.json(existing satisfies ReportResult);

  // Claim the report before spending anything, so two concurrent calls never both reserve quota
  // and run the model. The claim is a lease in report_source ('pending:{expiresAt}:{nonce}', only
  // while report IS NULL): a request that dies mid-way blocks the report for at most REPORT_LEASE_MS.
  // A caller that loses the claim gets the stored report, or 409 while it is being written.
  const lease = await claimReport(db, row.id, s.userId, Date.now());
  if (!lease) return c.json((await reportAfterLostClaim(db, row.id, s.userId)) satisfies ReportResult);
  const quota = quotaOf(c.env, services);
  let built: BuiltReport;
  try {
    built = await buildReport(c.env, services, quota, s, row);
  } catch (err) {
    await releaseReport(db, row.id, lease);
    throw err;
  }
  const { report, reservation, outcome } = built;

  const saved = await run(
    db,
    `UPDATE mic_sessions SET report = ?, report_source = ?
     WHERE id = ? AND user_id = ? AND report IS NULL AND report_source = ?`,
    JSON.stringify(report),
    report.source,
    row.id,
    s.userId,
    lease,
  );
  if (saved.changes !== 1) {
    // The lease ran out and another call wrote the report: answer that one, and do not bill this one.
    if (reservation)
      await quota.refund(s.userId, reservation, { latencyMs: outcome?.latencyMs, model: outcome?.model });
    return c.json((await reportAfterLostClaim(db, row.id, s.userId)) satisfies ReportResult);
  }
  if (reservation && outcome) background(c, quota.finish(reservation.eventId, outcome));
  return c.json(report satisfies ReportResult);
});

/** How long a /api/report claim holds before another call may take the report over. */
export const REPORT_LEASE_MS = 90_000;
const LEASE_PREFIX = 'pending:';

/** Compare-and-set claim of an ended session's report; the lease token, or null when taken/written. */
async function claimReport(db: D1Database, id: string, userId: string, now: number): Promise<string | null> {
  const lease = `${LEASE_PREFIX}${now + REPORT_LEASE_MS}:${crypto.randomUUID()}`;
  const res = await run(
    db,
    `UPDATE mic_sessions SET report_source = ?1
     WHERE id = ?2 AND user_id = ?3 AND status = 'ended' AND report IS NULL
       AND (report_source IS NULL OR (substr(report_source, 1, ?5) = ?6
            AND CAST(substr(report_source, ?5 + 1, 13) AS INTEGER) < ?4))`,
    lease,
    id,
    userId,
    now,
    LEASE_PREFIX.length,
    LEASE_PREFIX,
  );
  return res.changes === 1 ? lease : null;
}

async function releaseReport(db: D1Database, id: string, lease: string): Promise<void> {
  try {
    await run(
      db,
      'UPDATE mic_sessions SET report_source = NULL WHERE id = ? AND report IS NULL AND report_source = ?',
      id,
      lease,
    );
  } catch (err) {
    logWarn('report lease release failed', err);
  }
}

/** Another call holds or wrote the report: the stored one, or 409 while it is still being written. */
async function reportAfterLostClaim(db: D1Database, id: string, userId: string): Promise<ReportResult> {
  const stored = storedReport(await ownedSession(db, id, userId));
  if (stored) return stored;
  throw fail('conflict', 'O relatório está sendo gerado. Tente de novo em instantes.');
}

interface BuiltReport {
  report: ReportResult;
  /** The quota reservation of an AI report (null for a demo report). */
  reservation: ReserveResultWithEvent | null;
  /** Set when the model answered; recorded on the event once the report is stored. */
  outcome: UsageOutcome | null;
}

async function buildReport(
  env: Env,
  services: Services,
  quota: AiQuotaService,
  s: SessionInfo,
  row: SessionRow,
): Promise<BuiltReport> {
  const db = env.DB;
  const [assistant, turns] = await Promise.all([sessionAssistant(db, row.assistant_key), sessionTurns(db, row.id)]);
  const reportTurns = turns
    // A silent pronunciation try is not something the learner said.
    .filter((t) => (t.who === 'me' || t.who === 'her') && !(t.who === 'me' && t.en === SILENT_TURN))
    .map((t) => ({
      who: t.who,
      // Stored turns are clamped on write; clamping again bounds what demoReport copies into fixes.
      en: t.who === 'me' ? sanitizeLearnerText(t.en) : cleanText(t.en, 600),
      fb: clampFeedback(fromJson<unknown>(t.feedback, null)),
      pron: clampTips(fromJson<unknown>(t.pron, [])),
      words: clampWords(fromJson<unknown>(t.words, [])),
      // An assistant line the client appended at /end: not something the server's assistant said.
      client: t.source === TURN_SOURCE.client,
    }));
  const aThe = `${assistant.art} ${assistant.name}`;

  const demo: BuiltReport = { report: demoReport({ turns: reportTurns, aThe }), reservation: null, outcome: null };
  const spoke = reportTurns.some((t) => t.who === 'me');
  const usedServerAi = turns.some((t) => t.source === TURN_SOURCE.tutor || t.source === TURN_SOURCE.pronounce);
  if (!spoke || !usedServerAi || !(await aiEnabled(env, flagSubject(s)))) return demo;

  let recent = reportTurns.slice(-REPORT_MAX_TURNS);
  let transcript = transcriptMessage(recent, assistant.name);
  while (transcript.length > REPORT_TRANSCRIPT_MAX && recent.length > 1) {
    recent = recent.slice(1);
    transcript = transcriptMessage(recent, assistant.name);
  }
  const models = await loadModels(db);
  const r = await quota.reserve(s.userId, reportSeconds(transcript.length), {
    kind: 'report',
    model: models.tutor,
    sessionId: row.id,
  });
  // Denied (quota used up): the demo report stands; a report never answers 429.
  if (!r.ok) return demo;

  const started = Date.now();
  try {
    const [template, catalog, profile] = await Promise.all([
      promptTemplate(db, 'report'),
      catalogOf(services).catch(() => null),
      learnerProfile(db, s.userId),
    ]);
    const system = fillTemplate(template, {
      assistant_name: cleanText(assistant.name, 60),
      learner_profile: learnerProfileJson(catalog ? safeTutorContext(profile, catalog) : null),
    });
    const res = await runJson(env, models, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ],
      schema: REPORT_JSON_SCHEMA,
      accept: coerceReport,
      maxTokens: 1200,
      temperature: 0.4,
    });
    return { report: res.value, reservation: r, outcome: { ok: true, latencyMs: res.latencyMs, model: res.model } };
  } catch (err) {
    logWarn('report fell back to demo', err);
    // Nothing usable came back: the reservation is given back before the demo report is stored.
    await quota.refund(s.userId, r, { latencyMs: Date.now() - started });
    return demo;
  }
}

// ---------- POST /api/pronounce ----------

routes.post(aiApi.pronounce.path, requireUser(), rateLimit('RL_AI'), vJson(aiApi.pronounce.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const services = c.get('services');

  let bytes: Uint8Array;
  try {
    bytes = fromBase64(body.audio);
  } catch {
    throw fail('validation_failed', 'Áudio inválido.', { field: 'audio', reason: 'base64' });
  }
  const check = inspectWav(bytes);
  if (!check.ok) throw fail('validation_failed', 'Áudio inválido.', { field: 'audio', reason: check.reason });

  // A score that gets signed is always scored against the server's own text for that phrase; the
  // client's `target` only matters for unsigned free practice.
  const phrase = body.phraseId ? await resolvePhrase(db, body.phraseId) : null;
  if (body.phraseId && !phrase) throw fail('validation_failed', undefined, { field: 'phraseId' });
  // Scoring returns issues (target words), so a premium extra's lines are as gated as its content.
  if (phrase?.premium && !s.plan?.features[PLAN_FEATURES.premiumExtras]) throw fail('plan_required');
  const target = cleanText(phrase ? phrase.target : body.target, 300);
  if (!target) throw fail('validation_failed', undefined, { field: 'target' });

  const row = body.session_id ? await ownedSession(db, body.session_id, s.userId) : null;
  if (row && row.status !== 'open') throw fail('conflict', 'Esta conversa já terminou.');
  if (row && row.mode !== 'pronuncia') {
    throw fail('validation_failed', undefined, { field: 'session_id', reason: 'not_pronuncia' });
  }
  if (!(await aiEnabled(c.env, flagSubject(s)))) throw fail('ai_unavailable');
  // A signed try cannot be delivered without the key: refuse before reserving or calling Whisper.
  if (phrase && !c.env.MEDIA_TOKEN_KEY) {
    console.error(JSON.stringify({ level: 'error', msg: 'MEDIA_TOKEN_KEY is not set: attempt tokens disabled' }));
    throw fail('internal');
  }

  const quota = quotaOf(c.env, services);
  const models = await loadModels(db);
  const r = await reserveOrThrow(quota, s.userId, billedAudioSeconds(check.wav), {
    kind: 'pronounce',
    model: models.asr,
    sessionId: row?.id,
  });
  const started = Date.now();
  let heard: string;
  try {
    heard = cleanText(await transcribe(c.env, models.asr, body.audio), LIMITS.tutorTextMax);
  } catch (err) {
    logWarn('asr failed', err);
    // Nothing was delivered: give the seconds back before the client falls back to the demo.
    await quota.refund(s.userId, r, { latencyMs: Date.now() - started });
    throw fail('ai_unavailable');
  }
  const latencyMs = Date.now() - started;

  const scored = scorePronunciation(target, heard);
  const result: PronounceResult = { ...scored, issues: scored.issues.slice(0, AI_LIMITS.pronounceIssues) };
  if (phrase) {
    // Verified by /api/progress/mic (S2) and /api/extras/:id/dub (S6). The score inside was computed
    // against the server's text for phrase.id, so it cannot be minted for a phrase never said.
    // Signed before the reservation is finished: a failure here (MEDIA_TOKEN_KEY missing) answers
    // 500 with the seconds given back, never a billed error.
    try {
      result.attempt = await signAttempt(c.env.MEDIA_TOKEN_KEY, {
        userId: s.userId,
        phraseId: phrase.id,
        score: result.score,
      });
    } catch (err) {
      await quota.refund(s.userId, r, { latencyMs, model: models.asr });
      throw err;
    }
  }
  background(c, quota.finish(r.eventId, { ok: true, latencyMs, model: models.asr }));

  if (row) {
    const now = Date.now();
    // The try is billed by audio seconds. billed_until is left alone: a pronuncia session never
    // has tutor turns (/api/tutor refuses it), so no wall-clock time is billed there at all, and a
    // try can never write off a conversation's un-billed time.
    const [meRes, countRes, dayRes] = await db.batch([
      turnAppend(
        db,
        row.id,
        {
          who: 'me',
          // Never the target: the transcript must not claim the learner said it.
          en: heard || SILENT_TURN,
          pron: result.issues.map((i) => ({ word: i.word, tip_pt: i.tip_pt })),
          source: TURN_SOURCE.pronounce,
          at: now,
        },
        { requireOpen: true },
      ),
      learnerTurnCount(db, row.id),
      recentAwards(db, s.userId, 'maggie_turn', now),
    ]);
    const meIdx = appendedIdx(meRes);
    // A silent try earns nothing.
    if (
      meIdx !== null &&
      heard &&
      countOf(countRes) <= LIMITS.micTurnAwardsPerSession &&
      countOf(dayRes) < MAX_TURN_AWARDS_PER_DAY
    ) {
      await tryAward(services, s.userId, 'maggie_turn', `mturn:${row.id}:${meIdx}`, {
        maggieSec: MAGGIE_SEC_PRONOUNCE,
      });
    }
    if (meIdx !== null && heard) {
      background(
        c,
        moderateTurn(
          c.env,
          { userId: s.userId, sessionId: row.id, turnIdx: meIdx, text: heard, model: models.guard },
          quota,
        ),
      );
    }
  }

  return c.json(PronounceResultSchema.parse(result));
});

// ---------- POST /api/tts ----------

routes.post(aiApi.tts.path, requireUser(), rateLimit('RL_AI'), vJson(aiApi.tts.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const text = cleanText(body.text, LIMITS.ttsTextMax);
  if (!text) throw fail('validation_failed', undefined, { field: 'text' });

  const { speaker } = await resolveSpeaker(db, body.voice, body.gender);
  const models = await loadModels(db);
  const hash = await ttsKey(models.tts, speaker, text);
  const quota = quotaOf(c.env, c.get('services'));

  let source: 'cache' | 'r2' | 'ai' = 'cache';
  let audio = await cacheGet(hash);
  if (!audio) {
    audio = await r2Get(c.env.MEDIA, hash);
    source = 'r2';
    if (audio) background(c, cachePut(hash, audio));
  }
  if (!audio) {
    if (!(await aiEnabled(c.env, flagSubject(s)))) throw fail('ai_unavailable');
    const r = await reserveOrThrow(quota, s.userId, ttsSeconds(text), { kind: 'tts', model: models.tts });
    const started = Date.now();
    try {
      audio = await synthesize(c.env, models.tts, text, speaker);
    } catch (err) {
      logWarn('tts failed', err);
      // The client falls back to browser TTS: nothing delivered, nothing billed.
      await quota.refund(s.userId, r, { latencyMs: Date.now() - started });
      throw fail('ai_unavailable');
    }
    source = 'ai';
    background(c, quota.finish(r.eventId, { ok: true, latencyMs: Date.now() - started, model: models.tts }));
    // The audio is delivered (and billed) whether or not the caches can be written.
    const bytes = audio;
    background(c, r2Put(c.env.MEDIA, hash, bytes, speaker));
    background(c, cachePut(hash, bytes));
  } else {
    background(c, quota.log(s.userId, 'tts', { ok: true, model: models.tts }));
  }

  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(audio.byteLength),
    'Cache-Control': 'private, max-age=86400',
  };
  // The cache is shared across users, so where the bytes came from would tell a user whether
  // someone else already synthesized a text. Local development only.
  if (isLocalOrigin(c.env.APP_ORIGIN)) headers['X-TTS-Source'] = source;
  return new Response(audio, { headers });
});

export default routes;
