// Loads the prototype's ORIGINAL logic files (data + js/core/{personalize,game,guide,review,ai}.js)
// into one node:vm sandbox, so parity tests can call the real prototype functions next to the TS
// ports. Math.random is seedable and the clock is fixed; TIE.u comes from store.js itself.
// Nothing under prototipo/ is modified: ai.js only gets an extra line appended in memory to
// expose closure internals (demoReply, recast, script…).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { type Rng, seededRng } from '../../src/demo/rng';
import { type Any, PROTO_DIR } from './prototype';

const read = (rel: string) => readFileSync(PROTO_DIR + rel, 'utf8');

/** Source text of the initializer of `const <name> = …` or of `function <name>(…) {…}`. */
export function declSource(rel: string, name: string): string {
  const src = read(rel);
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  let out: string | null = null;
  simple(ast, {
    VariableDeclarator(node: Any) {
      if (!out && node.id?.type === 'Identifier' && node.id.name === name && node.init) {
        out = src.slice(node.init.start, node.init.end);
      }
    },
    FunctionDeclaration(node: Any) {
      if (!out && node.id?.name === name) out = `(${src.slice(node.start, node.end)})`;
    },
  });
  if (out === null) throw new Error(`${name} not found in ${rel}`);
  return out;
}

export interface ProtoCore {
  /** The sandbox's TIE. */
  T: Any;
  ctx: vm.Context;
  /** Replaces TIE.store.s (the prototype's whole persisted state). */
  setState(s: Any): void;
  /** Fixes Date.now() / new Date() inside the sandbox. */
  setNow(ms: number): void;
  /** Reseeds Math.random inside the sandbox; returns an identical rng for the TS side. */
  seed(n: number): Rng;
  /** Evaluates an expression inside the sandbox. */
  run(code: string): Any;
}

const AI_EXPOSE = 'ai.analyze = analyze;';

export function loadPrototypeCore(): ProtoCore {
  let now = Date.UTC(2026, 8, 15, 15, 0, 0);
  let random: Rng = seededRng(1);
  const HostDate = Date;
  class FixedDate extends HostDate {
    constructor(...args: Any[]) {
      if (args.length) super(...(args as [Any]));
      else super(now);
    }
    static override now() {
      return now;
    }
  }
  const sandboxMath = Object.create(Math);
  sandboxMath.random = () => random();

  const sandbox: Any = { Math: sandboxMath, Date: FixedDate, console };
  sandbox.window = sandbox;
  sandbox.TIE = { store: { s: { profile: null }, save() {} } };
  const ctx = vm.createContext(sandbox);
  const run = (code: string, filename?: string) => vm.runInContext(code, ctx, filename ? { filename } : undefined);

  // TIE.u exactly as store.js defines it, evaluated in the sandbox (so pick/today see the stubs).
  const U = ['esc', 'pad2', 'fmt', 'sub', 'pick', 'shuffle', 'uid', 'today'];
  sandbox.TIE.u = run(
    `(() => { ${U.map((k) => `const ${k} = ${declSource('js/core/store.js', k)};`).join('\n')} return { ${U.join(', ')} }; })()`,
  );

  for (const f of ['curriculum', 'onboarding', 'extras', 'maggie', 'mic-clips', 'assistants']) {
    run(read(`js/data/${f}.js`), `${f}.js`);
  }
  for (const f of ['personalize', 'game', 'guide', 'review']) run(read(`js/core/${f}.js`), `${f}.js`);

  const ai = read('js/core/ai.js');
  if (!ai.includes(AI_EXPOSE)) throw new Error('ai.js changed: expose hook not found');
  run(
    ai.replace(AI_EXPOSE, `ai.__ = { RULES, PT, PRAISE, recast, hintFor, script, lines, demoReply }; ${AI_EXPOSE}`),
    'ai.js',
  );

  return {
    T: sandbox.TIE,
    ctx,
    setState(s) {
      sandbox.TIE.store.s = s;
    },
    setNow(ms) {
      now = ms;
    },
    seed(n) {
      random = seededRng(n);
      return seededRng(n);
    },
    run: (code) => run(code),
  };
}

/** Deep copy into plain host-realm JSON (drops undefined and functions) for toEqual. */
export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
