// Vite plugin: keeps zod out of the browser bundle (spec 04 §5 "Performance": initial JS ≤60 KB gzip).
//
// The client imports @tie/shared endpoint tables (meApi, srsApi…) for their method and path, and the
// pure helpers that live next to the schemas (freshState, stepKey, ApiError…). The browser never
// validates with those schemas: the Worker does (spec 04 §5 "Validation"), and the client only needs
// their *types*, which TypeScript erases. Yet every table holds its schemas, and each schema module
// builds them at its top level, so the whole of zod (~26 KB gzip) shipped in the shell.
//
// For the modules of packages/shared/src that import zod, after TypeScript is stripped:
//   1. Inside `endpoint({...})`, the schema-valued `params`, `query`, `body` and `res` become
//      `void 0`. A string `res` ('binary') stays: api/client.ts reads it. method, path, access,
//      multipart (photo.ts reads its field) and the other plain values stay.
//   2. Every top-level `const` whose initializer runs code (z.object(), Profile.omit().partial(),
//      tables of endpoint() calls…) is wrapped in a `/* @__PURE__ */` IIFE, so the bundler drops the
//      ones nothing reads, and with them every schema they referenced and finally zod itself.
// Values the client does read are kept as they were: the transform never changes what a used binding
// holds, apart from the endpoint schemas of step 1. apps/app/scripts/budgets.ts fails the build check
// if zod comes back into the bundle.
import type { Plugin } from 'vite';

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string' && typeof (v as Node).start === 'number';

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) for (const v of value) isNode(v) && out.push(v);
    else if (isNode(value)) out.push(value);
  }
  return out;
}

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

/** True when evaluating `node` calls something (function bodies are not evaluated, so not entered). */
function runsCode(node: Node): boolean {
  if (FUNCTION_TYPES.has(node.type) || node.type === 'ClassExpression') return false;
  if (node.type === 'CallExpression' || node.type === 'NewExpression' || node.type === 'TaggedTemplateExpression')
    return true;
  return children(node).some(runsCode);
}

const SCHEMA_PROPS = new Set(['params', 'query', 'body', 'res']);
const SHARED_SRC = /[\\/]packages[\\/]shared[\\/]src[\\/].+\.ts$/;
const IMPORTS_ZOD = /\bfrom\s*["']zod["']/;

interface Edit {
  start: number;
  end: number;
  text: string;
}

export function slimSchemas(): Plugin {
  return {
    name: 'tie:slim-schemas',
    // Production bundles only: dev and the web unit tests keep the modules as written.
    apply: 'build',
    // After vite's own TypeScript transform: the code is plain JS here.
    enforce: 'post',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!SHARED_SRC.test(file) || !IMPORTS_ZOD.test(code)) return null;
      const program = this.parse(code) as unknown as Node;
      const edits: Edit[] = [];

      // 1. endpoint({...}): drop the schema values.
      const visit = (node: Node) => {
        const callee = node.callee as Node | undefined;
        const arg = (node.arguments as Node[] | undefined)?.[0];
        if (
          node.type === 'CallExpression' &&
          callee?.type === 'Identifier' &&
          callee.name === 'endpoint' &&
          arg?.type === 'ObjectExpression'
        ) {
          for (const prop of arg.properties as Node[]) {
            const key = prop.key as Node | undefined;
            const value = prop.value as Node | undefined;
            if (prop.type !== 'Property' || !key || !value || key.type !== 'Identifier') continue;
            if (!SCHEMA_PROPS.has(key.name as string)) continue;
            if (value.type === 'Literal' && typeof value.value === 'string') continue;
            if (code.slice(key.start, key.end) !== key.name) {
              this.error(`slim-schemas: AST offsets do not match the source of ${file}`);
            }
            edits.push({ start: value.start, end: value.end, text: 'void 0' });
          }
        }
        for (const child of children(node)) visit(child);
      };
      visit(program);

      // 2. Top-level consts that run code at module evaluation: pure IIFEs.
      for (const stmt of program.body as Node[]) {
        const decl = stmt.type === 'ExportNamedDeclaration' ? (stmt.declaration as Node | null) : stmt;
        if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
        for (const d of decl.declarations as Node[]) {
          const init = d.init as Node | null;
          if (!init || !runsCode(init)) continue;
          // Offsets must be UTF-16 string indices (these files hold pt-BR copy): a declarator starts
          // with its own name, or the edits would land in the wrong place.
          const name = (d.id as Node).name;
          if (typeof name === 'string' && code.slice(d.start, d.start + name.length) !== name) {
            this.error(`slim-schemas: AST offsets do not match the source of ${file}`);
          }
          edits.push({ start: init.start, end: init.start, text: '/* @__PURE__ */ (() => (' });
          edits.push({ start: init.end, end: init.end, text: '))()' });
        }
      }
      if (!edits.length) return null;

      // Later edits first, so earlier offsets stay valid; at one offset, the IIFE close (an insertion
      // at an init's end) goes after any edit that ends there.
      edits.sort((a, b) => b.start - a.start || b.end - a.end);
      let out = code;
      for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      return { code: out, map: null };
    },
  };
}
