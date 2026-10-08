// Loads the prototype's data scripts in node:vm (the same sandbox the seed uses) and extracts
// constants that live inside closures with acorn. Read-only access to prototipo/.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

export const PROTO_DIR = fileURLToPath(new URL('../../../../prototipo/', import.meta.url));

const read = (rel: string) => readFileSync(PROTO_DIR + rel, 'utf8');

// biome-ignore lint/suspicious/noExplicitAny: prototype globals are untyped JS
export type Any = any;

export function loadPrototypeData(): Any {
  const sandbox: Any = {};
  sandbox.window = sandbox;
  sandbox.TIE = {
    u: {
      esc: (s: unknown) => String(s ?? ''),
      sub: (t: unknown, name: string) =>
        String(t ?? '')
          .split('{N}')
          .join(name ?? ''),
      pick: (a: unknown[]) => a[0],
      shuffle: (a: unknown[]) => a,
      today: () => '2026-09-15',
    },
    store: { s: { profile: null } },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['curriculum', 'onboarding', 'extras', 'maggie', 'mic-clips', 'assistants']) {
    vm.runInContext(read(`js/data/${f}.js`), ctx, { filename: `${f}.js` });
  }
  return sandbox.TIE;
}

/** Evaluates the initializer of `const <name> = …` found anywhere in a prototype file. */
export function extractConst(rel: string, name: string, scope: Record<string, unknown> = {}): Any {
  const src = read(rel);
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  let init: { start: number; end: number } | null = null;
  simple(ast, {
    VariableDeclarator(node: Any) {
      if (!init && node.id?.type === 'Identifier' && node.id.name === name && node.init) init = node.init;
    },
  });
  if (!init) throw new Error(`${name} not found in ${rel}`);
  const { start, end } = init as { start: number; end: number };
  return vm.runInNewContext(`(${src.slice(start, end)})`, { ...scope });
}
