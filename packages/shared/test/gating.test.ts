import { describe, expect, it } from 'vitest';
import { STEP } from '../src/constants';
import { gate, need } from '../src/domain/gating';
import { stepKey } from '../src/state';
import { tsEpisode } from './helpers/catalog';
import { declSource, loadPrototypeCore } from './helpers/core';
import { rngFor } from './helpers/fixtures';
import type { Any } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
// need() is a closure function inside player.js; acorn pulls it out and it runs in the sandbox.
const protoNeed = core.run(declSource('js/screens/player.js', 'need'));
const protoGate = core.run(`(${declSource('js/screens/player.js', 'gate')})`.replace('need(', 'globalThis.__need('));
core.ctx.__need = protoNeed;

/**
 * The prototype's step at each production position 1-9 (spec 05 "Step order"): the presentation and
 * the song stay 1-2, the e-book step (prototype 3) is gone, the rest move up one. Step 10, Take the
 * Test, is new (tested on its own below).
 */
const PROTO_STEP = [1, 2, 4, 5, 6, 7, 8, 9, 10] as const;
/** A v6 state (index keys) and the same state in v7 (stable ids). */
function pair(rng: () => number, E: Any) {
  const n = E.num;
  const v6: Any = { ebooks: {}, epsDone: {}, prog: {}, stepOk: {}, scores: {}, exAns: {}, settings: { free: false } };
  const v7: Any = { ebooks: {}, epsDone: {}, prog: {}, stepOk: {}, scores: {}, exAns: {}, settings: { free: false } };
  const ebook = rng() < 0.5;
  const done = rng() < 0.1;
  const prog = rng() < 0.6 ? 1 + Math.floor(rng() * 10) : undefined;
  const free = rng() < 0.1;
  for (const s of [v6, v7]) {
    if (ebook) s.ebooks[E.ebook] = true;
    if (done) s.epsDone[n] = true;
    if (prog) s.prog[n] = prog;
    s.settings.free = free;
  }
  for (let step = 1; step <= 10; step++) {
    if (rng() < 0.2) {
      v6.stepOk[`${n}-${step}`] = true;
      v7.stepOk[stepKey(n, step)] = true;
    }
  }
  const allMic = rng() < 0.3;
  E.mic.forEach((_m: Any, i: number) => {
    if (allMic || rng() < 0.6) {
      const score = Math.floor(rng() * 11);
      v6.scores[`${n}-${i}`] = score;
      v7.scores[`e${n}-mic-${i}`] = score;
    }
  });
  const allEx = rng() < 0.3;
  E.ex.forEach((x: Any, xi: number) => {
    x.items.forEach((_it: Any, j: number) => {
      if (allEx || rng() < 0.8) {
        const a = Math.floor(rng() * 4);
        v6.exAns[`${n}-${xi}-${j}`] = a;
        v7.exAns[`e${n}-ex${xi}-i${j}`] = a;
      }
    });
  });
  return { v6, v7 };
}

describe('need() parity with player.js (index keys → stable ids)', () => {
  for (const n of [1, 2, 5]) {
    it(`episode ${n}: 400 random states × 10 steps`, () => {
      const E = T.data.EPS[n];
      const ep = tsEpisode(T.data, n);
      const rng = rngFor(100 + n);
      const messages = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const { v6, v7 } = pair(rng, E);
        for (let step = 1; step <= 10; step++) {
          let expected: string;
          let expectedGate: string;
          // PROD: step 1 is the presentation ("In this episode").
          const prod = (m: string) => (m === 'Ouça a abertura até o fim' ? 'Ouça a apresentação até o fim' : m);
          if (step > PROTO_STEP.length) {
            // Take the Test: the scripted episodes have no episode test (testCount absent).
            expected = '';
            expectedGate = '';
          } else {
            // The prototype step sees the same completions under its own number; "prog past this
            // step" is production's position, so the prototype runs without prog and the shortcut is
            // applied here.
            const old = PROTO_STEP[step - 1] as number;
            const stepOk: Any = {};
            PROTO_STEP.forEach((o, i) => {
              stepOk[`${n}-${o}`] = v7.stepOk[stepKey(n, i + 1)];
            });
            const v6r = { ...v6, prog: {}, stepOk };
            const past = (v7.prog[n] || 1) > step;
            expected = past ? '' : prod(protoNeed(E, v6r, old));
            expectedGate = past ? '' : prod(protoGate(E, v6r, old));
          }
          expect(need(ep, v7, step), `step ${step} ${JSON.stringify(v6)}`).toBe(expected);
          expect(gate(ep, v7, step)).toBe(expectedGate);
          messages.add(expected);
        }
      }
      // Every branch shows up, including the plural/singular counters.
      expect(messages.has('')).toBe(true);
      expect(messages.has('Ouça a apresentação até o fim')).toBe(true);
      expect([...messages].some((m) => m.startsWith('Faltam'))).toBe(true);
      expect(messages.size).toBeGreaterThan(8);
    });
  }

  it('a scene without video never gates Take a Look', () => {
    const ep = { ...tsEpisode(T.data, 1), sceneVideo: null };
    const s: Any = { ebooks: {}, epsDone: {}, prog: {}, stepOk: {}, scores: {}, exAns: {} };
    expect(need(ep, s, STEP.LOOK)).toBe('');
    expect(need({ ...ep, sceneVideo: '/m/x.mp4' }, s, STEP.LOOK)).toBe('Assista à cena até o fim');
  });

  it('Take the Test gates on the episode test (testDone of its e-book)', () => {
    const ep = { ...tsEpisode(T.data, 1), ebook: 1 };
    const s: Any = { epsDone: {}, prog: {}, stepOk: {}, scores: {}, exAns: {}, testDone: {} };
    expect(need({ ...ep, testCount: 0 }, s, STEP.TEST)).toBe('');
    expect(need({ ...ep, testCount: 6 }, s, STEP.TEST)).toBe('Faça o teste até o fim');
    expect(need({ ...ep, testCount: 6 }, { ...s, testDone: { 1: true } }, STEP.TEST)).toBe('');
    expect(need({ ...ep, testCount: 6, ebook: null }, s, STEP.TEST)).toBe('Faça o teste até o fim');
    expect(need({ ...ep, testCount: 6 }, { ...s, stepOk: { [stepKey(1, STEP.TEST)]: true } }, STEP.TEST)).toBe('');
  });
});
