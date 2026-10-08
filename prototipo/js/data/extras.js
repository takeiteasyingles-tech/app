// Catálogo do EXTRA: séries, novela, filmes e animes do universo de Beacon, mais álbuns de música.
// format: series | novelas | filmes | animes | musica | games (as mesmas chaves do cadastro).
window.TIE = window.TIE || {};
(function () {
  const IMG = 'assets/img/gen/';
  const C = { blue: '#2A6FF5', orange: '#F45A28', green: '#1F7A4C', slate: '#3C5580' };
  const EXTRAS = [
    { id: 'woods-and-beans', title: 'Woods & Beans', kind: 'Sitcom', format: 'series', genres: ['comedia'], themes: ['comida', 'negocios'], level: 'A1–A2', cefr: 1, ep: 'T1 · Ep. 3 · The Wrong Order', dur: '8 min', cover: IMG + 'cover/woods-and-beans.webp', scene: IMG + 'scene/cafe-counter.webp',
      synopsis: 'A cafeteria da Maggie abre às sete. No primeiro dia, o Lucas troca todos os pedidos, e a Dona Barbara não perdoa.',
      cast: [['Maggie', 'MW', C.blue], ['Lucas', 'LC', C.orange], ['Barbara', 'BB', C.slate], ['Zach', 'ZW', C.slate]], dub: 'Lucas', premiere: true,
      lines: [
        { who: 'Maggie', en: 'Lucas, table three wants two lattes and a muffin.', pt: 'Lucas, a mesa três quer dois lattes e um muffin.' },
        { who: 'Lucas', en: 'Two lattes and a muffin. Got it.', pt: 'Dois lattes e um muffin. Entendi.' },
        { who: 'Barbara', en: 'Excuse me, young man. This is not my order.', pt: 'Com licença, rapaz. Este não é o meu pedido.' },
        { who: 'Lucas', en: 'Oh no. I’m so sorry, Mrs. Baker. What did you order?', pt: 'Ah não. Me desculpe, Dona Barbara. O que a senhora pediu?' },
        { who: 'Barbara', en: 'A black coffee. No sugar, no milk, no muffin.', pt: 'Um café preto. Sem açúcar, sem leite, sem muffin.' },
        { who: 'Zach', en: 'Can I have the muffin, then?', pt: 'Então posso ficar com o muffin?' },
        { who: 'Maggie', en: 'Zach. School. Now.', pt: 'Zach. Escola. Agora.' },
        { who: 'Lucas', en: 'One black coffee, coming right up.', pt: 'Um café preto, saindo agora.' }
      ],
      vocab: [['order', 'pedido'], ['got it', 'entendi'], ['coming right up', 'saindo já'], ['no sugar', 'sem açúcar'], ['then', 'então']] },
    { id: 'main-street-hearts', title: 'Main Street Hearts', kind: 'Novela', format: 'novelas', genres: ['romance', 'drama', 'suspense'], themes: ['moda'], level: 'A2', cefr: 2, ep: 'Capítulo 12 · A carta', dur: '10 min', cover: IMG + 'cover/main-street-hearts.webp', scene: IMG + 'scene/mansion-stairs.webp',
      synopsis: 'A novela das nove, em inglês. Valentina acha uma carta escondida na escada da mansão. O casamento é amanhã.',
      cast: [['Valentina', 'VA', C.orange], ['Rafael', 'RA', C.blue], ['Helena', 'HE', C.slate]], dub: 'Valentina',
      lines: [
        { who: 'Valentina', en: 'Rafael, we need to talk. Now.', pt: 'Rafael, a gente precisa conversar. Agora.' },
        { who: 'Rafael', en: 'Valentina, the wedding is tomorrow. What’s wrong?', pt: 'Valentina, o casamento é amanhã. O que houve?' },
        { who: 'Valentina', en: 'I found this letter. It’s from your mother.', pt: 'Eu achei esta carta. É da sua mãe.' },
        { who: 'Rafael', en: 'That’s impossible. My mother never writes letters.', pt: 'Impossível. Minha mãe nunca escreve cartas.' },
        { who: 'Helena', en: 'Oh, I write letters, my dear. Only the important ones.', pt: 'Ah, eu escrevo cartas, minha querida. Só as importantes.' },
        { who: 'Valentina', en: 'You knew. You knew everything.', pt: 'Você sabia. Você sabia de tudo.' },
        { who: 'Helena', en: 'Of course I knew. And tomorrow, everybody will know.', pt: 'Claro que eu sabia. E amanhã, todo mundo vai saber.' }
      ],
      vocab: [['wedding', 'casamento'], ['What’s wrong?', 'O que houve?'], ['letter', 'carta'], ['my dear', 'minha querida'], ['everybody', 'todo mundo']] },
    { id: 'beat-beacon', title: 'Beat Beacon', kind: 'Anime', format: 'animes', genres: ['musical', 'shonen', 'slice'], themes: [], level: 'A1–A2', cefr: 1, ep: 'Ep. 1 · First Beat', dur: '9 min', cover: IMG + 'cover/beat-beacon.webp', scene: IMG + 'scene/garage-band.webp',
      synopsis: 'Zach quer montar uma banda para o festival da escola. Ele tem uma bateria, dois amigos e nenhuma música.',
      cast: [['Zach', 'ZW', C.orange], ['Mia', 'MI', C.blue], ['Kenji', 'KE', C.slate]], dub: 'Zach',
      lines: [
        { who: 'Zach', en: 'OK, band. The school festival is on Friday.', pt: 'Beleza, banda. O festival da escola é na sexta.' },
        { who: 'Mia', en: 'Friday? Zach, we don’t have a song.', pt: 'Sexta? Zach, a gente não tem uma música.' },
        { who: 'Zach', en: 'We have a drum kit, a guitar and a keyboard.', pt: 'A gente tem uma bateria, uma guitarra e um teclado.' },
        { who: 'Kenji', en: 'And we have a name. We are… Beat Beacon.', pt: 'E a gente tem um nome. Nós somos… Beat Beacon.' },
        { who: 'Mia', en: 'That’s so cheesy. I love it.', pt: 'Isso é muito brega. Eu adorei.' },
        { who: 'Zach', en: 'One, two, three, four. Let’s go.', pt: 'Um, dois, três, quatro. Vamos lá.' }
      ],
      vocab: [['on Friday', 'na sexta'], ['drum kit', 'bateria'], ['keyboard', 'teclado'], ['cheesy', 'brega'], ['Let’s go.', 'Vamos lá.']] },
    { id: 'last-train', title: 'The Last Train to the City', kind: 'Filme · suspense', format: 'filmes', genres: ['suspense', 'acao', 'drama'], themes: ['viagem'], level: 'B1', cefr: 3, ep: 'Curta-metragem', dur: '15 min', cover: IMG + 'cover/last-train.webp', scene: IMG + 'scene/train-night.webp',
      synopsis: 'Lucas pega o último trem para Nova York. No banco ao lado, uma pasta que não é dele. Alguém quer muito essa pasta.',
      cast: [['Lucas', 'LC', C.orange], ['Conductor', 'CO', C.slate], ['Woman', '??', C.blue]], dub: 'Lucas',
      lines: [
        { who: 'Conductor', en: 'Tickets, please. Last stop, Grand Central.', pt: 'Passagens, por favor. Última parada, Grand Central.' },
        { who: 'Lucas', en: 'Here you go. Is this the last train tonight?', pt: 'Aqui está. Este é o último trem de hoje?' },
        { who: 'Conductor', en: 'The very last one. Is that your briefcase?', pt: 'O último mesmo. Essa pasta é sua?' },
        { who: 'Lucas', en: 'No, it isn’t. Someone left it on the seat.', pt: 'Não, não é. Alguém deixou no banco.' },
        { who: 'Woman', en: 'Don’t open it. Just give it to me.', pt: 'Não abra. Só me entregue.' },
        { who: 'Lucas', en: 'Sorry, do I know you?', pt: 'Desculpe, eu conheço você?' },
        { who: 'Woman', en: 'Not yet. But you will, when we get to the city.', pt: 'Ainda não. Mas vai conhecer, quando a gente chegar na cidade.' }
      ],
      vocab: [['Here you go.', 'Aqui está.'], ['last stop', 'última parada'], ['briefcase', 'pasta'], ['left it', 'deixou'], ['get to', 'chegar a']] },
    { id: 'rain-on-main-street', title: 'Rain on Main Street', kind: 'Filme · comédia romântica', format: 'filmes', genres: ['comedia', 'romance'], themes: ['moda'], level: 'A2', cefr: 2, ep: 'Longa em partes · Parte 1', dur: '18 min', cover: IMG + 'cover/rain-on-main-street.webp', scene: IMG + 'scene/rainy-street.webp',
      synopsis: 'Chove há três dias em Beacon. A Becky e um desconhecido disputam o mesmo guarda-chuva na porta da loja de discos.',
      cast: [['Becky', 'BW', C.orange], ['Sam', 'SA', C.blue]], dub: 'Becky',
      lines: [
        { who: 'Becky', en: 'Excuse me, I think that’s my umbrella.', pt: 'Com licença, acho que esse guarda-chuva é meu.' },
        { who: 'Sam', en: 'Really? It was on the bench for an hour.', pt: 'Sério? Estava no banco fazia uma hora.' },
        { who: 'Becky', en: 'Yes, because I was in the record store for an hour.', pt: 'Sim, porque eu fiquei uma hora na loja de discos.' },
        { who: 'Sam', en: 'OK. How about we share it?', pt: 'Tá bom. Que tal a gente dividir?' },
        { who: 'Becky', en: 'Share it? I don’t even know your name.', pt: 'Dividir? Eu nem sei o seu nome.' },
        { who: 'Sam', en: 'I’m Sam. Now you know my name.', pt: 'Eu sou o Sam. Agora você sabe o meu nome.' },
        { who: 'Becky', en: 'Nice to meet you, Sam. You’re still getting wet.', pt: 'Prazer, Sam. Você continua se molhando.' }
      ],
      vocab: [['umbrella', 'guarda-chuva'], ['How about…?', 'Que tal…?'], ['share', 'dividir'], ['record store', 'loja de discos'], ['getting wet', 'se molhando']] },
    { id: 'beacon-after-dark', title: 'Beacon After Dark', kind: 'Série de suspense', format: 'series', genres: ['suspense', 'drama', 'terror'], themes: [], level: 'B1', cefr: 3, ep: 'Ep. 1 · The 2 a.m. Customer', dur: '12 min', cover: IMG + 'cover/beacon-after-dark.webp', scene: IMG + 'scene/night-diner.webp',
      synopsis: 'Toda noite, às duas da manhã, alguém pede o mesmo café no diner da estrada. Ninguém nunca viu o rosto dele.',
      cast: [['Rosie', 'RO', C.orange], ['Stranger', '??', C.slate]], dub: 'Rosie',
      lines: [
        { who: 'Rosie', en: 'We’re about to close, sir. Can I get you anything?', pt: 'Estamos quase fechando, senhor. Posso trazer alguma coisa?' },
        { who: 'Stranger', en: 'Just a coffee. The same as last night.', pt: 'Só um café. O mesmo de ontem à noite.' },
        { who: 'Rosie', en: 'I’m sorry, have we met before?', pt: 'Desculpe, a gente já se conhece?' },
        { who: 'Stranger', en: 'You don’t remember me. Nobody ever does.', pt: 'Você não se lembra de mim. Ninguém nunca lembra.' },
        { who: 'Rosie', en: 'That’s a little creepy, to be honest.', pt: 'Isso é meio assustador, para ser sincera.' },
        { who: 'Stranger', en: 'Keep the change. And lock the back door tonight.', pt: 'Fica com o troco. E tranque a porta dos fundos hoje.' },
        { who: 'Rosie', en: 'Wait. How do you know about the back door?', pt: 'Espera. Como você sabe da porta dos fundos?' }
      ],
      vocab: [['about to', 'prestes a'], ['have we met?', 'a gente já se conhece?'], ['creepy', 'assustador'], ['to be honest', 'para ser sincero(a)'], ['Keep the change.', 'Fica com o troco.']] },
    { id: 'spirit-roast', title: 'Spirit Roast', kind: 'Anime', format: 'animes', genres: ['slice', 'fantasia'], themes: ['comida'], level: 'A2', cefr: 2, ep: 'Ep. 4 · The Sleepy Bean', dur: '7 min', cover: IMG + 'cover/spirit-roast.webp', scene: IMG + 'scene/cafe-counter.webp',
      synopsis: 'Antes do sol nascer, a Becky conversa com os espíritos dos grãos de café. Um deles não quer acordar de jeito nenhum.',
      cast: [['Becky', 'BW', C.orange], ['Bean', 'BE', C.green]], dub: 'Becky',
      lines: [
        { who: 'Becky', en: 'Good morning, little beans. Time to wake up.', pt: 'Bom dia, grãozinhos. Hora de acordar.' },
        { who: 'Bean', en: 'Five more minutes, please.', pt: 'Mais cinco minutinhos, por favor.' },
        { who: 'Becky', en: 'You said that an hour ago.', pt: 'Você disse isso uma hora atrás.' },
        { who: 'Bean', en: 'I’m a dark roast. I need a lot of sleep.', pt: 'Eu sou torra escura. Preciso dormir bastante.' },
        { who: 'Becky', en: 'The customers are waiting. They need you.', pt: 'Os clientes estão esperando. Eles precisam de você.' },
        { who: 'Bean', en: 'Fine. But I want the blue cup today.', pt: 'Tá bom. Mas hoje eu quero a xícara azul.' }
      ],
      vocab: [['wake up', 'acordar'], ['five more minutes', 'mais cinco minutos'], ['ago', 'atrás'], ['a lot of', 'bastante'], ['waiting', 'esperando']] },
    { id: 'level-up-zach', title: 'Level Up, Zach', kind: 'Série sobre games', format: 'games', genres: ['comedia', 'rpg', 'fps', 'mobile'], themes: ['tecnologia'], level: 'A1–A2', cefr: 1, ep: 'Estreia sexta', dur: '6 min', cover: IMG + 'k7/garage-beacon.webp', scene: IMG + 'scene/garage-band.webp', locked: true,
      synopsis: 'Zach entra num torneio online e descobre que o chat do jogo é o melhor professor de inglês que ele já teve.', cast: [['Zach', 'ZW', C.orange]], dub: 'Zach', lines: [], vocab: [] },
    { id: 'barbaras-kitchen', title: 'Barbara’s Kitchen', kind: 'Programa de culinária', format: 'series', genres: ['documentario', 'comedia'], themes: ['comida'], level: 'A2', cefr: 2, ep: 'Estreia sexta', dur: '10 min', cover: IMG + 'bg/home.webp', scene: IMG + 'bg/home.webp', locked: true,
      synopsis: 'A Dona Barbara ensina as receitas da família e os phrasal verbs da cozinha: chop up, stir in, pour over.', cast: [['Barbara', 'BB', C.slate]], dub: 'Barbara', lines: [], vocab: [] }
  ];
  const ALBUMS = [
    { id: 'season-one', title: 'Músicas da Temporada 1', sub: 'As músicas dos episódios', level: 'A1', img: IMG + 'k7/season-one.webp', genres: ['pop'],
      tracks: [{ title: 'Say Hello', from: 'Episódio 1', audio: 'assets/audio/musica-aula-1.mp3', ep: 1 }, { title: 'This Is My Family', from: 'Episódio 2', bpm: 104, key: 0, ep: 2 }, { title: 'Come On In', from: 'Episódio 5', bpm: 96, key: 5, ep: 5 }] },
    { id: 'synth-nights', title: 'Synth Nights', sub: 'Pop anos 80 em inglês fácil', level: 'A2', img: IMG + 'k7/synth-nights.webp', genres: ['pop', 'anos80', 'eletronica'],
      tracks: [
        { title: 'Rewind My Heart', from: 'Original TIE', bpm: 112, key: 9, lines: [{ en: 'Press play, the night is young', pt: 'Aperte o play, a noite é uma criança', gap: 'young' }, { en: 'I know the words, I know the song', pt: 'Eu sei a letra, eu sei a música', gap: 'song' }, { en: 'If I make a mistake tonight', pt: 'Se eu errar hoje à noite', gap: 'mistake' }, { en: 'I rewind, and I get it right', pt: 'Eu volto e acerto', gap: 'right' }, { en: 'Rewind, rewind my heart', pt: 'Volta, volta meu coração', gap: 'heart' }, { en: 'Every stop is a brand-new start', pt: 'Cada pausa é um novo começo', gap: 'start' }] },
        { title: 'Night Drive to Beacon', from: 'Original TIE', bpm: 100, key: 2, lines: [{ en: 'Windows down, the radio on', pt: 'Vidros abertos, rádio ligado', gap: 'radio' }, { en: 'Driving home before the dawn', pt: 'Voltando para casa antes do amanhecer', gap: 'home' }, { en: 'Neon lights on Main Street', pt: 'Luzes neon na Main Street', gap: 'lights' }, { en: 'The coffee’s warm and life is sweet', pt: 'O café está quente e a vida é doce', gap: 'sweet' }] }
      ] },
    { id: 'garage-beacon', title: 'Garage Beacon', sub: 'O rock da banda do Zach', level: 'A1', img: IMG + 'k7/garage-beacon.webp', genres: ['rock'],
      tracks: [
        { title: 'First Beat', from: 'Beat Beacon · Ep. 1', bpm: 132, key: 4, lines: [{ en: 'One, two, three, four', pt: 'Um, dois, três, quatro', gap: 'four' }, { en: 'Open up the garage door', pt: 'Abre a porta da garagem', gap: 'door' }, { en: 'I can play and you can sing', pt: 'Eu sei tocar e você sabe cantar', gap: 'sing' }, { en: 'Friday night is everything', pt: 'Sexta à noite é tudo', gap: 'night' }] },
        { title: 'Friday Night', from: 'Beat Beacon · Ep. 1', bpm: 124, key: 7, lines: [{ en: 'It’s Friday night, the stage is bright', pt: 'É sexta à noite, o palco está iluminado', gap: 'stage' }, { en: 'My hands are cold but I’m alright', pt: 'Minhas mãos estão frias, mas estou bem', gap: 'hands' }, { en: 'The crowd is loud, I say hello', pt: 'A plateia está barulhenta, eu digo oi', gap: 'hello' }, { en: 'And then we play the show', pt: 'E aí a gente faz o show', gap: 'show' }] }
      ] }
  ];
  const EP_GAPS = { 1: ['morning', 'How', 'thank', 'you', 'Zach', 'meet', 'See', 'soon'], 2: ['mother', 'sister', 'Margaret', 'Becky', 'engineer', 'student', 'family', 'How'], 5: ['door', 'way', 'coat', 'town'] };
  TIE.data = Object.assign(TIE.data || {}, { EXTRAS, ALBUMS, EP_GAPS });
})();
