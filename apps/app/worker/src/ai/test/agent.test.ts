// PROD (spec 05 "Mic avatar per assistant"): Mic conversations held by an ElevenLabs agent. The agent
// route reserves quota and hands out a signed URL whose conversation id stays on the reservation; /end
// and the daily reconcile bill what ElevenLabs measured. ElevenLabs is a mocked fetch.
import { env as baseEnv } from 'cloudflare:workers';
import { AgentStartRes, EndSessionRes, ErrorEnvelope, ReportResult } from '@tie/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MAX_SECS,
  AGENT_OPEN_MS,
  agentFor,
  agentModel,
  conversationIdOf,
  parseAgentModel,
  reconcileAgentUsage,
} from '../agentUsage';
import { type Caller, call, first, resetDb, rows, startSession, testEnv } from './harness';

const AGENT = 'agent_0test1tie2margaret3agent4id';
const CONV = 'conv_0test1tie2conversation3id';
const SIGNED = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT}&conversation_signature=cvtkn_x&conversation_id=${CONV}`;

let u1: Caller;
let u2: Caller;

/** ElevenLabs as these tests need it: the signed URL and one conversation's record. */
interface Fake {
  signed: () => Response;
  conversation: () => Response;
  calls: string[];
}
let fake: Fake;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ({ u1, u2 } = await resetDb());
  await baseEnv.DB.prepare('UPDATE assistants SET avatar = ? WHERE key = ?')
    .bind(JSON.stringify({ kind: 'elevenlabs', agentId: AGENT, modes: ['livre', 'extra'] }), 'margaret')
    .run();
  fake = {
    signed: () => Response.json({ signed_url: SIGNED }),
    conversation: () =>
      Response.json({
        agent_id: AGENT,
        conversation_id: CONV,
        status: 'done',
        metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 95 },
      }),
    calls: [],
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.elevenlabs.io/')) return realFetch(input, init);
    fake.calls.push(url);
    if (url.includes('/convai/conversation/get-signed-url')) return fake.signed();
    if (url.includes('/convai/conversations/')) return fake.conversation();
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = (over: Parameters<typeof testEnv>[0] = {}) => testEnv({ ELEVENLABS_API_KEY: 'test-key', ...over });
const code = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
const startAgent = (id: string, e = env()) => call(e, 'POST', `/api/mic/sessions/${id}/agent`, { who: u1 });
const used = async () =>
  (await first<{ s: number }>('SELECT SUM(seconds_used) AS s FROM ai_usage_monthly WHERE user_id = ?', 'U1'))?.s ?? 0;
const agentEvent = () =>
  first<{ id: number; seconds: number; model: string; ok: number }>(
    "SELECT id, seconds, model, ok FROM ai_usage_events WHERE user_id = 'U1' AND kind = 'agent' ORDER BY id DESC LIMIT 1",
  );

describe('agent helpers', () => {
  it('reads the agent of a mode from the avatar JSON only', () => {
    const json = JSON.stringify({ kind: 'elevenlabs', agentId: AGENT, modes: ['livre'] });
    expect(agentFor(json, 'livre')).toEqual({ agentId: AGENT });
    expect(agentFor(json, 'missao')).toBeNull();
    expect(agentFor(JSON.stringify({ kind: 'assistia', slug: 'marguert' }), 'livre')).toBeNull();
    expect(agentFor('{"kind":"elevenlabs","agentId":"nope","modes":["livre"]}', 'livre')).toBeNull();
    expect(agentFor('not json', 'livre')).toBeNull();
    expect(agentFor(null, 'livre')).toBeNull();
  });

  it('takes the conversation id from the signed URL and round-trips the reservation model', () => {
    expect(conversationIdOf(SIGNED)).toBe(CONV);
    expect(conversationIdOf('wss://api.elevenlabs.io/v1/convai/conversation?agent_id=x')).toBeNull();
    expect(parseAgentModel(agentModel(AGENT, CONV))).toEqual({ agentId: AGENT, conversationId: CONV, final: false });
    expect(parseAgentModel(agentModel(AGENT, CONV, true))?.final).toBe(true);
    expect(parseAgentModel(AGENT)).toBeNull();
  });
});

describe('POST /api/mic/sessions/:id/agent', () => {
  it('reserves the quota and answers a signed URL with the learner variables, not the agent id', async () => {
    const id = await startSession(env(), u1);
    const res = await startAgent(id);
    expect(res.status).toBe(200);
    const body = AgentStartRes.parse(await res.json());
    expect(body.signedUrl).toBe(SIGNED);
    expect(body.dynamicVariables).toEqual({ student_name: 'Ana', student_level: 'A1' });
    expect(body.maxSecs).toBe(AGENT_MAX_SECS);
    expect(body.quotaLeftS).toBe(3600 - AGENT_MAX_SECS);
    expect(fake.calls[0]).toContain(`agent_id=${AGENT}`);
    expect(fake.calls[0]).toContain('include_conversation_id=true');
    expect(await agentEvent()).toMatchObject({ seconds: AGENT_MAX_SECS, model: agentModel(AGENT, CONV) });
    expect(await used()).toBe(AGENT_MAX_SECS);
    // The agent greets with its own first message: the scripted opener left the transcript.
    expect(await rows('SELECT idx FROM mic_turns WHERE session_id = ?', id)).toEqual([]);
  });

  it('reserves only what is left of the month', async () => {
    ({ u1, u2 } = await resetDb({ aiMinutes: 2 }));
    await baseEnv.DB.prepare('UPDATE assistants SET avatar = ? WHERE key = ?')
      .bind(JSON.stringify({ kind: 'elevenlabs', agentId: AGENT, modes: ['livre'] }), 'margaret')
      .run();
    const id = await startSession(env(), u1);
    const body = AgentStartRes.parse(await (await startAgent(id)).json());
    expect(body.maxSecs).toBe(120);
    expect(body.quotaLeftS).toBe(0);
  });

  it('answers 404 for a mode or an assistant without an agent, 409 for a second start', async () => {
    const missao = await startSession(env(), u1, { mode: 'missao' });
    expect(await code(await startAgent(missao))).toBe('not_found');
    const robert = await startSession(env(), u1, { assistant: 'robert' });
    expect(await code(await startAgent(robert))).toBe('not_found');
    const id = await startSession(env(), u1);
    expect((await startAgent(id)).status).toBe(200);
    expect(await code(await startAgent(id))).toBe('conflict');
    expect(await used()).toBe(AGENT_MAX_SECS);
  });

  it('gives the reservation back when ElevenLabs refuses the signed URL', async () => {
    fake.signed = () => new Response('{"detail":"invalid_api_key"}', { status: 401 });
    const id = await startSession(env(), u1);
    expect(await code(await startAgent(id))).toBe('ai_unavailable');
    expect(await used()).toBe(0);
    // Nothing billed, so the same session may try again.
    fake.signed = () => Response.json({ signed_url: SIGNED });
    expect((await startAgent(id)).status).toBe(200);
  });

  it('refuses a signed URL that points anywhere but ElevenLabs', async () => {
    fake.signed = () =>
      Response.json({ signed_url: 'wss://evil.example.com/v1/convai/conversation?conversation_id=x' });
    const id = await startSession(env(), u1);
    expect(await code(await startAgent(id))).toBe('ai_unavailable');
    expect(await used()).toBe(0);
  });

  it('needs the AI on, an ElevenLabs key and quota left', async () => {
    const id = await startSession(env(), u1);
    expect(await code(await startAgent(id, testEnv()))).toBe('ai_unavailable');
    await baseEnv.DB.prepare("UPDATE plans SET ai_minutes_month = 0 WHERE id = 'P0'").run();
    expect(await code(await startAgent(id))).toBe('quota_exceeded');
    expect(fake.calls).toEqual([]);
  });

  it('is the owner’s only: someone else’s session answers 404 and reserves nothing', async () => {
    const id = await startSession(env(), u1);
    const res = await call(env(), 'POST', `/api/mic/sessions/${id}/agent`, { who: u2 });
    expect(await code(res)).toBe('not_found');
    expect(fake.calls).toEqual([]);
  });
});

describe('/end with an agent conversation', () => {
  const end = (id: string, turns: unknown[] = []) =>
    call(env(), 'POST', `/api/mic/sessions/${id}/end`, { who: u1, body: { turns } });

  it('bills what ElevenLabs measured and keeps the transcript as client turns', async () => {
    const id = await startSession(env(), u1);
    await startAgent(id);
    const res = await end(id, [
      { who: 'her', en: "Hello! I'm Margaret. What's your name?" },
      { who: 'me', en: 'My name is Ana.' },
    ]);
    expect(res.status).toBe(200);
    const body = EndSessionRes.parse(await res.json());
    expect(body.secLeft).toBe(3600 - 95);
    expect(await used()).toBe(95);
    expect(await agentEvent()).toMatchObject({ seconds: 95, model: agentModel(AGENT, CONV, true) });
    expect(body.session.turns.map((t) => t.who)).toEqual(['her', 'me']);
  });

  it('gives everything back when the call never connected (ElevenLabs has no record)', async () => {
    fake.conversation = () => new Response('{"detail":{"status":"document_not_found"}}', { status: 404 });
    const id = await startSession(env(), u1);
    await startAgent(id);
    await end(id);
    expect(await used()).toBe(0);
    // Still open for the reconcile: the URL could be used until it expires.
    expect(await agentEvent()).toMatchObject({ seconds: 0, model: agentModel(AGENT, CONV) });
  });

  it('keeps the whole reservation while the call is still going on', async () => {
    fake.conversation = () =>
      Response.json({ agent_id: AGENT, status: 'in-progress', metadata: { start_time_unix_secs: 1 } });
    const id = await startSession(env(), u1);
    await startAgent(id);
    await end(id);
    expect(await used()).toBe(AGENT_MAX_SECS);
    expect((await agentEvent())?.model).toBe(agentModel(AGENT, CONV));
  });

  it('earns the AI report: the agent conversation was reserved and billed by the server', async () => {
    const id = await startSession(env(), u1);
    await startAgent(id);
    await end(id, [
      { who: 'her', en: 'Hi Ana! What kind of coffee do you like?' },
      { who: 'me', en: 'I like coffee with milk.' },
    ]);
    const res = await call(env(), 'POST', '/api/report', { who: u1, body: { session_id: id } });
    expect(ReportResult.parse(await res.json()).source).toBe('ia');

    // The same client turns without an agent conversation keep the demo report.
    const plain = await startSession(env(), u1, { assistant: 'robert' });
    await end(plain, [{ who: 'me', en: 'I like coffee with milk.' }]);
    const demo = await call(env(), 'POST', '/api/report', { who: u1, body: { session_id: plain } });
    expect(ReportResult.parse(await demo.json()).source).toBe('demo');
  });

  it('does not settle twice on a replayed /end', async () => {
    const id = await startSession(env(), u1);
    await startAgent(id);
    await end(id);
    fake.conversation = () => Response.json({ agent_id: AGENT, status: 'done', metadata: { call_duration_secs: 30 } });
    await end(id);
    expect(await used()).toBe(95);
  });
});

describe('reconcileAgentUsage (daily cron)', () => {
  const insertEvent = async (seconds: number, model: string, at: number) => {
    await baseEnv.DB.prepare("INSERT OR IGNORE INTO ai_usage_monthly(user_id, period, seconds_used) VALUES('U1', ?, 0)")
      .bind(new Date(at).toISOString().slice(0, 7))
      .run();
    await baseEnv.DB.prepare(
      "UPDATE ai_usage_monthly SET seconds_used = seconds_used + ? WHERE user_id = 'U1' AND period = ?",
    )
      .bind(seconds, new Date(at).toISOString().slice(0, 7))
      .run();
    await baseEnv.DB.prepare(
      `INSERT INTO ai_usage_events(user_id, kind, model, seconds, session_id, ok, latency_ms, created_at)
       VALUES('U1', 'agent', ?, ?, 'S1', 1, NULL, ?)`,
    )
      .bind(model, seconds, at)
      .run();
  };

  it('bills a call that went on after /end, and leaves final and recent reservations alone', async () => {
    const now = Date.now();
    const old = now - AGENT_OPEN_MS - 60_000;
    await insertEvent(0, agentModel(AGENT, CONV), old);
    await insertEvent(40, agentModel(AGENT, 'conv_finalfinalfinal', true), old);
    await insertEvent(600, agentModel(AGENT, 'conv_recentrecentrecent'), now - 60_000);
    fake.conversation = () => Response.json({ agent_id: AGENT, status: 'done', metadata: { call_duration_secs: 200 } });
    expect(await reconcileAgentUsage(env(), now)).toBe(1);
    const models = await rows<{ seconds: number; model: string }>(
      "SELECT seconds, model FROM ai_usage_events WHERE kind = 'agent' ORDER BY id",
    );
    expect(models).toEqual([
      { seconds: 200, model: agentModel(AGENT, CONV, true) },
      { seconds: 40, model: agentModel(AGENT, 'conv_finalfinalfinal', true) },
      { seconds: 600, model: agentModel(AGENT, 'conv_recentrecentrecent') },
    ]);
    expect(fake.calls).toHaveLength(1);
  });

  it('closes a reservation whose URL was never used once it expired', async () => {
    const now = Date.now();
    await insertEvent(0, agentModel(AGENT, CONV), now - AGENT_OPEN_MS - 1);
    fake.conversation = () => new Response('{}', { status: 404 });
    await reconcileAgentUsage(env(), now);
    expect(await agentEvent()).toMatchObject({ seconds: 0, model: agentModel(AGENT, CONV, true) });
  });
});
