// S7: /api/mic/sessions (start, end, list, read). Mounted at '/' by worker/src/index.ts.
// Owner checks are part of every query (ownedSession), and someone else's id answers 404.
import {
  type EndSessionRes,
  IdParams,
  LIMITS,
  micApi,
  missions,
  newId,
  opener,
  PLAN_FEATURES,
  type SessionRes,
  type SessionsRes,
  type StartSessionRes,
} from '@tie/shared';
import { type AppEnv, fail, one, rateLimit, requireUser, sessionOf, vJson, vParam } from '@tie/worker-core';
import { Hono } from 'hono';
import { MAGGIE_SEC_TURN, MAX_SESSION_AWARDS_PER_DAY, recentAwards, tryAward } from '../ai/award';
import {
  appendedIdx,
  assistantByKey,
  catalogOf,
  countOf,
  demoSession,
  learnerProfile,
  listSessions,
  MAX_OPEN_SESSIONS,
  ownedSession,
  ownedSessionWithTurns,
  retentionStatements,
  SILENT_TURN,
  scriptContent,
  sessionTurns,
  TURN_SOURCE,
  type TurnRow,
  toMicSession,
  turnAppend,
  turnInsert,
} from '../ai/context';
import { background, flagSubject } from '../ai/http';
import { aiEnabled, loadModels } from '../ai/models';
import { moderateTurn } from '../ai/moderation';
import { clampFeedback, clampTips, clampWords, cleanText, sanitizeLearnerText } from '../ai/prompt';
import { quotaOf } from '../ai/quota';

const routes = new Hono<AppEnv>();

/** Wall-clock session length is capped so a tab left open for days does not report days. */
const MAX_SESSION_SECS = 6 * 3600;
/** At most this much un-billed time is charged when a session ends (same cap as a tutor turn). */
const BILL_CAP_S = 120;
/**
 * maggie_session needs a session at least this long (wall clock): two real spoken turns take
 * longer, while start + /end with made-up turns in the same second earns nothing.
 */
export const MIN_AWARD_SESSION_SECS = 15;
/**
 * At most MAX_SESSION_AWARDS_PER_DAY sessions per rolling 24 h earn maggie_session. The count is
 * taken from point_ledger (awards actually granted), never from mic_sessions: retention deletes
 * old sessions by count, so a count of retained sessions could be reset by ending empty sessions.
 */
export { MAX_SESSION_AWARDS_PER_DAY };

