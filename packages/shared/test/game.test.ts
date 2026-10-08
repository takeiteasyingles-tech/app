import { describe, expect, it } from 'vitest';
import { BadgeRule } from '../src/contracts/game';
import { previousDate } from '../src/domain/daytime';
import {
  BADGES,
  badgeEarned,
  badgeStatsFromGame,
  dailyMissions,
  gameSummary,
  goalTarget,
  LEVELS,
  level,
  newBadges,
  POINTS,
  touchStreak,
} from '../src/domain/game';
import { current } from '../src/domain/guide';
import { emptyDaily } from '../src/state';
import { tsContent } from './helpers/catalog';
import { loadPrototypeCore, plain } from './helpers/core';
import { clone, PROFILES, randomCourse, randomGame, rngFor } from './helpers/fixtures';
import type { Any } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
const G = T.game;
const C = tsContent(T.data);
const assistant = (k: string) => C.assistants.find((a) => a.k === k) ?? (C.assistants[0] as (typeof C.assistants)[0]);

describe('game constants', () => {
  it('POINTS, LEVELS and badge metadata match game.js', () => {
    expect(POINTS).toEqual(plain(G.POINTS));
    expect(LEVELS.map((l) => [...l])).toEqual(plain(G.LEVELS));
    expect(BADGES.map(({ id, t, s, icon }) => ({ id, t, s, icon }))).toEqual(
      G.BADGES.map((b: Any) => ({ id: b.id, t: b.t, s: b.s, icon: b.icon })),
    );
    for (const b of BADGES) expect(BadgeRule.safeParse(b.rule).success, b.id).toBe(true);
  });
});

describe('level()', () => {
  it('matches on boundaries and a sweep', () => {
    const pts = [-5, 0, 1, 50, 99, 100, 101, 5000, 5001, 12_345];
    for (const [min] of LEVELS) pts.push(min - 1, min, min + 1);
    for (let p = 0; p <= 6000; p += 37) pts.push(p);
    for (const p of pts) expect(level(p), String(p)).toEqual(plain(G.level(p)));
  });
});

describe('goalTarget()', () => {
  it('matches for several minute budgets', () => {
    for (const m of [undefined, 0, 5, 9.9, 10, 20, 33, 50, 240]) {
      const profile = m === undefined ? {} : { minutes: m };
      core.setState({ profile });
      expect(goalTarget(profile as Any)).toBe(G.goalTarget());
    }
    core.setState({ profile: null });
    expect(goalTarget(null)).toBe(G.goalTarget());
  });
});

describe('badges as JSON rules', () => {
  it('agree with the prototype test() functions on 300 random game states', () => {
    const rng = rngFor(7);
    const earned = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const g = randomGame(rng, '2026-09-15');
      const proto = G.BADGES.filter((b: Any) => b.test(g)).map((b: Any) => b.id);
      const st = badgeStatsFromGame(g);
      const ts = BADGES.filter((b) => badgeEarned(b.rule, st)).map((b) => b.id);
      expect(ts).toEqual(proto);
      for (const id of ts) earned.add(id);
      expect(newBadges(BADGES, g.badges, st).map((b) => b.id)).toEqual(
        proto.filter((id: string) => !g.badges.includes(id)),
      );
    }
    expect(earned.size).toBe(14);
  });
});

describe('touch() streak', () => {
  it('matches the prototype', () => {
    const now = Date.UTC(2026, 8, 15, 15);
    core.setNow(now);
    const today = '2026-09-15';
    for (const lastDay of ['', today, '2026-09-14', '2026-09-13', '2025-01-01']) {
      for (const streak of [0, 1, 4]) {
        const g = { streak, lastDay };
        core.setState({ game: clone(g) });
        G.touch();
        const after = T.store.s.game;
        expect(touchStreak(g, today, previousDate(today))).toEqual({ streak: after.streak, lastDay: after.lastDay });
      }
    }
  });
});

describe('summary() and daily missions', () => {
  it('match on random states across days of the month', () => {
    const rng = rngFor(11);
    const kinds = new Set<string>();
    for (let i = 0; i < 240; i++) {
      const day = 1 + (i % 28);
      const now = Date.UTC(2026, 8, day, 15, 0, 0);
      core.setNow(now);
      const today = new Date(now).toISOString().slice(0, 10);
      const profile = clone(PROFILES[i % PROFILES.length]);
      const course = randomCourse(rng, C.episodes);
      const game = randomGame(rng, today);
      const due = [0, 0, 3, 12][i % 4] as number;
      const s = { ...course, profile, due, game };
      core.setState(clone(s));
      const proto = plain(G.summary());
      const cur = current(s, C.episodes);
      const ts = gameSummary({
        game,
        profile,
        today,
        due,
        styles: profile.styles,
        currentEp: cur.num,
        assistant: assistant(profile.assistant),
        dayOfMonth: new Date(now).getDate(),
      });
      expect(ts).toEqual(proto);
      for (const m of ts.missions) kinds.add(m.k);
    }
    expect([...kinds].sort()).toEqual(['cards', 'extra', 'maggie', 'step']);
  });

  it('a fresh day with no deck lists step, extra and maggie', () => {
    const list = dailyMissions({
      daily: emptyDaily(),
      due: 0,
      styles: [],
      currentEp: 1,
      assistant: assistant('robert'),
      dayOfMonth: 3,
    });
    expect(list.map((m) => m.k)).toEqual(['step', 'extra', 'maggie']);
    expect(list[2]?.t).toBe('2 minutos com o Robert');
  });
});
