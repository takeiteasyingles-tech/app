// PROD (spec 05 "Mic avatar per assistant"): Mic conversations held by an assistant's ElevenLabs agent.
// The agent id lives in assistants.avatar (admin) and never reaches the client. Starting one reserves up
// to AGENT_MAX_SECS of the month's quota and asks ElevenLabs for a one-time signed URL that carries the
// conversation id; the server keeps that id on the reservation (ai_usage_events.model "agent/conv").
// What a conversation really lasted is ElevenLabs' answer, never the client's: /end bills it, and the
// daily cron reconciles the reservations still open (a call going on at /end, a URL used after /end,
// ElevenLabs unreachable at the time).
import { MicAvatar, type MicMode } from '@tie/shared';
import { all, ElevenError, type Env, elevenGetConversation, one, readElevenConfig } from '@tie/worker-core';
import { type AiQuotaService, createQuotaService } from './quota';

/** Longest conversation one start reserves; the client hangs up there (the agent's own cap also applies). */
export const AGENT_MAX_SECS = 600;
/** A conversation longer than this is billed as this long (a client that ignored the hang-up). */
const AGENT_BILL_CAP_S = 3600;
/** A signed URL stays usable for 15 minutes, then the call may run AGENT_MAX_SECS: after that, final. */
export const AGENT_OPEN_MS = 15 * 60_000 + AGENT_MAX_SECS * 1000;
/** ElevenLabs closes a call's record a moment after the hang-up: /end looks once more after this. */
const RETRY_MS = 1500;
const DAY_MS = 86_400_000;
/** The daily reconcile looks this far back, at most RECONCILE_MAX reservations per run. */
const RECONCILE_DAYS = 3;
const RECONCILE_MAX = 200;

const CONV_RE = /^conv_[A-Za-z0-9]{8,60}$/;

/** The assistant's agent for this Mic mode, from the assistants row's avatar JSON. */
export function agentFor(avatarJson: string | null | undefined, mode: MicMode): { agentId: string } | null {
  if (!avatarJson) return null;
  try {
    const p = MicAvatar.safeParse(JSON.parse(avatarJson));
    if (!p.success || p.data.kind !== 'elevenlabs') return null;
    return (p.data.modes as readonly string[]).includes(mode) ? { agentId: p.data.agentId } : null;
  } catch {
    return null;
  }
}

