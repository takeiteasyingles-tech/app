// The client half of TIE.game.award(kind) (prototipo/js/core/game.js). The server decides the
// points (AwardResult); the client mirrors the result into state.game (so the gamebar, side card and
// missions update at once) and plays the prototype's effects with the same copy and timing:
//   +N pontos toast (with the points sfx) → level up (sfx, toast, confetti) or, failing that, the
//   daily goal (sfx, toast, confetti) → each new medal toast 900 ms later.

import { LIMITS } from '@tie/shared/constants';
import type { AwardResult } from '@tie/shared/contracts/game';
import { previousDate } from '@tie/shared/domain/daytime';
import { dayStats, touchStreak } from '@tie/shared/domain/game';
import type { GameLogEntry, GameState, TieState } from '@tie/shared/state';
import type { SfxName } from '@tie/ui';
import { confetti, pointsToast, toast, uiConfig } from '@tie/ui';
import { today } from './game';
import { state } from './state';

/** One effect of an award, `at` ms after the award lands. */
export type Fx =
  | { at: number; kind: 'points'; n: number }
  | { at: number; kind: 'sfx'; name: SfxName }
  | { at: number; kind: 'toast'; msg: string }
  | { at: number; kind: 'confetti' };

/** Delay of the medal toasts after the award (game.js: setTimeout(..., 900)). */
export const MEDAL_DELAY_MS = 900;

/** The effects game.award() played for this result, in order. Nothing for a replay or a capped award. */
export function awardFx(a: AwardResult | null | undefined): Fx[] {
  if (!a?.awarded) return [];
  const fx: Fx[] = [];
  if (a.points) fx.push({ at: 0, kind: 'points', n: a.points });
  if (a.levelUp) {
    fx.push(
      { at: 0, kind: 'sfx', name: 'level' },
      { at: 0, kind: 'toast', msg: `Novo nível: ${a.levelUp.name}.` },
      { at: 0, kind: 'confetti' },
    );
  } else if (a.goalHit) {
    fx.push(
      { at: 0, kind: 'sfx', name: 'done' },
      { at: 0, kind: 'toast', msg: `Meta do dia batida. ${a.dayPoints} pontos hoje.` },
      { at: 0, kind: 'confetti' },
    );
  }
  for (const b of a.newBadges) fx.push({ at: MEDAL_DELAY_MS, kind: 'toast', msg: `Medalha: ${b.t}. ${b.s}.` });
  return fx;
}

/** review.sync()'s toast when finished steps unlock cards ("2 cartões novos na Revisão."). */
export function cardsFx(n: number): Fx[] {
  if (n <= 0) return [];
  return [{ at: 0, kind: 'toast', msg: `${n}${n > 1 ? ' cartões novos' : ' cartão novo'} na Revisão.` }];
}

/** app.toast(msg, ms), a no-op without a DOM (unit tests, prerender). */
export function showToast(msg: string, ms?: number): void {
  if (typeof document !== 'undefined') toast(msg, ms);
}

/** Plays effects through @tie/ui (toasts and confetti in #fxroot, sfx through uiConfig). */
export function runFx(fx: readonly Fx[]): void {
  if (typeof document === 'undefined') return;
  for (const f of fx) {
    const play = () => {
      if (f.kind === 'points') pointsToast(f.n);
      else if (f.kind === 'sfx') uiConfig.sfx(f.name);
      else if (f.kind === 'toast') toast(f.msg);
      else confetti();
    };
    if (f.at > 0) setTimeout(play, f.at);
    else play();
  }
}

export interface AwardMeta {
  /** Mic seconds this award counts toward the "2 minutos com…" mission (maggie_turn 20, try 15). */
  sec?: number;
  /** Clock for the local day key (tests). */
  now?: number;
}

/**
 * state.game after an award: the server's totals win (points, today's points), the day counters
 * move the way the ledger trigger moves them, and the streak is touched like game.touch().
 */
export function gameAfterAward(s: Pick<TieState, 'game' | 'tz'>, a: AwardResult, meta: AwardMeta = {}): GameState {
  const now = meta.now ?? Date.now();
  const g = s.game;
  const t = today(s.tz, now);
  const d = { ...dayStats(g, t), missions: { ...dayStats(g, t).missions } };
  d.points = a.dayPoints;
  if (!a.awarded) return { ...g, points: a.total, daily: { ...g.daily, [t]: d } };

  if (a.kind === 'step' || a.kind === 'episode') d.steps++;
  if (a.kind === 'card') d.cards++;
  if (a.kind === 'extra') d.extras++;
  if (a.kind === 'mic_try' || a.kind === 'mic_good') d.mic++;
  if (meta.sec) d.maggieSec += meta.sec;
  if (a.goalHit) d.goal = true;
  for (const m of a.missionsDone) d.missions[m] = true;

  const log: GameLogEntry[] = [...g.log, { k: a.kind, t: now, p: a.points }];
  const bonus = a.total - g.points - a.points;
  if (a.missionsDone.length && bonus > 0) {
    const each = Math.round(bonus / a.missionsDone.length);
    for (let i = 0; i < a.missionsDone.length; i++) log.push({ k: 'mission', t: now, p: each });
  }
  const badges = [...g.badges];
  for (const b of a.newBadges) if (!badges.includes(b.id)) badges.push(b.id);
  const streak = touchStreak(g, t, previousDate(t));
  return {
    ...g,
    ...streak,
    points: a.total,
    daily: { ...g.daily, [t]: d },
    badges,
    log: log.slice(-LIMITS.gameLogMax),
  };
}

/** Mirrors an award into the store without effects (used for replays and silent syncs). */
export function applyAward(a: AwardResult | null | undefined, meta: AwardMeta = {}): void {
  if (!a) return;
  const s = state.value;
  state.value = { ...s, game: gameAfterAward(s, a, meta) };
}

/** TIE.game.award(): mirror the server's result into the store, then play its effects. */
export function playAward(a: AwardResult | null | undefined, meta: AwardMeta = {}): void {
  if (!a) return;
  applyAward(a, meta);
  runFx(awardFx(a));
}
