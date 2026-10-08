import { z } from 'zod';
import { LIMITS } from '../constants';
import { Bilingual } from '../content/schema';
import { IdString } from './common';
import { endpoint } from './http';

// Client-facing AI contract, identical to the prototype's js/core/ai.js. In production the server
// builds persona, context, history and script itself; the client only sends the session, text and turn.

export const AiSource = z.enum(['ia', 'demo']);
export type AiSource = z.infer<typeof AiSource>;

export const FeedbackStatus = z.enum(['certo', 'ajuste', 'natural']);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export const Feedback = z.object({
  status: FeedbackStatus,
  original: z.string(),
  corrected: z.string(),
  explain_pt: z.string(),
  cat: z.string(),
  tip_pt: z.string().optional(),
});
export type Feedback = z.infer<typeof Feedback>;

export const PronTip = z.object({ word: z.string(), tip_pt: z.string() });
export type PronTip = z.infer<typeof PronTip>;

/** encouraging → talk-happy, thinking/correcting → talk-soft, anything else → talk. */
export const Mood = z.enum(['happy', 'curious', 'encouraging', 'thinking', 'correcting']);
export type Mood = z.infer<typeof Mood>;

/** The server clamps model output to these lengths before validating it. */
export const AI_LIMITS = {
  pronWatch: 3,
  newWords: 6,
  strengths: 6,
  fixes: 8,
  reportPron: 4,
  reportWords: 8,
  pronounceIssues: 5,
} as const;

export const TutorReply = z.object({
  reply_en: z.string().min(1),
  reply_pt: z.string(),
  feedback: Feedback,
  pron_watch: z.array(PronTip).max(AI_LIMITS.pronWatch),
  new_words: z.array(Bilingual).max(AI_LIMITS.newWords),
  mood: Mood,
  end: z.boolean(),
  hint_en: z.string(),
  hint_pt: z.string(),
  source: AiSource,
});
export type TutorReply = z.infer<typeof TutorReply>;

export const ReportFix = z.object({ said: z.string(), better: z.string(), why_pt: z.string(), cat: z.string() });
export type ReportFix = z.infer<typeof ReportFix>;

export const ReportResult = z.object({
  summary_pt: z.string(),
  strengths: z.array(z.string()).max(AI_LIMITS.strengths),
  fixes: z.array(ReportFix).max(AI_LIMITS.fixes),
  pron: z.array(PronTip).max(AI_LIMITS.reportPron),
  words: z.array(Bilingual).max(AI_LIMITS.reportWords),
  next_goal_pt: z.string(),
  source: AiSource,
});
export type ReportResult = z.infer<typeof ReportResult>;

/** Cuts a report's lists to AI_LIMITS so ReportResult accepts it (AI and demo paths alike). */
export function clampReport<R extends Pick<ReportResult, 'strengths' | 'fixes' | 'pron' | 'words'>>(r: R): R {
  return {
    ...r,
    strengths: r.strengths.slice(0, AI_LIMITS.strengths),
    fixes: r.fixes.slice(0, AI_LIMITS.fixes),
    pron: r.pron.slice(0, AI_LIMITS.reportPron),
    words: r.words.slice(0, AI_LIMITS.reportWords),
  };
}

export const PronounceIssue = z.object({ word: z.string(), issue_pt: z.string().optional(), tip_pt: z.string() });
export type PronounceIssue = z.infer<typeof PronounceIssue>;

/** A score of 8 or more counts as good (mic_good). */
export const PRONOUNCE_GOOD = 8;

export const PronounceResult = z.object({
  score: z.int().min(0).max(10),
  heard: z.string(),
  issues: z.array(PronounceIssue).max(AI_LIMITS.pronounceIssues),
  praise_pt: z.string(),
  source: AiSource,
});
export type PronounceResult = z.infer<typeof PronounceResult>;

export const Health = z.object({ ai: z.boolean(), model: z.string().optional() });
export type Health = z.infer<typeof Health>;

export const TutorBody = z.object({
  session_id: IdString,
  /** Spec 04 §3.1: longer text is cut to LIMITS.tutorTextMax, not rejected (the JSON guard caps the body). */
  text: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, LIMITS.tutorTextMax)),
  turn: z.int().min(0).max(100),
});
export type TutorBody = z.infer<typeof TutorBody>;

export const ReportBody = z.object({ session_id: IdString });
export type ReportBody = z.infer<typeof ReportBody>;

export const PronounceBody = z.object({
  /** Base64 WAV, 16 kHz mono PCM16, ≤15 s, no data: prefix. */
  audio: z.base64().max(LIMITS.pronounceAudioB64Max),
  target: z.string().min(1).max(300),
  /** Links the try to a Mic session (pronuncia mode) so it is billed and stored as a turn. */
  session_id: IdString.optional(),
});
export type PronounceBody = z.infer<typeof PronounceBody>;

export const TtsGender = z.enum(['female', 'male']);
export const TtsBody = z.object({
  text: z.string().min(1).max(LIMITS.ttsTextMax),
  gender: TtsGender,
  /** Speaker name from the allowlist (TTS_SPEAKERS) or an assistant key. */
  voice: z.string().min(1).max(40),
});
export type TtsBody = z.infer<typeof TtsBody>;

export const aiApi = {
  health: endpoint({ method: 'GET', path: '/api/health', access: 'public', res: Health }),
  tutor: endpoint({
    method: 'POST',
    path: '/api/tutor',
    access: 'user',
    body: TutorBody,
    res: TutorReply,
    rateLimit: 'RL_AI',
    quota: true,
  }),
  report: endpoint({
    method: 'POST',
    path: '/api/report',
    access: 'user',
    body: ReportBody,
    res: ReportResult,
    rateLimit: 'RL_AI',
    quota: true,
  }),
  pronounce: endpoint({
    method: 'POST',
    path: '/api/pronounce',
    access: 'user',
    body: PronounceBody,
    res: PronounceResult,
    rateLimit: 'RL_AI',
    quota: true,
  }),
  /** Responds with audio/mpeg bytes. */
  tts: endpoint({
    method: 'POST',
    path: '/api/tts',
    access: 'user',
    body: TtsBody,
    res: 'binary',
    rateLimit: 'RL_AI',
    quota: true,
  }),
} as const;
