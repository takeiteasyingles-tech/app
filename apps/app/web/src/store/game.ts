// What the shell chrome (sidebar footer, gamebar) needs from game.summary(), computed with the
// shared game domain so it matches the prototype's C.side for the same points, profile and day.
import { computed, signal } from '@preact/signals';
import { DEFAULT_TZ } from '@tie/shared/constants';
import { isValidTimeZone, localDate } from '@tie/shared/domain/daytime';
import { dayStats, goalTarget, LEVELS, level } from '@tie/shared/domain/game';
import type { GameView } from '@tie/ui';
import { state } from './state';

/** [min points, name] ascending: the built-in LEVELS until the catalog's levels replace them. */
export const levels = signal<readonly (readonly [number, string])[]>(LEVELS);

/** Today's key in game.daily, in the user's timezone (falls back to the default zone). */
export function today(tz: string, at: number = Date.now()): string {
  return localDate(isValidTimeZone(tz) ? tz : DEFAULT_TZ, at);
}

export const gameView = computed<GameView>(() => {
  const s = state.value;
  const g = s.game;
  const target = goalTarget(s.profile);
  const done = dayStats(g, today(s.tz)).points;
  return {
    points: g.points,
    streak: g.streak || 1,
    level: level(g.points, levels.value),
    goal: { target, done, pct: Math.min(100, Math.round((done / target) * 100)) },
  };
});
