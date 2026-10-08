// GET /api/me/state: TieState v7 in a single D1 batch (spec 04 §0, §5 "Performance").
import {
  Bilingual,
  type DailyStats,
  DEFAULT_TZ,
  Feedback,
  FLAGS,
  type GameLogEntry,
  LIMITS,
  MicMode,
  type MicSession,
  type MicTurn,
  PronTip,
  ReportResult,
  SETTINGS,
  STATE_VERSION,
  stepKey,
  type TestAnswer,
  type TieState,
} from '@tie/shared';
import { addDays, batch, bool, fromJson, localDate, period, q, type SessionInfo } from '@tie/worker-core';
import { z } from 'zod';
import {
  appSettingQuery,
  CLIENT_FLAGS,
  evaluateRows,
  flagRowsQuery,
  flagSubject,
  quotaInfo,
  settingString,
} from './common';
import {
  draftFromRow,
  PROFILE_SELECT,
  type ProfileRow,
  profileFromRow,
  type SettingsRow,
  settingsFromRow,
} from './profile';

/**
 * The streak the client sees, with the same rule as the S4 game summary (game/engine.ts summary()
 * + shared gameSummary's `streak || 1`): a streak whose last day is today or yesterday is alive and
 * shown as stored (at least 1); a broken one, or a new account (streak 0, no last_day), shows 1,
 * like the prototype's store.fresh(). lastDay stays raw so touchStreak() keeps working client-side.
 */
export function displayStreak(
  streak: number | null | undefined,
  lastDay: string | null | undefined,
  today: string,
): number {
  const live = !!lastDay && (lastDay === today || lastDay === addDays(today, -1));
  return live ? Math.max(1, streak ?? 0) : 1;
}

/** Days of daily_stats sent with the state (today and the 6 before it, user tz). */
export const STATE_DAILY_DAYS = 7;

interface StatsRow {
  points: number;
  streak: number;
  last_day: string | null;
  challenge_best: number;
  last_extra_id: string | null;
}

interface DailyRow {
  local_date: string;
  points: number;
  steps: number;
  cards: number;
  extras: number;
  mic: number;
  maggie_sec: number;
  goal_hit: number;
  missions: string;
}

interface MicSessionRow {
  id: string;
  assistant_key: string;
  mode: string;
  mission_key: string | null;
  extra_id: string | null;
  started_at: number;
  secs: number;
  report: string | null;
  report_source: string | null;
}

interface MicTurnRow {
  session_id: string;
  idx: number;
  who: string;
  en: string;
  pt: string | null;
  feedback: string | null;
  pron: string | null;
  words: string | null;
}

export function dailyFromRow(r: DailyRow): DailyStats {
  const missions = fromJson<unknown>(r.missions, {});
  const m: Record<string, boolean> = {};
  if (missions && typeof missions === 'object' && !Array.isArray(missions)) {
    for (const [k, v] of Object.entries(missions)) m[k] = !!v;
  }
  return {
    points: r.points,
    steps: r.steps,
    cards: r.cards,
    maggieSec: r.maggie_sec,
    extras: r.extras,
    mic: r.mic,
    goal: bool(r.goal_hit),
    missions: m,
  };
}

const PronTips = z.array(PronTip);
const Words = z.array(Bilingual);

function parsed<T>(schema: z.ZodType<T>, text: string | null, fallback: T): T {
  if (!text) return fallback;
  const res = schema.safeParse(fromJson<unknown>(text, null));
  return res.success ? res.data : fallback;
}

function turnFromRow(t: MicTurnRow): MicTurn | null {
  if (t.who !== 'me' && t.who !== 'her') return null;
  return {
    who: t.who,
    en: t.en,
    pt: t.pt ?? '',
    fb: parsed(Feedback.nullable(), t.feedback, null),
    pron: parsed(PronTips, t.pron, []),
    words: parsed(Words, t.words, []),
  };
}

function reportFromRow(r: MicSessionRow): MicSession['report'] {
  if (!r.report) return null;
  const raw = fromJson<unknown>(r.report, null);
  if (!raw || typeof raw !== 'object') return null;
  const withSource = { source: r.report_source === 'ia' ? 'ia' : 'demo', ...(raw as object) };
  const res = ReportResult.safeParse(withSource);
  return res.success ? res.data : null;
}

export function micSessionsFrom(rows: readonly MicSessionRow[], turns: readonly MicTurnRow[]): MicSession[] {
  const bySession = new Map<string, MicTurn[]>();
  for (const t of turns) {
    const turn = turnFromRow(t);
    if (!turn) continue;
    const list = bySession.get(t.session_id) ?? [];
    list.push(turn);
    bySession.set(t.session_id, list);
  }
  const out: MicSession[] = [];
  for (const r of rows) {
    const mode = MicMode.safeParse(r.mode);
    if (!mode.success) continue;
    out.push({
      id: r.id,
      at: r.started_at,
      assistant: r.assistant_key,
      mode: mode.data,
      mission: r.mission_key,
      extraId: r.extra_id,
      secs: Math.max(0, Math.floor(r.secs)),
      turns: bySession.get(r.id) ?? [],
      report: reportFromRow(r),
    });
  }
  return out;
}