routes.post(micApi.start.path, requireUser(), rateLimit('RL_AI'), vJson(micApi.start.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const services = c.get('services');
  const [assistant, catalog, profile] = await Promise.all([
    assistantByKey(db, body.assistant),
    catalogOf(services),
    learnerProfile(db, s.userId),
  ]);

  let mission: string | null = null;
  let extraId: string | null = null;
  if (body.mode === 'missao') {
    const known = new Set(catalog.mic.missions.map((m) => m.k));
    if (body.mission !== undefined && !known.has(body.mission)) {
      throw fail('validation_failed', undefined, { field: 'mission' });
    }
    mission = body.mission ?? missions(profile ?? { goals: [] }, catalog)[0]?.k ?? null;
  } else if (body.mode === 'extra') {
    // Premium extras are gated by plan here as in routes/content.ts and routes/extras.ts: an explicit
    // premium extraId answers 403 plan_required, and the default never picks one the plan cannot use.
    // Locked extras ("Estreias sexta" teasers) are not released yet, so they are never usable here
    // (same rule as routes/extras.ts and resolvePhrase).
    const premiumOk = !!s.plan?.features[PLAN_FEATURES.premiumExtras];
    const released = catalog.extras.filter((x) => !x.locked);
    const usable = new Set(released.filter((x) => premiumOk || !x.premium).map((x) => x.id));
    if (body.extraId !== undefined) {
      const x = released.find((e) => e.id === body.extraId);
      if (!x) throw fail('validation_failed', undefined, { field: 'extraId' });
      if (!usable.has(x.id)) throw fail('plan_required');
    }
    const last = body.extraId
      ? null
      : await one<{ id: string | null }>(db, 'SELECT last_extra_id AS id FROM user_stats WHERE user_id = ?', s.userId);
    extraId = body.extraId ?? (last?.id && usable.has(last.id) ? last.id : ([...usable][0] ?? null));
  }

  const row = { mode: body.mode, mission_key: mission, extra_id: extraId };
  let first: StartSessionRes['opener'];
  try {
    first = opener(demoSession(row, assistant, profile, 0), scriptContent(catalog));
  } catch {
    throw fail('content_unavailable');
  }

  const on = await aiEnabled(c.env, flagSubject(s));
  const quotaLeftS = on ? (await quotaOf(c.env, services).remaining(s.userId)).leftS : 0;

  const id = newId();
  const now = Date.now();
  // Open sessions are bounded: beyond MAX_OPEN_SESSIONS - 1 older open ones, the oldest are closed
  // here (no bill: their AI turns were billed per turn; no award), then retention runs as on /end.
  const autoEnd = db
    .prepare(
      `UPDATE mic_sessions SET status = 'ended', ended_at = ?1,
         secs = CAST(MIN(?2, MAX(0, (?1 - started_at) / 1000)) AS INTEGER)
       WHERE user_id = ?3 AND status = 'open' AND id NOT IN (
         SELECT id FROM mic_sessions WHERE user_id = ?3 AND status = 'open' ORDER BY started_at DESC LIMIT ?4)`,
    )
    .bind(now, MAX_SESSION_SECS, s.userId, MAX_OPEN_SESSIONS - 1);
  await db.batch([
    autoEnd,
    ...retentionStatements(db, s.userId, LIMITS.micSessionsKept),
    db
      .prepare(
        `INSERT INTO mic_sessions(id, user_id, assistant_key, mode, mission_key, extra_id, started_at, billed_until, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .bind(id, s.userId, assistant.key, body.mode, mission, extraId, now, now),
    turnInsert(db, {
      sessionId: id,
      idx: 0,
      who: 'her',
      en: first.reply_en,
      pt: first.reply_pt,
      words: first.words,
      source: 'script',
      at: now,
    }),
  ]);
  return c.json({ id, opener: first, quotaLeftS } satisfies StartSessionRes);
});

routes.post(
  micApi.end.path,
  requireUser(),
  rateLimit('RL_API'),
  vParam(IdParams),
  vJson(micApi.end.body),
  async (c) => {
    const s = sessionOf(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.env.DB;
    const services = c.get('services');
    const quota = quotaOf(c.env, services);
    const row = await ownedSession(db, id, s.userId);
    const now = Date.now();

    // Replayed finish (outbox): no second bill, no second award.
    const replay = async (ended: typeof row) => {
      const turns = await sessionTurns(db, id);
      const left = await quota.remaining(s.userId);
      return c.json({ session: toMicSession(ended, turns), secLeft: left.leftS, award: null } satisfies EndSessionRes);
    };
    if (row.status === 'ended') return replay(row);

    const secs = Math.min(MAX_SESSION_SECS, Math.max(0, Math.round((now - row.started_at) / 1000)));
    // Claim the end first, so concurrent finishes bill and award once. Once ended, no tutor turn can
    // move billed_until any more (its compare-and-set requires 'open'), so the value returned here
    // is the true start of the un-billed window.
    const claim = await one<{ billed_until: number }>(
      db,
      `UPDATE mic_sessions SET status = 'ended', ended_at = ?, secs = ?
       WHERE id = ? AND user_id = ? AND status = 'open' RETURNING billed_until`,
      now,
      secs,
      id,
      s.userId,
    );
    if (!claim) {
      // A concurrent finish of the same session (an outbox replay racing the original) won the
      // claim: answer as the sequential replay does, with the session it ended.
      const current = await ownedSession(db, id, s.userId);
      if (current.status === 'ended') return replay(current);
      throw fail('conflict');
    }

    // Turns produced client-side (demo mode) are appended after the stored ones (idx taken in SQL),
    // then, in the same round trip: did the tutor model answer in this session, and how many times
    // the learner spoke. Award policy (spec 03 §B, EndSessionBody): every learner turn counts toward
    // maggie_session, client-side demo turns included (demo mode is the documented flow once the
    // quota is used up), except silent pronunciation tries. What keeps this from being farmed: the
    // session must have lasted MIN_AWARD_SESSION_SECS, the award key is per session, at most
    // MAX_SESSION_AWARDS_PER_DAY maggie_session awards per rolling 24 h (S7 bound, counted in
    // point_ledger, which retention never touches), and point_rules.daily_cap (S4 seed). Concurrent
    // /end calls of different sessions read the count together, so the bound can be passed by at
    // most MAX_OPEN_SESSIONS - 1 in a burst.
    //
    // Client-side learner turns never earn maggie_turn (they are not verified by the server).
    // Their Mic time is credited through this award instead: maggieSec = MAGGIE_SEC_TURN per
    // client learner turn (at most LIMITS.micTurnAwardsPerSession of them), never more than the
    // session's wall-clock length, so demo mode moves the daily maggieSec mission too (spec 03 §B).
    //
    // Client turns are untrusted: every field is clamped like model output (the shared contract
    // bounds en/pt but not the strings inside fb/pron/words), and fb is kept only on a learner turn
    // that parses as Feedback, with `original` set to what is stored as the learner's text.
    const inserts = (body.turns ?? []).flatMap((t) => {
      const me = t.who === 'me';
      const en = me ? sanitizeLearnerText(t.en) : cleanText(t.en, 600);
      if (!en) return [];
      const pron = clampTips(t.pron);
      const words = clampWords(t.words);
      return [
        turnAppend(db, id, {
          who: t.who,
          en,
          pt: (t.pt && cleanText(t.pt, 600)) || null,
          feedback: me && t.fb ? clampFeedback({ ...t.fb, original: en }) : null,
          pron: pron.length ? pron : null,
          words: words.length ? words : null,
          source: TURN_SOURCE.client,
          at: now,
        }),
      ];
    });
    const results = await db.batch([
      ...inserts,
      db
        .prepare(
          `SELECT
             EXISTS(SELECT 1 FROM mic_turns WHERE session_id = ?1 AND source = ?2) AS used_ai,
             (SELECT COUNT(*) FROM mic_turns WHERE session_id = ?1 AND who = 'me' AND en <> ?3) AS spoke,
             (SELECT COUNT(*) FROM mic_turns WHERE session_id = ?1 AND who = 'me' AND en <> ?3 AND source = ?4)
               AS client_spoke`,
        )
        .bind(id, TURN_SOURCE.tutor, SILENT_TURN, TURN_SOURCE.client),
      recentAwards(db, s.userId, 'maggie_session', now),
    ]);
    const appended = new Set(
      results.slice(0, inserts.length).flatMap((res) => {
        const idx = appendedIdx(res);
        return idx === null ? [] : [idx];
      }),
    );
    const stats = (results[inserts.length]?.results?.[0] ?? {}) as {
      used_ai?: number;
      spoke?: number;
      client_spoke?: number;
    };
    const recentSessionAwards = countOf(results[inserts.length + 1]);

    // Bill the time since the last billed tutor turn (capped) when the session used the tutor model.
    // billed_until may be ahead of now (prepaid turn minimum): then there is nothing left to bill.
    const billed = stats.used_ai === 1;
    if (billed) {
      const remainder = Math.min(BILL_CAP_S, Math.max(0, Math.floor((now - claim.billed_until) / 1000)));
      if (remainder > 0) {
        const r = await quota.reserve(s.userId, remainder, { kind: 'tutor', sessionId: id });
        if (!r.ok && r.quota.leftS > 0) await quota.reserve(s.userId, r.quota.leftS, { kind: 'tutor', sessionId: id });
      }
    }

    const clientSpoke = Math.min(Number(stats.client_spoke ?? 0), LIMITS.micTurnAwardsPerSession);
    const award =
      Number(stats.spoke ?? 0) >= 2 &&
      secs >= MIN_AWARD_SESSION_SECS &&
      recentSessionAwards < MAX_SESSION_AWARDS_PER_DAY
        ? await tryAward(services, s.userId, 'maggie_session', `msess:${id}`, {
            now,
            ...(clientSpoke > 0 ? { maggieSec: Math.min(secs, clientSpoke * MAGGIE_SEC_TURN) } : {}),
          })
        : null;

    // billed_until, retention (never this session: it is the newest finished one) and the final
    // transcript, in one round trip.
    const finalRes = await db.batch([
      ...(billed
        ? [db.prepare('UPDATE mic_sessions SET billed_until = MAX(billed_until, ?) WHERE id = ?').bind(now, id)]
        : []),
      ...retentionStatements(db, s.userId, LIMITS.micSessionsKept, id),
      db.prepare('SELECT * FROM mic_turns WHERE session_id = ? ORDER BY idx').bind(id),
    ]);
    const turns = (finalRes.at(-1)?.results ?? []) as unknown as TurnRow[];

    // Client-side learner turns never went through Llama Guard: check them (joined) in the background.
    if (appended.size && (await aiEnabled(c.env, flagSubject(s)))) {
      const mine = turns.filter((t) => t.who === 'me' && appended.has(t.idx));
      const first = mine[0];
      if (first) {
        const models = await loadModels(db);
        background(
          c,
          moderateTurn(
            c.env,
            {
              userId: s.userId,
              sessionId: id,
              turnIdx: first.idx,
              text: mine.map((t) => t.en).join('\n'),
              model: models.guard,
            },
            quota,
          ),
        );
      }
    }

    const ended = { ...row, status: 'ended' as const, ended_at: now, secs };
    const left = await quota.remaining(s.userId);
    return c.json({ session: toMicSession(ended, turns), secLeft: left.leftS, award } satisfies EndSessionRes);
  },
);

routes.get(micApi.list.path, requireUser(), async (c) => {
  const s = sessionOf(c);
  const sessions = await listSessions(c.env.DB, s.userId, LIMITS.micSessionsKept);
  return c.json({ sessions } satisfies SessionsRes);
});

routes.get(micApi.get.path, requireUser(), vParam(IdParams), async (c) => {
  const s = sessionOf(c);
  const { id } = c.req.valid('param');
  const { row, turns } = await ownedSessionWithTurns(c.env.DB, id, s.userId);
  return c.json({ session: toMicSession(row, turns) } satisfies SessionRes);
});

export default routes;
