// Voice (port of prototipo/js/core/speech.js): speak (free browser voice with a synced mouth, or the
// HD voice from /api/tts when settings.hd is on and the AI is online), listen (Web Speech API, en-US
// with interim results) and record a 16 kHz mono PCM16 WAV for /api/pronounce.
// PROD: listeners (onSpeech) follow what is spoken (the 3D avatar's lip sync and word timing), a
// voice host (setVoiceHost) may speak for its assistant itself, HD lines in a lesson use the
// lesson's voice (setLesson), and HD audio is loudness-normalized.

import { DEFAULT_ASSISTANT, narratorRole } from '@tie/shared/constants';
import type { AssistantPublic } from '@tie/shared/content/schema';
import type { WordSpan } from '@tie/shared/contracts/ai';
import { assistantByName, getAssistant } from '@tie/shared/domain/assist';
import { catalog } from '../store/content';
import { state } from '../store/state';
import { aiOnline, type TtsLesson, tts } from './aiClient';
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

/** What is being spoken, for listeners that animate it (the 3D avatar). */
export type SpeechEvent =
  /** The line ended or was stopped. */
  | { type: 'end' }
  /** Browser voice: the mouth shape, every ~85 ms. */
  | { type: 'mouth'; v: Viseme }
  /** HD voice: the decoded audio, scheduled at `startAt` on `ctx`, with its word timings when known. */
  | {
      type: 'audio';
      text: string;
      buffer: AudioBuffer;
      ctx: AudioContext;
      startAt: number;
      rate: number;
      words: WordSpan[] | null;
    };

const listeners = new Set<(e: SpeechEvent) => void>();

