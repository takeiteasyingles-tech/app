// D1 + content readers shared by the Mic and AI routes: sessions and turns, assistants (with the
// server-only persona), the learner profile, and the demo-script context.
import {
  AI_PROMPT_KEYS,
  type Bilingual,
  type Catalog,
  type DemoSession,
  type Feedback,
  type MicMode,
  type MicSession,
  type MicTurn,
  type PersonalizeProfile,
  type PronTip,
  type ReportResult,
  ReportResult as ReportResultSchema,
  type ScriptContent,
  type TutorContext,
  tutorContext,
} from '@tie/shared';
import { all, type Bind, fail, fromJson, one, run, type Services } from '@tie/worker-core';
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_TUTOR_TEMPLATE } from './prompt';

// ---------- Sessions ----------

export interface SessionRow {
  id: string;
  user_id: string;
  assistant_key: string;
  mode: MicMode;
  mission_key: string | null;
  extra_id: string | null;
  started_at: number;
  billed_until: number;
  ended_at: number | null;
  secs: number;
  status: 'open' | 'ended';
  report: string | null;
  report_source: string | null;
  flagged: number;
}

export interface TurnRow {
  session_id: string;
  idx: number;
  who: 'me' | 'her' | 'coach';
  en: string;
  pt: string | null;
  feedback: string | null;
  pron: string | null;
  words: string | null;
  source: string | null;
  created_at: number;
}

const SESSION_COLS =
  'id, user_id, assistant_key, mode, mission_key, extra_id, started_at, billed_until, ended_at, secs, status, report, report_source, flagged';

/**
 * The caller's session, or 404 (also for someone else's session, so ids cannot be probed).
 * Owner checks live in the WHERE clause, never after the read.
 */
export async function ownedSession(db: D1Database, id: string, userId: string): Promise<SessionRow> {
  const row = await one<SessionRow>(
    db,
    `SELECT ${SESSION_COLS} FROM mic_sessions WHERE id = ? AND user_id = ?`,
    id,
    userId,
  );
  if (!row) throw fail('not_found');
  return row;
}

/** ownedSession + sessionTurns in one round trip (the turns query carries the owner check too). */
export async function ownedSessionWithTurns(
  db: D1Database,
  id: string,
  userId: string,
): Promise<{ row: SessionRow; turns: TurnRow[] }> {
  const [sess, turns] = await db.batch([
    db.prepare(`SELECT ${SESSION_COLS} FROM mic_sessions WHERE id = ? AND user_id = ?`).bind(id, userId),
    db
      .prepare(
        `SELECT t.* FROM mic_turns t WHERE t.session_id = (SELECT id FROM mic_sessions WHERE id = ?1 AND user_id = ?2)
         ORDER BY t.idx`,
      )
      .bind(id, userId),
  ]);
  const row = sess?.results?.[0] as SessionRow | undefined;
  if (!row) throw fail('not_found');
  return { row, turns: (turns?.results ?? []) as unknown as TurnRow[] };
}

export async function sessionTurns(db: D1Database, sessionId: string): Promise<TurnRow[]> {
  return all<TurnRow>(db, 'SELECT * FROM mic_turns WHERE session_id = ? ORDER BY idx', sessionId);
}

/** Last `n` turns, oldest first. */
export async function recentTurns(db: D1Database, sessionId: string, n: number): Promise<TurnRow[]> {
  const rows = await all<TurnRow>(
    db,
    'SELECT * FROM mic_turns WHERE session_id = ? ORDER BY idx DESC LIMIT ?',
    sessionId,
    n,
  );
  return rows.reverse();
}

export function toMicTurn(t: TurnRow): MicTurn | null {
  if (t.who !== 'me' && t.who !== 'her') return null;
  return {
    who: t.who,
    en: t.en,
    pt: t.pt ?? '',
    fb: fromJson<Feedback | null>(t.feedback, null),
    pron: fromJson<PronTip[]>(t.pron, []),
    words: fromJson<Bilingual[]>(t.words, []),
  };
}

export function storedReport(row: Pick<SessionRow, 'report'>): ReportResult | null {
  const parsed = ReportResultSchema.safeParse(fromJson<unknown>(row.report, null));
  return parsed.success ? parsed.data : null;
}

export function toMicSession(s: SessionRow, turns: readonly TurnRow[]): MicSession {
  return {
    id: s.id,
    at: s.started_at,
    assistant: s.assistant_key,
    mode: s.mode,
    mission: s.mission_key,
    extraId: s.extra_id,
    secs: Math.max(0, Math.floor(s.secs)),
    turns: turns.flatMap((t) => {
      const m = toMicTurn(t);
      return m ? [m] : [];
    }),
    report: storedReport(s),
  };
}

