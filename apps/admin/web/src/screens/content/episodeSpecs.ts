// Form specs of the episode editor, one list per tab. The document edited is the episode row plus its
// child rows: `mic` (Take the Mic phrases) and `ex` (Take Action exercises, each with its `items`).
import type { Spec } from '../../ui/form';

export type TabId = 'geral' | 'midia' | 'musica' | 'olhar' | 'dialogo' | 'mic' | 'licao' | 'away' | 'exercicios' | 'fim';

export const TABS: readonly (readonly [TabId, string])[] = [
  ['geral', 'Geral'],
  ['midia', 'Mídia'],
  ['musica', '2 · Música'],
  ['olhar', '4 · Take a Look'],
  ['dialogo', '5 · Take It In'],
  ['mic', '6 · Take the Mic'],
  ['licao', '7 · Take a Lesson'],
  ['away', '8 · Take Away'],
  ['exercicios', '9 · Take Action'],
  ['fim', 'Conclusão'],
];

const GERAL: Spec[] = [
  { t: 'text', k: 'title', label: 'Título', max: 200 },
  {
    t: 'select',
    k: 'status',
    label: 'Situação',
    hint: 'Publicado aparece para os alunos (pede a tela de conclusão). Só título aparece bloqueado na trilha.',
    options: [
      ['title_only', 'Só título'],
      ['draft', 'Rascunho'],
      ['published', 'Publicado'],
    ],
  },
  { t: 'int', k: 'seasonN', label: 'Temporada', opt: 'null', min: 1 },
  { t: 'int', k: 'ebookNum', label: 'E-book', opt: 'null', min: 1, hint: 'O e-book que cobre este episódio (etapa 3).' },
  { t: 'text', k: 'synopsis', label: 'Sinopse', opt: 'null', rows: 3, hint: 'Mostrada na Intro (etapa 1).' },
  {
    t: 'strings',
    k: 'castNames',
    label: 'Personagens',
    wide: true,
    ph: 'Nome e Enter',
    hint: 'Quem aparece no episódio (Intro e Take It In). As cores vêm do elenco do curso.',
  },
];

const MIDIA: Spec[] = [
  { t: 'media', k: 'introMedia', label: 'Áudio da Intro (etapa 1)', kind: 'audio', opt: 'null' },
  { t: 'text', k: 'songTitle', label: 'Título da música', opt: 'null' },
  { t: 'media', k: 'songMedia', label: 'Música (etapas 2 e 10)', kind: 'audio', opt: 'null' },
  { t: 'media', k: 'sceneMedia', label: 'Vídeo da cena (etapa 4)', kind: 'video', opt: 'null' },
  { t: 'text', k: 'sceneNote', label: 'Nota da cena', opt: 'null', rows: 2 },
];

const MUSICA: Spec[] = [
  {
    t: 'list',
    k: 'lyrics',
    label: 'Letra',
    item: 'linha',
    inline: true,
    hint: 'A lacuna é a palavra que o aluno completa no karaokê.',
    of: [
      { t: 'text', k: 'en', label: 'Inglês' },
      { t: 'text', k: 'pt', label: 'Tradução' },
      { t: 'text', k: 'gap', label: 'Lacuna', opt: 'undef' },
    ],
  },
];

const OLHAR: Spec[] = [
  {
    t: 'list',
    k: 'visual',
    label: 'Vocabulário da cena',
    item: 'palavra',
    inline: true,
    hint: 'Viram cartões de revisão quando o aluno termina a etapa 4.',
    of: [
      { t: 'text', k: 'en', label: 'Inglês' },
      { t: 'text', k: 'pt', label: 'Tradução' },
    ],
  },
];

const DIALOGO: Spec[] = [
  { t: 'text', k: 'dialogTitle', label: 'Título do diálogo', opt: 'null' },
  { t: 'text', k: 'dialogSub', label: 'Subtítulo', opt: 'null' },
  {
    t: 'list',
    k: 'dialog',
    label: 'Falas',
    item: 'fala',
    summary: (v) => `${v.stage ? '(cena) ' : v.who ? `${String(v.who)}: ` : ''}${String(v.en ?? '')}`,
    of: [
      { t: 'text', k: 'who', label: 'Quem fala', hint: 'Vazio numa indicação de cena; "All" para todos.' },
      { t: 'bool', k: 'stage', label: 'Indicação de cena', opt: 'undef', hint: 'Ex.: (the doorbell rings)' },
      { t: 'text', k: 'en', label: 'Inglês', rows: 2 },
      { t: 'text', k: 'pt', label: 'Tradução', rows: 2 },
      { t: 'text', k: 'err', label: 'Nota de erro comum', opt: 'undef', rows: 2, hint: 'Aparece em azul abaixo da fala.' },
      { t: 'text', k: 'hook', label: 'Destaque', opt: 'undef' },
    ],
  },
];

