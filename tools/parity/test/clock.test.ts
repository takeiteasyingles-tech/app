// The Worker clock shim must behave like Date in every form a dependency may use.
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { clockShimSource } from '../src/wranglerDev';

const OFFSET = 1_000_000_000;

function sandbox() {
  const ctx = createContext({});
  // The shim is an ES module only for its (absent) exports; its body runs as a script too.
  runInContext(clockShimSource(OFFSET), ctx);
  return (code: string) => runInContext(code, ctx);
}

describe('parity clock shim', () => {
  it('shifts Date.now() and new Date()', () => {
    const run = sandbox();
    const real = run('Reflect.getPrototypeOf(Date).now()') as number;
    const shifted = run('Date.now()') as number;
    expect(Math.abs(real - OFFSET - shifted)).toBeLessThan(1000);
    const d = run('new Date().getTime()') as number;
    expect(Math.abs(d - shifted)).toBeLessThan(1000);
  });

  it('Date() without new returns a string (and does not throw)', () => {
    const run = sandbox();
    const s = run('Date()');
    expect(typeof s).toBe('string');
    const year = run('new Date(Date.now()).getFullYear()');
    expect(String(s)).toContain(String(year));
  });

  it('explicit arguments, statics, instanceof and subclasses keep working', () => {
    const run = sandbox();
    expect(run('new Date(0).toISOString()')).toBe('1970-01-01T00:00:00.000Z');
    expect(run('new Date(2026, 8, 15).getMonth()')).toBe(8);
    expect(run("Date.parse('2026-09-15T15:00:00Z')")).toBe(Date.parse('2026-09-15T15:00:00Z'));
    expect(run('Date.UTC(2026, 0, 1)')).toBe(Date.UTC(2026, 0, 1));
    expect(run('new Date() instanceof Date')).toBe(true);
    expect(run('Object.prototype.toString.call(new Date())')).toBe('[object Date]');
    expect(
      run(
        'class X extends Date { y() { return 1; } }; const x = new X(5); [x instanceof X, x instanceof Date, x.y(), x.getTime()]',
      ),
    ).toEqual([true, true, 1, 5]);
    expect(run('class Z extends Date {}; Math.abs(new Z().getTime() - Date.now()) < 1000')).toBe(true);
    expect(run('typeof Date.prototype.getTime')).toBe('function');
  });
});
