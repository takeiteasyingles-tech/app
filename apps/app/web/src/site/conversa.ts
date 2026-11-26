// "Converse agora com os Woods": the demo conversation with Margaret and Robert Woods on the course
// home. 7 lines, from A1 to B2. Each answer is 'certo' (2 points), 'natural' (1) or 'ajuste' (0).
// Canned answers only: nothing is sent anywhere, and the result is an estimate.
import margaretFoto from './media/margaret.jpg';
import robertFoto from './media/robert.jpg';

export type Tipo = 'certo' | 'natural' | 'ajuste';

export interface Opcao {
  t: string;
  tipo: Tipo;
  fb: string;
}

export interface Fala {
  en: string;
  pt: string;
  opcoes: readonly Opcao[];
}

export interface Conversa {
  nome: string;
  /** How the result names the character ("com a Maggie"). */
  apelido: string;
  onde: string;
  foto: string;
  falas: readonly Fala[];
}

export type Personagem = 'margaret' | 'robert';

export const CONVERSAS: Readonly<Record<Personagem, Conversa>> = {
  margaret: {
    nome: 'Margaret Woods',
    apelido: 'Maggie',
    onde: 'Woods & Beans · Beacon, NY',
    foto: margaretFoto,
    falas: [
      {
        en: "Hi! Welcome to Woods & Beans. I'm Margaret, but everybody calls me Maggie. What's your name?",
        pt: 'Oi! Bem-vindo à Woods & Beans. Eu sou a Margaret, mas todo mundo me chama de Maggie. Qual é o seu nome?',
        opcoes: [
          { t: "I'm Ana. Nice to meet you!", tipo: 'certo', fb: 'Perfeito. Simples e natural.' },
          {
            t: 'I have Ana of name.',
            tipo: 'ajuste',
            fb: 'Em inglês, nome não se "tem": diga "My name is Ana" ou "I\'m Ana".',
          },
          { t: 'Is Ana.', tipo: 'ajuste', fb: 'O inglês não deixa o sujeito escondido: "I\'m Ana" ou "It\'s Ana".' },
        ],
      },
      {
        en: 'Nice to meet you! So, where are you from?',
        pt: 'Prazer! E aí, de onde você é?',
        opcoes: [
          { t: 'I from Brazil.', tipo: 'ajuste', fb: 'Faltou o verbo: "I\'m from Brazil".' },
          { t: "I'm from Brazil.", tipo: 'certo', fb: 'Isso. "I\'m from…" é o jeito de dizer de onde você é.' },
          { t: 'I am of Brazil.', tipo: 'ajuste', fb: 'Em inglês é "from", não "of": "I\'m from Brazil".' },
        ],
      },
      {
        en: 'Oh, Brazil! Lucas is from Brazil too. What would you like to drink?',
        pt: 'Ah, Brasil! O Lucas também é do Brasil. O que você gostaria de beber?',
        opcoes: [
          {
            t: 'Give me one coffee.',
            tipo: 'ajuste',
            fb: 'Entende-se, mas soa ríspido. Peça com "I\'d like a coffee, please".',
          },
          {
            t: 'I want a coffee.',
            tipo: 'natural',
            fb: 'Funciona. "I\'d like a coffee, please" soa mais educado no balcão.',
          },
          { t: "I'd like a coffee, please.", tipo: 'certo', fb: 'Educado e natural. Do jeito que se pede num café.' },
        ],
      },
      {
        en: 'Great choice. Have you ever been to New York?',
        pt: 'Ótima escolha. Você já foi a Nova York?',
        opcoes: [
          {
            t: 'Yes, I went there two years ago.',
            tipo: 'certo',
            fb: 'Certo. Com "ago", o inglês usa o passado simples: "I went".',
          },
          {
            t: 'Yes, I have been there two years ago.',
            tipo: 'ajuste',
            fb: 'Com data ou "ago", use o passado: "I went there two years ago".',
          },
          { t: 'Yes, I go there in 2022.', tipo: 'ajuste', fb: 'Foi no passado, então "I went there in 2022".' },
        ],
      },
      {
        en: 'If you could live anywhere in the world, where would you live?',
        pt: 'Se você pudesse morar em qualquer lugar do mundo, onde moraria?',
        opcoes: [
          { t: 'I will live in Paris.', tipo: 'ajuste', fb: 'É hipótese, então "would": "I would live in Paris".' },
          {
            t: 'If I can, I live in Paris.',
            tipo: 'ajuste',
            fb: 'Para hipótese: "If I could, I would live in Paris".',
          },
          {
            t: "I'd live somewhere near the ocean, where it's warm.",
            tipo: 'certo',
            fb: 'Ótimo. "I\'d" (I would) é o jeito certo de falar de hipótese.',
          },
        ],
      },
      {
        en: "I've been running this shop for a few months now. How long have you been studying English?",
        pt: 'Eu cuido desta loja há alguns meses. Há quanto tempo você estuda inglês?',
        opcoes: [
          {
            t: 'I study English since three years.',
            tipo: 'ajuste',
            fb: 'Erro clássico de quem fala português. Diga "I\'ve been studying English for three years".',
          },
          {
            t: "I've been studying on and off for about three years.",
            tipo: 'certo',
            fb: 'Excelente. Tempo verbal certo e "on and off" (com pausas) soa muito natural.',
          },
          {
            t: "I'm studying English for three years.",
            tipo: 'ajuste',
            fb: 'Para algo que começou no passado e continua: "I\'ve been studying… for three years".',
          },
        ],
      },
      {
        en: 'Honestly, the winters here are brutal for business. What would you do to keep customers coming in?',
        pt: 'Sinceramente, o inverno aqui é cruel para o negócio. O que você faria para os clientes continuarem vindo?',
        opcoes: [
          {
            t: 'I would make a promotion for attract clients.',
            tipo: 'ajuste',
            fb: 'Quase lá. Diga "run a promotion to attract customers": "make" e "for" são traduções do português.',
          },
          {
            t: "I'd probably start a loyalty program and host small events to bring people in.",
            tipo: 'certo',
            fb: 'Resposta de quem já negocia em inglês. "Bring people in" é exatamente o que um nativo diria.',
          },
          {
            t: 'Maybe do discount.',
            tipo: 'natural',
            fb: 'A ideia é boa, mas a frase está incompleta: "Maybe offer a discount".',
          },
        ],
      },
    ],
  },

  robert: {
    nome: 'Robert Woods',
    apelido: 'Robert',
    onde: 'Deerfield Machinery · Beacon, NY',
    foto: robertFoto,
    falas: [
      {
        en: "Good morning. I'm Robert Woods. What do you do?",
        pt: 'Bom dia. Eu sou Robert Woods. O que você faz?',
        opcoes: [
          { t: "I'm engineer.", tipo: 'ajuste', fb: 'Em inglês, profissão leva artigo: "I\'m an engineer".' },
          {
            t: "I'm an engineer.",
            tipo: 'certo',
            fb: 'Certo. O "an" antes da profissão é o detalhe que muita gente esquece.',
          },
          { t: 'I work of engineer.', tipo: 'ajuste', fb: 'Diga "I\'m an engineer" ou "I work as an engineer".' },
        ],
      },
      {
        en: 'Do you drink coffee every day?',
        pt: 'Você toma café todo dia?',
        opcoes: [
          { t: 'Yes, I am.', tipo: 'ajuste', fb: 'A pergunta usou "do", então a resposta é "Yes, I do".' },
          {
            t: 'Yes, I drink.',
            tipo: 'natural',
            fb: 'Entende-se, mas o natural é responder com o auxiliar: "Yes, I do".',
          },
          {
            t: 'Yes, I do. Every morning.',
            tipo: 'certo',
            fb: 'Perfeito. Resposta curta com o auxiliar, do jeito que se fala.',
          },
        ],
      },
      {
        en: "We're opening a coffee shop on Main Street. What do you think of the idea?",
        pt: 'Estamos abrindo uma cafeteria na Main Street. O que você acha da ideia?',
        opcoes: [
          { t: "I think it's a great idea.", tipo: 'certo', fb: 'Isso. Com o "it" no lugar certo.' },
          {
            t: 'I think is a great idea.',
            tipo: 'ajuste',
            fb: 'O inglês exige o sujeito: "I think it\'s a great idea".',
          },
          {
            t: 'I am thinking it is good idea.',
            tipo: 'ajuste',
            fb: 'Para opinião, "I think" sem -ing, e com artigo: "a good idea".',
          },
        ],
      },
      {
        en: 'Last month I traveled to Brazil for work. Where did you go on your last trip?',
        pt: 'Mês passado eu viajei ao Brasil a trabalho. Para onde você foi na sua última viagem?',
        opcoes: [
          { t: 'I go to Salvador last year.', tipo: 'ajuste', fb: 'Foi no passado: "I went to Salvador last year".' },
          {
            t: 'I was go to Salvador.',
            tipo: 'ajuste',
            fb: 'Não se junta "was" com "go". Diga só "I went to Salvador".',
          },
          { t: 'I went to Salvador with my family.', tipo: 'certo', fb: 'Certo. "Went" é o passado de "go".' },
        ],
      },
      {
        en: 'We need to start selling to stores in New York. What should we do first?',
        pt: 'Precisamos começar a vender para lojas em Nova York. O que deveríamos fazer primeiro?',
        opcoes: [
          {
            t: 'You should to visit the stores.',
            tipo: 'ajuste',
            fb: 'Depois de "should" não vai "to": "You should visit the stores".',
          },
          {
            t: 'I think you should visit a few stores and talk to the owners.',
            tipo: 'certo',
            fb: 'Muito bom. Clara, educada e com "should" no lugar certo.',
          },
          {
            t: 'Is better you visit the stores.',
            tipo: 'ajuste',
            fb: 'Faltou o sujeito e a estrutura: "It\'s better to visit the stores".',
          },
        ],
      },
      {
        en: 'And if the first client says no, what would you do?',
        pt: 'E se o primeiro cliente disser não, o que você faria?',
        opcoes: [
          { t: 'I would to try again.', tipo: 'ajuste', fb: 'Depois de "would" não vai "to": "I would try again".' },
          {
            t: 'I would try again with other price.',
            tipo: 'natural',
            fb: 'Quase. O natural é "with a different price" ou "with another price".',
          },
          {
            t: "I'd ask for feedback and come back with a better offer.",
            tipo: 'certo',
            fb: 'Excelente. "Come back with a better offer" é inglês de negociação de verdade.',
          },
        ],
      },
      {
        en: 'Suppose a client asks for a discount on a large order. How would you handle it?',
        pt: 'Suponha que um cliente peça desconto num pedido grande. Como você lidaria com isso?',
        opcoes: [
          {
            t: "I'd offer a volume discount, but only if they commit to a longer contract.",
            tipo: 'certo',
            fb: 'Resposta de B2. Você negociou uma contrapartida e usou "commit to" do jeito certo.',
          },
          {
            t: 'I would give the discount, if they buy more bigger.',
            tipo: 'ajuste',
            fb: '"More bigger" não existe. Diga "if they place a larger order".',
          },
          {
            t: 'I accept, no problem.',
            tipo: 'natural',
            fb: 'Dá para entender, mas é hipótese: "I\'d accept". E aceitar de cara deixa dinheiro na mesa.',
          },
        ],
      },
    ],
  },
};