const MIC: Spec[] = [
  {
    t: 'list',
    k: 'mic',
    label: 'Frases para gravar',
    item: 'frase',
    open: false,
    of: [
      { t: 'text', k: 'en', label: 'Frase em inglês', wide: true },
      { t: 'text', k: 'tip', label: 'Dica de pronúncia', opt: 'null', rows: 2 },
      { t: 'text', k: 'fb', label: 'Retorno no modo demo', opt: 'null', rows: 2 },
      { t: 'int', k: 'demoResult', label: 'Nota no modo demo (0 a 10)', opt: 'null', min: 0, max: 10 },
      { t: 'bool', k: 'blue', label: 'Retorno em azul (ajuste)', hint: 'Mostra o retorno demo como correção.' },
    ],
  },
];

const ROW_SPECS: Spec[] = [
  { t: 'text', k: 'q', label: 'Pergunta / contexto', opt: 'undef' },
  { t: 'text', k: 'en', label: 'Inglês' },
  { t: 'text', k: 'pt', label: 'Tradução', opt: 'undef' },
  { t: 'text', k: 'bad', label: 'Forma errada', opt: 'undef' },
  { t: 'text', k: 'note', label: 'Nota', opt: 'undef', rows: 2 },
];

export const BLOCK_SPECS: Spec[] = [
  { t: 'text', k: 'k', label: 'Rótulo', hint: 'Ex.: "1 · Como se apresentar".' },
  { t: 'text', k: 'title', label: 'Título', opt: 'undef' },
  { t: 'text', k: 'body', label: 'Texto', opt: 'undef', rows: 3 },
  { t: 'text', k: 'body2', label: 'Segundo parágrafo', opt: 'undef', rows: 3 },
  { t: 'list', k: 'rows', label: 'Exemplos', item: 'exemplo', opt: 'undef', of: ROW_SPECS, summary: (v) => String(v.en ?? '') },
  { t: 'lines', k: 'bullets', label: 'Tópicos', opt: 'undef', rows: 3 },
  { t: 'text', k: 'callout', label: 'Destaque final', opt: 'undef', rows: 2, hint: 'Card azul-marinho no fim do bloco.' },
  { t: 'text', k: 'badLabel', label: 'Rótulo da forma errada', opt: 'undef', hint: 'Padrão: "NÃO É".' },
];

const LICAO: Spec[] = [
  {
    t: 'list',
    k: 'lesson',
    label: 'Blocos da lição',
    item: 'bloco',
    summary: (v) => [v.k, v.title].filter(Boolean).join(' · '),
    of: BLOCK_SPECS,
  },
  {
    t: 'obj',
    k: 'pron',
    label: 'Pronúncia',
    opt: 'null',
    hint: 'Sem bloco de pronúncia neste episódio.',
    make: () => ({ k: 'Pronúncia', parts: [], pairs: [], words: [] }),
    of: [
      { t: 'text', k: 'k', label: 'Rótulo' },
      {
        t: 'list',
        k: 'parts',
        label: 'Explicação',
        item: 'parte',
        inline: true,
        of: [
          { t: 'text', k: 'b', label: 'Em destaque' },
          { t: 'text', k: 't', label: 'Texto' },
        ],
      },
      {
        t: 'list',
        k: 'pairs',
        label: 'Pares mínimos',
        item: 'par',
        inline: true,
        of: [
          { t: 'text', k: 'a', label: 'Palavra A' },
          { t: 'text', k: 'b', label: 'Palavra B' },
          { t: 'text', k: 'c', label: 'Diferença' },
        ],
      },
      { t: 'strings', k: 'words', label: 'Palavras para treinar', wide: true },
    ],
  },
];

