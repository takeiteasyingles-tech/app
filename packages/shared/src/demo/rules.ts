// Demo-mode grammar rules from prototipo/js/core/ai.js: the first match wins and becomes an
// 'ajuste' feedback. Regexes and pt-BR copy are verbatim.

export interface DemoRule {
  re: RegExp;
  fix: (m: RegExpMatchArray) => string;
  exp: string;
  cat: string;
}

const PAST: Readonly<Record<string, string>> = {
  go: 'went',
  eat: 'ate',
  see: 'saw',
  have: 'had',
  do: 'did',
  make: 'made',
  take: 'took',
  buy: 'bought',
  watch: 'watched',
  play: 'played',
  visit: 'visited',
};
const THIRD: Readonly<Record<string, string>> = { have: 'has', do: 'does', go: 'goes', watch: 'watches' };
const JOBS =
  'engineer|designer|student|teacher|doctor|nurse|lawyer|developer|programmer|manager|architect|journalist|accountant|dentist|chef|artist|actor|singer|writer|salesperson|farmer|agronomist|analyst|consultant';
const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const g = (m: RegExpMatchArray, i: number) => m[i] ?? '';

export const RULES: readonly DemoRule[] = [
  {
    re: /\bi\s+(?:have|has)\s+(\d+|[a-z-]+)\s+years?(?:\s+old)?\b/i,
    fix: (m) => `I’m ${g(m, 1)}`,
    exp: 'Idade em inglês usa o verbo to be: I’m 30. O have fica de fora.',
    cat: 'Idade com to be',
  },
  {
    re: /^(am|is)\s+(\w+)/i,
    fix: (m) => (g(m, 1).toLowerCase() === 'am' ? 'I’m ' : 'It’s ') + g(m, 2),
    exp: 'Toda frase em inglês precisa de sujeito: I’m…, It’s…. Só o verbo não basta.',
    cat: 'Sujeito que some',
  },
  {
    re: new RegExp(
      `\\b(i’?m|i'm|i am|he’?s|he's|she’?s|she's|he is|she is|you’?re|you're|you are)\\s+(${JOBS})\\b`,
      'i',
    ),
    fix: (m) => `${g(m, 1)} ${an(g(m, 2))}`,
    exp: 'Profissão pede artigo em inglês: I’m a designer, I’m an engineer.',
    cat: 'Artigo antes de profissão',
  },
  {
    re: /\bpeople\s+is\b/i,
    fix: () => 'people are',
    exp: 'People é plural em inglês: people are.',
    cat: 'Concordância',
  },
  {
    re: /\b(?:i’?m|i'm|i am)\s+agree\b/i,
    fix: () => 'I agree',
    exp: 'Agree já é verbo: I agree. Sem o am.',
    cat: 'Falso amigo',
  },
  {
    re: /\bmake\s+(?:a|one|some)\s+questions?\b/i,
    fix: () => 'ask a question',
    exp: 'Pergunta se faz com ask: ask a question.',
    cat: 'Colocação',
  },
  { re: /\bexplain\s+me\b/i, fix: () => 'explain to me', exp: 'Explain pede to: explain to me.', cat: 'Preposição' },
  { re: /\bdepends?\s+of\b/i, fix: () => 'depends on', exp: 'Em inglês é depends on, não of.', cat: 'Preposição' },
  {
    re: /\b(he|she|it)\s+(have|do|go|like|want|work|live|play|watch|need|love|speak|study)\b/i,
    fix: (m) => `${g(m, 1)} ${THIRD[g(m, 2).toLowerCase()] || `${g(m, 2)}s`}`,
    exp: 'Com he, she e it o verbo ganha -s: she likes, he has.',
    cat: 'Terceira pessoa',
  },
  {
    re: /\b(he|she|it)\s+don’?'?t\b/i,
    fix: (m) => `${g(m, 1)} doesn’t`,
    exp: 'Com he, she e it a negativa é doesn’t.',
    cat: 'Terceira pessoa',
  },
  {
    re: /\bin\s+the\s+weekend\b/i,
    fix: () => 'on the weekend',
    exp: 'No inglês americano é on the weekend.',
    cat: 'Preposição',
  },
  {
    re: /\bi\s+like\s+(?:very much|so much)\s+(\w+)/i,
    fix: (m) => `I really like ${g(m, 1)}`,
    exp: 'Very much não vai no meio. Diga I really like anime.',
    cat: 'Ordem da frase',
  },
  {
    re: /\b(yesterday|last\s+(?:week|night|year|month|weekend|friday|saturday|sunday))\b[^.?!]*?\b(i|we|they|he|she)\s+(go|eat|see|have|do|make|take|buy|watch|play|visit)\b/i,
    fix: (m) => `${g(m, 2)} ${PAST[g(m, 3).toLowerCase()]}`,
    exp: 'Com yesterday e last week o verbo vai para o passado: I went, I watched.',
    cat: 'Passado',
  },
  {
    re: /\bi\s+want\s+that\s+you\b/i,
    fix: () => 'I want you to',
    exp: 'Em inglês: I want you to…, sem that.',
    cat: 'Estrutura',
  },
  {
    re: /\bsince\s+(\d+|two|three|four|five|ten)\s+(years|months|days|weeks)\b/i,
    fix: (m) => `for ${g(m, 1)} ${g(m, 2)}`,
    exp: 'Duração é com for: for 3 years. Since marca o começo: since 2020.',
    cat: 'For × since',
  },
];

/** Portuguese words that mark a mixed answer ("Português no meio"). */
export const PT_WORDS =
  /\b(não|nao|você|voce|eu|que|muito|também|tambem|porque|obrigad[oa]|legal|mas|com|para|gosto|sim)\b/i;

export const PRAISE: readonly string[] = [
  'Frase clara e completa.',
  'Isso. Soou natural.',
  'Boa: sujeito, verbo e complemento no lugar.',
  'Entendi de primeira. É esse o objetivo.',
  'Certinho. Pode seguir nesse ritmo.',
];
