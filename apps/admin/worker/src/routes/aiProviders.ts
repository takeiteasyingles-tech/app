// /admin-api/ai-providers (Configurações → App → Provedores de IA, permission settings.manage).
// PROD (spec 05 "Paid AI providers"): the Claude (Anthropic) and OpenAI API keys, sealed in app_settings
// (worker-core secrets.ts) and write-only: responses and the audit log carry only their last 4
// characters. Both Workers use them through worker-core's aiRunner whenever an ai.model.* setting names
// an "anthropic:" or "openai:" model.
import { type AiProviderKey, type AiProviderName, adminApi, SETTINGS } from '@tie/shared';
import {
  type AppEnv,
  aiRunner,
  all,
  listProviderModels,
  ProviderError,
  type Query,
  q,
  readProviderKeys,
  sealSecret,
  secretHint,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditStmt, bodyOf, type Ctx, route } from '../lib/http';

const routes = new Hono<AppEnv>();
const api = adminApi.aiProviders;
const KEY_OF: Record<AiProviderName, string> = {
  anthropic: SETTINGS.aiKeyAnthropic,
  openai: SETTINGS.aiKeyOpenai,
};
const NAME: Record<AiProviderName, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI' };

async function view(c: Ctx): Promise<AiProviderKey[]> {
  const [keys, stamps] = await Promise.all([
    readProviderKeys(c.env),
    all<{ key: string; at: number; by: string | null }>(
      c.env.DB,
      'SELECT key, updated_at AS at, updated_by AS by FROM app_settings WHERE key IN (?, ?)',
      SETTINGS.aiKeyAnthropic,
      SETTINGS.aiKeyOpenai,
    ),
  ]);
  return (['anthropic', 'openai'] as const).map((p) => {
    const key = keys[p];
    const stamp = stamps.find((s) => s.key === KEY_OF[p]);
    return {
      provider: p,
      keySet: !!key,
      keyHint: key ? secretHint(key) : null,
      keySource: keys.source[p],
      updatedAt: stamp?.at ?? null,
      updatedBy: stamp?.by ?? null,
    };
  });
}

route(routes, api.get, async (c) => c.json({ providers: await view(c) }));

route(routes, api.put, async (c) => {
  const body = await bodyOf(c, api.put.body);
  const db = c.env.DB;
  const now = Date.now();
  const userId = actor(c).userId;
  const before = await readProviderKeys(c.env);
  const stmts: Query<unknown>[] = [];
  const diff: Record<string, unknown> = {};
  for (const p of ['anthropic', 'openai'] as const) {
    const next = body[p];
    if (next === undefined) continue;
    const from = before.source[p] === 'settings' && before[p] ? secretHint(before[p] as string) : null;
    if (next === null) {
      stmts.push(q(db, 'DELETE FROM app_settings WHERE key = ?', KEY_OF[p]));
      diff[p] = { from, to: null };
    } else {
      stmts.push(
        q(
          db,
          `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          KEY_OF[p],
          await sealSecret(c.env.MEDIA_TOKEN_KEY, KEY_OF[p], next),
          userId,
          now,
        ),
      );
      diff[p] = { from, to: secretHint(next) };
    }
  }
  if (stmts.length) {
    stmts.push(
      await auditStmt(c, { action: 'ai.providers', targetType: 'app_setting', targetId: 'ai.key', diff }, now),
    );
    await db.batch(stmts.map((s) => s.stmt));
  }
  return c.json({ providers: await view(c) });
});

route(routes, api.test, async (c) => {
  const { provider } = await bodyOf(c, api.test.body);
  const key = (await readProviderKeys(c.env))[provider];
  if (!key) return c.json({ ok: false, models: [], error: `Nenhuma chave da ${NAME[provider]} salva.` });
  try {
    const models = await listProviderModels(provider, key);
    return c.json({ ok: true, models: models.slice(0, 300), error: null });
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : undefined;
    const error =
      status === 401 || status === 403
        ? `A ${NAME[provider]} recusou a chave. Confira se ela está certa e ativa.`
        : status === 429
          ? `A conta da ${NAME[provider]} está sem créditos ou no limite de uso agora.`
          : `Não foi possível falar com a ${NAME[provider]}${status ? ` (erro ${status})` : ''}.`;
    return c.json({ ok: false, models: [], error });
  }
});

// A short Mic-like turn (persona, JSON answer), the same shape the app sends: how long the learner
// would wait for this model. Nothing is stored.
const SPEED_SYSTEM = `You are Maggie, a warm English tutor for Brazilian learners on a voice call.
Reply in 1-2 short, natural English sentences, then translate them to Brazilian Portuguese.
Check the learner's sentence and, if needed, give a short correction explained in Portuguese.`;
const SPEED_SCHEMA = {
  type: 'object',
  properties: {
    reply_en: { type: 'string' },
    reply_pt: { type: 'string' },
    feedback: {
      type: 'object',
      properties: { status: { type: 'string' }, corrected: { type: 'string' }, explain_pt: { type: 'string' } },
      required: ['status', 'corrected', 'explain_pt'],
    },
  },
  required: ['reply_en', 'reply_pt', 'feedback'],
};

route(routes, api.speed, async (c) => {
  const { model } = await bodyOf(c, api.speed.body);
  const t0 = Date.now();
  try {
    const out = await aiRunner(c.env).run(model, {
      messages: [
        { role: 'system', content: SPEED_SYSTEM },
        { role: 'assistant', content: 'What song are you listening to these days?' },
        { role: 'user', content: 'I listening a new song of Coldplay, is very good.' },
      ],
      response_format: { type: 'json_schema', json_schema: SPEED_SCHEMA },
      max_tokens: 700,
      temperature: 0.6,
    });
    const ms = Date.now() - t0;
    const parsed = extractJsonObject(out);
    if (!parsed || typeof parsed.reply_en !== 'string') {
      return c.json({ model, ok: false, ms, error: 'Respondeu, mas fora do formato esperado.' });
    }
    return c.json({ model, ok: true, ms, error: null });
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const error =
      err instanceof ProviderError && /no .* API key/.test(msg)
        ? 'Sem chave salva para este provedor.'
        : `Falhou: ${msg.slice(0, 160)}`;
    return c.json({ model, ok: false, ms, error });
  }
});

/** The JSON object in a model answer ({response: text} or an object). */
function extractJsonObject(out: unknown): Record<string, unknown> | null {
  const r = out && typeof out === 'object' && 'response' in out ? (out as { response: unknown }).response : out;
  if (r && typeof r === 'object') return r as Record<string, unknown>;
  if (typeof r !== 'string') return null;
  const a = r.indexOf('{');
  const b = r.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(r.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default routes;
