// Form specs of the episode editor, one list per tab. The document edited is the episode row plus its
// child rows: `mic` (Take the Mic phrases) and `ex` (Take Action exercises, each with its `items`).
import type { VNode } from 'preact';
import type { CustomProps, Spec } from '../../ui/form';
import { EpisodeExtraPicker } from './EpisodeReferences';
import { CastVoicesField, EpisodeVoicesField, narrationVoiceField } from './EpisodeVoices';

export type TabId =
  | 'geral'
  | 'apresentacao'
  | 'musica'
  | 'olhar'
  | 'dialogo'
  | 'mic'
  | 'licao'
  | 'away'
  | 'exercicios'
  | 'fim';

export const TABS: readonly (readonly [TabId, string])[] = [
  ['geral', 'Geral'],
  ['apresentacao', '1 · In this episode'],
  ['musica', '2 · Música'],
  ['olhar', '3 · Take a Look'],
  ['dialogo', '4 · Take It In'],
  ['mic', '5 · Take the Mic'],
  ['licao', '6 · Take a Lesson'],
  ['away', '7 · Take Away'],
  ['exercicios', '8 · Take Action'],
  ['fim', 'Conclusão'],
];

// PROD (spec 05 "Lesson voices"): the voice of what the learner taps to hear, on every tab that has it.
const voiceSpec = (k: string, render: (p: CustomProps) => VNode | null): Spec => ({
  t: 'custom',
  k: 'voices',
  label: k,
  wide: true,
  render,
});
const VOICE_OLHAR = voiceSpec('Voz do vocabulário', narrationVoiceField('Take a Look'));
const VOICE_DIALOGO = voiceSpec('Vozes dos personagens', CastVoicesField);
const VOICE_MIC = voiceSpec('Voz das frases', narrationVoiceField('Take the Mic'));
const VOICE_LICAO = voiceSpec('Voz das palavras', narrationVoiceField('Take a Lesson'));
const VOICE_AWAY = voiceSpec('Voz do Take Away', narrationVoiceField('Take Away'));
const VOICE_EXERCICIOS = voiceSpec('Voz dos exercícios', narrationVoiceField('Take Action'));

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
  {
    t: 'custom',
    k: 'extraId',
    label: 'Extra do episódio',
    hint: 'Escolha um extra exclusivo. Os materiais já vinculados a outro episódio não aparecem.',
    render: EpisodeExtraPicker,
  },
  {
    t: 'strings',
    k: 'castNames',
    label: 'Personagens',
    wide: true,
    ph: 'Nome e Enter',
    hint: 'Quem aparece no episódio (Take a Look e Take It In). Cada personagem ganha uma cor própria, na ordem desta lista.',
  },
  { t: 'custom', k: 'voices', label: 'Vozes desta lição', wide: true, render: EpisodeVoicesField },
];

// 1 · Apresentação do Episódio: the audio of the opening (the orb plays with it) and the episode text.
const APRESENTACAO: Spec[] = [
  {
    t: 'media',
    k: 'introMedia',
    label: 'Áudio da apresentação',
    kind: 'audio',
    opt: 'null',
    hint: 'Sem áudio, o aluno ouve uma vinheta de 15 s.',
  },
  {
    t: 'text',
    k: 'synopsis',
    label: 'Texto da apresentação',
    opt: 'null',
    rows: 6,
    wide: true,
    hint: 'Aparece abaixo do orb. Se passar do espaço da tela, o aluno rola com a setinha.',
  },
];

// The song file itself is sent from the "Música e sincronização" card (SongSync.tsx) above these fields.
const MUSICA: Spec[] = [
  { t: 'text', k: 'songTitle', label: 'Título da música', opt: 'null' },
  {
    t: 'list',
    k: 'lyrics',
    label: 'Letra',
    item: 'linha',
    inline: true,
    // The karaoke gap is not edited here: the AI picks it (or the line's first word is used); rows keep theirs.
    hint: 'Início: segundo da música em que a linha começa (vazio = estimado).',
    of: [
      { t: 'text', k: 'en', label: 'Inglês' },
      { t: 'text', k: 'pt', label: 'Tradução' },
      { t: 'num', k: 't', label: 'Início (s)', opt: 'undef', min: 0, step: 0.1 },
    ],
  },
];

const OLHAR: Spec[] = [
  VOICE_OLHAR,
  {
    t: 'media',
    k: 'lookMedia',
    label: 'Áudio de contexto',
    kind: 'audio',
    opt: 'null',
    hint: '"1º Ouça o contexto e prepare a mente": toca antes do vídeo. Opcional.',
  },
  { t: 'media', k: 'sceneMedia', label: 'Vídeo da cena', kind: 'video', opt: 'null' },
  { t: 'text', k: 'sceneNote', label: 'Nota da cena', opt: 'null', rows: 2 },
  {
    t: 'list',
    k: 'visual',
    label: 'Vocabulário da cena',
    item: 'palavra',
    inline: true,
    hint: 'Viram Cards quando o aluno termina a etapa 3.',
    of: [
      { t: 'text', k: 'en', label: 'Inglês' },
      { t: 'text', k: 'pt', label: 'Tradução' },
    ],
  },
];

const DIALOGO: Spec[] = [
  VOICE_DIALOGO,
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
      {
        t: 'text',
        k: 'err',
        label: 'Nota de erro comum',
        opt: 'undef',
        rows: 2,
        hint: 'Aparece em azul abaixo da fala.',
      },
      { t: 'text', k: 'hook', label: 'Destaque', opt: 'undef' },
    ],
  },
];

const MIC: Spec[] = [
  VOICE_MIC,
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
  {
    t: 'list',
    k: 'rows',
    label: 'Exemplos',
    item: 'exemplo',
    opt: 'undef',
    of: ROW_SPECS,
    summary: (v) => String(v.en ?? ''),
  },
  { t: 'lines', k: 'bullets', label: 'Tópicos', opt: 'undef', rows: 3 },
  {
    t: 'text',
    k: 'callout',
    label: 'Destaque final',
    opt: 'undef',
    rows: 2,
    hint: 'Card azul-marinho no fim do bloco.',
  },
  { t: 'text', k: 'badLabel', label: 'Rótulo da forma errada', opt: 'undef', hint: 'Padrão: "NÃO É".' },
];

const LICAO: Spec[] = [
  VOICE_LICAO,
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
  VOICE_AWAY,
  {
    t: 'list',
    k: 'awayExp',
    label: 'Expressões',
    item: 'expressão',
    inline: true,
    hint: 'Viram Cards quando o aluno termina a etapa 7.',
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
  VOICE_EXERCICIOS,
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
      {
        t: 'text',
        k: 'go',
        label: 'Destino do botão',
        mono: true,
        hint: 'Rota sem "#/": episodio/2, extra ou inicio.',
      },
    ],
  },
];

export const TAB_SPECS: Record<TabId, readonly Spec[]> = {
  geral: GERAL,
  apresentacao: APRESENTACAO,
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
  if (head === 'songMedia') return 'musica';
  for (const [tab, specs] of Object.entries(TAB_SPECS) as [TabId, readonly Spec[]][]) {
    if (specs.some((s) => s.k === head)) return tab;
  }
  return 'geral';
}