/** Subscribes to speech events; returns the unsubscribe function. */
export function onSpeech(fn: (e: SpeechEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(e: SpeechEvent): void {
  for (const fn of listeners) fn(e);
}

/**
 * Something that speaks for one assistant itself (its own voice and lip sync). say() hands it that
 * assistant's lines first; it resolves true when it spoke the line, false to fall back to the HD or
 * browser voice.
 */
export interface VoiceHost {
  /** Assistant key it speaks for. */
  k: string;
  say(text: string, onStart: () => void): Promise<boolean>;
  stop(): void;
}

let host: VoiceHost | null = null;

/** Registers the voice host; returns the function that removes it. */
export function setVoiceHost(h: VoiceHost): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

/** Stops whatever is speaking (browser or HD voice) and resolves its say(). */
export function stop(): void {
  host?.stop();
  if (current) emit({ type: 'end' });
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
  /** HD voice on/off for this line (default: settings.hd). */
  hd?: boolean;
  /** Lesson voice for this line (default: the one set by setLesson, as the speaker or the narrator). */
  lesson?: TtsLesson;
}

const assistants = (): readonly AssistantPublic[] => catalog.value?.assistants ?? [];

/** The learner's chosen assistant (TIE.assist.cur()), or null before the catalog loads. */
function currentAssistant(): AssistantPublic | null {
  const list = assistants();
  return list.length ? getAssistant(list, state.value.profile?.assistant || DEFAULT_ASSISTANT) : null;
}

let lessonEp: number | null = null;
let lessonStep: number | null = null;

/**
 * PROD: the lesson (episode, and step) on screen, so HD lines use that lesson's voices; null when
 * leaving it.
 */
export function setLesson(ep: number | null, step: number | null = null): void {
  lessonEp = ep;
  lessonStep = ep == null ? null : step;
}

/** speech.say(text, opt): resolves when the line finishes (or is stopped). */
export async function say(text: string, opt: SayOptions = {}): Promise<void> {
  stop();
  const lesson =
    opt.lesson ?? (lessonEp == null ? undefined : { ep: lessonEp, role: opt.who?.trim() || narratorRole(lessonStep) });
  const o = { rate: 1, who: currentAssistant()?.name ?? 'Maggie', ...opt };
  const prof = assistantByName(assistants(), o.who);
  const vo = prof ? prof.voice : null;
  const gender: 'male' | 'female' = vo ? vo.gender : MALE.test(o.who) ? 'male' : 'female';
  const job: Job = { mouth: o.mouth, cancelled: false };
  current = job;
  const h = host;
  if (h && prof?.k === h.k) {
    const spoke = await new Promise<boolean>((resolve) => {
      job.resolve = () => resolve(true);
      h.say(text, () => {
        if (!job.cancelled) o.onStart?.();
      }).then(resolve, () => resolve(false));
    });
    if (job.cancelled) return;
    if (spoke) {
      if (current === job) current = null;
      emit({ type: 'end' });
      return;
    }
  }
  if ((o.hd ?? state.value.settings.hd) && aiOnline.value) {
    try {
      const voice = prof?.k || vo?.tts || (gender === 'male' ? 'orion' : 'asteria');
      const r = await (lesson ? tts(text, gender, voice, lesson) : tts(text, gender, voice));
      if (job.cancelled) return;
      if (r) return await playBuffer(r.audio, job, o, text, r.words);
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
      emit({ type: 'end' });
      if (current === job) current = null;
      resolve();
    };
    const cps = 13.5 * o.rate;
    let base = 0;
    let t0 = 0;
    const flap = () => {
      const pos = Math.floor(base + ((performance.now() - t0) / 1000) * cps);
      const ch = text[pos];
      const v: Viseme = ch == null ? 'rest' : pos % 3 === 2 ? 'm' : VIS(ch);
      o.mouth?.(v);
      emit({ type: 'mouth', v });
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

/** RMS the HD voice is normalized to (voices come at very different levels). */
const TARGET_RMS = 0.11;

/** Gain that brings the voiced parts (20 ms frames above the noise) to TARGET_RMS, within 0.25–4. */
function loudnessGain(audio: AudioBuffer): number {
  const data = audio.getChannelData(0);
  const frame = Math.max(1, Math.floor(audio.sampleRate * 0.02));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += frame) {
    const end = Math.min(data.length, i + frame);
    let s = 0;
    for (let j = i; j < end; j++) {
      const x = data[j] ?? 0;
      s += x * x;
    }
    if (Math.sqrt(s / (end - i)) > 0.01) {
      sum += s;
      count += end - i;
    }
  }
  if (!count) return 1;
  const rms = Math.sqrt(sum / count);
  return Math.min(4, Math.max(0.25, TARGET_RMS / rms));
}

/**
 * HD voice through the shared AudioContext, loudness-normalized (gain + a limiter); the mouth follows
 * the RMS level and listeners get the audio to animate it.
 */
function playBuffer(
  arrayBuf: ArrayBuffer,
  job: Job,
  o: SayOptions & { rate: number },
  text: string,
  words: WordSpan[] | null = null,
): Promise<void> {
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
        if (typeof c.createGain === 'function' && typeof c.createDynamicsCompressor === 'function') {
          const gain = c.createGain();
          gain.gain.value = loudnessGain(audio);
          const limiter = c.createDynamicsCompressor();
          limiter.threshold.value = -3;
          limiter.knee.value = 0;
          limiter.ratio.value = 20;
          limiter.attack.value = 0.002;
          limiter.release.value = 0.08;
          src.connect(gain);
          gain.connect(limiter);
          limiter.connect(an);
        } else src.connect(an);
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
          if (current === job) {
            emit({ type: 'end' });
            current = null;
          }
          resolve();
        };
        o.onStart?.();
        const startAt = c.currentTime;
        emit({ type: 'audio', text, buffer: audio, ctx: c, startAt, rate: o.rate, words });
        src.start(startAt);
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
  /** Milliseconds of voice in the take (50 ms frames above the noise floor); absent on failure. */
  voicedMs?: number;
  error?: string;
}

export interface RecordOptions {
  /** Auto-stop (default 8 s). */
  maxMs?: number;
  /** Input level 0..1 for the meter. */
  onLevel?: (level: number) => void;
  /**
   * Voice activity detection: called once when the learner has spoken and then gone quiet for
   * `silenceMs`. The caller stops (and scores) the take; recording itself goes on until stop().
   */
  onSilence?: () => void;
  /** Quiet time after speech that counts as "done" (default 1100 ms). */
  silenceMs?: number;
}

/** VAD tuning: 50 ms frames; the first 300 ms measure the room; 250 ms of voice before silence counts. */
const VAD = { tickMs: 50, calibMs: 300, minSpeechMs: 250, silenceMs: 1100, minLevel: 0.012, maxNoise: 0.05 };

/**
 * Voice activity detector on an analyser: RMS per frame against an adaptive noise floor (calibrated
 * on the first frames, then tracked while nobody is speaking). Fires `done` once, after speech and
 * then `silenceMs` of quiet. Returns the stop function.
 */
export function detectSilence(
  an: Pick<AnalyserNode, 'fftSize' | 'getByteTimeDomainData'>,
  silenceMs: number,
  done: () => void,
): () => void {
  const buf = new Uint8Array(an.fftSize);
  const t0 = performance.now();
  let noise = 0;
  let voiced = 0;
  let quiet = 0;
  const id = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = ((buf[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    if (performance.now() - t0 < VAD.calibMs) {
      noise = Math.min(VAD.maxNoise, Math.max(noise, rms));
      return;
    }
    if (rms > Math.max(VAD.minLevel, noise * 2.5)) {
      voiced += VAD.tickMs;
      quiet = 0;
      return;
    }
    quiet += VAD.tickMs;
    if (voiced < VAD.minSpeechMs) noise = Math.min(VAD.maxNoise, noise * 0.95 + rms * 0.05);
    else if (quiet >= silenceMs) {
      clearInterval(id);
      done();
    }
  }, VAD.tickMs);
  return () => clearInterval(id);
}

/**
 * speech.record(h): asks for the microphone (rejects when denied), meters the level and records
 * until stop() or maxMs; stop() resolves with the WAV. With `onSilence`, it also tells the caller
 * when the learner has finished speaking (VAD).
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
  const onSilence = o.onSilence;
  const stopVad = onSilence ? detectSilence(an, o.silenceMs ?? VAD.silenceMs, onSilence) : () => {};
  let resolveStop: (r: RecordResult) => void = () => {};
  const stopped = new Promise<RecordResult>((r) => {
    resolveStop = r;
  });
  mr.onstop = async () => {
    cancelAnimationFrame(raf);
    stopVad();
    for (const t of stream.getTracks()) t.stop();
    srcNode.disconnect();
    try {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const pcm = await resample16k(await c.decodeAudioData(await blob.arrayBuffer()));
      resolveStop({
        b64: toBase64(encodeWav16(pcm, WAV_RATE)),
        secs: (performance.now() - t0) / 1000,
        voicedMs: voicedMs(pcm, WAV_RATE),
      });
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

/** Resamples to 16 kHz mono with an OfflineAudioContext. */
async function resample16k(audio: AudioBuffer): Promise<Float32Array> {
  const len = Math.max(1, Math.ceil(audio.duration * WAV_RATE));
  const off = new OfflineAudioContext(1, len, WAV_RATE);
  const s = off.createBufferSource();
  s.buffer = audio;
  s.connect(off.destination);
  s.start();
  return (await off.startRendering()).getChannelData(0);
}

/**
 * Voiced milliseconds of a take: 50 ms frames louder than the noise floor (3× the 10th-percentile
 * frame, clamped to the VAD's levels). Lets callers treat a take with no speech as silence.
 */
function voicedMs(pcm: Float32Array, rate: number): number {
  const frame = Math.max(1, Math.round(rate * 0.05));
  const levels: number[] = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) {
      const x = pcm[j] ?? 0;
      s += x * x;
    }
    levels.push(Math.sqrt(s / frame));
  }
  if (!levels.length) return 0;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const threshold = Math.max(VAD.minLevel, Math.min(floor * 3, VAD.maxNoise));
  return levels.filter((l) => l > threshold).length * 50;
}

/** A take with less voice than this is treated as silence. */
export const MIN_VOICED_MS = 250;

/** TIE.speech */
export const speech = {
  say,
  stop,
  listen,
  record,
  setLesson,
  canListen,
  canRecord,
  hasTTS,
  VIS,
  MIN_VOICED_MS,
} as const;
