// award → effects: the same toasts, sfx and confetti, in the same order and timing, as
// prototipo/js/core/game.js award() (run in node:vm) for the same outcome; and the store mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { AwardResult } from '@tie/shared/contracts/game';
import { emptyDaily, freshState, type Profile, type TieState } from '@tie/shared/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { state, today } from '../src/store';
import { awardFx, cardsFx, type Fx, gameAfterAward, MEDAL_DELAY_MS, playAward } from '../src/store/award';

// biome-ignore lint/suspicious/noExplicitAny: prototype globals are untyped JS
type Any = any;

const BADGE = (id: string, t: string, s: string) => ({ id, t, s, icon: 'flag' });

function result(p: Partial<AwardResult>): AwardResult {
  return {
    awarded: true,
    kind: 'step',
    points: 10,
    total: 10,
    dayPoints: 10,
    levelUp: null,
    goalHit: false,
    newBadges: [],
    missionsDone: [],
    ...p,
  };
}

/**
 * Runs the prototype's game.award(kind) on a game state and records what TIE.app/TIE.sound were
 * asked to do, with the setTimeout delays, as Fx.
 */
function prototypeFx(kind: string, game: Any, profile: Any = { minutes: 10 }): Fx[] {
  const fx: Fx[] = [];
  let delay = 0;
  const src = readFileSync(fileURLToPath(new URL('../../../../prototipo/js/core/game.js', import.meta.url)), 'utf8');
  const sandbox: Any = {
    TIE: {
      u: { today: () => '2026-09-15' },
      store: { s: { game, profile, due: 0 }, save() {} },
      personalize: { build: () => ({}) },
      guide: { current: () => ({ num: 1 }) },
      assist: { the: () => 'a Maggie' },
      sound: {
        sfx: {
          level: () => fx.push({ at: delay, kind: 'sfx', name: 'level' }),
          done: () => fx.push({ at: delay, kind: 'sfx', name: 'done' }),
        },
      },
      app: {
        points: (n: number) => fx.push({ at: delay, kind: 'points', n }),
        toast: (msg: string) => fx.push({ at: delay, kind: 'toast', msg }),
        confetti: () => fx.push({ at: delay, kind: 'confetti' }),
      },
    },
    setTimeout: (fn: () => void, ms: number) => {
      const prev = delay;
      delay = ms;
      fn();
      delay = prev;
    },
    Date,
  };
  sandbox.window = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'game.js' });
  sandbox.TIE.game.award(kind);
  return fx;
}

const protoGame = (p: Partial<Any> = {}) => ({
  points: 0,
  streak: 1,
  lastDay: '2026-09-15',
  daily: {},
  badges: [] as string[],
  log: [] as Any[],
  ...p,
});

describe('awardFx (game.award effects)', () => {
  it('plays only "+N pontos" for a plain award', () => {
    const proto = prototypeFx('step', protoGame({ badges: ['first-step'], log: [{ k: 'step', t: 0, p: 10 }] }));
    expect(awardFx(result({ kind: 'step', points: 10 }))).toEqual(proto);
    expect(proto).toEqual([{ at: 0, kind: 'points', n: 10 }]);
  });

  it('level up: points, level sfx, "Novo nível" toast, confetti', () => {
    const g = protoGame({ points: 95, badges: ['first-step'], log: [{ k: 'step', t: 0, p: 10 }] });
    const proto = prototypeFx('step', g);
    const mine = awardFx(result({ points: 10, total: 105, levelUp: { n: 2, name: 'Curioso' } }));
    expect(mine).toEqual(proto);
    expect(mine.map((f) => f.kind)).toEqual(['points', 'sfx', 'toast', 'confetti']);
  });

  it('daily goal: done sfx and "Meta do dia batida. N pontos hoje." when no level up', () => {
    const g = protoGame({
      points: 140,
      badges: ['first-step', 'first-episode'],
      daily: { '2026-09-15': { ...emptyDaily(), points: 40, steps: 1, missions: { step: true } } },
      log: [
        { k: 'step', t: 0, p: 10 },
        { k: 'episode', t: 0, p: 40 },
      ],
    });
    const proto = prototypeFx('step', g);
    const mine = awardFx(result({ points: 10, total: 150, dayPoints: 50, goalHit: true }));
    expect(mine).toEqual(proto);
    expect(mine).toContainEqual({ at: 0, kind: 'toast', msg: 'Meta do dia batida. 50 pontos hoje.' });
  });

  it('level up wins over the goal toast', () => {
    const fx = awardFx(result({ total: 260, dayPoints: 60, goalHit: true, levelUp: { n: 3, name: 'Aprendiz' } }));
    expect(fx.filter((f) => f.kind === 'toast')).toEqual([{ at: 0, kind: 'toast', msg: 'Novo nível: Aprendiz.' }]);
  });

  it('new medals toast 900 ms later, one per badge, in order', () => {
    const proto = prototypeFx('step', protoGame());
    const mine = awardFx(result({ newBadges: [BADGE('first-step', 'Primeiro passo', 'Concluiu uma etapa')] }));
    expect(mine).toEqual(proto);
    expect(mine.at(-1)).toEqual({
      at: MEDAL_DELAY_MS,
      kind: 'toast',
      msg: 'Medalha: Primeiro passo. Concluiu uma etapa.',
    });
    const two = awardFx(result({ newBadges: [BADGE('a', 'A', 'x'), BADGE('b', 'B', 'y')] })).filter((f) => f.at > 0);
    expect(two.map((f) => (f.kind === 'toast' ? f.msg : ''))).toEqual(['Medalha: A. x.', 'Medalha: B. y.']);
  });

  it('a replayed or capped award plays nothing', () => {
    expect(awardFx(result({ awarded: false, points: 0 }))).toEqual([]);
    expect(awardFx(null)).toEqual([]);
  });

  it('no points toast for a zero-point award that still levels up through a mission bonus', () => {
    const fx = awardFx(result({ points: 0, levelUp: { n: 2, name: 'Curioso' } }));
    expect(fx[0]).toEqual({ at: 0, kind: 'sfx', name: 'level' });
  });
});