const AWAY: Spec[] = [
  {
    t: 'list',
    k: 'awayExp',
    label: 'Expressões',
    item: 'expressão',
    inline: true,
    hint: 'Viram cartões de revisão quando o aluno termina a etapa 8.',
    of: [
      { t: 'text', k: 'en', label: 'Inglês' },
      { t: 'text', k: 'pt', label: 'Tradução' },
      { t: 'text', k: 'note', label: 'Quando usar', opt: 'undef' },
    ],
  },
  { t: 'strings', k: 'awayWords', label: 'Palavras-chave', wide: true },
];

const ITEM_SPECS: Spec[] = [
  { t: 'text', k: 'q', label: 'Pergunta', rows: 2 },
  { t: 'choices', k: 'opts', label: 'Opções', answer: 'answerIdx', min: 2, max: 4 },
  { t: 'text', k: 'fix', label: 'Explicação quando erra', opt: 'null', rows: 2 },
  { t: 'text', k: 'say', label: 'Texto do áudio', opt: 'null', hint: 'Lido pela voz nos exercícios com áudio.' },
];

const EXERCICIOS: Spec[] = [
  {
    t: 'list',
    k: 'ex',
    label: 'Exercícios',
    item: 'exercício',
    summary: (v) => `${String(v.title ?? '')}${Array.isArray(v.items) ? ` · ${v.items.length} questões` : ''}`,
    make: () => ({ kind: 'escrito', title: '', intro: null, audio: null, audioLabel: null, items: [] }),
    of: [
      {
        t: 'select',
        k: 'kind',
        label: 'Tipo',
        options: [
          ['escrito', 'Escrito'],
          ['com áudio', 'Com áudio'],
          ['música', 'Música'],
        ],
      },
      { t: 'text', k: 'title', label: 'Título' },
      { t: 'text', k: 'intro', label: 'Instrução', opt: 'null', rows: 2 },
      {
        t: 'select',
        k: 'audio',
        label: 'Áudio',
        opt: 'null',
        options: [
          ['tts', 'Voz lendo o texto'],
          ['song', 'Música do episódio'],
        ],
      },
      { t: 'text', k: 'audioLabel', label: 'Rótulo do botão de áudio', opt: 'null' },
      {
        t: 'list',
        k: 'items',
        label: 'Questões',
        item: 'questão',
        summary: (v) => String(v.q ?? ''),
        make: () => ({ q: '', opts: ['', '', ''], answerIdx: 0, fix: null, say: null }),
        of: ITEM_SPECS,
      },
    ],
  },
];

const FIM: Spec[] = [
  {
    t: 'obj',
    k: 'done',
    label: 'Tela de conclusão',
    opt: 'null',
    hint: 'Obrigatória para publicar o episódio.',
    make: () => ({ title: '', line: '', nextNum: '', nextTitle: '', nextSub: '', nextNote: '', cta: '', go: '' }),
    of: [
      { t: 'text', k: 'title', label: 'Título', hint: 'Ex.: "Episódio 1 concluído!"' },
      { t: 'text', k: 'line', label: 'Frase', rows: 2, hint: '{N} vira o nome do aluno.' },
      { t: 'text', k: 'nextNum', label: 'Próximo: número', hint: 'Ex.: "02".' },
      { t: 'text', k: 'nextTitle', label: 'Próximo: título' },
      { t: 'text', k: 'nextSub', label: 'Próximo: subtítulo' },
      { t: 'text', k: 'nextNote', label: 'Próximo: nota', rows: 2 },
      { t: 'text', k: 'cta', label: 'Texto do botão' },
      { t: 'text', k: 'go', label: 'Destino do botão', mono: true, hint: 'Rota sem "#/": episodio/2, ebook/1 ou inicio.' },
    ],
  },
];

export const TAB_SPECS: Record<TabId, readonly Spec[]> = {
  geral: GERAL,
  midia: MIDIA,
  musica: MUSICA,
  olhar: OLHAR,
  dialogo: DIALOGO,
  mic: MIC,
  licao: LICAO,
  away: AWAY,
  exercicios: EXERCICIOS,
  fim: FIM,
};

export const ALL_SPECS: readonly Spec[] = Object.values(TAB_SPECS).flat();

/** Tab of an error path ("dialog.3.en" → dialogo). */
export function tabOf(path: string): TabId {
  const head = path.split('.')[0] ?? '';
  for (const [tab, specs] of Object.entries(TAB_SPECS) as [TabId, readonly Spec[]][]) {
    if (specs.some((s) => s.k === head)) return tab;
  }
  return 'geral';
}
