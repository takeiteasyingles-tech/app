// "Dica": a suggested answer (EN, PT) for the assistant's last line, by question pattern.

const HINTS: readonly (readonly [RegExp, string, string])[] = [
  [/how old/i, 'I’m … years old.', 'Eu tenho … anos.'],
  [/where are you from/i, 'I’m from São Paulo, in Brazil.', 'Eu sou de São Paulo, no Brasil.'],
  [/where are you flying|where.*going/i, 'I’m flying to New York.', 'Vou para Nova York.'],
  [/passport|can i see/i, 'Sure. Here you go.', 'Claro. Aqui está.'],
  [/bags|luggage/i, 'Yes, one bag, please.', 'Sim, uma mala, por favor.'],
  [/window or/i, 'Window, please.', 'Janela, por favor.'],
  [/about yourself/i, 'I’m Ana. I’m a designer and I love music.', 'Sou a Ana. Sou designer e amo música.'],
  [/favorite/i, 'My favorite is …', 'O meu favorito é …'],
  [/why/i, 'Because it’s fun and I learn a lot.', 'Porque é divertido e eu aprendo muito.'],
  [/how long/i, 'For six months.', 'Por seis meses.'],
  [/how was|how’s your day|how is your day/i, 'It was good, thanks. And you?', 'Foi bom, obrigado. E você?'],
  [/would you like/i, 'Yes, please.', 'Sim, por favor.'],
  [/\bdo you\b|^are you|^is it|^was it/i, 'Yes, I do. I really like it.', 'Sim. Eu gosto muito.'],
  [/what.*(watching|listening|playing)/i, 'I’m watching Woods & Beans.', 'Estou vendo Woods & Beans.'],
  [/what do you do\b/i, 'I’m a student. I study design.', 'Sou estudante. Estudo design.'],
  [/questions? for me/i, 'Yes. What’s a normal day like here?', 'Sim. Como é um dia normal aqui?'],
];

const FALLBACK: readonly [string, string] = ['I think …', 'Eu acho que …'];

/** [hint_en, hint_pt] for a line; the first matching pattern wins. */
export function hintFor(line: unknown): [string, string] {
  const l = String(line || '');
  for (const [re, en, pt] of HINTS) if (re.test(l)) return [en, pt];
  return [FALLBACK[0], FALLBACK[1]];
}
