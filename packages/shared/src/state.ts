import { z } from 'zod';
import { DEFAULT_TZ, LIMITS } from './constants';
import { Bilingual, MicMode } from './content/schema';
import { Feedback, PronounceIssue, PronTip, ReportResult } from './contracts/ai';
import { IsoDate, TimeHHMM, Timestamp } from './contracts/common';

// TieState v7: the prototype's store.s (tie.v6, see store.fresh()) built by the server for
// GET /api/me/state. Same keys and nesting so screens port mechanically; index-based keys became
// stable ids. Object keys are strings because this travels as JSON (prog["1"], not prog[1]).
//
//   v6                          v7
//   scores['ep-micIdx']     →   scores[phraseId]          ('e1-mic-0')
//   exAns['ep-ex-item']     →   exAns[itemId]             ('e1-ex0-i3')
//   testAns[n]              →   testAns[ebook][questionId] ('eb1-t14')
//   testDone, testScore     →   testDone[ebook], testScore[ebook]
//   deck[i]                 →   deck[i] with id (srs_cards.id)
//   maggie.secLeft          →   from the plan quota; maggie.limitSec added
//   draft.pass              →   removed (never persisted client-side)

export const STATE_VERSION = 7;

export const SessionUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  fullName: z.string(),
});
export type SessionUser = z.infer<typeof SessionUser>;

/** Voice test result from onboarding step 7 (a PronounceResult without source). */
export const VoiceTest = z.object({
  score: z.int().min(0).max(10),
  praise_pt: z.string(),
  issues: z.array(PronounceIssue),
  heard: z.string(),
});
export type VoiceTest = z.infer<typeof VoiceTest>;

const Keys = z.array(z.string().min(1).max(40)).max(20);
const WeekDays = z.array(z.int().min(0).max(6)).max(7);
const Reminders = z.array(TimeHHMM).max(LIMITS.remindersMax);

/**
 * Onboarding profile. Option keys are not validated here (lists live in D1); `genres` keeps the
 * prototype's bare keys, matched against Extras genres.
 */
export const Profile = z.object({
  name: z.string().max(LIMITS.nameMax),
  fullName: z.string().max(LIMITS.fullNameMax),
  birth: z.union([IsoDate, z.literal('')]),
  /** Age band key: '-18', '18-24', … */
  age: z.string().max(10),
  occup: z.string().max(40),
  area: z.string().max(40),
  level: z.string().max(40),
  goals: z.array(z.string().max(40)).max(LIMITS.goalsMax),
  deadline: z.string().max(40),
  history: Keys,
  fails: Keys,
  formats: Keys,
  genres: z.array(z.string().min(1).max(40)).max(60),
  themes: Keys,
  diffs: Keys,
  mainDiff: z.string().max(40),
  styles: Keys,
  company: z.string().max(40),
  feedback: z.string().max(40),
  days: WeekDays,
  minutes: z.int().min(5).max(240),
  reminders: Reminders,
  motives: Keys,
  why: z.string().max(LIMITS.freeTextMax),
  assistant: z.string().max(40),
  avatar: z.int().min(1).max(6),
  /** URL of the uploaded photo (/m/...), visible to its owner even while pending moderation. */
  photo: z.string().nullable(),
  voice: VoiceTest.nullable(),
});
export type Profile = z.infer<typeof Profile>;

/** Onboarding answers before the profile is complete (cadastro screens). */
export const Draft = z.object({
  fullName: z.string(),
  name: z.string(),
  birth: z.string(),
  email: z.string(),
  goals: z.array(z.string()),
  formats: z.array(z.string()),
  genres: z.array(z.string()),
  themes: z.array(z.string()),
  diffs: z.array(z.string()),
  mainDiff: z.string(),
  styles: z.array(z.string()),
  company: z.string(),
  feedback: z.string(),
  days: z.array(z.int().min(0).max(6)),
  minutes: z.int(),
  reminders: z.array(z.string()),
  voice: VoiceTest.nullable(),
});
export type Draft = z.infer<typeof Draft>;

