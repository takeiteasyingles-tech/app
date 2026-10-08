// Constants the prototype keeps inside closures or inline in screen markup, pulled out with acorn.
// Every extractor throws when the prototype no longer has the shape it expects, so a prototype
// change breaks the seed loudly instead of seeding stale or empty content.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { type Any, extractConst, PROTO_DIR } from './loadPrototype';

const read = (rel: string) => readFileSync(PROTO_DIR + rel, 'utf8');
const ast = (rel: string) => parse(read(rel), { ecmaVersion: 'latest', sourceType: 'script' });

/** Every string literal value in a prototype file. */
function stringLiterals(rel: string): string[] {
  const out: string[] = [];
  simple(ast(rel), {
    Literal(node: Any) {
      if (typeof node.value === 'string') out.push(node.value);
    },
    TemplateElement(node: Any) {
      if (typeof node.value?.cooked === 'string') out.push(node.value.cooked);
    },
  });
  return out;
}

function htmlBetween(text: string, open: RegExp, rel: string, what: string): string {
  const m = open.exec(text);
  if (!m?.[1]) throw new Error(`${what} not found in ${rel}`);
  return m[1];
}

export interface Extracted {
  FOCUS: Record<string, { t: string; b: string; cta: string; go: string }>;
  FORMAT_WORD: Record<string, string>;
  FORMAT_THEME: Record<string, string>;
  SEASONS: string[];
  POINTS: Record<string, number>;
  LEVELS: [number, string][];
  BADGES: { id: string; t: string; s: string; icon: string }[];
  GRADES: [string, string, number][];
  EXTRAS_EB: { name: string; pt: string; desc: string; meta: string; go: string }[];
  SHELVES: [string, string][];
  /** E-book subtitles from the Trilha chapter headers ("E-book 1 · Nice to Meet You"). */
  ebookTitles: Record<number, string>;
  /** Season 1 blurb on the Trilha card. */
  seasonSynopsis: string;
  /** "Na próxima" card on the e-book 1 page. */
  ebookTeaser: { title: string; sub: string };
  /** Take a Look stills (player.js STEP[4]): per-episode overrides and the default. */
  sceneImages: { default: string; episodes: Record<number, string> };
  /** Every literal 'assets/...' path the screens, UI and core scripts hardcode. */
  hardcodedAssets: string[];
  /** Directory the avatar module builds user-<n>.webp / as-<k>-*.webp paths from. */
  avatarDir: string;
}

/** Trilha: `e === 1 ? ' · Nice to Meet You' : e === 2 ? ' · Sunday Lunch' : …` */
function ebookTitles(): Record<number, string> {
  const rel = 'js/screens/curso.js';
  const out: Record<number, string> = {};
  simple(ast(rel), {
    ConditionalExpression(node: Any) {
      const t = node.test;
      if (
        t?.type === 'BinaryExpression' &&
        t.operator === '===' &&
        t.left?.type === 'Identifier' &&
        t.left.name === 'e' &&
        t.right?.type === 'Literal' &&
        typeof t.right.value === 'number' &&
        node.consequent?.type === 'Literal' &&
        typeof node.consequent.value === 'string' &&
        node.consequent.value.startsWith(' · ')
      ) {
        out[t.right.value] = node.consequent.value.slice(3).trim();
      }
    },
  });
  if (!out[1]) throw new Error(`e-book chapter titles not found in ${rel}`);
  return out;
}

/** player.js STEP[4]: `const scene = Ep.num === 2 ? 'assets/…/cafe-counter.webp' : 'assets/…/home.webp'`. */
function sceneImages(): Extracted['sceneImages'] {
  const rel = 'js/screens/player.js';
  let found: Extracted['sceneImages'] | null = null;
  simple(ast(rel), {
    VariableDeclarator(node: Any) {
      if (found || node.id?.name !== 'scene' || node.init?.type !== 'ConditionalExpression') return;
      const { test, consequent, alternate } = node.init;
      if (
        test?.type === 'BinaryExpression' &&
        test.operator === '===' &&
        test.left?.type === 'MemberExpression' &&
        test.left.property?.name === 'num' &&
        typeof test.right?.value === 'number' &&
        typeof consequent?.value === 'string' &&
        typeof alternate?.value === 'string'
      ) {
        found = { default: alternate.value, episodes: { [test.right.value]: consequent.value } };
      }
    },
  });
  if (!found) throw new Error(`scene image fallback not found in ${rel}`);
  return found;
}

function listJs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(PROTO_DIR, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.name.endsWith('.js')) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const ASSET_RE = /assets\/[\w./-]+\.(?:webp|png|jpe?g|svg|mp3|mp4|webm|pdf)/g;

function hardcodedAssets(): string[] {
  const found = new Set<string>();
  for (const rel of ['js/screens', 'js/ui', 'js/core'].flatMap(listJs)) {
    for (const s of stringLiterals(rel)) for (const m of s.match(ASSET_RE) ?? []) found.add(m);
  }
  return [...found].sort();
}

export function extract(): Extracted {
  const curso = 'js/screens/curso.js';
  const trilhaCard = stringLiterals(curso).find((s) => s.includes('Ver as 8 temporadas'));
  if (!trilhaCard) throw new Error(`season card not found in ${curso}`);
  const teaserCard = stringLiterals(curso).find((s) => s.includes('Na próxima'));
  if (!teaserCard) throw new Error(`"Na próxima" card not found in ${curso}`);

  const avatarDir = extractConst('js/ui/avatar2d.js', 'DIR');
  if (typeof avatarDir !== 'string' || !avatarDir.startsWith('assets/')) throw new Error('avatar2d DIR changed');

  return {
    FOCUS: extractConst('js/core/personalize.js', 'FOCUS'),
    FORMAT_WORD: extractConst('js/core/personalize.js', 'FORMAT_WORD'),
    FORMAT_THEME: extractConst('js/core/personalize.js', 'FORMAT_THEME'),
    SEASONS: extractConst(curso, 'SEASONS'),
    POINTS: extractConst('js/core/game.js', 'POINTS'),
    LEVELS: extractConst('js/core/game.js', 'LEVELS'),
    BADGES: (extractConst('js/core/game.js', 'BADGES') as Any[]).map(({ id, t, s, icon }) => ({ id, t, s, icon })),
    GRADES: extractConst('js/core/review.js', 'GRADES', { MIN: 6e4, DAY: 864e5 }),
    EXTRAS_EB: extractConst(curso, 'EXTRAS_EB'),
    SHELVES: extractConst('js/screens/extra.js', 'SHELVES'),
    ebookTitles: ebookTitles(),
    seasonSynopsis: htmlBetween(trilhaCard, /<p class="p">([^<]+)<\/p>/, curso, 'season synopsis'),
    ebookTeaser: {
      title: htmlBetween(teaserCard, /<div class="h3">([^<]+)<\/div>/, curso, 'teaser title'),
      sub: htmlBetween(teaserCard, /<p class="p">([^<]+)<\/p>/, curso, 'teaser sub'),
    },
    sceneImages: sceneImages(),
    hardcodedAssets: hardcodedAssets(),
    avatarDir,
  };
}
