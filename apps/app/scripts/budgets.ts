// Bundle budgets for a production build of the student PWA (spec 04 §5 "Performance"):
//   - initial JS (everything index.html downloads: the entry, the chunks it imports statically and every
//     modulepreload, the landing screens included) ≤ 60 KB gzip;
//   - each lazy screen chunk (screens/registry.ts) ≤ 25 KB gzip;
//   - zod is not in the bundle (scripts/slimSchemas.ts keeps it out; the client never validates).
// CSS is reported (initial and per screen), not budgeted. Sizes are gzip at zlib's default level, in
// kB of 1000 bytes, as vite prints them.
//
//   npm run budgets -w @tie/app                    # checks dist/web
//   npm run budgets -w @tie/app -- dist/web-perf   # another outDir (relative to apps/app)
//   npm run budgets -w @tie/app -- dist/web --json out.json
// Exits 1 when a budget is exceeded.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
/** kB as vite prints it (1000 bytes): the stricter reading of the spec's KB. */
const KB = 1000;
export const BUDGETS = { initialJsGzip: 60 * KB, screenChunkGzip: 25 * KB } as const;

interface Asset {
  file: string;
  bytes: number;
  gzip: number;
}

export interface ScreenReport {
  screen: string;
  chunk: Asset;
  /** The chunk plus the shared chunks it imports statically that the shell has not loaded yet. */
  routeJsGzip: number;
  css: Asset[];
}

export interface BudgetReport {
  outDir: string;
  initialJs: Asset[];
  initialJsGzip: number;
  initialCss: Asset[];
  initialCssGzip: number;
  screens: ScreenReport[];
  otherLazy: Asset[];
  allJsGzip: number;
  allCssGzip: number;
  zodChunks: string[];
  violations: string[];
}

function asset(outDir: string, file: string): Asset {
  const buf = readFileSync(join(outDir, file));
  return { file, bytes: buf.length, gzip: gzipSync(buf).length };
}

interface Imports {
  statics: string[];
  dynamics: string[];
  /** Per dynamic import: the files vite preloads with it (__vite__mapDeps), CSS included. */
  preloads: Map<string, string[]>;
}

const toAsset = (rel: string) => `assets/${rel.replace(/^\.\//, '')}`;

/** `./x.js` imports of one chunk: static (import … from "…" / import "…") and dynamic (import(`…`)). */
function importsOf(code: string): Imports {
  const statics = new Set<string>();
  const dynamics = new Set<string>();
  const preloads = new Map<string, string[]>();
  for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'`](\.\/[\w.-]+\.js)["'`]/g))
    statics.add(toAsset(m[1] as string));
  // const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/a.js","assets/a.css",…])))=>…
  const table = /__vite__mapDeps=[^[]*\[([^\]]*)\]/.exec(code)?.[1];
  const depFiles = table ? [...table.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1] as string) : [];
  for (const m of code.matchAll(/\bimport\(\s*["'`](\.\/[\w.-]+\.js)["'`]\s*\)/g)) {
    const file = toAsset(m[1] as string);
    dynamics.add(file);
    const after = code.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 200);
    const idx = /^[\s\S]*?__vite__mapDeps\(\[([\d,]*)\]\)/.exec(after.split(/\bimport\(/)[0] as string)?.[1];
    if (idx)
      preloads.set(
        file,
        idx.split(',').map((i) => depFiles[Number(i)] as string),
      );
  }
  return { statics: [...statics], dynamics: [...dynamics], preloads };
}

/** Screen chunk base names from screens/registry.ts: import('./entrada/Entrar') → Entrar. */
function screenNames(): string[] {
  const src = readFileSync(join(APP_DIR, 'web', 'src', 'screens', 'registry.ts'), 'utf8');
  return [...src.matchAll(/import\(\s*'\.\/[\w/]+\/(\w+)'\s*\)/g)].map((m) => m[1] as string);
}