export const TEXT_SIZES = [1, 1.12, 1.25] as const;

export const Settings = z.object({
  ts: z.union([z.literal(1), z.literal(1.12), z.literal(1.25)]),
  sound: z.boolean(),
  hd: z.boolean(),
  trans: z.boolean(),
  slow: z.boolean(),
  remind: z.boolean(),
  /** Dev-only phone layout toggle; client-side, never stored in D1. */
  phone: z.boolean(),
  fx: z.boolean(),
  /** "Etapas livres": true only when the dev.free_steps flag is on for this user. */
  free: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

export const DeckCard = z.object({
  id: z.string(),
  en: z.string(),
  pt: z.string(),
  /** Where the card came from, e.g. "Ep. 1 · Take a Look", "Mic · Maggie". */
  scene: z.string(),
  note: z.string(),
  /** Due time (srs_cards.due_at). */
  at: Timestamp,
  reps: z.int().min(0),
});
export type DeckCard = z.infer<typeof DeckCard>;

export const ExtrasState = z.object({
  seen: z.record(z.string(), z.boolean()),
  /** Running dub average per extra id (0..10). */
  dubs: z.record(z.string(), z.number()),
  /** Desafio record. */
  best: z.int().min(0),
  lastId: z.string(),
});
export type ExtrasState = z.infer<typeof ExtrasState>;

export const MicTurn = z.object({
  who: z.enum(['me', 'her']),
  en: z.string(),
  pt: z.string(),
  fb: Feedback.nullable(),
  pron: z.array(PronTip),
  words: z.array(Bilingual),
});
export type MicTurn = z.infer<typeof MicTurn>;

export const MicSession = z.object({
  id: z.string(),
  /** Start time. */
  at: Timestamp,
  assistant: z.string(),
  mode: MicMode,
  mission: z.string().nullable(),
  extraId: z.string().nullable(),
  secs: z.int().min(0),
  turns: z.array(MicTurn),
  report: ReportResult.nullable(),
});
export type MicSession = z.infer<typeof MicSession>;

export const MaggieState = z.object({
  /** Seconds left this month = plan limit − used (ai_usage_monthly). */
  secLeft: z.int().min(0),
  limitSec: z.int().min(0),
  /** Newest first, at most LIMITS.micSessionsKept. */
  sessions: z.array(MicSession).max(LIMITS.micSessionsKept),
});
export type MaggieState = z.infer<typeof MaggieState>;

export const DailyStats = z.object({
  points: z.int(),
  steps: z.int(),
  cards: z.int(),
  maggieSec: z.int(),
  extras: z.int(),
  mic: z.int(),
  goal: z.boolean(),
  missions: z.record(z.string(), z.boolean()),
});
export type DailyStats = z.infer<typeof DailyStats>;

export const GameLogEntry = z.object({ k: z.string(), t: Timestamp, p: z.int() });
export type GameLogEntry = z.infer<typeof GameLogEntry>;

export const GameState = z.object({
  points: z.int().min(0),
  streak: z.int().min(0),
  /** Local date (user tz) of the last activity, '' when none. */
  lastDay: z.string(),
  /** Keyed by local date YYYY-MM-DD; recent days only. */
  daily: z.record(z.string(), DailyStats),
  badges: z.array(z.string()),
  /** Most recent point_ledger rows, oldest first. */
  log: z.array(GameLogEntry).max(LIMITS.gameLogMax),
});
export type GameState = z.infer<typeof GameState>;

export const PlanInfo = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  aiMinutesMonth: z.int().min(0),
  features: z.record(z.string(), z.unknown()),
});
export type PlanInfo = z.infer<typeof PlanInfo>;

export const QuotaInfo = z.object({
  /** YYYY-MM in the user's timezone. */
  period: z.string(),
  limitS: z.int().min(0),
  usedS: z.int().min(0),
  leftS: z.int().min(0),
});
export type QuotaInfo = z.infer<typeof QuotaInfo>;

