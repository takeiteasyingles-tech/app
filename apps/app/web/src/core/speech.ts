// Voice (port of prototipo/js/core/speech.js): speak (free browser voice with a synced mouth, or the
// HD voice from /api/tts when settings.hd is on and the AI is online), listen (Web Speech API, en-US
// with interim results) and record a 16 kHz mono PCM16 WAV for /api/pronounce.

import { DEFAULT_ASSISTANT } from '@tie/shared/constants';
import type { AssistantPublic } from '@tie/shared/content/schema';
import { assistantByName, getAssistant } from '@tie/shared/domain/assist';
import { catalog } from '../store/content';
import { state } from '../store/state';
import { aiOnline, tts } from './aiClient';
import { ac } from './sound';
import { encodeWav16, toBase64, WAV_RATE } from './wav';

// ---------- Web Speech typings (not in lib.dom) ----------

interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { readonly length: number; readonly [i: number]: SRResult };
}
interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SRCtor = new () => SRInstance;

const W = (typeof window === 'undefined' ? {} : window) as Window & {
  SpeechRecognition?: SRCtor;
  webkitSpeechRecognition?: SRCtor;
};
const SR: SRCtor | undefined = W.SpeechRecognition ?? W.webkitSpeechRecognition;
export const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canListen = !!SR;
export const canRecord =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';

/** Series characters with a male voice when they are not Mic assistants. */
const MALE = /^(Lucas|Zach|Rafael|Kenji|Sam|Conductor|Stranger|Robert|Bean)$/i;

