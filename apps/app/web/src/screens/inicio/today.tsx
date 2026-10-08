// What Hoje and Conquistas read from the prototype's TIE.game.summary() / TIE.guide / TIE.personalize,
// computed on the client from the store and the catalog with the shared domain functions (the same
// ones the Worker's game engine uses), so missions, medals and the plan match the server's view.
import type { Catalog } from '@tie/shared/content/schema';
import type { GameSummary } from '@tie/shared/contracts/game';
import { getAssistant } from '@tie/shared/domain/assist';
import { dayOfMonth } from '@tie/shared/domain/daytime';
import { BADGES, gameSummary, level } from '@tie/shared/domain/game';
import { current } from '@tie/shared/domain/guide';
import type { TieState } from '@tie/shared/state';
import { Btn } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { layoutOf } from '../../shell';
import { catalog, clock, dueNow, levels, loadCatalog, state, today, useContent } from '../../store';

/** Episode numbers the learner can play (TIE.data.EPS): the published ones. */
export function publishedEpisodes(c: Catalog): number[] {
  return c.episodes.filter((e) => e.status === 'published').map((e) => e.num);
}

/** TIE.app.isDesktop() */
export const isDesktop = (s: TieState = state.value): boolean => layoutOf(s) === 'desktop';

/** Today's key in the user's timezone, following the coarse clock so the day rolls over while open. */
export const todayKey = (s: TieState = state.value): string => today(s.tz, Math.max(clock.value, Date.now()));

/**
 * game.summary(): points, level (from the catalog's levels), streak, today's goal, the catalog's
 * medals and today's missions. `due` is review.sync()'s recount (cards due now).
 */
export function summary(s: TieState, c: Catalog): GameSummary {
  const t = todayKey(s);
  const p = s.profile;
  const sum = gameSummary({
    game: s.game,
    profile: p,
    today: t,
    badges: c.game?.badges?.length ? c.game.badges : BADGES,
    due: dueNow.value,
    styles: p?.styles,
    currentEp: current(s, publishedEpisodes(c)).num,
    assistant: getAssistant(c.assistants, p?.assistant),
    dayOfMonth: dayOfMonth(t),
  });
  return { ...sum, level: level(s.game.points, levels.value) };
}

/**
 * The catalog the screen needs (already fetched at sign-in; this makes sure it is). Renders the
 * children once it is there; a failed load shows a retry card instead of a blank screen.
 */
export function WithCatalog({ children }: { children: (c: Catalog) => ComponentChildren }) {
  const [attempt, setAttempt] = useState(0);
  const { error } = useContent(loadCatalog, [attempt]);
  const c = catalog.value;
  if (c) return <>{children(c)}</>;
  if (!error) return null;
  return (
    <div class="scroll">
      <div class="wrap">
        <div class="card mt24 stack" style={{ '--gap': '12px' }}>
          <div class="h3">Não deu para carregar o conteúdo.</div>
          <p class="p">Confira a sua conexão e tente de novo.</p>
          <Btn label="Tentar de novo" kind="block" onClick={() => setAttempt((n) => n + 1)} />
        </div>
      </div>
    </div>
  );
}
