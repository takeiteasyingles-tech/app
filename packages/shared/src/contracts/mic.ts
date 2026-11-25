import { z } from 'zod';
import { LIMITS } from '../constants';
import { Bilingual, MicMode } from '../content/schema';
import { MicSession } from '../state';
import { Feedback, Mood, PronTip, TutorReply } from './ai';
import { IdParams, IdString } from './common';
import { AwardResult } from './game';
import { endpoint } from './http';

/** mgCall. `mission` defaults to the first personalized mission, `extraId` to extras.lastId. */
export const StartSessionBody = z.object({
  assistant: z.string().min(1).max(40),
  mode: MicMode,
  mission: z.string().max(40).optional(),
  extraId: IdString.optional(),
});
export type StartSessionBody = z.infer<typeof StartSessionBody>;

/** ai.opener(): first scripted line, already personalized ({N}, {A}, {oA} replaced). */
export const Opener = z.object({
  reply_en: z.string(),
  reply_pt: z.string(),
  mood: Mood,
  words: z.array(Bilingual),
  hint_en: z.string(),
  hint_pt: z.string(),
});
export type Opener = z.infer<typeof Opener>;

/** quotaLeftS ≤ 0 means the client runs the conversation in demo mode. */
export const StartSessionRes = z.object({ id: z.string(), opener: Opener, quotaLeftS: z.int().min(0) });
export type StartSessionRes = z.infer<typeof StartSessionRes>;

/** Turns produced client-side (demo mode, pronuncia tries without session_id) appended at the end. */
export const ClientTurn = z.object({
  who: z.enum(['me', 'her']),
  en: z.string().min(1).max(LIMITS.tutorTextMax),
  pt: z.string().max(LIMITS.tutorTextMax).optional(),
  fb: Feedback.nullable().optional(),
  pron: z.array(PronTip).max(5).optional(),
  words: z.array(Bilingual).max(10).optional(),
});
export type ClientTurn = z.infer<typeof ClientTurn>;

/**
 * PROD (spec 05 "Mic avatar per assistant"): the session's conversation moves to the assistant's
 * ElevenLabs agent. The server reserves up to `maxSecs` of the month's quota and answers a one-time
 * signed URL (wss, valid for a few minutes) plus the agent's dynamic variables; the agent id and its
 * prompt never reach the client. The URL's conversation id stays on the reservation, which /end (and
 * the daily cron) settle with the length ElevenLabs measured.
 */
export const AgentStartRes = z.object({
  signedUrl: z.string().url(),
  dynamicVariables: z.record(z.string(), z.string()),
  /** The client hangs up at this point (the reservation is this long). */
  maxSecs: z.int().positive(),
  quotaLeftS: z.int().min(0),
});
export type AgentStartRes = z.infer<typeof AgentStartRes>;

/**
 * finish(): the server computes secs from its clock, bills the remainder, keeps the newest
 * LIMITS.micSessionsKept sessions and awards maggie_session when the user spoke 2+ times.
 */
export const EndSessionBody = z.object({ turns: z.array(ClientTurn).max(LIMITS.micEndTurnsMax).optional() });
export type EndSessionBody = z.infer<typeof EndSessionBody>;

export const EndSessionRes = z.object({
  session: MicSession,
  secLeft: z.int().min(0),
  award: AwardResult.nullable(),
});
export type EndSessionRes = z.infer<typeof EndSessionRes>;

/**
 * What POST /api/tutor actually returns: the TutorReply contract plus the maggie_turn award of
 * this turn (null when capped, replayed or not awarded). Parse with this to read the award;
 * TutorReply alone strips it. Lives here, not in ai.ts, to keep ai.ts free of the game import.
 */
export const TutorTurnRes = TutorReply.extend({ award: AwardResult.nullable().optional() });
export type TutorTurnRes = z.infer<typeof TutorTurnRes>;

export const SessionsRes = z.object({ sessions: z.array(MicSession) });
export type SessionsRes = z.infer<typeof SessionsRes>;

export const SessionRes = z.object({ session: MicSession });
export type SessionRes = z.infer<typeof SessionRes>;

export const micApi = {
  start: endpoint({
    method: 'POST',
    path: '/api/mic/sessions',
    access: 'user',
    body: StartSessionBody,
    res: StartSessionRes,
    rateLimit: 'RL_AI',
    quota: true,
  }),
  agent: endpoint({
    method: 'POST',
    path: '/api/mic/sessions/:id/agent',
    access: 'owner',
    params: IdParams,
    res: AgentStartRes,
    rateLimit: 'RL_AI',
    quota: true,
  }),
  end: endpoint({
    method: 'POST',
    path: '/api/mic/sessions/:id/end',
    access: 'owner',
    params: IdParams,
    body: EndSessionBody,
    res: EndSessionRes,
    rateLimit: 'RL_API',
  }),
  list: endpoint({ method: 'GET', path: '/api/mic/sessions', access: 'user', res: SessionsRes }),
  get: endpoint({ method: 'GET', path: '/api/mic/sessions/:id', access: 'owner', params: IdParams, res: SessionRes }),
} as const;