export function measure(outDir: string): BudgetReport {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const entry = /<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (!entry) throw new Error(`no module entry script in ${join(outDir, 'index.html')}`);
  const initialCssFiles = [
    ...html.matchAll(/<link rel="(?:stylesheet|preload)"[^>]*href="\/(assets\/[^"]+\.css)"/g),
  ].map((m) => m[1] as string);

  const files = readdirSync(join(outDir, 'assets'));
  const jsFiles = files.filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);
  const cssFiles = files.filter((f) => f.endsWith('.css')).map((f) => `assets/${f}`);
  const code = new Map(jsFiles.map((f) => [f, readFileSync(join(outDir, f), 'utf8')]));
  const graph = new Map(jsFiles.map((f) => [f, importsOf(code.get(f) as string)]));

  const closure = (start: string, skip: ReadonlySet<string> = new Set()): Set<string> => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop() as string;
      if (seen.has(f) || skip.has(f)) continue;
      seen.add(f);
      for (const s of graph.get(f)?.statics ?? []) stack.push(s);
    }
    return seen;
  };

  // index.html also modulepreloads the landing screens (vite.config.ts preloadLandingScreens).
  const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/(assets\/[^"]+\.js)"/g)].map(
    (m) => m[1] as string,
  );
  const initial = new Set([entry, ...preloaded].flatMap((f) => [...closure(f)]));
  const initialJs = [...initial].map((f) => asset(outDir, f));
  const initialCss = initialCssFiles.map((f) => asset(outDir, f));

  const dynamicTargets = new Set<string>();
  const preloads = new Map<string, string[]>();
  for (const g of graph.values()) {
    for (const d of g.dynamics) dynamicTargets.add(d);
    for (const [k, v] of g.preloads) preloads.set(k, v);
  }

  const screens: ScreenReport[] = [];
  const screenFiles = new Set<string>();
  for (const name of screenNames()) {
    const file = [...dynamicTargets].find((f) => new RegExp(`^assets/${name}-[\\w-]+\\.js$`).test(f));
    if (!file) throw new Error(`no lazy chunk for screen ${name} (is it still in screens/registry.ts?)`);
    screenFiles.add(file);
    const route = closure(file, initial);
    const routeJsGzip = [...route].reduce((n, f) => n + asset(outDir, f).gzip, 0);
    const css = (preloads.get(file) ?? []).filter((d) => d.endsWith('.css') && existsSync(join(outDir, d)));
    screens.push({ screen: name, chunk: asset(outDir, file), routeJsGzip, css: css.map((c) => asset(outDir, c)) });
  }
  const otherLazy = [...dynamicTargets]
    .filter((f) => !screenFiles.has(f) && !initial.has(f))
    .sort()
    .map((f) => asset(outDir, f));

  const zodChunks = jsFiles.filter((f) => /__zod_globalConfig|\$ZodType|ZodError/.test(code.get(f) as string));
  const sum = (xs: Asset[]) => xs.reduce((n, a) => n + a.gzip, 0);
  const initialJsGzip = sum(initialJs);

  const violations: string[] = [];
  if (initialJsGzip > BUDGETS.initialJsGzip) {
    violations.push(`initial JS ${kb(initialJsGzip)} gzip > ${kb(BUDGETS.initialJsGzip)}`);
  }
  for (const s of screens) {
    if (s.chunk.gzip > BUDGETS.screenChunkGzip) {
      violations.push(`screen ${s.screen} chunk ${kb(s.chunk.gzip)} gzip > ${kb(BUDGETS.screenChunkGzip)}`);
    }
  }
  if (zodChunks.length) {
    violations.push(
      `zod is bundled again (${zodChunks.join(', ')}): some client code reads a schema at runtime; see scripts/slimSchemas.ts`,
    );
  }

  return {
    outDir,
    initialJs,
    initialJsGzip,
    initialCss,
    initialCssGzip: sum(initialCss),
    screens,
    otherLazy,
    allJsGzip: sum(jsFiles.map((f) => asset(outDir, f))),
    allCssGzip: sum(cssFiles.map((f) => asset(outDir, f))),
    zodChunks,
    violations,
  };
}

const kb = (n: number) => `${(n / KB).toFixed(2)} kB`;
const pad = (s: string, n: number) => s.padEnd(n);

function print(r: BudgetReport): void {
  const line = (label: string, a: Asset) => `  ${pad(label, 34)} ${pad(kb(a.bytes), 11)} gzip ${kb(a.gzip)}`;
  console.log(`Budgets for ${r.outDir}`);
  console.log(`\nInitial JS: ${kb(r.initialJsGzip)} gzip (budget ${kb(BUDGETS.initialJsGzip)})`);
  for (const a of r.initialJs) console.log(line(a.file, a));
  console.log(`\nInitial CSS: ${kb(r.initialCssGzip)} gzip`);
  for (const a of r.initialCss) console.log(line(a.file, a));
  console.log(
    `\nScreens (chunk budget ${kb(BUDGETS.screenChunkGzip)} gzip; route = chunk + shared chunks not in the shell)`,
  );
  for (const s of [...r.screens].sort((a, b) => b.chunk.gzip - a.chunk.gzip)) {
    const css = s.css.reduce((n, c) => n + c.gzip, 0);
    console.log(
      `  ${pad(s.screen, 12)} chunk ${pad(kb(s.chunk.gzip), 10)} route JS ${pad(kb(s.routeJsGzip), 10)} CSS ${kb(css)}`,
    );
  }
  console.log('\nOther lazy chunks');
  for (const a of r.otherLazy) console.log(line(a.file, a));
  console.log(
    `\nAll JS ${kb(r.allJsGzip)} gzip · all CSS ${kb(r.allCssGzip)} gzip · zod chunks: ${r.zodChunks.length}`,
  );
  if (r.violations.length) {
    console.log('\nBUDGET VIOLATIONS');
    for (const v of r.violations) console.log(`  - ${v}`);
  } else {
    console.log('\nAll budgets met.');
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let jsonOut: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') jsonOut = args[++i] ?? null;
    else rest.push(args[i] as string);
  }
  const outDir = resolve(APP_DIR, rest[0] ?? 'dist/web');
  const report = measure(outDir);
  print(report);
  if (jsonOut) writeFileSync(resolve(jsonOut), `${JSON.stringify(report, null, 2)}\n`);
  if (report.violations.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