export interface Resultado {
  /** Highest point total (0 to 14) in this band. */
  ate: number;
  nivel: string;
  titulo: string;
  texto: string;
}

/** Result bands by the sum of the points (0 to 14). */
export const RESULTADOS: readonly Resultado[] = [
  {
    ate: 4,
    nivel: 'A1',
    titulo: 'Começando do zero',
    texto:
      'Você está no ponto de partida certo para a Temporada 1. Ela foi feita exatamente para isso: começar do zero, com tudo explicado em português.',
  },
  {
    ate: 7,
    nivel: 'A1+',
    titulo: 'Você já tem uma base',
    texto:
      'Você se vira no básico. A Temporada 1 vai consolidar essa base e corrigir os vícios do português antes que eles virem hábito.',
  },
  {
    ate: 10,
    nivel: 'A2',
    titulo: 'Você já conversa no dia a dia',
    texto:
      'Você já se comunica em situações simples. Os primeiros episódios vão ser rápidos, e a correção de pronúncia vai fazer diferença desde o início.',
  },
  {
    ate: 12,
    nivel: 'B1',
    titulo: 'Você já se vira bem',
    texto:
      'Você conversa com segurança. Sua faixa está nas temporadas 4 e 5, de negociação. Até lá, a Temporada 1 e o Mic ajudam a deixar a pronúncia mais clara.',
  },
  {
    ate: 14,
    nivel: 'B2',
    titulo: 'Você já negocia em inglês',
    texto:
      'Você responde com naturalidade, até em negociação. Sua faixa está nas temporadas 7 e 8. Enquanto elas não chegam, o Mic é um bom lugar para manter o inglês em dia.',
  },
];