describe('cardsFx (review.sync toast)', () => {
  it('uses the prototype copy', () => {
    expect(cardsFx(1)).toEqual([{ at: 0, kind: 'toast', msg: '1 cartão novo na Revisão.' }]);
    expect(cardsFx(7)).toEqual([{ at: 0, kind: 'toast', msg: '7 cartões novos na Revisão.' }]);
    expect(cardsFx(0)).toEqual([]);
  });
});

describe('gameAfterAward (store mirror)', () => {
  const NOW = Date.parse('2026-09-15T15:00:00Z');
  const base = (): Pick<TieState, 'game' | 'tz'> => ({
    tz: 'America/Sao_Paulo',
    game: { points: 40, streak: 2, lastDay: '2026-09-14', daily: {}, badges: [], log: [] },
  });

  it('takes the server totals, counts the day and touches the streak', () => {
    const g = gameAfterAward(
      base(),
      result({
        kind: 'step',
        points: 10,
        total: 65,
        dayPoints: 25,
        missionsDone: ['step'],
        newBadges: [BADGE('first-step', 't', 's')],
      }),
      { now: NOW },
    );
    expect(g.points).toBe(65);
    expect(g.streak).toBe(3);
    expect(g.lastDay).toBe('2026-09-15');
    expect(g.daily['2026-09-15']).toMatchObject({ points: 25, steps: 1, missions: { step: true } });
    expect(g.badges).toEqual(['first-step']);
    expect(g.log).toEqual([
      { k: 'step', t: NOW, p: 10 },
      { k: 'mission', t: NOW, p: 15 },
    ]);
  });

  it('adds Mic seconds and flags the goal', () => {
    const g = gameAfterAward(
      base(),
      result({ kind: 'maggie_turn', points: 5, total: 45, dayPoints: 50, goalHit: true }),
      {
        now: NOW,
        sec: 20,
      },
    );
    expect(g.daily['2026-09-15']).toMatchObject({ maggieSec: 20, goal: true, points: 50 });
  });

  it('a non-awarded result only syncs the totals', () => {
    const g = gameAfterAward(base(), result({ awarded: false, points: 0, total: 40, dayPoints: 0 }), { now: NOW });
    expect(g.log).toEqual([]);
    expect(g.streak).toBe(2);
    expect(g.daily['2026-09-15']?.steps).toBe(0);
  });
});

describe('playAward', () => {
  afterEach(() => {
    state.value = freshState();
    vi.useRealTimers();
  });

  it('updates the store (gamebar numbers) even without a DOM for the toasts', () => {
    const s = { ...freshState(), profile: { minutes: 10 } as Profile };
    state.value = s;
    playAward(result({ points: 10, total: 10, dayPoints: 10 }));
    expect(state.value.game.points).toBe(10);
    expect(state.value.game.daily[today(s.tz)]?.points).toBe(10);
  });
});