/** Owner's finished sessions (most recently finished first, as retention keeps them) with their turns, in one batch. */
export async function listSessions(db: D1Database, userId: string, limit: number): Promise<MicSession[]> {
  const where = "status = 'ended'";
  const [sessions, turns] = await db.batch([
    db
      .prepare(
        `SELECT ${SESSION_COLS} FROM mic_sessions WHERE user_id = ? AND ${where} ORDER BY ${ENDED_ORDER} LIMIT ?`,
      )
      .bind(userId, limit),
    db
      .prepare(
        `SELECT t.* FROM mic_turns t WHERE t.session_id IN
           (SELECT id FROM mic_sessions WHERE user_id = ? AND ${where} ORDER BY ${ENDED_ORDER} LIMIT ?)
         ORDER BY t.session_id, t.idx`,
      )
      .bind(userId, limit),
  ]);
  const byId = new Map<string, TurnRow[]>();
  for (const t of (turns?.results ?? []) as unknown as TurnRow[]) {
    const list = byId.get(t.session_id) ?? [];
    list.push(t);
    byId.set(t.session_id, list);
  }
  return ((sessions?.results ?? []) as unknown as SessionRow[]).map((s) => toMicSession(s, byId.get(s.id) ?? []));
}

/**
 * Where a stored turn came from. Only TURN_SOURCE.tutor turns mean "the session used the tutor
 * model" (wall-clock remainder billing at /end); pronounce tries are billed by audio seconds.
 */
export const TURN_SOURCE = {
  script: 'script',
  /** /api/tutor answered by the model. */
  tutor: 'ia',
  /** /api/tutor demo fallback (server-side). */
  demo: 'demo',
  /** /api/pronounce try (Whisper transcript). */
  pronounce: 'pron',
  /**
   * Appended by the client at /end (client-side demo turns): never a reason to run the AI report and
   * never maggie_turn; they do count toward maggie_session, whose award carries their Mic time
   * (maggieSec, capped by the session's wall-clock length; see routes/mic.ts /end).
   */
  client: 'client',
} as const;

export interface NewTurn {
  who: 'me' | 'her' | 'coach';
  en: string;
  pt?: string | null;
  feedback?: unknown;
  pron?: unknown;
  words?: unknown;
  source?: string | null;
  at: number;
}

const jsonBind = (v: unknown): Bind => (v === undefined || v === null ? null : JSON.stringify(v));

/** INSERT for one turn at a known idx (the opener, written together with the session row). */
export function turnInsert(db: D1Database, t: NewTurn & { sessionId: string; idx: number }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO mic_turns(session_id, idx, who, en, pt, feedback, pron, words, source, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.sessionId,
      t.idx,
      t.who,
      t.en,
      t.pt ?? null,
      jsonBind(t.feedback),
      jsonBind(t.pron),
      jsonBind(t.words),
      t.source ?? null,
      t.at,
    );
}

/**
 * INSERT that takes the next idx inside SQL (RETURNING idx), so concurrent writers (two tutor
 * calls, a tutor call racing /end) never collide on (session_id, idx). With `requireOpen`, nothing
 * is inserted (no row returned) once the session has ended.
 */
