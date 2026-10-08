import { describe, expect, it } from 'vitest';
import {
  buildPersonalization,
  FOCUS,
  FORMAT_THEME,
  FORMAT_WORD,
  focus,
  genreWord,
  hour,
  label,
  levelInfo,
  missions,
  rankExtras,
  reminders,
  tutorContext,
} from '../src/domain/personalize';
import { tsContent } from './helpers/catalog';
import { loadPrototypeCore, plain } from './helpers/core';
import { clone, PROFILES } from './helpers/fixtures';
import { type Any, extractConst } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
const PZ = T.personalize;
const C = tsContent(T.data);
const summary = (list: Any[]) => list.map((x) => [x.id, x.score, x.why]);

describe('personalize parity', () => {
  it('constants', () => {
    expect(FORMAT_WORD).toEqual(plain(PZ.FORMAT_WORD));
    expect(FORMAT_THEME).toEqual(extractConst('js/core/personalize.js', 'FORMAT_THEME'));
    expect(FOCUS).toEqual(extractConst('js/core/personalize.js', 'FOCUS'));
  });

  it('label, genreWord and levelInfo', () => {
    const O = T.data.ONB;
    for (const k of [...O.THEMES.map((x: Any) => x[0]), 'nada', ''])
      expect(label(C.onboarding.themes, k)).toBe(PZ.label(O.THEMES, k));
    for (const k of [...O.DIFFS.map((x: Any) => x.k), 'nada'])
      expect(label(C.onboarding.diffs, k)).toBe(PZ.label(O.DIFFS, k));
    const genreKeys = Object.values(O.GENRES).flatMap((l: Any) => l.map((g: Any) => g[0]));
    for (const k of [...genreKeys, 'nada']) expect(genreWord(C.onboarding.genres, k), k).toBe(PZ.GENRE_WORD(k));
    for (const p of PROFILES) expect(levelInfo(C.onboarding.levels, p)).toEqual(plain(PZ.levelInfo(p)));
    expect(levelInfo(C.onboarding.levels, null)).toEqual(plain(PZ.levelInfo(null)));
  });

  for (const [i, p] of PROFILES.entries()) {
    it(`build() for profile ${i} (${p.name})`, () => {
      core.setState({ profile: clone(p) });
      const P = plain(PZ.build(clone(p)));
      const ts = buildPersonalization(p, C);
      expect(summary(ts.extras)).toEqual(summary(P.extras));
      expect(summary(rankExtras(p, C))).toEqual(summary(P.extras));
      expect(summary(ts.albums)).toEqual(summary(P.albums));
      expect(ts.focus).toEqual(P.focus);
      expect(focus(p, C)).toEqual(P.focus);
      expect(ts.defaults).toEqual(P.defaults);
      expect(ts.ctx).toEqual(P.ctx);
      expect(tutorContext(p, C)).toEqual(P.ctx);
      expect(ts.level).toEqual(P.level);
      const protoMissions = P.missions.map((m: Any) => ({
        k: m.k,
        t: m.t,
        role: m.role,
        goal: m.goal,
        turns: m.turns.map((t: Any) => ({ ...t, words: t.words.map(([en, pt]: string[]) => ({ en, pt })) })),
      }));
      expect(plain(ts.missions)).toEqual(protoMissions);
      expect(plain(missions(p, C))).toEqual(protoMissions);
    });
  }

  it('the ranking is not trivial (scores spread, locked extras sink)', () => {
    const ranked = rankExtras(PROFILES[0], C);
    expect(new Set(ranked.map((x) => x.score)).size).toBeGreaterThan(3);
    const blank = rankExtras(PROFILES[1], C);
    expect(blank.slice(-2).map((x) => x.locked)).toEqual([true, true]);
  });

  it('build(null) is null', () => {
    expect(buildPersonalization(null, C)).toBeNull();
    expect(PZ.build(null)).toBeNull();
  });

  it('reminders and hour', () => {
    const inputs: Any[] = [
      null,
      undefined,
      {},
      { reminders: [] },
      { reminders: ['20:00', '07:30', '', '12:05'] },
      { remind: '08:00' },
      { remind: '' },
      { reminders: ['21:00'], remind: '08:00' },
    ];
    for (const p of inputs) expect(reminders(p)).toEqual(plain(PZ.reminders(p)));
    for (const t of ['07:00', '20:30', '00:00', '9:05', '12', '', 'ab:cd', '23:59', '08:00:00']) {
      expect(hour(t), t).toBe(PZ.hour(t));
    }
  });
});
