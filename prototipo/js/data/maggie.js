// Maggie: modos, missões por objetivo e roteiros do modo demo.
window.TIE = window.TIE || {};
(function () {
  const MODES = [
    { k: 'livre', t: 'Conversa livre', s: 'Sobre o que você curte.', icon: 'chat' },
    { k: 'missao', t: 'Missão', s: 'Uma cena do seu objetivo.', icon: 'flag' },
    { k: 'pronuncia', t: 'Pronúncia', s: 'Frases com os sons que travam.', icon: 'wave' },
    { k: 'extra', t: 'Sobre um Extra', s: 'Conte o que você assistiu.', icon: 'tv' }
  ];
  const OPENERS = {
    animes: { en: 'Hi, {N}. Zach told me you like anime. What’s your favorite one?', pt: 'Oi, {N}. O Zach me contou que você curte anime. Qual é o seu favorito?' },
    musica: { en: 'Hi, {N}. I heard you love music. What are you listening to these days?', pt: 'Oi, {N}. Fiquei sabendo que você ama música. O que você anda ouvindo?' },
    series: { en: 'Hi, {N}. So, what series are you watching right now?', pt: 'Oi, {N}. E aí, que série você está vendo agora?' },
    novelas: { en: 'Hi, {N}. Do you watch novelas? I hear they’re very dramatic.', pt: 'Oi, {N}. Você assiste novela? Dizem que são bem dramáticas.' },
    filmes: { en: 'Hi, {N}. Seen any good movies lately?', pt: 'Oi, {N}. Viu algum filme bom ultimamente?' },
    games: { en: 'Hi, {N}. Zach says you’re a gamer. What are you playing now?', pt: 'Oi, {N}. O Zach disse que você joga. O que você está jogando agora?' },
    _: { en: 'Hi, {N}. Come in, sit down. How’s your day going?', pt: 'Oi, {N}. Entra, senta aí. Como está o seu dia?' }
  };
  const FOLLOW = [
    { en: 'Oh, nice. Why do you like it?', pt: 'Ah, legal. Por que você gosta?' },
    { en: 'Do you watch it in English or in Portuguese?', pt: 'Você assiste em inglês ou em português?' },
    { en: 'Cool. What else do you like to do on the weekend?', pt: 'Legal. O que mais você gosta de fazer no fim de semana?' },
    { en: 'That sounds fun. Is it popular in Brazil?', pt: 'Parece divertido. É popular no Brasil?' },
    { en: 'I’m learning a lot from you today. Thanks, {N}. See you soon.', pt: 'Estou aprendendo muito com você hoje. Obrigada, {N}. Até logo.', end: true }
  ];
  const MISSIONS = {
    viagem: { t: 'No check-in do aeroporto', role: 'atendente da companhia aérea', goal: 'Fazer o check-in, despachar a mala e escolher o assento.', turns: [
      { en: 'Good morning. Where are you flying today?', pt: 'Bom dia. Para onde você vai voar hoje?', words: [['flying', 'voando']] },
      { en: 'Great. Can I see your passport, please?', pt: 'Ótimo. Posso ver o seu passaporte, por favor?', words: [['passport', 'passaporte']] },
      { en: 'Thank you. Do you have any bags to check?', pt: 'Obrigada. Você tem malas para despachar?', words: [['check a bag', 'despachar a mala']] },
      { en: 'Would you like a window or an aisle seat?', pt: 'Você prefere janela ou corredor?', words: [['aisle seat', 'assento no corredor']] },
      { en: 'Here’s your boarding pass. Gate 12. Have a nice flight.', pt: 'Aqui está o seu cartão de embarque. Portão 12. Boa viagem.', words: [['boarding pass', 'cartão de embarque'], ['gate', 'portão']], end: true }] },
    carreira: { t: 'Entrevista de emprego', role: 'gerente de RH na Deerfield Machinery', goal: 'Se apresentar, falar do seu trabalho e fazer uma pergunta.', turns: [
      { en: 'Thanks for coming in. So, tell me a little about yourself.', pt: 'Obrigada por vir. Então, me conte um pouco sobre você.', words: [['tell me about', 'me conte sobre']] },
      { en: 'Interesting. What do you do in your current job?', pt: 'Interessante. O que você faz no seu emprego atual?', words: [['current job', 'emprego atual']] },
      { en: 'Why do you want to work with us?', pt: 'Por que você quer trabalhar com a gente?', words: [['work with', 'trabalhar com']] },
      { en: 'What’s your biggest strength?', pt: 'Qual é o seu maior ponto forte?', words: [['strength', 'ponto forte']] },
      { en: 'Great. Do you have any questions for me?', pt: 'Ótimo. Você tem alguma pergunta para mim?', words: [['any questions', 'alguma pergunta']] },
      { en: 'Thank you. We’ll be in touch.', pt: 'Obrigada. A gente entra em contato.', words: [['be in touch', 'entrar em contato']], end: true }] },
    morar: { t: 'Alugando um quarto', role: 'dona de um quarto para alugar em Beacon', goal: 'Perguntar do quarto, do preço e combinar a mudança.', turns: [
      { en: 'Hi. You’re here about the room, right?', pt: 'Oi. Você veio por causa do quarto, certo?', words: [['room', 'quarto']] },
      { en: 'Nice to meet you. Where are you from?', pt: 'Prazer. De onde você é?', words: [['where are you from', 'de onde você é']] },
      { en: 'How long are you staying in Beacon?', pt: 'Quanto tempo você vai ficar em Beacon?', words: [['how long', 'quanto tempo']] },
      { en: 'The rent is nine hundred dollars a month. Is that OK?', pt: 'O aluguel é novecentos dólares por mês. Tudo bem?', words: [['rent', 'aluguel']] },
      { en: 'Perfect. When do you want to move in?', pt: 'Perfeito. Quando você quer se mudar?', words: [['move in', 'se mudar']], end: true }] },
    series: { t: 'Conversa sobre o episódio', role: 'fã de séries', goal: 'Contar o que aconteceu no episódio que você viu.', turns: [
      { en: 'So, did you watch Woods & Beans? What happened in the episode?', pt: 'E aí, você viu Woods & Beans? O que aconteceu no episódio?', words: [['happened', 'aconteceu']] },
      { en: 'Ha. Who’s your favorite character?', pt: 'Rá. Quem é o seu personagem favorito?', words: [['character', 'personagem']] },
      { en: 'Was it easy to understand without subtitles?', pt: 'Foi fácil de entender sem legenda?', words: [['subtitles', 'legendas']] },
      { en: 'Tell me one new word you learned.', pt: 'Me diga uma palavra nova que você aprendeu.', words: [['learned', 'aprendeu']], end: true }] },
    musica: { t: 'Falando de música', role: 'amiga que ama música', goal: 'Falar de uma música que você gosta e de quem canta.', turns: [
      { en: 'What song are you listening to these days?', pt: 'Que música você anda ouvindo?', words: [['these days', 'ultimamente']] },
      { en: 'Who sings it?', pt: 'Quem canta?', words: [['sings', 'canta']] },
      { en: 'Do you understand the lyrics?', pt: 'Você entende a letra?', words: [['lyrics', 'letra']] },
      { en: 'Can you tell me one line in English?', pt: 'Você me diz um verso em inglês?', words: [['line', 'verso']], end: true }] },
    provas: { t: 'Simulado da prova oral', role: 'examinadora', goal: 'Responder com frases completas e dar um motivo.', turns: [
      { en: 'Let’s practice the speaking test. Please describe your hometown.', pt: 'Vamos praticar a prova oral. Descreva a sua cidade natal.', words: [['hometown', 'cidade natal']] },
      { en: 'What do you like most about it?', pt: 'Do que você mais gosta nela?', words: [['most', 'mais']] },
      { en: 'Is it better to live in a big city or a small town? Why?', pt: 'É melhor morar numa cidade grande ou pequena? Por quê?', words: [['small town', 'cidade pequena']] },
      { en: 'Thank you. That’s the end of the test.', pt: 'Obrigada. Esse é o fim do teste.', words: [], end: true }] },
    gente: { t: 'Fazendo amizade', role: 'vizinha nova', goal: 'Se apresentar e descobrir algo em comum.', turns: [
      { en: 'Hi, I don’t think we’ve met. I’m {A}.', pt: 'Oi, acho que a gente não se conhece. Eu sou {oA}.', words: [['we’ve met', 'nos conhecemos']] },
      { en: 'Where are you from?', pt: 'De onde você é?', words: [] },
      { en: 'What do you do?', pt: 'O que você faz?', words: [['What do you do?', 'Com o que você trabalha?']] },
      { en: 'And what do you do for fun?', pt: 'E o que você faz para se divertir?', words: [['for fun', 'para se divertir']], end: true }] },
    games: { t: 'Papo de gamer', role: 'amiga gamer', goal: 'Falar do seu jogo e de como você joga online.', turns: [
      { en: 'I heard you play games. What are you playing now?', pt: 'Fiquei sabendo que você joga. O que você está jogando agora?', words: [] },
      { en: 'Do you play online with people from other countries?', pt: 'Você joga online com gente de outros países?', words: [['other countries', 'outros países']] },
      { en: 'What do you say to your team when you win?', pt: 'O que você diz para o seu time quando ganha?', words: [['win', 'ganhar']] },
      { en: 'GG. Good game, {N}.', pt: 'GG. Bom jogo, {N}.', words: [['good game', 'bom jogo']], end: true }] }
  };
  const PRON = [
    { en: 'Hi, how are you?', target: 'h', tip: 'O h é só ar, como quem embaça um espelho. Nada de R de “rato”.' },
    { en: 'Welcome to our home.', target: 'h', tip: 'Home começa com sopro: “hôum”.' },
    { en: 'She’s a student at school.', target: 's', tip: 'Comece pelo S sozinho: sss-tudent. Sem “i” antes.' },
    { en: 'This is a big ship.', target: 'final', tip: 'Big termina em G seco. Nada de “bigui”.' },
    { en: 'Thanks, I think so.', target: 'th', tip: 'Th: língua entre os dentes e sopro.' },
    { en: 'Sheep and ship.', target: 'ii', tip: 'Sheep tem i longo, ship tem i curto e relaxado.' }
  ];
  const HELP = [{ en: 'Sorry?', pt: 'não entendi' }, { en: 'Again, please.', pt: 'de novo' }, { en: 'Slowly, please.', pt: 'mais devagar' }];
  TIE.data = Object.assign(TIE.data || {}, { MAGGIE: { MODES, OPENERS, FOLLOW, MISSIONS, PRON, HELP } });
})();