export function turnAppend(
  db: D1Database,
  sessionId: string,
  t: NewTurn,
  opts: { requireOpen?: boolean } = {},
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO mic_turns(session_id, idx, who, en, pt, feedback, pron, words, source, created_at)
       SELECT ?1, (SELECT COALESCE(MAX(idx), -1) + 1 FROM mic_turns WHERE session_id = ?1),
              ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       FROM mic_sessions WHERE id = ?1${opts.requireOpen ? " AND status = 'open'" : ''}
       RETURNING idx`,
    )
    .bind(
      sessionId,
      t.who,
      t.en,
      t.pt ?? null,
      jsonBind(t.feedback),
      jsonBind(t.pron),
      jsonBind(t.words),
      t.source ?? null,
      t.at,
    );
}

/** idx a turnAppend statement returned, or null when it inserted nothing. */
export function appendedIdx(res: D1Result | undefined): number | null {
  const idx = (res?.results?.[0] as { idx?: unknown } | undefined)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/** Learner turns of a session (for the per-session maggie_turn cap), batched after an append. */
export function learnerTurnCount(db: D1Database, sessionId: string): D1PreparedStatement {
  return db.prepare("SELECT COUNT(*) AS n FROM mic_turns WHERE session_id = ? AND who = 'me'").bind(sessionId);
}

export const countOf = (res: D1Result | undefined): number =>
  Number((res?.results?.[0] as { n?: unknown } | undefined)?.n ?? 0);

/**
 * Claims the un-billed wall-clock window of an open session with a compare-and-set on
 * billed_until, so two concurrent tutor turns never bill the same seconds. Returns the claimed
 * window, or null when the session is no longer open. `release` puts the window back (the
 * reservation was denied).
 *
 * `seconds` is the window in whole seconds, at least minS (every model-answered turn costs
 * something, even the first turn of a brand-new session or a burst of concurrent turns) and at
 * most capS (time beyond the cap is never billed). When the minimum is more than the elapsed
 * time, billed_until moves ahead of `now` by the difference, so the prepaid seconds are not
 * billed again by the next turn or /end: over a session, the total stays close to wall-clock
 * time whenever turns are more than minS apart.
 */
export async function claimBillWindow(
  db: D1Database,
  sessionId: string,
  knownBilledUntil: number,
  now: number,
  opts: { capS: number; minS: number },
): Promise<{ from: number; to: number; seconds: number; release: () => Promise<void> } | null> {
  let from: number | null = knownBilledUntil;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (from === null) {
      const cur = await one<{ b: number; status: string }>(
        db,
        'SELECT billed_until AS b, status FROM mic_sessions WHERE id = ?',
        sessionId,
      );
      if (cur?.status !== 'open') return null;
      from = cur.b;
    }
    const elapsedS = Math.max(0, Math.floor((now - from) / 1000));
    const seconds = Math.min(opts.capS, Math.max(opts.minS, elapsedS));
    const to = Math.max(from + seconds * 1000, now);
    const res = await run(
      db,
      "UPDATE mic_sessions SET billed_until = ? WHERE id = ? AND billed_until = ? AND status = 'open'",
      to,
      sessionId,
      from,
    );
    if (res.changes === 1) {
      const start = from;
      return {
        from: start,
        to,
        seconds,
        release: async () => {
          await run(
            db,
            'UPDATE mic_sessions SET billed_until = ? WHERE id = ? AND billed_until = ?',
            start,
            sessionId,
            to,
          );
        },
      };
    }
    from = null;
  }
  throw fail('conflict', 'Tente de novo.');
}

/** A phrase the server knows the text of, so a pronunciation score can be bound to it. */
export interface PhraseTarget {
  kind: 'mic' | 'dub';
  id: string;
  target: string;
  /** Line of a premium extra: only plans with PLAN_FEATURES.premiumExtras may score against it. */
  premium: boolean;
}

/**
 * Resolves an attempt phraseId to its server-side text: a mic_phrases id of a published episode,
 * else `${extraId}:${line}`, line N of a published extra (/api/extras/:id/dub then checks it is a
 * dubbing line). Null when unknown. Same resolution as learning/attemptTarget.ts (S2). The caller
 * enforces `premium` (same rule as routes/content.ts and routes/extras.ts).
 */
export async function resolvePhrase(db: D1Database, phraseId: string): Promise<PhraseTarget | null> {
  const p = await one<{ en: string }>(
    db,
    `SELECT p.en FROM mic_phrases p JOIN episodes e ON e.num = p.episode_num
     WHERE p.id = ? AND e.status = 'published'`,
    phraseId,
  );
  if (p) return p.en.trim() ? { kind: 'mic', id: phraseId, target: p.en, premium: false } : null;
  const dub = /^(.+):(\d{1,4})$/.exec(phraseId);
  if (!dub?.[1] || !dub[2]) return null;
  const x = await one<{ lines: string; premium: number }>(
    db,
    // Locked extras ("Estreias sexta" teasers) cannot be dubbed yet, so their lines are not scored
    // either (scoring returns the line's words as issues). Same rule as routes/extras.ts.
    "SELECT lines, premium FROM extras WHERE id = ? AND status = 'published' AND locked = 0",
    dub[1],
  );
  if (!x) return null;
  const lines = fromJson<unknown>(x.lines, []);
  const line = Array.isArray(lines) ? (lines[Number(dub[2])] as { en?: unknown } | undefined) : undefined;
  if (!line || typeof line !== 'object' || typeof line.en !== 'string' || !line.en.trim()) return null;
  return { kind: 'dub', id: phraseId, target: line.en, premium: x.premium === 1 };
}

/**
 * Stored as the learner turn of a pronunciation try when Whisper heard nothing. It is never the
 * target text (the transcript must not claim the learner said it), it is left out of reports, and
 * it does not count as the learner speaking (no maggie_turn, not toward maggie_session).
 */
export const SILENT_TURN = '(silêncio)';

/** Open sessions a user may keep; starting one more auto-ends the oldest (no bill, no award). */
export const MAX_OPEN_SESSIONS = 3;

/** Order of finished sessions, most recently finished first (retention and the session list). */
export const ENDED_ORDER = 'COALESCE(ended_at, started_at) DESC, started_at DESC';

/**
 * Finished sessions kept for review beyond the `keep` newest (flagged, with a pending moderation
 * item), per user, in two separate budgets so one kind of pin can never push the other out:
 * - MAX_GUARD_PINNED_SESSIONS for sessions Llama Guard flagged (a pending 'transcript' item with no
 *   reporter). Self-reports cannot evict this evidence before a moderator reviews it; only newer
 *   guard-flagged sessions (themselves evidence) can.
 * - MAX_REPORT_PINNED_SESSIONS for sessions the user reported (a pending item with a reporter).
 * Both are capped because both ways of pinning are in the user's hands. Together with the per-turn
 * clamps at /end, this bounds what one account can keep in D1.
 */
export const MAX_GUARD_PINNED_SESSIONS = 10;
export const MAX_REPORT_PINNED_SESSIONS = 5;

/** The mic_sessions id a moderation item points at ('mic_session' → ref_id, 'mic_turn' → `{id}:{idx}`). */
const MOD_SESSION_ID = `CASE m.ref_type WHEN 'mic_turn'
    THEN substr(m.ref_id, 1, length(rtrim(m.ref_id, '0123456789')) - 1) ELSE m.ref_id END`;

/**
 * Retention for one user, as batchable statements: keep the `keep` most recently finished
 * sessions (by ended_at, so a session left open for a long time and ended now is among the newest);
 * older ones go unless they are among the newest flagged sessions with a moderation item still
 * pending, within the budgets above (a flag alone does not keep a session). `exceptId` (the session
 * being ended in this request) is never deleted.
 *
 * Cost: the moderation lookups are uncorrelated (SQLite runs each at most once per statement), are
 * limited to this user's items (subject_user_id; every Mic item names the session owner), and only
 * run when an older session is flagged at all (`s.flagged = 0 OR …` short-circuits).
 */
export function retentionStatements(
  db: D1Database,
  userId: string,
  keep: number,
  exceptId: string | null = null,
): D1PreparedStatement[] {
  const kept = `SELECT id FROM mic_sessions WHERE user_id = ?1 AND status = 'ended' ORDER BY ${ENDED_ORDER} LIMIT ?2`;
  const pendingFor = (guard: boolean) => `SELECT ${MOD_SESSION_ID} FROM moderation_items m
    WHERE m.status = 'pending' AND m.subject_user_id = ?1 AND m.ref_type IN ('mic_session', 'mic_turn')
      AND ${guard ? "m.kind = 'transcript' AND m.reporter_user_id IS NULL" : 'm.reporter_user_id IS NOT NULL'}`;
  const pinned = (guard: boolean, limit: string) => `SELECT p.id FROM mic_sessions p
    WHERE p.user_id = ?1 AND p.status = 'ended' AND p.flagged = 1 AND p.id IN (${pendingFor(guard)})
    ORDER BY ${ENDED_ORDER} LIMIT ${limit}`;
  const stale = `SELECT s.id FROM mic_sessions s WHERE s.user_id = ?1 AND s.status = 'ended' AND s.id IS NOT ?3
    AND s.id NOT IN (${kept})
    AND (s.flagged = 0 OR (s.id NOT IN (${pinned(true, '?4')}) AND s.id NOT IN (${pinned(false, '?5')})))`;
  const args = [userId, keep, exceptId, MAX_GUARD_PINNED_SESSIONS, MAX_REPORT_PINNED_SESSIONS] as const;
  return [
    db.prepare(`DELETE FROM mic_turns WHERE session_id IN (${stale})`).bind(...args),
    db.prepare(`DELETE FROM mic_sessions WHERE id IN (${stale})`).bind(...args),
  ];
}

// ---------- Assistants ----------

export interface AssistantRow {
  key: string;
  name: string;
  art: 'a' | 'o';
  persona: string;
  tts_speaker: string;
  voice: string;
  active: number;
}

export interface Assistant {
  key: string;
  name: string;
  art: 'a' | 'o';
  persona: string;
  ttsSpeaker: string;
  gender: 'female' | 'male';
}

function toAssistant(r: AssistantRow): Assistant {
  const v = fromJson<{ gender?: unknown }>(r.voice, {});
  return {
    key: r.key,
    name: r.name,
    art: r.art,
    persona: r.persona,
    ttsSpeaker: r.tts_speaker,
    gender: v.gender === 'male' ? 'male' : 'female',
  };
}

export async function activeAssistants(db: D1Database): Promise<Assistant[]> {
  const rows = await all<AssistantRow>(
    db,
    'SELECT key, name, art, persona, tts_speaker, voice, active FROM assistants WHERE active = 1 ORDER BY sort',
  );
  return rows.map(toAssistant);
}

/** Active assistant by key, or 404. */
export async function assistantByKey(db: D1Database, key: string): Promise<Assistant> {
  const row = await one<AssistantRow>(
    db,
    'SELECT key, name, art, persona, tts_speaker, voice, active FROM assistants WHERE key = ? AND active = 1',
    key,
  );
  if (!row) throw fail('not_found', 'Assistente não encontrado.');
  return toAssistant(row);
}

/** Assistant by key even when deactivated later (old sessions keep their persona). */
export async function sessionAssistant(db: D1Database, key: string): Promise<Assistant> {
  const row = await one<AssistantRow>(
    db,
    'SELECT key, name, art, persona, tts_speaker, voice, active FROM assistants WHERE key = ?',
    key,
  );
  if (!row) throw fail('not_found', 'Assistente não encontrado.');
  return toAssistant(row);
}

// ---------- Prompts ----------

export async function promptTemplate(db: D1Database, which: keyof typeof AI_PROMPT_KEYS): Promise<string> {
  const row = await one<{ template: string }>(
    db,
    'SELECT template FROM ai_prompts WHERE key = ?',
    AI_PROMPT_KEYS[which],
  );
  const t = row?.template?.trim();
  if (t) return t;
  return which === 'tutor' ? DEFAULT_TUTOR_TEMPLATE : DEFAULT_REPORT_TEMPLATE;
}

// ---------- Learner ----------

interface ProfileRow {
  name: string | null;
  level_key: string;
  age_band: string | null;
  occupation: string | null;
  area: string | null;
  goals: string;
  deadline: string | null;
  formats: string;
  genres: string;
  themes: string;
  diffs: string;
  main_diff: string | null;
  styles: string;
  feedback: string | null;
  minutes: number;
  motives: string;
  why: string | null;
  assistant_key: string | null;
}

const strs = (json: string | null | undefined): string[] =>
  fromJson<unknown[]>(json, []).filter((x): x is string => typeof x === 'string');

/** The personalization fields of the learner's profile, or null before onboarding. */
export async function learnerProfile(db: D1Database, userId: string): Promise<PersonalizeProfile | null> {
  const r = await one<ProfileRow>(
    db,
    `SELECT name, level_key, age_band, occupation, area, goals, deadline, formats, genres, themes, diffs,
            main_diff, styles, feedback, minutes, motives, why, assistant_key
     FROM profiles WHERE user_id = ?`,
    userId,
  );
  if (!r) return null;
  return {
    name: r.name ?? '',
    level: r.level_key,
    age: r.age_band ?? '',
    occup: r.occupation ?? '',
    area: r.area ?? '',
    goals: strs(r.goals),
    deadline: r.deadline ?? '',
    formats: strs(r.formats),
    genres: strs(r.genres),
    themes: strs(r.themes),
    diffs: strs(r.diffs),
    mainDiff: r.main_diff ?? '',
    styles: strs(r.styles),
    feedback: r.feedback ?? '',
    minutes: r.minutes,
    motives: strs(r.motives),
    why: r.why ?? '',
    assistant: r.assistant_key ?? '',
  };
}

export function safeTutorContext(p: PersonalizeProfile | null, catalog: Catalog): TutorContext | null {
  if (!p) return null;
  try {
    return tutorContext(p, catalog);
  } catch {
    return null;
  }
}

// ---------- Content ----------

/** Published catalog (S9's ContentService); 503 content_unavailable when nothing is published. */
export async function catalogOf(services: Services): Promise<Catalog> {
  try {
    return await services.content.catalog();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'catalog unavailable', error: String(err) }));
    throw fail('content_unavailable');
  }
}

export function scriptContent(catalog: Catalog): ScriptContent {
  return { mic: catalog.mic, extras: catalog.extras };
}

export function demoSession(
  s: Pick<SessionRow, 'mode' | 'mission_key' | 'extra_id'>,
  a: Pick<Assistant, 'name' | 'art'>,
  profile: PersonalizeProfile | null,
  turn: number,
): DemoSession {
  return {
    mode: s.mode,
    mission: s.mission_key,
    extraId: s.extra_id,
    ctxFormats: profile?.formats ?? [],
    name: profile?.name ?? '',
    aName: a.name,
    aThe: `${a.art} ${a.name}`,
    turn,
  };
}