/** The conversation id ElevenLabs put in a signed URL (requested with include_conversation_id). */
export function conversationIdOf(signedUrl: string): string | null {
  try {
    const id = new URL(signedUrl).searchParams.get('conversation_id');
    return id && CONV_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** ai_usage_events.model of an agent reservation: "agent_…/conv_…", plus "/final" once settled for good. */
export function agentModel(agentId: string, conversationId: string, final = false): string {
  return `${agentId}/${conversationId}${final ? '/final' : ''}`;
}

export function parseAgentModel(
  model: string | null | undefined,
): { agentId: string; conversationId: string; final: boolean } | null {
  const m = /^(agent_[A-Za-z0-9]+)\/(conv_[A-Za-z0-9]+)(\/final)?$/.exec(model ?? '');
  return m ? { agentId: m[1] as string, conversationId: m[2] as string, final: !!m[3] } : null;
}

/**
 * What a conversation cost, as ElevenLabs reports it: its length once the call is over, 0 when it never
 * connected (a pre-allocated id has no record until the socket opens), null while it may still be going
 * on or when ElevenLabs cannot tell.
 */
export async function conversationSeconds(
  apiKey: string,
  agentId: string,
  conversationId: string,
): Promise<number | null> {
  try {
    const conv = await elevenGetConversation(apiKey, conversationId);
    if (conv.agentId && conv.agentId !== agentId) return null;
    if (conv.status === 'in-progress' || conv.status === 'initiated' || conv.durationS === null) return null;
    return Math.min(AGENT_BILL_CAP_S, Math.ceil(conv.durationS));
  } catch (err) {
    if (err instanceof ElevenError && err.status === 404) return 0;
    return null;
  }
}

interface AgentEvent {
  id: number;
  user_id: string;
  seconds: number;
  created_at: number;
  model: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One reservation against ElevenLabs: bills what the call lasted. A call that never connected gives
 * everything back, but stays open for the reconcile until its URL can no longer be used.
 */
async function settleOne(
  env: Pick<Env, 'DB' | 'MEDIA_TOKEN_KEY' | 'ELEVENLABS_API_KEY' | 'ELEVENLABS_VOICES' | 'ELEVENLABS_MODEL'>,
  quota: AiQuotaService,
  ev: AgentEvent,
  now: number,
  retry: boolean,
): Promise<boolean> {
  const ref = parseAgentModel(ev.model);
  if (!ref || ref.final) return false;
  const cfg = await readElevenConfig(env.DB, env);
  if (!cfg.apiKey) return false;
  let secs = await conversationSeconds(cfg.apiKey, ref.agentId, ref.conversationId);
  if (secs === null && retry) {
    await sleep(RETRY_MS);
    secs = await conversationSeconds(cfg.apiKey, ref.agentId, ref.conversationId);
  }
  if (secs === null) return false;
  const final = secs > 0 || now - ev.created_at >= AGENT_OPEN_MS;
  await quota.settle(ev.user_id, ev.id, secs, {
    ok: true,
    model: agentModel(ref.agentId, ref.conversationId, final),
  });
  return true;
}

/** /end: settles the session's agent reservation, if it had one. */
export async function settleAgentSession(
  env: Pick<Env, 'DB' | 'MEDIA_TOKEN_KEY' | 'ELEVENLABS_API_KEY' | 'ELEVENLABS_VOICES' | 'ELEVENLABS_MODEL'>,
  quota: AiQuotaService,
  userId: string,
  sessionId: string,
  now: number = Date.now(),
): Promise<void> {
  const ev = await one<AgentEvent>(
    env.DB,
    `SELECT id, user_id, seconds, created_at, model FROM ai_usage_events
     WHERE session_id = ? AND user_id = ? AND kind = 'agent' AND model LIKE 'agent\\_%/conv\\_%' ESCAPE '\\'
     ORDER BY id DESC LIMIT 1`,
    sessionId,
    userId,
  );
  if (ev) await settleOne(env, quota, ev, now, true);
}

/** Did this session's conversation run on an ElevenLabs agent (a reservation with a conversation id)? */
export async function hadAgentConversation(db: D1Database, sessionId: string, userId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ai_usage_events
     WHERE session_id = ? AND user_id = ? AND kind = 'agent' AND model LIKE 'agent\\_%/conv\\_%' ESCAPE '\\'`,
    sessionId,
    userId,
  );
  return (row?.n ?? 0) > 0;
}

/** Daily cron: settles the agent reservations of the last days that are still open. */
export async function reconcileAgentUsage(env: Env, now: number = Date.now()): Promise<number> {
  const rows = await all<AgentEvent>(
    env.DB,
    `SELECT id, user_id, seconds, created_at, model FROM ai_usage_events
     WHERE kind = 'agent' AND created_at BETWEEN ? AND ?
       AND model LIKE 'agent\\_%/conv\\_%' ESCAPE '\\' AND model NOT LIKE '%/final'
     ORDER BY id LIMIT ?`,
    now - RECONCILE_DAYS * DAY_MS,
    now - AGENT_OPEN_MS,
    RECONCILE_MAX,
  );
  if (!rows.length) return 0;
  const quota = createQuotaService(env);
  let settled = 0;
  for (const ev of rows) if (await settleOne(env, quota, ev, now, false)) settled++;
  console.log(JSON.stringify({ level: 'info', msg: 'agent usage reconcile', open: rows.length, settled }));
  return settled;
}