/** Builds the whole client state for the session user. Every query is scoped to that user id. */
export async function buildState(db: D1Database, s: SessionInfo, now: number): Promise<TieState> {
  const uid = s.userId;
  const tz = s.tz || DEFAULT_TZ;
  const today = localDate(now, tz);
  const since = addDays(today, -(STATE_DAILY_DAYS - 1));
  const per = period(now, tz);

  const [
    users,
    profiles,
    settings,
    progress,
    steps,
    scores,
    answers,
    ebooks,
    testAnswers,
    testResults,
    cards,
    due,
    extras,
    stats,
    daily,
    badges,
    ledger,
    sessions,
    turns,
    usage,
    flags,
    content,
  ] = await batch(db, [
    q<{ id: string; email: string; tz: string }>(db, 'SELECT id, email, tz FROM users WHERE id = ?', uid),
    q<ProfileRow>(db, `${PROFILE_SELECT} WHERE p.user_id = ?`, uid),
    q<SettingsRow>(db, 'SELECT ts, sound, hd, trans, slow, remind, fx, free FROM user_settings WHERE user_id = ?', uid),
    q<{ episode_num: number; furthest_step: number; done_at: number | null }>(
      db,
      'SELECT episode_num, furthest_step, done_at FROM episode_progress WHERE user_id = ?',
      uid,
    ),
    q<{ episode_num: number; step: number }>(
      db,
      'SELECT episode_num, step FROM step_completions WHERE user_id = ?',
      uid,
    ),
    q<{ phrase_id: string; last_score: number }>(
      db,
      'SELECT phrase_id, last_score FROM mic_scores WHERE user_id = ?',
      uid,
    ),
    q<{ item_id: string; choice_idx: number }>(
      db,
      'SELECT item_id, choice_idx FROM exercise_answers WHERE user_id = ?',
      uid,
    ),
    q<{ ebook_num: number }>(db, 'SELECT ebook_num FROM user_ebooks WHERE user_id = ?', uid),
    q<{ question_id: string; ebook_num: number; choice_idx: number | null; text_value: string | null }>(
      db,
      `SELECT a.question_id, q.ebook_num, a.choice_idx, a.text_value FROM ebook_test_answers a
       JOIN ebook_test_questions q ON q.id = a.question_id WHERE a.user_id = ?`,
      uid,
    ),
    q<{ ebook_num: number; score: number; passed: number }>(
      db,
      'SELECT ebook_num, score, passed FROM ebook_test_results WHERE user_id = ?',
      uid,
    ),
    q<{ id: string; en: string; pt: string; scene: string | null; note: string | null; due_at: number; reps: number }>(
      db,
      'SELECT id, en, pt, scene, note, due_at, reps FROM srs_cards WHERE user_id = ? ORDER BY created_at, id',
      uid,
    ),
    q<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM srs_cards WHERE user_id = ? AND due_at <= ?', uid, now),
    q<{ extra_id: string; seen_at: number | null; dub_avg: number | null }>(
      db,
      'SELECT extra_id, seen_at, dub_avg FROM user_extras WHERE user_id = ?',
      uid,
    ),
    q<StatsRow>(
      db,
      'SELECT points, streak, last_day, challenge_best, last_extra_id FROM user_stats WHERE user_id = ?',
      uid,
    ),
    q<DailyRow>(
      db,
      `SELECT local_date, points, steps, cards, extras, mic, maggie_sec, goal_hit, missions FROM daily_stats
       WHERE user_id = ? AND local_date >= ? ORDER BY local_date`,
      uid,
      since,
    ),
    q<{ badge_id: string }>(db, 'SELECT badge_id FROM user_badges WHERE user_id = ? ORDER BY earned_at, badge_id', uid),
    q<{ kind: string; created_at: number; points: number }>(
      db,
      'SELECT kind, created_at, points FROM point_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      uid,
      LIMITS.gameLogMax,
    ),
    q<MicSessionRow>(
      db,
      `SELECT id, assistant_key, mode, mission_key, extra_id, started_at, secs, report, report_source
       FROM mic_sessions WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
      uid,
      LIMITS.micSessionsKept,
    ),
    q<MicTurnRow>(
      db,
      `SELECT t.session_id, t.idx, t.who, t.en, t.pt, t.feedback, t.pron, t.words FROM mic_turns t
       WHERE t.session_id IN (SELECT id FROM mic_sessions WHERE user_id = ?1 ORDER BY started_at DESC, id DESC LIMIT ?2)
       ORDER BY t.session_id, t.idx`,
      uid,
      LIMITS.micSessionsKept,
    ),
    q<{ seconds_used: number }>(
      db,
      'SELECT seconds_used FROM ai_usage_monthly WHERE user_id = ? AND period = ?',
      uid,
      per,
    ),
    flagRowsQuery(db),
    appSettingQuery(db, SETTINGS.contentCurrent),
  ]);

  const user = users[0];
  const profileRow = profiles[0] ?? null;
  const email = user?.email ?? s.email;

  const flagValues = evaluateRows(flags, flagSubject(s), CLIENT_FLAGS);
  const freeOn = flagValues[FLAGS.freeSteps] === true;

  const prog: Record<string, number> = {};
  const epsDone: Record<string, boolean> = {};
  for (const p of progress) {
    prog[String(p.episode_num)] = Math.min(10, Math.max(1, p.furthest_step));
    if (p.done_at != null) epsDone[String(p.episode_num)] = true;
  }

  const stepOk: Record<string, boolean> = {};
  for (const st of steps) stepOk[stepKey(st.episode_num, st.step)] = true;

  const scoreMap: Record<string, number> = {};
  for (const sc of scores) scoreMap[sc.phrase_id] = Math.min(10, Math.max(0, sc.last_score));

  const exAns: Record<string, number> = {};
  for (const a of answers) if (a.choice_idx >= 0) exAns[a.item_id] = a.choice_idx;

  const ebookMap: Record<string, boolean> = {};
  for (const e of ebooks) ebookMap[String(e.ebook_num)] = true;

  const testAns: Record<string, Record<string, TestAnswer>> = {};
  for (const a of testAnswers) {
    const value: TestAnswer | null = a.choice_idx != null && a.choice_idx >= 0 ? a.choice_idx : a.text_value;
    if (value == null) continue;
    const key = String(a.ebook_num);
    testAns[key] ??= {};
    testAns[key][a.question_id] = value;
  }
  const testDone: Record<string, boolean> = {};
  const testScore: Record<string, number> = {};
  for (const r of testResults) {
    testDone[String(r.ebook_num)] = true;
    testScore[String(r.ebook_num)] = Math.max(0, r.score);
  }

  const st = stats[0];
  const seen: Record<string, boolean> = {};
  const dubs: Record<string, number> = {};
  for (const x of extras) {
    if (x.seen_at != null) seen[x.extra_id] = true;
    if (x.dub_avg != null) dubs[x.extra_id] = x.dub_avg;
  }

  const dailyMap: Record<string, DailyStats> = {};
  for (const d of daily) dailyMap[d.local_date] = dailyFromRow(d);

  const log: GameLogEntry[] = ledger
    .slice()
    .reverse()
    .map((l) => ({ k: l.kind, t: l.created_at, p: l.points }));

  const quota = quotaInfo(s.plan, usage[0]?.seconds_used ?? 0, per);
  const contentVersion = settingString(content[0]?.value);

  return {
    v: STATE_VERSION,
    user: { id: uid, email, name: profileRow?.name ?? s.name, fullName: profileRow?.full_name ?? s.fullName },
    profile: profileRow?.onb_completed_at != null ? profileFromRow(profileRow) : null,
    onbStep: Math.min(7, Math.max(1, profileRow?.onb_step ?? 1)),
    draft: draftFromRow(profileRow, email),
    prog,
    ebooks: ebookMap,
    epsDone,
    stepOk,
    scores: scoreMap,
    exAns,
    testAns,
    testDone,
    testScore,
    deck: cards.map((c) => ({
      id: c.id,
      en: c.en,
      pt: c.pt,
      scene: c.scene ?? '',
      note: c.note ?? '',
      at: c.due_at,
      reps: Math.max(0, c.reps),
    })),
    due: due[0]?.n ?? 0,
    extras: { seen, dubs, best: Math.max(0, st?.challenge_best ?? 0), lastId: st?.last_extra_id ?? '' },
    maggie: {
      secLeft: quota.leftS,
      limitSec: quota.limitS,
      sessions: micSessionsFrom(sessions, turns),
    },
    game: {
      points: Math.max(0, st?.points ?? 0),
      streak: displayStreak(st?.streak, st?.last_day, today),
      lastDay: st?.last_day ?? '',
      daily: dailyMap,
      badges: badges.map((b) => b.badge_id),
      log,
    },
    settings: settingsFromRow(settings[0], freeOn && bool(settings[0]?.free)),
    plan: s.plan,
    flags: flagValues,
    contentVersion,
    now,
    tz,
  };
}
