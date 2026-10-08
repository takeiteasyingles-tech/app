import { describe, expect, it } from 'vitest';
import { norm } from '../src/domain/norm';
import { loadPrototypeCore } from './helpers/core';
import type { Any } from './helpers/prototype';

const { T } = loadPrototypeCore();
const D = T.data;

describe('norm() matches TIE.data.norm', () => {
  it('every TEST acc, show and question string', () => {
    const inputs: string[] = [];
    for (const q of D.TEST_ALL as Any[]) {
      inputs.push(q.q, ...(q.acc ?? []), ...(q.opts ?? []));
      if (q.show) inputs.push(q.show);
    }
    expect(inputs.length).toBeGreaterThan(40);
    for (const s of inputs) expect(norm(s), s).toBe(D.norm(s));
  });

  it('typed answers: the shown answer normalizes into acc', () => {
    for (const q of (D.TEST_ALL as Any[]).filter((x) => x.acc && x.show)) {
      expect(q.acc, q.show).toContain(norm(q.show));
      expect(q.acc).toContain(D.norm(q.show));
    }
  });

  it('every episode line and Extra line', () => {
    let n = 0;
    for (const E of Object.values(D.EPS) as Any[]) {
      for (const l of [...E.dialog, ...E.lyrics, ...E.visual, ...E.awayExp]) {
        expect(norm(l.en)).toBe(D.norm(l.en));
        n++;
      }
    }
    for (const x of D.EXTRAS as Any[]) {
      for (const l of x.lines) {
        expect(norm(l.en)).toBe(D.norm(l.en));
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('edge cases', () => {
    const cases: unknown[] = [
      '',
      null,
      undefined,
      0,
      42,
      false,
      '   ',
      'I AM ANA',
      'i am  ana.',
      'She is — my sister!',
      'He is; he’s; he‘s; he`s',
      'IT IS (it’s) "fine"',
      'Who is this? – It is our neighbor…',
      'iam i amazing; i am.',
      'this-is a test',
      '¿Qué? ¡Hola! São Paulo',
      'whois who is who isn’t',
      '\tGood\nmorning\r\n',
      'shes she is she isn’t',
      'I’m Ana. I am Ana.',
    ];
    for (const c of cases) expect(norm(c), String(c)).toBe(D.norm(c));
  });
});
