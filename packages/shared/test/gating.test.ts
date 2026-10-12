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

/** The prototype's step at production positions 1-3 (spec 05 "Step order"); 4-10 are the same. */
const PROTO_STEP = [2, 3, 1] as const;

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
          if (step > PROTO_STEP.length) {
            expected = protoNeed(E, v6, step);
            expectedGate = protoGate(E, v6, step);
          } else {
            // Steps 1-3 are the prototype's 2, 3, 1 (production order). The prototype step sees the
            // same completions under its own number; "prog past this step" is production's position,
            // so the prototype runs without prog and the shortcut is applied here.
            const old = PROTO_STEP[step - 1] as number;
            const stepOk: Any = { ...v6.stepOk };
            PROTO_STEP.forEach((o, i) => {
              stepOk[`${n}-${o}`] = v7.stepOk[stepKey(n, i + 1)];
            });
            const v6r = { ...v6, prog: {}, stepOk };
            const past = step !== STEP.EBOOK && (v7.prog[n] || 1) > step;
            expected = past ? '' : protoNeed(E, v6r, old);
            expectedGate = v7.settings.free ? '' : expected;
          }
          expect(need(ep, v7, step), `step ${step} ${JSON.stringify(v6)}`).toBe(expected);
          expect(gate(ep, v7, step)).toBe(expectedGate);
          messages.add(expected);
        }
      }
      // Every branch shows up, including the plural/singular counters.
      expect(messages.has('')).toBe(true);
      expect(messages.has('Baixe o e-book para seguir')).toBe(true);
      expect([...messages].some((m) => m.startsWith('Faltam'))).toBe(true);
      expect(messages.size).toBeGreaterThan(8);
    });
  }

  it('a scene without video never gates step 4', () => {
    const ep = { ...tsEpisode(T.data, 1), sceneVideo: null };
    const s: Any = { ebooks: {}, epsDone: {}, prog: {}, stepOk: {}, scores: {}, exAns: {} };
    expect(need(ep, s, 4)).toBe('');
    expect(need({ ...ep, sceneVideo: '/m/x.mp4' }, s, 4)).toBe('Assista à cena até o fim');
  });
});