let voices: SpeechSynthesisVoice[] = [];
function loadVoices(): void {
  if (hasTTS)
    voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_)US/i.test(v.lang) || /^en$/i.test(v.lang));
}
if (hasTTS) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice(gender: 'male' | 'female'): SpeechSynthesisVoice | null {
  if (!voices.length) loadVoices();
  const prefs =
    gender === 'male'
      ? [
          /Andrew.*Natural|Guy.*Natural|Christopher.*Natural|Brian.*Natural/i,
          /Google US English Male|Guy|Davis|David|Mark|Alex|Fred/i,
        ]
      : [
          /Aria.*Natural|Jenny.*Natural|Ava.*Natural|Emma.*Natural|Michelle.*Natural/i,
          /Google US English|Samantha|Zira|Allison|Victoria/i,
        ];
  for (const re of prefs) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

/** Mouth shapes for the 2D avatar. */
export type Viseme = 'a' | 'o' | 'e' | 'm' | 'rest';

/** Character → mouth shape (speech.js VIS). */
export function VIS(ch: string | undefined): Viseme {
  const c = (ch || '').toLowerCase();
  if (!c) return 'rest';
  if ('aá'.includes(c)) return 'a';
  if ('oóuú'.includes(c)) return 'o';
  if ('eéiíy'.includes(c)) return 'e';
  if ('mbp'.includes(c)) return 'm';
  if (/[a-z]/.test(c)) return 'e';
  return 'rest';
}

interface Job {
  mouth?: ((v: Viseme) => void) | undefined;
  cancelled: boolean;
  timer?: ReturnType<typeof setInterval>;
  raf?: number;
  src?: AudioBufferSourceNode;
  resolve?: () => void;
}

let current: Job | null = null;

/** Stops whatever is speaking (browser or HD voice) and resolves its say(). */
export function stop(): void {
  if (current) {
    const job = current;
    job.cancelled = true;
    clearInterval(job.timer);
    cancelAnimationFrame(job.raf || 0);
    try {
      job.src?.stop();
    } catch {
      // Not started yet.
    }
    job.mouth?.('rest');
    job.resolve?.();
    current = null;
  }
  if (hasTTS) window.speechSynthesis.cancel();
}

export interface SayOptions {
  /** 1 = normal; "Slowly, please." is .7, "Sorry?" .85. */
  rate?: number;
  /** Speaker name: a Mic assistant (its voice profile) or a series character. Default: the chosen assistant. */
  who?: string;
  mouth?: (v: Viseme) => void;
  onStart?: () => void;
}

const assistants = (): readonly AssistantPublic[] => catalog.value?.assistants ?? [];

/** The learner's chosen assistant (TIE.assist.cur()), or null before the catalog loads. */
function currentAssistant(): AssistantPublic | null {
  const list = assistants();
  return list.length ? getAssistant(list, state.value.profile?.assistant || DEFAULT_ASSISTANT) : null;
}

/** speech.say(text, opt): resolves when the line finishes (or is stopped). */
export async function say(text: string, opt: SayOptions = {}): Promise<void> {
  stop();
  const o = { rate: 1, who: currentAssistant()?.name ?? 'Maggie', ...opt };
  const prof = assistantByName(assistants(), o.who);
  const vo = prof ? prof.voice : null;
  const gender: 'male' | 'female' = vo ? vo.gender : MALE.test(o.who) ? 'male' : 'female';
  const job: Job = { mouth: o.mouth, cancelled: false };
  current = job;
  if (state.value.settings.hd && aiOnline.value) {
    try {
      const buf = await tts(text, gender, vo?.tts || (gender === 'male' ? 'orion' : 'asteria'));
      if (job.cancelled) return;
      if (buf) return await playBuffer(buf, job, o);
    } catch {
      // Falls back to the browser voice.
    }
  }
  return new Promise<void>((resolve) => {
    job.resolve = resolve;
    const end = () => {
      if (job.cancelled) return;
      clearInterval(job.timer);
      o.mouth?.('rest');
      if (current === job) current = null;
      resolve();
    };
    const cps = 13.5 * o.rate;
    let base = 0;
    let t0 = 0;
    const flap = () => {
      if (!o.mouth) return;
      const pos = Math.floor(base + ((performance.now() - t0) / 1000) * cps);
      const ch = text[pos];
      o.mouth(ch == null ? 'rest' : pos % 3 === 2 ? 'm' : VIS(ch));
    };
    const startFlap = () => {
      t0 = performance.now();
      o.onStart?.();
      job.timer = setInterval(flap, 85);
    };
    if (!hasTTS) {
      startFlap();
      setTimeout(end, Math.max(900, (text.length / cps) * 1000));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95 * o.rate * (vo ? vo.rate : 1);
    u.pitch = vo ? vo.pitch : gender === 'male' ? 0.95 : 1.05;
    const pref = vo?.prefer ? (voices.find((x) => new RegExp(vo.prefer as string, 'i').test(x.name)) ?? null) : null;
    const v = pref || pickVoice(gender);
    if (v) u.voice = v;
    if (pref && vo) {
      u.pitch = vo.preferPitch ?? u.pitch;
      u.rate = 0.95 * o.rate * (vo.preferRate ?? 1);
    }
    u.onstart = startFlap;
    u.onboundary = (e) => {
      if (typeof e.charIndex === 'number') {
        base = e.charIndex;
        t0 = performance.now();
      }
    };
    u.onend = end;
    u.onerror = end;
    // Watchdog: some engines never fire onend.
    setTimeout(
      () => {
        if (current === job && !window.speechSynthesis.speaking) end();
      },
      Math.max(2500, (text.length / cps) * 1000 + 2500),
    );
    window.speechSynthesis.speak(u);
  });
}

/** HD voice through the shared AudioContext; the mouth follows the RMS level. */
function playBuffer(arrayBuf: ArrayBuffer, job: Job, o: SayOptions & { rate: number }): Promise<void> {
  return new Promise<void>((resolve) => {
    const c = ac();
    if (!c) return resolve();
    c.decodeAudioData(arrayBuf.slice(0)).then(
      (audio) => {
        if (job.cancelled) return resolve();
        const src = c.createBufferSource();
        src.buffer = audio;
        src.playbackRate.value = o.rate;
        const an = c.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        an.connect(c.destination);
        job.src = src;
        job.resolve = resolve;
        const data = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const x = ((data[i] ?? 128) - 128) / 128;
            sum += x * x;
          }
          const rms = Math.sqrt(sum / data.length);
          o.mouth?.(rms < 0.02 ? 'rest' : rms < 0.06 ? 'e' : rms < 0.11 ? 'o' : 'a');
          job.raf = requestAnimationFrame(loop);
        };
        src.onended = () => {
          cancelAnimationFrame(job.raf || 0);
          o.mouth?.('rest');
          if (current === job) current = null;
          resolve();
        };
        o.onStart?.();
        src.start();
        loop();
      },
      () => resolve(),
    );
  });
}

