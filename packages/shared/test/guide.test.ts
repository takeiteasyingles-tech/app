import { describe, expect, it } from 'vitest';
import { current, plan } from '../src/domain/guide';
import { tsContent } from './helpers/catalog';
import { loadPrototypeCore, plain } from './helpers/core';
import { clone, PROFILES, randomCourse, randomGame, rngFor } from './helpers/fixtures';
import type { Any } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
const C = tsContent(T.data);
const HOME = 'assets/img/gen/bg/home.webp';

describe('guide.current()', () => {
  it('matches on every combination of done/started episodes', () => {
    const eps = C.episodes;
    expect(eps).toEqual([1, 2, 5]);
    for (let mask = 0; mask < 8; mask++) {
      for (const prog of [{}, { 1: 4 }, { 2: 10, 5: 3 }, { 1: 10, 2: 1, 5: 7 }] as Any[]) {
        const epsDone: Any = {};
        eps.forEach((n, i) => {
          if (mask & (1 << i)) epsDone[n] = true;
        });
        const s = { epsDone, prog };
        core.setState(clone(s));
        const p = T.guide.current();
        expect(current(s, eps)).toEqual({ num: p.num, step: p.step, started: p.started, allDone: p.allDone });
      }
    }
  });
});

describe('guide.plan()', () => {
  it('matches on random states for every profile', () => {
    const rng = rngFor(23);
    const seen = new Set<string>();
    for (let i = 0; i < 180; i++) {
      const now = Date.UTC(2026, 8, 1 + (i % 28), 15);
      core.setNow(now);
      const today = new Date(now).toISOString().slice(0, 10);
      const profile = clone(PROFILES[i % PROFILES.length]);
      if (i % 5 === 0) profile.minutes = 10;
      const course = randomCourse(rng, C.episodes);
      for (const x of C.extras) if (rng() < 0.3) course.extras.seen[x.id] = true;
      const game = randomGame(rng, today);
      const due = [0, 2, 9][i % 3] as number;
      const s = { ...course, profile, due, game };
      core.setState(clone(s));
      const proto = plain(T.guide.plan());
      const ts = plan({ state: s, content: C, today, epImg: HOME });
      expect(plain(ts)).toEqual(proto);
      for (const t of ts.tasks) seen.add(t.k);
    }
    expect([...seen].sort()).toEqual(['cards', 'ep', 'extra', 'maggie']);
  });
});
