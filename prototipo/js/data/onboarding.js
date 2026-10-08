// Cadastro em 7 etapas. Tudo o que a pessoa responde vira o perfil usado por
// js/core/personalize.js (o que aparece) e js/core/guide.js (o plano de cada dia).
// skip: a etapa tem o botão "Pular" e pode seguir sem nada marcado.
window.TIE = window.TIE || {};
(function () {
  const STEPS = [
    { k: 'conta', t: 'Sua conta', h: 'Primeiro, a sua conta.', s: 'Leva um minuto. Depois é só com a gente.' },
    { k: 'objetivo', t: 'Objetivo', h: 'Qual uso você vai fazer do inglês?', s: 'Escolha até 3. O plano da semana é calculado a partir daqui.', skip: true },
    { k: 'gostos', t: 'Gostos', h: 'Do que você gosta?', s: 'É daqui que sai a sua prateleira no EXTRA.', skip: true },
    { k: 'trava', t: 'Dificuldades', h: 'O que mais te trava hoje?', s: 'Marque tudo o que pesa. Depois escolha o que trava mais.', skip: true },
    { k: 'estilo', t: 'Jeito de aprender', h: 'Como você aprende melhor?', s: 'O app dá mais espaço para o que funciona com você.', skip: true },
    { k: 'ritmo', t: 'Meta', h: 'Defina sua meta.', s: 'Dias, minutos e horário.' },
    { k: 'voz', t: 'Teste de voz', h: 'Diga oi para a Maggie.', s: 'Um teste rápido para calibrar a sua pronúncia. Dá para pular.' }
  ];
  const AGES = [['-18', 'Até 17'], ['18-24', '18 a 24'], ['25-34', '25 a 34'], ['35-44', '35 a 44'], ['45-59', '45 a 59'], ['60+', '60 ou mais']];
  const OCCUP = [['estudo', 'Estudo'], ['trabalho', 'Trabalho com carteira'], ['autonomo', 'Trabalho por conta'], ['empresa', 'Tenho um negócio'], ['casa', 'Cuido da casa'], ['aposentado', 'Aposentado(a)'], ['procurando', 'Procurando trabalho']];
  const AREAS = [['tech', 'Tecnologia'], ['saude', 'Saúde'], ['vendas', 'Vendas e atendimento'], ['educacao', 'Educação'], ['financas', 'Finanças e negócios'], ['criativo', 'Design e comunicação'], ['industria', 'Indústria e engenharia'], ['turismo', 'Turismo e gastronomia'], ['outra', 'Outra área']];
  const LEVELS = [
    { k: 'zero', t: 'Do zero', s: 'Nunca estudei ou lembro muito pouco.', season: 1, cefr: 'A1' },
    { k: 'basico', t: 'Sei o básico', s: 'Me apresento e entendo frases simples.', season: 1, cefr: 'A1+' },
    { k: 'meviro', t: 'Me viro', s: 'Converso devagar sobre o dia a dia.', season: 3, cefr: 'A2' },
    { k: 'avancar', t: 'Quero chegar ao avançado', s: 'Já converso e quero ganhar fluidez.', season: 5, cefr: 'B1' }
  ];
  const QUIZ = [
    { q: 'Hi, I’m Ana. ___ to meet you.', opts: ['Nice', 'Good', 'Fine'], a: 0 },
    { q: 'She ___ a designer.', opts: ['are', 'is', 'have'], a: 1 },
    { q: 'Yesterday I ___ to the store.', opts: ['go', 'going', 'went'], a: 2 },
    { q: 'If I ___ more time, I would travel more.', opts: ['had', 'have', 'will have'], a: 0 }
  ];
  const GOALS = [
    { k: 'viagem', t: 'Viajar sem travar', s: 'Aeroporto, hotel, restaurante.', icon: 'plane' },
    { k: 'carreira', t: 'Crescer no trabalho', s: 'Reuniões, e-mails, entrevistas.', icon: 'brief' },
    { k: 'morar', t: 'Morar ou estudar fora', s: 'Aluguel, vizinhos, faculdade.', icon: 'home' },
    { k: 'series', t: 'Séries e filmes sem legenda', s: 'Entender o que falam de verdade.', icon: 'tv' },
    { k: 'musica', t: 'Entender as músicas', s: 'Cantar sabendo o que diz.', icon: 'music' },
    { k: 'provas', t: 'Passar numa prova', s: 'TOEFL, IELTS, Cambridge.', icon: 'check' },
    { k: 'gente', t: 'Conversar com gente de fora', s: 'Amigos, clientes, redes.', icon: 'chat' },
    { k: 'games', t: 'Jogar online', s: 'Entender e falar no game.', icon: 'game' }
  ];
  const DEADLINES = [['3m', 'Em 3 meses'], ['6m', 'Em 6 meses'], ['1a', 'Em 1 ano'], ['calma', 'Sem pressa']];
  const HISTORY = [['nunca', 'Nunca estudei'], ['escola', 'Só na escola'], ['curso', 'Fiz curso e parei'], ['app', 'Usei apps'], ['particular', 'Aula particular'], ['sozinho', 'Estudei por conta']];
  const FAILS = [['tempo', 'Faltou tempo'], ['chato', 'Ficou chato'], ['dificil', 'Ficou difícil demais'], ['falar', 'Nunca chegava a falar'], ['caro', 'Ficou caro'], ['sozinho', 'Me senti sozinho(a)'], ['nada', 'Nada, é a primeira vez']];
  const FORMATS = [
    { k: 'series', t: 'Séries', img: 'assets/img/gen/cover/woods-and-beans.webp' },
    { k: 'novelas', t: 'Novelas', img: 'assets/img/gen/cover/main-street-hearts.webp' },
    { k: 'filmes', t: 'Filmes', img: 'assets/img/gen/cover/last-train.webp' },
    { k: 'animes', t: 'Animes', img: 'assets/img/gen/cover/beat-beacon.webp' },
    { k: 'musica', t: 'Música', img: 'assets/img/gen/k7/synth-nights.webp' },
    { k: 'games', t: 'Games', img: 'assets/img/gen/scene/garage-band.webp' },
    { k: 'viagens', t: 'Viagens', img: 'assets/img/gen/cover/fmt-viagens.webp' },
    { k: 'artes', t: 'Artes', img: 'assets/img/gen/cover/fmt-artes.webp' },
    { k: 'business', t: 'Business', img: 'assets/img/gen/cover/fmt-business.webp' }
  ];
  const SCREEN = [['comedia', 'Comédia'], ['romance', 'Romance'], ['suspense', 'Suspense'], ['acao', 'Ação'], ['terror', 'Terror'], ['ficcao', 'Ficção científica'], ['drama', 'Drama'], ['documentario', 'Documentário']];
  const GENRES = {
    series: SCREEN, filmes: SCREEN, novelas: [['romance', 'Romance'], ['drama', 'Drama'], ['comedia', 'Comédia'], ['suspense', 'Mistério e vingança']],
    animes: [['shonen', 'Ação e aventura'], ['slice', 'Slice of life'], ['romance', 'Romance'], ['fantasia', 'Fantasia'], ['esporte', 'Esporte'], ['musical', 'Música e bandas']],
    musica: [['pop', 'Pop'], ['rock', 'Rock'], ['rap', 'Rap e hip-hop'], ['kpop', 'K-pop'], ['sertanejo', 'Sertanejo'], ['anos80', 'Anos 80'], ['eletronica', 'Eletrônica'], ['gospel', 'Gospel']],
    games: [['rpg', 'RPG'], ['fps', 'Tiro e ação'], ['esporte', 'Esporte'], ['mobile', 'Mobile'], ['estrategia', 'Estratégia']],
    viagens: [['praia', 'Praia e sol'], ['cidades', 'Cidades grandes'], ['natureza', 'Natureza e trilhas'], ['mochilao', 'Mochilão'], ['gastronomia', 'Gastronomia'], ['museus', 'Museus e história']],
    artes: [['pintura', 'Pintura e desenho'], ['fotografia', 'Fotografia'], ['teatro', 'Teatro'], ['danca', 'Dança'], ['design', 'Design'], ['literatura', 'Literatura']],
    business: [['empreender', 'Empreendedorismo'], ['marketing', 'Marketing'], ['financas', 'Finanças'], ['lideranca', 'Liderança'], ['negociacao', 'Vendas e negociação'], ['startups', 'Tecnologia e startups']]
  };
  const THEMES = [['viagem', 'Viagem'], ['comida', 'Comida'], ['tecnologia', 'Tecnologia'], ['esportes', 'Esportes'], ['moda', 'Moda'], ['negocios', 'Negócios'], ['saude', 'Saúde'], ['pets', 'Bichos']];
  const DIFFS = [
    { k: 'listening', t: 'Entender quando falam rápido', icon: 'ear' },
    { k: 'speaking', t: 'Falar sem travar', icon: 'mic' },
    { k: 'pron', t: 'Pronúncia', icon: 'wave' },
    { k: 'grammar', t: 'Gramática', icon: 'book' },
    { k: 'vocab', t: 'Vocabulário', icon: 'cards' },
    { k: 'writing', t: 'Escrever', icon: 'pen' },
    { k: 'time', t: 'Ter constância', icon: 'clock' },
    { k: 'shy', t: 'Vergonha de errar', icon: 'heart' }
  ];
  const STYLES = [['ouvindo', 'Ouvindo', 'ear'], ['falando', 'Falando', 'mic'], ['vendo', 'Vendo vídeos', 'tv'], ['lendo', 'Lendo', 'book'], ['escrevendo', 'Escrevendo', 'pen'], ['jogando', 'Jogando', 'game']];
  const COMPANY = [['sozinho', 'Sozinho(a), no meu ritmo'], ['desafio', 'Com desafios e metas'], ['gente', 'Conversando com alguém']];
  const FEEDBACK = [['direto', 'Corrija na hora'], ['depois', 'Corrija no fim'], ['suave', 'Só o essencial, com calma']];
  const DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const MINUTES = [[20, '20 min'], [30, '30 min'], [40, '40 min'], [50, '50 min']];
  // Lembretes: a pessoa escolhe o horário de cada um (até REMIND_MAX).
  const REMIND_MAX = 5;
  const MOTIVES = [['familia', 'Pela minha família'], ['carreira', 'Pela carreira'], ['sonho', 'É um sonho antigo'], ['vergonha', 'Cansei de passar vergonha'], ['viagem', 'Tenho uma viagem marcada'], ['curiosidade', 'Curiosidade e prazer']];

  TIE.data = Object.assign(TIE.data || {}, { ONB: { STEPS, AGES, OCCUP, AREAS, LEVELS, QUIZ, GOALS, DEADLINES, HISTORY, FAILS, FORMATS, GENRES, THEMES, DIFFS, STYLES, COMPANY, FEEDBACK, DAYS, MINUTES, REMIND_MAX, MOTIVES } });
})();
