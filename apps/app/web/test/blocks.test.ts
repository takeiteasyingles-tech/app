// DOM parity of <Blocks> with TIE.blocks (prototipo/js/screens/curso.js run in node:vm): same tags,
// classes, inline styles and text for the same blocks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { Block } from '@tie/shared/content/schema';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { parseHtml, renderVNode } from '../../../../packages/ui/test/helpers/canon';
import { Blocks } from '../src/ui-blocks/Blocks';

// biome-ignore lint/suspicious/noExplicitAny: prototype globals are untyped JS
type Any = any;

function prototypeBlocks(): (list: unknown, badLabel?: string) => string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
  const sandbox: Any = {
    TIE: {
      u: { esc, pad2: (n: number) => String(n).padStart(2, '0'), sub: (t: string) => t },
      C: {},
      icon: () => '',
      screens: {},
      ui: {},
      act: {},
    },
  };
  sandbox.window = sandbox;
  const src = readFileSync(
    fileURLToPath(new URL('../../../../prototipo/js/screens/curso.js', import.meta.url)),
    'utf8',
  );
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'curso.js' });
  return sandbox.TIE.blocks;
}

const LESSON: Block[] = [
  {
    k: 'TO BE',
    title: 'I am, you are, she is',
    body: 'O verbo to be é "ser" e "estar" ao mesmo tempo.',
    body2: 'Em inglês, a frase sempre tem sujeito <sempre>.',
    rows: [
      {
        q: 'Como dizer "tenho 30 anos"?',
        en: 'I’m 30.',
        pt: 'Tenho 30 anos.',
        bad: 'I have 30 years.',
        note: 'Idade usa to be.',
      },
      { en: 'She’s a designer.' },
      { en: 'It’s cold & rainy.', pt: 'Está frio e chuvoso.' },
    ],
    bullets: ['Contraia: I’m, you’re, she’s.', 'Pergunta inverte: Are you…?'],
    callout: 'Regra de ouro: sujeito + verbo, sempre.',
  },
  { k: '', title: 'Só título' },
  { k: 'FALSOS AMIGOS', rows: [{ en: 'actually', bad: 'atualmente' }], badLabel: 'NÃO SIGNIFICA' },
  { k: 'VAZIO', rows: [], bullets: [], title: '', body: '' },
];

describe('Blocks (TIE.blocks)', () => {
  const proto = prototypeBlocks();

  for (const badLabel of ['EVITE', undefined]) {
    it(`renders the prototype markup (badLabel ${badLabel ?? 'default'})`, () => {
      const expected = parseHtml(proto(LESSON, badLabel));
      const actual = renderVNode(h(Blocks, { list: LESSON, ...(badLabel ? { badLabel } : {}) }));
      expect(actual).toEqual(expected);
    });
  }

  it('uses the block badLabel, then the argument, then "NÃO É"', () => {
    const text = JSON.stringify(renderVNode(h(Blocks, { list: LESSON })));
    expect(text).toContain('NÃO SIGNIFICA');
    expect(text).toContain('NÃO É');
    expect(JSON.stringify(renderVNode(h(Blocks, { list: LESSON, badLabel: 'EVITE' })))).toContain('EVITE');
  });

  it('renders nothing for an empty or missing list', () => {
    expect(renderVNode(h(Blocks, { list: [] }))).toEqual(parseHtml(proto([])));
    expect(renderVNode(h(Blocks, { list: null }))).toEqual([]);
  });
});
