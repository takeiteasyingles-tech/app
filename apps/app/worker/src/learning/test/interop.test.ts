// S7 → S2 interop, by behaviour: the REAL POST /api/pronounce route (routes/ai.ts) scores a mic
// phrase and signs its attempt token, and the REAL POST /api/progress/mic route (routes/progress.ts)
// must accept that token. If the two slices ever drift to different token formats or secrets, this
// fails. Only env.AI (ASR) and the award/SRS services are faked; D1 runs the real migrations.
import { FLAGS, MicScoreRes, PronounceResult } from '@tie/shared';
import {
  type AppEnv,
  invalidateFlags,
  onError,
  quotaServiceStub,
  type Services,
  type SessionInfo,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeWav } from '../../ai/wav';
import aiRoutes from '../../routes/ai';
import progressRoutes from '../../routes/progress';
import { OTHER, SECRET, setProg, USER, type World, world } from './helpers/fixtures';

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const limiter = { limit: async () => ({ success: true }) };

function session(userId: string): SessionInfo {
  const now = Date.now();
  return {
    tokenHash: `t-${userId}`,
    audience: 'app',
    userId,
    email: `${userId}@x.test`,
    name: userId,
    fullName: userId,
    tz: 'America/Sao_Paulo',
    roles: [],
    plan: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 3_600_000,
  };
}

interface Harness {
  call(userId: string, path: string, body: unknown): Promise<Response>;
}

function harness(w: World, heard: () => string): Harness {
  const ai = {
    run: async (_model: string, inputs: Record<string, unknown>) =>
      'audio' in inputs ? { text: heard() } : { response: { safe: true } },
  };
  const env = {
    DB: w.db.asD1(),
    MEDIA_TOKEN_KEY: SECRET,
    AI: ai,
    RL_AI: limiter,
    RL_API: limiter,
    APP_ORIGIN: 'http://localhost:5199',
  };
  // quota: the stub, so /api/pronounce uses S7's own D1 quota service (quotaOf).
  const services = { award: w.award, srs: w.srs, content: undefined, quota: quotaServiceStub } as unknown as Services;
  return {
    call(userId, path, body) {
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('services', services);
        c.set('session', session(userId));
        await next();
      });
      app.route('/', aiRoutes);
      app.route('/', progressRoutes);
      app.onError(onError);
      return Promise.resolve(
        app.request(
          path,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
          env,
        ),
      );
    },
  };
}

describe('POST /api/pronounce token → POST /api/progress/mic (real routes)', () => {
  let w: World;
  let heard: string;
  let h: Harness;
  const audio = toB64(makeWav(16_000));

  beforeEach(() => {
    w = world();
    setProg(w, 1, 6);
    setProg(w, 1, 6, false, OTHER);
    w.db.exec(`INSERT INTO feature_flags(key, enabled, rollout_pct, updated_at) VALUES(?, 1, 100, 1)`, FLAGS.aiEnabled);
    w.db.exec(
      `INSERT INTO plans(id, slug, name, ai_minutes_month, is_default, created_at, updated_at)
       VALUES('p_free', 'free', 'Free', 60, 1, 1, 1)`,
    );
    invalidateFlags();
    heard = "Hi, I'm Ana.";
    h = harness(w, () => heard);
  });

  async function pronounce(userId: string, phraseId: string): Promise<PronounceResult> {
    // The client's target is ignored for a phraseId: the server scores its own text for the phrase.
    const res = await h.call(userId, '/api/pronounce', { audio, target: 'anything', phraseId });
    expect(res.status).toBe(200);
    return PronounceResult.parse(await res.json());
  }

  it("a mic phrase scored by the AI is accepted as 'ia' and earns mic_good", async () => {
    const scored = await pronounce(USER, 'e1-mic-0');
    expect(scored).toMatchObject({ score: 10, source: 'ia' });
    expect(scored.attempt).toBeTruthy();

    const res = await h.call(USER, '/api/progress/mic', {
      phraseId: 'e1-mic-0',
      score: 0, // the token's score wins over the body's
      source: 'ia',
      attempt: scored.attempt,
    });
    expect(res.status).toBe(200);
    const body = MicScoreRes.parse(await res.json());
    expect(body).toMatchObject({ phraseId: 'e1-mic-0', last: 10, best: 10, attempts: 1 });
    expect(body.award).toMatchObject({ kind: 'mic_good', awarded: true });
    expect(w.award.awardedKeys()).toEqual(['mic_good:e1-mic-0']);
  });

  it('a low AI score is stored as is and awards mic_try only', async () => {
    heard = 'yes';
    const scored = await pronounce(USER, 'e1-mic-1');
    expect(scored.score).toBeLessThan(8);
    const res = await h.call(USER, '/api/progress/mic', {
      phraseId: 'e1-mic-1',
      score: 10,
      source: 'ia',
      attempt: scored.attempt,
    });
    const body = MicScoreRes.parse(await res.json());
    expect(body).toMatchObject({ last: scored.score, best: scored.score });
    expect(body.award?.kind).toBe('mic_try');
  });

  it('the token is bound to the phrase and the user it was signed for', async () => {
    const scored = await pronounce(USER, 'e1-mic-0');
    const otherPhrase = await h.call(USER, '/api/progress/mic', {
      phraseId: 'e1-mic-1',
      score: 10,
      source: 'ia',
      attempt: scored.attempt,
    });
    expect(otherPhrase.status).toBe(400);
    expect(((await otherPhrase.json()) as { error: { code: string } }).error.code).toBe('token_invalid');
    const otherUser = await h.call(OTHER, '/api/progress/mic', {
      phraseId: 'e1-mic-0',
      score: 10,
      source: 'ia',
      attempt: scored.attempt,
    });
    expect(((await otherUser.json()) as { error: { code: string } }).error.code).toBe('token_invalid');
    expect(w.db.rows('SELECT * FROM mic_scores')).toEqual([]);
  });

  it('replaying the same /api/progress/mic request counts the attempt once', async () => {
    const scored = await pronounce(USER, 'e1-mic-0');
    const req = { phraseId: 'e1-mic-0', score: 10, source: 'ia', attempt: scored.attempt };
    await h.call(USER, '/api/progress/mic', req);
    const replay = MicScoreRes.parse(await (await h.call(USER, '/api/progress/mic', req)).json());
    expect(replay).toMatchObject({ last: 10, best: 10, attempts: 1 });
  });
});