export interface ListenHandlers {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onEnd?: (text: string) => void;
  /** 'unsupported', 'busy', or the recognizer's error ('not-allowed', 'no-speech', …). */
  onError?: (err: string) => void;
}

/** speech.listen(h): one en-US utterance with interim results. */
export function listen(h: ListenHandlers): { stop(): void } {
  if (!SR) {
    h.onError?.('unsupported');
    return { stop() {} };
  }
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res?.[0]?.transcript ?? '';
      if (res?.isFinal) finalText += t;
      else interim += t;
    }
    h.onInterim?.(`${finalText} ${interim}`.trim());
  };
  r.onerror = (e) => h.onError?.(e.error || 'error');
  r.onend = () => {
    h.onEnd?.(finalText.trim());
    if (finalText.trim()) h.onFinal?.(finalText.trim());
  };
  try {
    r.start();
  } catch {
    h.onError?.('busy');
  }
  return {
    stop() {
      try {
        r.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

export interface RecordResult {
  /** Base64 WAV (16 kHz mono PCM16), '' on failure. */
  b64: string;
  secs: number;
  error?: string;
}

export interface RecordOptions {
  /** Auto-stop (default 8 s). */
  maxMs?: number;
  /** Input level 0..1 for the meter. */
  onLevel?: (level: number) => void;
}

/**
 * speech.record(h): asks for the microphone (rejects when denied), meters the level and records
 * until stop() or maxMs; stop() resolves with the WAV.
 */
export async function record(h: RecordOptions = {}): Promise<{ stop(): Promise<RecordResult> }> {
  const o = { maxMs: 8000, ...h };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const c = ac();
  if (!c) {
    for (const t of stream.getTracks()) t.stop();
    throw new Error('Web Audio indisponível');
  }
  const srcNode = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 1024;
  srcNode.connect(an);
  const data = new Uint8Array(an.fftSize);
  let raf = 0;
  const meter = () => {
    an.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] ?? 128) - 128) / 128);
    o.onLevel?.(Math.min(1, peak * 1.6));
    raf = requestAnimationFrame(meter);
  };
  meter();
  const chunks: Blob[] = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const t0 = performance.now();
  mr.start();
  let resolveStop: (r: RecordResult) => void = () => {};
  const stopped = new Promise<RecordResult>((r) => {
    resolveStop = r;
  });
  mr.onstop = async () => {
    cancelAnimationFrame(raf);
    for (const t of stream.getTracks()) t.stop();
    srcNode.disconnect();
    try {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const audio = await c.decodeAudioData(await blob.arrayBuffer());
      resolveStop({ b64: toBase64(await toWav16k(audio)), secs: (performance.now() - t0) / 1000 });
    } catch (e) {
      resolveStop({ b64: '', secs: 0, error: String(e) });
    }
  };
  const timer = setTimeout(() => {
    if (mr.state === 'recording') mr.stop();
  }, o.maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (mr.state === 'recording') mr.stop();
      return stopped;
    },
  };
}

/** Resamples to 16 kHz mono with an OfflineAudioContext and wraps it in a WAV. */
async function toWav16k(audio: AudioBuffer): Promise<ArrayBuffer> {
  const len = Math.max(1, Math.ceil(audio.duration * WAV_RATE));
  const off = new OfflineAudioContext(1, len, WAV_RATE);
  const s = off.createBufferSource();
  s.buffer = audio;
  s.connect(off.destination);
  s.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  return encodeWav16(pcm, WAV_RATE);
}

/** TIE.speech */
export const speech = { say, stop, listen, record, canListen, canRecord, hasTTS, VIS } as const;
