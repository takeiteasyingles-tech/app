// The Mic assistant's brain, client side (port of prototipo/js/core/ai.js). The server owns the AI
// (persona, context, history and script are built there) and answers demo itself when the AI is off,
// so the client only sends {session_id, text, turn}. When the server cannot answer at all (network,
// 5xx, 429 rate limit or quota, a session that is gone) the shared demo brain (@tie/shared/demo)
// answers locally, exactly like the prototype without a server: scripted turns, the regex grammar
// checker and word-overlap scoring. `ai.online` drives demoBadge ("IA ligada" / "Modo demo").
import { signal } from '@preact/signals';
import { aiApi, type PronounceResult, type ReportResult, type TtsBody } from '@tie/shared/contracts/ai';
import type { TutorTurnRes } from '@tie/shared/contracts/mic';
import type { DemoSession, ReportTurn, ScriptContent } from '@tie/shared/demo/index';
import { ApiError } from '@tie/shared/errors';
import { call } from '../api';
import { playAward } from '../store/award';
import { catalog, loadCatalog } from '../store/content';

/** /api/health said the AI is on (and no quota_exceeded since). */
export const aiOnline = signal(false);
export const aiModel = signal('');

/** TIE.ai: `ai.online.value`, `ai.model.value`. */
export const ai = { online: aiOnline, model: aiModel } as const;

/** The demo brain is only downloaded when a fallback actually happens. */
const demo = () => import('@tie/shared/demo/index');

/** TIE.ai.init(): GET /api/health; any failure keeps demo mode. */
export async function health(): Promise<boolean> {
  try {
    const h = await call(aiApi.health);
    aiOnline.value = h.ai;
    aiModel.value = h.model ?? '';
  } catch {
    aiOnline.value = false;
  }
  return aiOnline.value;
}

/** A 429 quota_exceeded means the month's AI minutes are gone: the rest runs in demo mode. */
function noteFailure(err: unknown, what: string): void {
  if (err instanceof ApiError && err.code === 'quota_exceeded') aiOnline.value = false;
  console.warn(`[TIE] /api/${what} falhou, usando o modo demo:`, err instanceof Error ? err.message : err);
}

/** Script content for the demo brain (catalog Mic scripts + Extras titles). */
async function scriptContent(): Promise<ScriptContent> {
  const c = catalog.value ?? (await loadCatalog());
  return { mic: c.mic, extras: c.extras };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The prototype's demo pause before a scripted reply (700–1200 ms). */
const demoPause = () => 700 + Math.random() * 500;

export interface TutorSession extends DemoSession {
  /** Server session id (POST /api/mic/sessions); null runs the conversation locally. */
  id: string | null;
}

/** A tutor reply; `local` when the client's demo brain produced it (send it as a turn at /end). */
export type TutorOutcome = TutorTurnRes & { local: boolean };

/**
 * ai.tutor(sess, text): the reply to the learner's line. A server reply plays its maggie_turn award
 * (+5 pontos, 20 s toward the Mic mission). Demo replies keep the prototype's pause.
 */
export async function tutor(sess: TutorSession, text: string): Promise<TutorOutcome> {
  const t0 = Date.now();
  if (sess.id) {
    try {
      const r = (await call(aiApi.tutor, { body: { session_id: sess.id, text, turn: sess.turn } })) as TutorTurnRes;
      if (r?.reply_en) {
        const fb = r.feedback ?? { status: 'certo', original: text, corrected: '', explain_pt: '', cat: '' };
        if (!fb.original) fb.original = text;
        const out: TutorOutcome = {
          ...r,
          pron_watch: r.pron_watch ?? [],
          new_words: r.new_words ?? [],
          feedback: fb,
          local: false,
        };
        if (out.source === 'demo') await sleep(Math.max(0, demoPause() - (Date.now() - t0)));
        playAward(r.award, { sec: 20 });
        return out;
      }
    } catch (err) {
      noteFailure(err, 'tutor');
    }
  }
  const [d, content] = await Promise.all([demo(), scriptContent()]);
  await sleep(Math.max(0, demoPause() - (Date.now() - t0)));
  return { ...d.demoReply(sess, text, content), award: null, local: true };
}

export interface ReportSession {
  /** Ended server session; null builds the report locally. */
  id: string | null;
  turns: readonly ReportTurn[];
  /** "a Maggie" / "o Robert". */
  aThe?: string | null;
}

/** ai.report(sess): the end-of-conversation report (stored by the server once written). */
export async function report(sess: ReportSession): Promise<ReportResult> {
  if (sess.id) {
    try {
      const r = await call(aiApi.report, { body: { session_id: sess.id } });
      if (r?.summary_pt) return r;
    } catch (err) {
      noteFailure(err, 'report');
    }
  }
  const d = await demo();
  return d.demoReport({ turns: sess.turns, aThe: sess.aThe ?? null });
}

export interface PronounceOptions {
  /** What the browser recognizer heard (scores the demo fallback). */
  heard?: string;
  /** Mic phrase id or `${extraId}:${line}`: the server signs an `attempt` token for it. */
  phraseId?: string;
  /** Pronúncia-mode Mic session the try belongs to (stored as a turn, billed by audio). */
  sessionId?: string;
}

/**
 * ai.pronounce(b64, target, heard): AI scoring when online and there is audio (with the signed
 * `attempt` token when a phraseId is given), else the demo word-overlap score.
 */
export async function pronounce(b64: string, target: string, opts: PronounceOptions = {}): Promise<PronounceResult> {
  if (aiOnline.value && b64) {
    try {
      const r = await call(aiApi.pronounce, {
        body: {
          audio: b64,
          target,
          ...(opts.phraseId ? { phraseId: opts.phraseId } : {}),
          ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
        },
      });
      if (r && typeof r.score === 'number') return r;
    } catch (err) {
      noteFailure(err, 'pronounce');
    }
  }
  const d = await demo();
  return d.demoPronounce(target, opts.heard);
}

/** ai.tts(text, gender, voice): HD voice bytes (mp3), or null so speech falls back to browser TTS. */
export async function tts(text: string, gender: TtsBody['gender'], voice: string): Promise<ArrayBuffer | null> {
  try {
    return await call(aiApi.tts, { body: { text: text.slice(0, 400), gender, voice } });
  } catch (err) {
    noteFailure(err, 'tts');
    return null;
  }
}

/** ai.hint(line): the Dica for an assistant line (lazy: the demo tables load on first use). */
export async function hint(line: string): Promise<{ en: string; pt: string }> {
  const d = await demo();
  const [en, pt] = d.hintFor(line);
  return { en, pt };
}