export const TestAnswer = z.union([z.int().min(0), z.string().max(LIMITS.freeTextMax)]);
export type TestAnswer = z.infer<typeof TestAnswer>;

export const TieState = z.object({
  v: z.literal(STATE_VERSION),
  user: SessionUser.nullable(),
  /** null until onboarding is complete (the shell then routes to cadastro/<onbStep>). */
  profile: Profile.nullable(),
  onbStep: z.int().min(1).max(7),
  draft: Draft,
  /** Furthest step reached per episode. */
  prog: z.record(z.string(), z.int().min(1).max(10)),
  ebooks: z.record(z.string(), z.boolean()),
  epsDone: z.record(z.string(), z.boolean()),
  /** Key `${ep}-${step}` (stepKey). */
  stepOk: z.record(z.string(), z.boolean()),
  /** Latest Take the Mic score per phrase id (mic_scores.last_score), as the prototype stores it. */
  scores: z.record(z.string(), z.int().min(0).max(10)),
  /** Chosen option per exercise item id. */
  exAns: z.record(z.string(), z.int().min(0)),
  testAns: z.record(z.string(), z.record(z.string(), TestAnswer)),
  testDone: z.record(z.string(), z.boolean()),
  testScore: z.record(z.string(), z.int().min(0)),
  deck: z.array(DeckCard),
  due: z.int().min(0),
  extras: ExtrasState,
  maggie: MaggieState,
  game: GameState,
  settings: Settings,
  plan: PlanInfo.nullable(),
  /** Client-visible feature flags, already evaluated for this user. */
  flags: z.record(z.string(), z.boolean()),
  contentVersion: z.string().nullable(),
  /** Server clock and the user's timezone, for local-date math on the client. */
  now: Timestamp,
  tz: z.string(),
});
export type TieState = z.infer<typeof TieState>;

export const stepKey = (ep: number, step: number): string => `${ep}-${step}`;

export function emptyDaily(): DailyStats {
  return { points: 0, steps: 0, cards: 0, maggieSec: 0, extras: 0, mic: 0, goal: false, missions: {} };
}

export function freshDraft(): Draft {
  return {
    fullName: '',
    name: '',
    birth: '',
    email: '',
    goals: [],
    formats: [],
    genres: [],
    themes: [],
    diffs: [],
    mainDiff: '',
    styles: [],
    company: 'desafio',
    feedback: 'direto',
    days: [1, 2, 3, 4, 5],
    minutes: 20,
    reminders: ['20:00'],
    voice: null,
  };
}

export function freshSettings(): Settings {
  return { ts: 1, sound: true, hd: false, trans: true, slow: false, remind: true, phone: false, fx: true, free: false };
}

/** Defaults mirroring the prototype's store.fresh(), with the free-steps bypass off. */
export function freshState(now: number = Date.now()): TieState {
  return {
    v: STATE_VERSION,
    user: null,
    profile: null,
    onbStep: 1,
    draft: freshDraft(),
    prog: {},
    ebooks: {},
    epsDone: {},
    stepOk: {},
    scores: {},
    exAns: {},
    testAns: {},
    testDone: {},
    testScore: {},
    deck: [],
    due: 0,
    extras: { seen: {}, dubs: {}, best: 0, lastId: '' },
    maggie: { secLeft: 60 * 60, limitSec: 60 * 60, sessions: [] },
    game: { points: 0, streak: 1, lastDay: '', daily: {}, badges: [], log: [] },
    settings: freshSettings(),
    plan: null,
    flags: {},
    contentVersion: null,
    now,
    tz: DEFAULT_TZ,
  };
}

/** Keys cleared by "Zerar progresso" (store.resetProgress); account, profile and settings stay. */
export const PROGRESS_KEYS = [
  'prog',
  'ebooks',
  'epsDone',
  'stepOk',
  'scores',
  'exAns',
  'testAns',
  'testDone',
  'testScore',
  'deck',
  'due',
  'extras',
  'maggie',
  'game',
] as const satisfies readonly (keyof TieState)[];
