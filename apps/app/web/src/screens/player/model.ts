// Player model: the prototype's per-screen `P` object (prototipo/js/screens/player.js fresh()) and the
// small helpers the step renderers share. P is a mutable object owned by one mounted step (a step
// change is a new route, so a new component and a fresh P), exactly like the prototype's module-level
// P that was rebuilt whenever the episode or the step changed.

import type { Catalog, Episode } from '@tie/shared/content/schema';
import type { PronounceIssue } from '@tie/shared/contracts/ai';
import type { TieState } from '@tie/shared/state';
import type { VNode } from 'preact';

export type MicStatus = 'idle' | 'rec' | 'busy' | 'done';

/** Take the Mic feedback card: a pronounce result, or the stored score with the phrase's scripted line. */
export interface MicFeedback {
  score: number;
  praise_pt: string;
  heard?: string;
  issues: readonly Pick<PronounceIssue, 'word' | 'tip_pt'>[];
}

export interface PState {
  ep: number;
  step: number;
  /** Current lyric (steps 2 and 10) or dialogue line (step 5). */
  line: number;
  playing: boolean;
  micIdx: number;
  mic: MicStatus;
  exIdx: number;
  /** null until Take Action opens on the first unanswered question. */
  itIdx: number | null;
  trans: boolean;
  speed: number;
  sheet: boolean;
  dl: 'idle' | 'busy';
  /** Audio position / duration (s) of the intro or the song. */
  aT: number;
  aD: number;
  showScore: boolean;
  fb: MicFeedback | null;
  /** Take a Look: the scene video was started (native controls appear only then). */
  vid: boolean;
  /** Take a Look: the scene video's duration (s), from its metadata. */
  vD: number;
  /** Take the Mic: a recording is being set up (mic permission prompt): a second tap is ignored. */
  arming: boolean;
  /** Step 10: episode-done is in flight (the done screen opens once the server confirms it). */
  finishing: boolean;
  // Runtime handles (not rendered).
  audio: HTMLAudioElement | null;
  timer: ReturnType<typeof setInterval> | undefined;
  /** Play token: bumped by stopAll(), so stale timers and speech callbacks stand down. */
  tk: number;
  stopper: (() => void) | null;
  /** Drops a recording in progress without scoring it (leaving the step, picking another phrase). */
  cancelRec: (() => void) | null;
  /** The step unmounted (the prototype's `P = null`). */
  dead: boolean;
}

/** trans / speed survive step changes inside the same episode (the prototype's `keep`). */
let keep: { ep: number; trans: boolean; speed: number } | null = null;

export function fresh(ep: number, step: number, s: TieState): PState {
  const k = keep && keep.ep === ep ? keep : null;
  return {
    ep,
    step,
    line: 0,
    playing: false,
    micIdx: 0,
    mic: 'idle',
    exIdx: 0,
    itIdx: null,
    trans: k ? k.trans : true,
    speed: k ? k.speed : s.settings.slow ? 0.75 : 1,
    sheet: false,
    dl: 'idle',
    aT: 0,
    aD: 0,
    showScore: false,
    fb: null,
    vid: false,
    vD: 0,
    arming: false,
    finishing: false,
    audio: null,
    timer: undefined,
    tk: 0,
    stopper: null,
    cancelRec: null,
    dead: false,
  };
}

/** Called when a step unmounts: keep trans/speed only when the next route is still this player. */
export function remember(P: PState, stillPlayer: boolean): void {
  keep = stillPlayer ? { ep: P.ep, trans: P.trans, speed: P.speed } : null;
}

/** sayMark's "already heard" marks: ephemeral, until the page reloads (TIE.ui.heard). */
export const heard = new Set<string>();

export const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/** m:ss (TIE.u.fmt). */
export function fmt(t: number): string {
  const x = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(x / 60)}:${pad2(x % 60)}`;
}

/**
 * Lyric rows: a line the song repeats back to back is shown once with a ×N badge (the prototype listed
 * "Bye! Bye! See you soon." twice in a row). `of[i]` maps a raw lyric index (the one the audio sync
 * computes) to its row, so the highlight and the auto-scroll stay in step with the recording.
 */
export function lyricRows<L extends { en: string; pt: string }>(
  lyrics: readonly L[],
): { rows: { l: L; n: number; first: number }[]; of: number[] } {
  const rows: { l: L; n: number; first: number }[] = [];
  const of: number[] = [];
  lyrics.forEach((l, i) => {
    const last = rows[rows.length - 1];
    if (last && last.l.en === l.en && last.l.pt === l.pt) last.n++;
    else rows.push({ l, n: 1, first: i });
    of.push(rows.length - 1);
  });
  return { rows, of };
}

/** Media of the steps that play a recording: intro (1) and song (2, 10). */
export function stepAudio(Ep: Episode, step: number): string {
  return (step === 1 ? Ep.introAudio : step === 2 || step === 10 ? Ep.songAudio : '') || '';
}

/** Click handler: preventDefault + tick sfx + action (the prototype's delegated data-act click). */
export type Tap = (fn: () => void) => (ev: Event) => void;

export interface StepActions {
  play(): void;
  trans(): void;
  speed(v: number): void;
  line(i: number): void;
  micPick(i: number): void;
  record(): void;
  showScore(): void;
  download(): void;
  /** Opens the e-book's own screen (#/ebook/N). */
  ebookOpen(): void;
  /** Take a Look: starts the scene video (the poster's play button). */
  vidStart(v: HTMLVideoElement | null): void;
  vidMeta(duration: number): void;
  ex(itemId: string, choice: number): void;
  exGo(d: number): void;
  /** Jumps to exercise `x`, on its first unanswered question. */
  exPick(x: number): void;
  exAudio(): void;
  say(t: string): void;
  sayMark(t: string): void;
  next(): void;
}

/** What a step renderer reads. */
export interface StepCtx {
  Ep: Episode;
  cat: Catalog;
  s: TieState;
  P: PState;
  step: number;
  desk: boolean;
  training: boolean;
  /** Background of the intro card and the fallback scene still (assets/img/gen/bg/home.webp). */
  homeBg: string;
  a: StepActions;
  tap: Tap;
}

/** A step either renders one scrolling body or a fixed dock above a scrolling body. */
export type StepOut = { dock?: VNode; body: VNode };
