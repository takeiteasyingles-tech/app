// Conteúdo do curso, portado do Take It Easy App v3.2.dc.html (linhas 1193–1534) sem mudanças de texto.
window.TIE = window.TIE || {};
(function () {
const STEPS = [
  { n: 1, name: 'Intro', pt: 'vinheta e claquete', group: 'ABERTURA' },
  { n: 2, name: 'Take the Mic', pt: 'música · 1ª passada' },
  { n: 3, name: 'e-book', pt: 'baixe para liberar o episódio' },
  { n: 4, name: 'Take a Look', pt: 'dê uma olhada', group: 'O EPISÓDIO' },
  { n: 5, name: 'Take It In', pt: 'absorva' },
  { n: 6, name: 'Take the Mic', pt: 'pegue o microfone' },
  { n: 7, name: 'Take a Lesson', pt: 'tenha uma aula' },
  { n: 8, name: 'Take Away', pt: 'leve com você' },
  { n: 9, name: 'Take Action', pt: 'mãos à obra' },
  { n: 10, name: 'Take the Mic', pt: 'música · cante junto', group: 'FECHAMENTO' }
];
const N = '#0F2A55', B = '#2A6FF5', O = '#F45A28', C = '#F8F5EB', L = '#E6E0CE', G = '#1F7A4C', M = '#56607A', S = '#3C5580';
const CAST = { Zach: ['ZW', S], Margaret: ['MW', B], Maggie: ['MW', B], Robert: ['RW', S], Becky: ['BW', S], Barbara: ['BB', S], Lucas: ['LC', O] };
const EB1_SCOPE = 'Ao terminar este e-book você cumprimenta alguém em inglês americano, diz o seu nome, responde a uma apresentação e apresenta as pessoas da sua família.';

const EPS = {
  1: {
    num: 1, title: 'Good Morning', ebook: 1, ebookEps: '1–2', ebookTitle: 'NICE TO MEET YOU', scope: EB1_SCOPE,
    synopsis: 'Um domingo de setembro na casa dos Woods, em Beacon. Zach precisa gravar um vídeo sobre a família para a escola.',
    introAudio: 'assets/audio/intro-aula-1.mp3', songAudio: 'assets/audio/musica-aula-1.mp3', songTitle: 'Say Hello', sceneVideo: 'assets/video/cena-aula-1.mp4',
    lyrics: [
      { en: 'Hi! Hi! Good morning!', pt: 'Oi! Oi! Bom dia!' },
      { en: 'Hi! Hi! How are you?', pt: 'Oi! Oi! Como vai?' },
      { en: 'I’m fine, I’m fine, thank you.', pt: 'Tô bem, tô bem, obrigado.' },
      { en: 'I’m fine — and how are you?', pt: 'Tô bem — e você, como vai?' },
      { en: 'Hello! Hello! My name is Zach.', pt: 'Olá! Olá! Meu nome é Zach.' },
      { en: 'Hello! Hello! Nice to meet you.', pt: 'Olá! Olá! Prazer em conhecer.' },
      { en: 'Bye! Bye! See you soon.', pt: 'Tchau! Tchau! Até logo.' },
      { en: 'Bye! Bye! See you soon.', pt: 'Tchau! Tchau! Até logo.' }
    ],
    sceneNote: 'Cozinha dos Woods, manhã de domingo. Espaço para a ilustração ou clipe.',
    cast: ['Zach', 'Margaret', 'Robert', 'Becky', 'Barbara'],
    visual: [{ en: 'morning', pt: 'manhã' }, { en: 'kitchen', pt: 'cozinha' }, { en: 'window', pt: 'janela' }, { en: 'table', pt: 'mesa' }, { en: 'coffee', pt: 'café' }, { en: 'mug', pt: 'caneca' }, { en: 'door', pt: 'porta' }, { en: 'phone', pt: 'celular' }],
    dialogTitle: 'ZACH’S VIDEO · PART ONE', dialogSub: 'Zach precisa gravar um vídeo sobre a família para a escola.',
    dialog: [
      { who: 'Zach', en: 'OK. Ready? Hi! My name is Zach. Zach Woods.', pt: 'Certo. Pronto? Oi! Meu nome é Zach. Zach Woods.' },
      { who: 'Zach', en: 'Mom! Say hello!', pt: 'Mãe! Dá um oi!' },
      { who: 'Margaret', en: 'Hello! I’m Margaret. Good morning, everybody.', pt: 'Olá! Eu sou a Margaret. Bom dia, pessoal.' },
      { who: 'Zach', en: 'Dad, you’re next.', pt: 'Pai, agora é você.' },
      { who: 'Robert', en: 'Good morning. My name is Robert Woods. It’s nice to meet you.', pt: 'Bom dia. Meu nome é Robert Woods. Prazer em conhecer vocês.' },
      { who: 'Zach', en: 'Becky! Come here!', pt: 'Becky! Vem cá!' },
      { who: 'Becky', en: 'Hey. I’m Becky. Hi, everybody.', pt: 'Ei. Eu sou a Becky. Oi, gente.' },
      { who: '', en: '(the doorbell rings)', pt: '(a campainha toca)', stage: true },
      { who: 'Margaret', en: 'Hi, Barbara! Come in.', pt: 'Oi, Barbara! Entra.' },
      { who: 'Barbara', en: 'Good morning, honey. How are you?', pt: 'Bom dia, querida. Como você está?' },
      { who: 'Margaret', en: 'I’m fine, thanks. And you?', pt: 'Estou bem, obrigada. E você?' },
      { who: 'Barbara', en: 'Oh, I’m good. Thank you, dear.', pt: 'Ah, estou ótima. Obrigada, querida.' },
      { who: 'Zach', en: 'Mrs. Baker! Say hello!', pt: 'Dona Barbara! Dá um oi!' },
      { who: 'Barbara', en: 'Hello! I’m Barbara Baker. Nice to meet you.', pt: 'Olá! Eu sou a Barbara Baker. Prazer.' },
      { who: 'Zach', en: 'Thank you, everybody. Bye!', pt: 'Obrigado, pessoal. Tchau!' },
      { who: 'All', en: 'Bye!', pt: 'Tchau!' }
    ],
    mic: [
      { en: 'Hi! My name is Zach.', tip: 'O H é só ar. Nada de R de “rato”.', result: 7, blue: true, fb: 'A frase foi clara. Ajuste o /h/ em hi: solte ar, não use o R da garganta. Ouça e tente de novo.' },
      { en: 'Hello! I’m Margaret.', tip: 'I’m sai numa sílaba só: “aim”.', result: 8, blue: true, fb: 'Quase lá. Hello saiu com um pouco de R da garganta. Mantenha a garganta solta.' },
      { en: 'Good morning.', tip: 'O r de morning se pronuncia. Boa notícia: o seu R já ajuda.', result: 9, fb: 'O r de morning saiu inteiro. Esse você já tem.' },
      { en: 'How are you?', tip: 'As três palavras se emendam: “hau-ar-iú”.', result: 8, blue: true, fb: 'Boa emenda. O h de how pode ser mais soprado.' },
      { en: 'I’m fine, thanks. And you?', tip: 'O th de thanks: língua entre os dentes, sopro.', result: 7, blue: true, fb: 'Thanks saiu perto de “tanks”. Língua entre os dentes e sopre.' },
      { en: 'Nice to meet you.', tip: 'meet you vira “mí-tchu” na fala natural. Pode copiar.', result: 9, fb: 'Natural, com o meet you emendado.' },
      { en: 'Bye! See you.', tip: 'See you = “si-iú”. Despedida padrão nos EUA.', result: 10, fb: 'Perfeito para o dia a dia.' }
    ],
    lesson: [
      { k: '1 · O VERBO TO BE NA 1ª E 2ª PESSOA', body: 'Em inglês, dizer quem você é exige um verbo. Esse verbo é to be, e nesta lição você usa duas formas dele.',
        rows: [{ en: 'I am Robert. → I’m Robert.', note: 'A contraída é a forma normal na fala. A completa soa enfática.' }, { en: 'You are Zach. → You’re Zach.', note: 'You serve para “você” e para “vocês”. Não muda.' }] },
      { k: '2 · O SUJEITO NUNCA SOME', title: 'A ARMADILHA NÚMERO UM DO PORTUGUÊS', body: 'Em português, “Sou o Robert” é uma frase completa: o verbo já diz quem fala. Em inglês isso não existe. Toda frase precisa de sujeito, mesmo quando é óbvio.',
        rows: [{ en: 'I am Robert.', pt: 'Sou o Robert.', bad: 'Am Robert.' }, { en: 'I’m fine.', pt: 'Estou bem.', bad: 'Am fine. / Is fine.' }, { en: 'It’s Barbara.', pt: 'É a Barbara.', bad: 'Is Barbara.' }] },
      { k: '3 · DUAS FORMAS DE DIZER O SEU NOME', body: 'My name is Ana. e I’m Ana. fazem exatamente a mesma coisa. A segunda é mais curta e mais comum na vida real.' },
      { k: '4 · MR. · MRS. · MS. · MISS', body: 'O inglês americano põe ponto nessas abreviações. O britânico omite. Como o curso é americano do primeiro áudio ao último, use sempre com ponto — exceto Miss, que não leva ponto porque não é abreviação de nada.',
        rows: [{ en: 'Mr.', note: 'Homem adulto, qualquer estado civil. Mr. Woods.' }, { en: 'Mrs.', note: 'Mulher casada que usa o sobrenome do marido. Mrs. Baker.' }, { en: 'Ms.', note: 'Mulher adulta, sem informar estado civil. É a escolha segura quando você não sabe.' }, { en: 'Miss', note: 'Mulher jovem ou solteira. Hoje soa antiquado com adultas.' }, { en: 'Mrs. Baker', bad: 'Mrs. Barbara', note: 'Essas formas vão com o sobrenome, nunca com o primeiro nome.' }] },
      { k: '5 · GOOD MORNING E O RESTO DA GRADE', body: 'O americano usa Hi, Hey, Hello e Good morning no dia a dia. Good afternoon e Good evening existem, mas são raros na fala casual. Aprenda agora: Hi serve para qualquer hora e qualquer pessoa.' },
      { k: '6 · THANKS OU THANK YOU?', body: 'As duas estão certas. Thanks é mais curto e mais frequente. Thank you é um grau mais atento — e é o que você usa quando alguém realmente fez algo por você.' }
    ],
    pron: { k: 'NOTA DE PRONÚNCIA · O /H/ INICIAL', parts: [
      { b: 'O que a gente faz.', t: 'O português não tem o som do h inglês. Quando o brasileiro precisa produzir algum som ali, o cérebro oferece o R gutural de rato. Hello costuma sair como “Rélou”.' },
      { b: 'O que fazer.', t: 'O /h/ inglês não é um som, é um sopro. A garganta fica relaxada, sem vibração nenhuma. É o mesmo ar de quando você embaça o vidro dos óculos para limpar.' },
      { b: 'Teste da mão.', t: 'Coloque a mão a cinco centímetros da boca e diga Hi. Você precisa sentir o ar batendo na palma antes da vogal.' }],
      pairs: [{ a: 'hi /haɪ/', b: 'eye /aɪ/', c: '“oi” vira “olho”' }, { a: 'hear /hɪr/', b: 'ear /ɪr/', c: '“ouvir” vira “orelha”' }, { a: 'hat /hæt/', b: 'at /æt/', c: '“chapéu” vira “em”' }, { a: 'hold /hoʊld/', b: 'old /oʊld/', c: '“segurar” vira “velho”' }],
      words: ['hi', 'hello', 'how', 'honey', 'here'] },
    awayExp: [
      { en: 'Hi · Hello', pt: 'Oi · Olá', note: 'Qualquer hora, qualquer pessoa' }, { en: 'Hey', pt: 'Ei', note: 'Informal e neutro nos EUA. Não é grosseiro.' },
      { en: 'Good morning', pt: 'Bom dia', note: 'Até por volta do meio-dia' }, { en: 'My name is…', pt: 'Meu nome é…', note: 'Apresentação um pouco mais formal' },
      { en: 'I’m…', pt: 'Eu sou…', note: 'A forma mais comum na vida real' }, { en: 'Nice to meet you.', pt: 'Prazer em conhecer.', note: 'Só na primeira vez que você encontra a pessoa' },
      { en: 'How are you?', pt: 'Como vai?', note: 'É cumprimento, não pergunta. Ver Take Five.' }, { en: 'I’m fine, thanks.', pt: 'Estou bem, obrigado(a).', note: 'Resposta padrão' },
      { en: 'And you?', pt: 'E você?', note: 'Devolve a bola. Nunca deixe de devolver.' }, { en: 'Thanks · Thank you.', pt: 'Obrigado(a).' },
      { en: 'Bye · See you.', pt: 'Tchau · Até mais.' }, { en: 'Come in.', pt: 'Entra.', note: 'Convite na porta' }, { en: 'Come here.', pt: 'Vem cá.', note: 'Informal, entre próximos' }
    ],
    awayWords: ['morning', 'kitchen', 'window', 'table', 'coffee', 'mug', 'door', 'phone', 'name', 'Mr.', 'Mrs.', 'Ms.', 'Miss', 'everybody', 'honey', 'ready'],
    ex: [
      { kind: 'escrito', title: 'Take a Guess', intro: 'Você não viu estas palavras na lição. Use o contexto e escolha a melhor tradução.', items: [
        { q: 'Zach diz: “Come here!”', opts: ['Vem cá!', 'Que horas são?', 'Tchau!'], a: 0 },
        { q: 'Margaret diz: “Come in.”', opts: ['Sai.', 'Entra.', 'Senta.'], a: 1 },
        { q: 'Zach diz: “Ready?”', opts: ['Pronto?', 'Cansado?', 'Certo?'], a: 0 },
        { q: 'Todos dizem: “Bye!”', opts: ['Bom dia.', 'Obrigado.', 'Tchau.'], a: 2 },
        { q: 'Barbara diz: “Oh, I’m good.”', opts: ['Sou boa nisso.', 'Estou bem.', 'Está bom assim.'], a: 1 }] },
      { kind: 'escrito', title: 'Complete o diálogo', intro: 'Use: I’m · Hello · How · name · you · Nice', items: [
        { q: 'Ana: ___! My name is Ana.', opts: ['Hello', 'How', 'Nice'], a: 0 },
        { q: 'Ana: Hello! My ___ is Ana.', opts: ['you', 'name', 'I’m'], a: 1 },
        { q: 'Margaret: Hi, Ana. ___ Margaret.', opts: ['Nice', 'How', 'I’m'], a: 2 },
        { q: 'Ana: ___ to meet you.', opts: ['Nice', 'How', 'Hello'], a: 0 },
        { q: 'Margaret: Nice to meet you too. ___ are you?', opts: ['I’m', 'How', 'name'], a: 1 },
        { q: 'Ana: I’m fine, thanks. And ___?', opts: ['name', 'Nice', 'you'], a: 2 }] },
      { kind: 'com áudio', title: 'Quem está dizendo o quê?', intro: 'Pense na voz de cada um, não só no conteúdo.', audio: 'tts', audioLabel: 'Ouvir as falas', items: [
        { q: '“Hey. I’m Becky. Hi, everybody.”', opts: ['Robert Woods', 'Barbara Baker', 'Zach Woods', 'Becky Woods'], a: 3 },
        { q: '“Good morning. My name is Robert Woods. It’s nice to meet you.”', opts: ['Robert Woods', 'Barbara Baker', 'Zach Woods', 'Becky Woods'], a: 0 },
        { q: '“Good morning, honey. How are you?”', opts: ['Robert Woods', 'Barbara Baker', 'Zach Woods', 'Becky Woods'], a: 1 },
        { q: '“Mom! Say hello!”', opts: ['Robert Woods', 'Barbara Baker', 'Zach Woods', 'Becky Woods'], a: 2 }] },
      { kind: 'música', title: 'A música · Say Hello', intro: 'Ouça duas vezes e complete as lacunas.', audio: 'song', audioLabel: 'Ouvir a música', items: [
        { q: 'Hi! Hi! Good ___!', opts: ['morning', 'night', 'bye'], a: 0 },
        { q: 'Hi! Hi! ___ are you?', opts: ['Who', 'How', 'What'], a: 1 },
        { q: 'I’m fine, I’m fine, thank ___.', opts: ['me', 'your', 'you'], a: 2 },
        { q: '___! Hello! My name is Zach.', opts: ['Hello', 'Bye', 'Nice'], a: 0 },
        { q: 'Hello! Hello! ___ to meet you.', opts: ['Fine', 'Nice', 'Good'], a: 1 },
        { q: 'Bye! Bye! ___ you soon.', opts: ['Meet', 'See', 'Say'], a: 1 }] }
    ],
    done: { title: 'AGORA VOCÊ CUMPRIMENTA E DIZ QUEM VOCÊ É.', line: 'Hi! I’m {N}. Nice to meet you.', nextNum: '02', nextTitle: 'This Is My Family', nextSub: 'Fecha o e-book 1', nextNote: 'Depois do episódio 2: Take Five, Take the Lead, Take it for Real e o Take the episode test.', cta: 'Abrir o episódio 2', go: 'ep2' }
  },
  2: {
    num: 2, title: 'This Is My Family', ebook: 1, ebookEps: '1–2', ebookTitle: 'NICE TO MEET YOU', scope: EB1_SCOPE,
    synopsis: 'Mesma casa, uma hora depois. Zach edita o vídeo e agora apresenta a família para a professora.',
    introAudio: '', songAudio: '', songTitle: 'This Is My Family',
    lyrics: [
      { en: 'This is my mother. This is my father.', pt: 'Esta é a minha mãe. Este é o meu pai.' },
      { en: 'This is my sister. And this is me.', pt: 'Esta é a minha irmã. E este sou eu.' },
      { en: 'Her name is Margaret. His name is Robert.', pt: 'O nome dela é Margaret. O nome dele é Robert.' },
      { en: 'Her name is Becky. My name is Zach.', pt: 'O nome dela é Becky. O meu nome é Zach.' },
      { en: 'He’s an engineer. She’s a designer.', pt: 'Ele é engenheiro. Ela é designer.' },
      { en: 'She’s a student. I’m a student too.', pt: 'Ela é estudante. Eu também sou estudante.' },
      { en: 'This is my family — nice to meet you.', pt: 'Esta é a minha família — prazer.' },
      { en: 'This is my family. How are you?', pt: 'Esta é a minha família. Como vai?' }
    ],
    sceneNote: 'Mesa da cozinha, uma hora depois. Espaço para a ilustração ou clipe.',
    cast: ['Zach', 'Barbara', 'Margaret'],
    visual: [{ en: 'family', pt: 'família' }, { en: 'laptop', pt: 'notebook (o computador)' }, { en: 'project', pt: 'trabalho, projeto' }, { en: 'school', pt: 'escola' }, { en: 'mother · mom', pt: 'mãe' }, { en: 'father · dad', pt: 'pai' }, { en: 'sister', pt: 'irmã' }, { en: 'neighbor', pt: 'vizinho(a)' }],
    dialogTitle: 'ZACH’S VIDEO · PART TWO', dialogSub: 'Agora Zach narra. Ele está apresentando a família para a professora.',
    dialog: [
      { who: 'Zach', en: 'This is my family. This is my school project.', pt: 'Esta é a minha família. Este é o meu trabalho da escola.' },
      { who: 'Zach', en: 'This is my mother. Her name is Margaret. She’s a designer.', pt: 'Esta é a minha mãe. O nome dela é Margaret. Ela é designer.' },
      { who: 'Margaret', en: 'Hello again!', pt: 'Olá de novo!' },
      { who: 'Zach', en: 'This is my father. His name is Robert. He’s an engineer.', pt: 'Este é o meu pai. O nome dele é Robert. Ele é engenheiro.' },
      { who: 'Robert', en: 'Good morning. I’m an engineer at Deerfield Machinery.', pt: 'Bom dia. Eu sou engenheiro na Deerfield Machinery.' },
      { who: 'Zach', en: 'This is my sister. Her name is Becky. She’s a student.', pt: 'Esta é a minha irmã. O nome dela é Becky. Ela é estudante.' },
      { who: 'Becky', en: 'I’m a student and a designer. Hi.', pt: 'Eu sou estudante e designer. Oi.' },
      { who: 'Zach', en: 'And this is me. I’m Zach. I’m a student too.', pt: 'E este sou eu. Eu sou o Zach. Eu também sou estudante.' },
      { who: 'Barbara', en: 'And who’s this, honey?', pt: 'E quem é essa aqui, querido?' },
      { who: 'Zach', en: 'Oh! This is Mrs. Baker. She’s our neighbor.', pt: 'Ah! Esta é a Dona Barbara. Ela é a nossa vizinha.' },
      { who: 'Barbara', en: 'Hello! I’m Barbara. Nice to meet you.', pt: 'Olá! Eu sou a Barbara. Prazer.' },
      { who: 'Zach', en: 'Mrs. Baker, this is my project. It’s for school.', pt: 'Dona Barbara, este é o meu trabalho. É para a escola.' },
      { who: 'Barbara', en: 'It’s a lovely project, sweetheart.', pt: 'É um trabalho lindo, meu bem.' },
      { who: 'Zach', en: 'Thank you!', pt: 'Obrigado!' },
      { who: 'Margaret', en: 'Robert. Tell them your news.', pt: 'Robert. Conta a novidade para eles.' },
      { who: 'Robert', en: 'After lunch, Maggie. After lunch.', pt: 'Depois do almoço, Maggie. Depois do almoço.', hook: 'Gancho do e-book. News, tell them e after lunch são ensinados no E-book 2.' }
    ],
    mic: [
      { en: 'This is my mother.', tip: 'This com o th soprado, língua entre os dentes.', result: 8, blue: true, fb: 'Quase. O th de this saiu perto de “dis”. Língua entre os dentes.' },
      { en: 'Her name is Margaret.', tip: 'Her tem R pronunciado até o fim.', result: 9, fb: 'O r de her saiu inteiro.' },
      { en: 'He’s an engineer.', tip: 'Não engula o an. Sem ele, a frase soa errada.', result: 7, blue: true, fb: 'O an quase sumiu. Diga “hiz-an-engineer”, sem pular o artigo.' },
      { en: 'She’s a student.', tip: 'Comece pelo S: “sss-tudent”. Nunca “istudent”.', result: 6, blue: true, fb: 'Em student você acrescentou um “i” antes do S. Comece prolongando o S e só depois solte o T. Tente de novo.' },
      { en: 'This is Mrs. Baker.', tip: 'Mrs. = “MÍ-ssis”. Não é “mistress”.', result: 9, fb: 'Mrs. saiu certinho: “mí-ssis”.' },
      { en: 'Who’s this?', tip: 'Uma palavra só na fala: “rús-dis”.', result: 8, blue: true, fb: 'Boa. O who’s pode ser mais soprado no começo.' },
      { en: 'She’s our neighbor.', tip: 'neighbor = “NÊI-bor”. O gh é mudo.', result: 9, fb: 'Neighbor com o gh mudo. Isso.' }
    ],
    lesson: [
      { k: '1 · THIS IS — A FÓRMULA DE APRESENTAR ALGUÉM', body: 'This is… serve para apresentar uma pessoa perto de você ou mostrar uma coisa. O inglês não muda nada por gênero: This is my mother e This is my father têm exatamente a mesma estrutura.', body2: 'No telefone, This is Ana. significa “aqui é a Ana”. Guarde isso agora; você vai usar a vida inteira.' },
      { k: '2 · HE · SHE · IT E AS CONTRAÇÕES', body: 'Aqui o inglês é mais simples que o português: mesa, projeto, café e casa são todos it.',
        rows: [{ en: 'he is → he’s', note: 'Homem, menino' }, { en: 'she is → she’s', note: 'Mulher, menina' }, { en: 'it is → it’s', note: 'Coisa, animal, ideia — tudo que não é pessoa' }] },
      { k: '3 · MY · HIS · HER', title: 'O POSSESSIVO CONCORDA COM O DONO', body: 'Em português, “sua mãe” é ambíguo: pode ser a mãe dele, dela ou sua. Em inglês, a palavra muda conforme quem é o dono.',
        rows: [{ en: 'my mother', pt: 'a minha mãe', note: 'Dono: eu' }, { en: 'his mother', pt: 'a mãe dele', note: 'Dono: um homem' }, { en: 'her mother', pt: 'a mãe dela', note: 'Dono: uma mulher' }] },
      { k: '4 · A ARMADILHA DO ARTIGO ANTES DE PROFISSÃO', body: 'Em português, dizemos “Ele é engenheiro”. Sem artigo. Em inglês, o artigo é obrigatório. Frase sem artigo aqui não é sotaque — é erro de gramática.',
        rows: [{ en: 'She’s a designer.', pt: 'Ela é designer.', bad: 'She’s designer.' }, { en: 'He’s an engineer.', pt: 'Ele é engenheiro.', bad: 'He’s engineer.' }, { en: 'I’m a student.', pt: 'Eu sou estudante.', bad: 'I’m student.' }, { en: 'an engineer · an hour · a designer · a university', note: 'a ou an? Depende do som, não da letra.' }] },
      { k: '5 · WHO’S THIS?', body: 'Pergunta fixa, use inteira: Who’s this? = “Quem é essa pessoa?”. A contração who’s vem de who is.' }
    ],
    pron: { k: 'NOTA DE PRONÚNCIA · O “I” ANTES DO S', parts: [
      { b: 'O que a gente faz.', t: 'O português não começa palavra com s + consoante. Quando o brasileiro lê school ou student, o cérebro completa a sílaba sozinho e insere um “i” que não existe: “iscool”, “istudent”.' },
      { b: 'O que fazer.', t: 'Comece pelo S sozinho, e segure: sssss. Sem parar o ar, acrescente a consoante seguinte: sss-t. Só então abra a vogal: sss-t-udent → student.' },
      { b: 'Truque de emenda.', t: 'Pense na palavra anterior grudada. It’s school → “itsss-cool”. A frase inteira ajuda a boca a não parar.' }],
      pairs: [{ a: 'student', b: '“istudent”', c: 'É “stu-dent”, não “styu-dent”.' }, { a: 'school', b: '“iscool”', c: 'Aparece em toda a série.' }, { a: 'small', b: '“ismol”', c: 'Vale para todo s + consoante.' }, { a: 'street', b: '“istrit”', c: 'Vem aí: a loja fica na Main Street.' }],
      words: ['student', 'school', 'stop', 'street'] },
    awayExp: [
      { en: 'This is my mother.', pt: 'Esta é a minha mãe.', note: 'A fórmula de apresentar alguém' }, { en: 'Her name is…', pt: 'O nome dela é…' }, { en: 'His name is…', pt: 'O nome dele é…' },
      { en: 'He’s an engineer.', pt: 'Ele é engenheiro.', note: 'O artigo é obrigatório' }, { en: 'She’s a designer.', pt: 'Ela é designer.' },
      { en: 'I’m a student too.', pt: 'Eu também sou estudante.', note: 'too vem no fim da frase' }, { en: 'Who’s this?', pt: 'Quem é essa pessoa?' },
      { en: 'She’s our neighbor.', pt: 'Ela é a nossa vizinha.' }, { en: 'Hello again!', pt: 'Olá de novo!' }, { en: 'It’s for school.', pt: 'É para a escola.' }
    ],
    awayWords: ['family', 'mother (mom)', 'father (dad)', 'sister', 'brother', 'neighbor', 'student', 'designer', 'engineer', 'project', 'school', 'laptop', 'lovely', 'sweetheart', 'again', 'too', 'a / an', 'my', 'his', 'her', 'our'],
    ex: [
      { kind: 'escrito', title: 'Escolha a tradução', intro: 'Cuidado com o artigo antes da profissão e com o sujeito da frase.', items: [
        { q: 'Esta é a minha mãe.', opts: ['This is my mother.', 'This is mother.', 'Is my mother.'], a: 0 },
        { q: 'O nome dele é Robert.', opts: ['Her name is Robert.', 'His name is Robert.', 'He name is Robert.'], a: 1 },
        { q: 'Ela é designer.', opts: ['She’s designer.', 'Is a designer.', 'She’s a designer.'], a: 2 },
        { q: 'Eu sou estudante também.', opts: ['I’m a student too.', 'I’m student too.', 'Too I’m a student.'], a: 0 },
        { q: 'Esta é a Dona Barbara. Ela é a nossa vizinha.', opts: ['This is Mrs. Barbara. She’s our neighbor.', 'This is Mrs. Baker. She’s our neighbor.', 'This is Mrs. Baker. Is our neighbor.'], a: 1 },
        { q: 'Quem é essa aqui?', opts: ['What’s this?', 'Whose this?', 'Who’s this?'], a: 2 }] },
      { kind: 'escrito', title: 'Complete com he’s · she’s · it’s · this is', items: [
        { q: '___ my father. ___ an engineer.', opts: ['This is / He’s', 'This is / She’s', 'He’s / This is'], a: 0 },
        { q: '___ my sister. ___ a student.', opts: ['This is / He’s', 'This is / She’s', 'She’s / It’s'], a: 1 },
        { q: '___ my school project. ___ for school.', opts: ['This is / He’s', 'It’s / This is', 'This is / It’s'], a: 2 },
        { q: '___ Mrs. Baker. ___ our neighbor.', opts: ['This is / She’s', 'This is / It’s', 'She’s / He’s'], a: 0 }] },
      { kind: 'com áudio', title: 'Ordene a conversa', intro: 'Qual fala vem depois?', audio: 'tts', audioLabel: 'Ouvir a conversa', items: [
        { q: 'Hi! My name is Ana.', opts: ['Nice to meet you too.', 'Hello, Ana. I’m Barbara.', 'Hello, Sonia! Nice to meet you.'], a: 1 },
        { q: 'Hello, Ana. I’m Barbara.', opts: ['Nice to meet you, Barbara.', 'Nice to meet you too.', 'Hello, Sonia! Nice to meet you.'], a: 0 },
        { q: 'Nice to meet you, Barbara.', opts: ['Hi! My name is Ana.', 'And this is my mother. Her name is Sonia.', 'Nice to meet you too.'], a: 2 },
        { q: 'Nice to meet you too.', opts: ['And this is my mother. Her name is Sonia.', 'Hello, Ana. I’m Barbara.', 'Hi! My name is Ana.'], a: 0 },
        { q: 'And this is my mother. Her name is Sonia.', opts: ['Nice to meet you, Barbara.', 'Hello, Sonia! Nice to meet you.', 'Hi! My name is Ana.'], a: 1 }] },
      { kind: 'música', title: 'A música · This Is My Family', intro: 'Complete com he’s · she’s · His · Her.', items: [
        { q: '___ name is Margaret.', opts: ['Her', 'His', 'He’s', 'She’s'], a: 0 },
        { q: '___ name is Robert.', opts: ['Her', 'His', 'He’s', 'She’s'], a: 1 },
        { q: '___ an engineer.', opts: ['Her', 'His', 'He’s', 'She’s'], a: 2 },
        { q: '___ a designer.', opts: ['Her', 'His', 'He’s', 'She’s'], a: 3 },
        { q: '___ a student. I’m a student too.', opts: ['Her', 'His', 'He’s', 'She’s'], a: 3 }] }
    ],
    done: { title: 'AGORA VOCÊ APRESENTA A SUA FAMÍLIA.', line: 'This is my family. Nice to meet you.', nextNum: 'E1', nextTitle: 'Extras e teste do e-book 1', nextSub: 'Take Five · Take the Lead · Take it for Real · teste', nextNote: 'O almoço de domingo está na mesa, e o Robert ainda não contou a novidade.', cta: 'Ir para os extras do e-book 1', go: 'ebook1' }
  },
  5: {
    num: 5, title: 'Welcome to Beacon', ebook: 3, ebookEps: '5–6', ebookTitle: 'WELCOME TO BEACON',
    scope: 'Ao terminar você cumprimenta quem chega, diz sua idade e pergunta como foi a viagem.',
    synopsis: 'Lucas chega à casa dos Woods com uma mala e 24 horas de viagem nas costas.',
    introAudio: '', songAudio: '', songTitle: 'Come On In',
    lyrics: [
      { en: 'Open the door, come on in', pt: 'Abre a porta, pode entrar' },
      { en: 'You came a long way, my friend', pt: 'Você veio de longe, meu amigo' },
      { en: 'Take off your coat, sit down', pt: 'Tira o casaco, senta aí' },
      { en: 'Welcome to this little town', pt: 'Bem-vindo a esta cidadezinha' }
    ],
    sceneNote: 'Espaço para o vídeo da cena.', cast: ['Maggie', 'Lucas', 'Zach'],
    visual: [{ en: 'front porch', pt: 'varanda da frente' }, { en: 'suitcase', pt: 'mala' }, { en: 'hallway', pt: 'corredor' }, { en: 'drum kit', pt: 'bateria' }],
    dialogTitle: 'ACT 1 · A CHEGADA', dialogSub: 'Lucas chega à casa dos Woods.',
    dialog: [
      { who: 'Margaret', en: 'Hi! You must be Lucas.', pt: 'Oi! Você deve ser o Lucas.' },
      { who: 'Lucas', en: 'Yes. Nice to meet you, Mrs. Woods.', pt: 'Sim. Prazer, sra. Woods.' },
      { who: 'Margaret', en: 'Please, call me Maggie. Welcome to our home!', pt: 'Por favor, me chame de Maggie. Bem-vindo à nossa casa!' },
      { who: 'Lucas', en: 'Thank you. Your house is beautiful.', pt: 'Obrigado. Sua casa é linda.' },
      { who: 'Zach', en: 'Hi, I’m Zach. How old are you?', pt: 'Oi, eu sou o Zach. Quantos anos você tem?' },
      { who: 'Lucas', en: 'I have 24 years.', pt: 'Eu tenho 24 anos.', err: 'Erro de brasileiro, planejado. A Maggie corrige na fala seguinte. Explicação no Take a Lesson.' },
      { who: 'Margaret', en: 'Oh, you’re 24! Zach is 12.', pt: 'Ah, você tem 24! O Zach tem 12.' },
      { who: 'Lucas', en: 'Right. I’m 24.', pt: 'Isso. Eu tenho 24.' },
      { who: 'Zach', en: 'Cool. Do you play the drums?', pt: 'Legal. Você toca bateria?' },
      { who: 'Margaret', en: 'Zach, let him sit down! How was your flight?', pt: 'Zach, deixa ele sentar! Como foi o voo?' },
      { who: 'Lucas', en: 'Long. But I’m happy to be here.', pt: 'Longo. Mas estou feliz de estar aqui.' }
    ],
    mic: [
      { en: 'Nice to meet you.', tip: '', result: 9, fb: 'Ritmo certo e o t final soltinho, sem virar “tchi”.' },
      { en: 'Welcome to our home.', tip: 'O h de home é só ar.', result: 7, blue: true, fb: 'O h de home saiu perto do r de “rato”. Solte só o ar, como quem embaça um espelho.' },
      { en: 'I’m 24.', tip: '', result: 9, fb: 'Claro e natural.' },
      { en: 'How was your flight?', tip: '', result: 8, blue: true, fb: 'Quase lá. O h de how pode ser mais leve: só ar, sem raspar.' }
    ],
    lesson: [
      { k: 'A REGRA', title: 'IDADE EM INGLÊS USA O VERBO TO BE.', body: 'Em inglês você não “tem” anos: você “é” uma idade. Por isso a pergunta é How old are you?, literalmente “quão velho você é?”.' },
      { k: 'NO DIÁLOGO', rows: [{ en: 'Oh, you’re 24!', pt: 'Ah, você tem 24!' }, { en: 'Zach is 12.', pt: 'O Zach tem 12.' }] },
      { k: 'A ARMADILHA DO PORTUGUÊS', body: 'A gente pensa em “eu tenho 24 anos” e traduz o verbo. Foi o que o Lucas fez.', rows: [{ en: 'I’m 24.', pt: 'Eu tenho 24 anos.', bad: 'I have 24 years.' }] }
    ],
    pron: { k: 'NOTA DE PRONÚNCIA · O H DE HOME', parts: [
      { b: 'O que a gente faz.', t: 'Troca o h pelo r de “rato”: home vira “rome”.' },
      { b: 'Por quê.', t: 'Em vários sotaques do português, esse r já sai do fundo da garganta. Parece o mesmo som, mas raspa.' },
      { b: 'O que fazer.', t: 'O h inglês é só ar. Solte como quem embaça um espelho, sem tocar a garganta.' }], pairs: [], words: ['hi', 'home', 'house', 'happy'] },
    awayExp: [{ en: 'You must be…', pt: 'Você deve ser…' }, { en: 'Nice to meet you.', pt: 'Prazer.' }, { en: 'Call me…', pt: 'Me chame de…' }, { en: 'Welcome to our home.', pt: 'Bem-vindo à nossa casa.' }, { en: 'I’m 24.', pt: 'Tenho 24 anos.' }, { en: 'How was your flight?', pt: 'Como foi o voo?' }],
    awayWords: ['home', 'house', 'flight', 'happy', 'beautiful', 'old'],
    ex: [
      { kind: 'escrito', title: 'Complete a frase', items: [{ q: 'Lucas ___ 24.', opts: ['is', 'has', 'have'], a: 0, fix: 'Idade usa o verbo to be.' }] },
      { kind: 'escrito', title: 'Ordem da frase', items: [{ q: 'Qual frase está na ordem certa?', opts: ['Welcome to our home.', 'Welcome our to home.', 'To our home welcome.'], a: 0 }] },
      { kind: 'com áudio', title: 'Ouça e escolha', audio: 'tts', audioLabel: 'Ouvir a Maggie', items: [{ q: 'O que a Maggie pergunta?', opts: ['How was your flight?', 'How was your fight?', 'Who was your flight?'], a: 0, say: 'How was your flight?' }] },
      { kind: 'música', title: 'Complete o verso', items: [{ q: 'Open the door, come ___', opts: ['in', 'on', 'at'], a: 0 }] }
    ],
    done: { title: 'AGORA VOCÊ DIZ SUA IDADE EM INGLÊS.', line: 'I’m 24.', nextNum: '06', nextTitle: 'A Room Upstairs', nextSub: 'Libera na sexta · fecha o e-book 3', nextNote: 'Depois do episódio 6: Take Five, Take the Lead, Take it for Real, Take It Out e o Take the episode test.', cta: 'Voltar ao início', go: 'home' }
  }
};

const CHAT = [
  { her: { en: 'Hi! Welcome to Beacon. I’m Maggie.', pt: 'Oi! Bem-vindo a Beacon. Eu sou a Maggie.' }, sug: [{ en: 'Nice to meet you, Maggie.', pt: 'Prazer, Maggie.' }, { en: 'Thank you. I’m happy to be here.', pt: 'Obrigado. Estou feliz de estar aqui.' }] },
  { her: { en: 'So, how old are you?', pt: 'E quantos anos você tem?' }, sug: [{ en: 'I have 30 years.', pt: 'Eu tenho 30 anos.', fix: 'Em inglês, idade usa to be: I’m 30.' }, { en: 'I’m 30.', pt: 'Tenho 30.' }] },
  { her: { en: 'Thirty! That’s a great age. How was your trip?', pt: 'Trinta! Ótima idade. Como foi a viagem?' }, sug: [{ en: 'Long, but good.', pt: 'Longa, mas boa.' }, { en: 'It was great, thank you.', pt: 'Foi ótima, obrigado.' }] },
  { her: { en: 'Come in, please. Would you like some coffee?', pt: 'Entra, por favor. Aceita um café?' }, sug: [{ en: 'Yes, please!', pt: 'Sim, por favor!' }, { en: 'I’d love some.', pt: 'Eu adoraria.' }] },
  { her: { en: 'Here you go. It’s from our shop, Woods & Beans.', pt: 'Aqui está. É da nossa loja, a Woods & Beans.' }, sug: [] }
];
const LEAD = [
  { m: { en: 'Oh, hi! Good morning.', pt: 'Ah, oi! Bom dia.' }, opts: [{ en: 'Good morning! My name is {N}.', pt: 'Bom dia! Meu nome é {N}.' }, { en: 'Hi! I’m {N}.', pt: 'Oi! Eu sou {N}.' }, { en: 'Good morning! Am {N}.', pt: 'Bom dia! Sou {N}.', fix: 'Toda frase precisa de sujeito: I’m {N}, nunca Am {N}.' }] },
  { m: { en: 'Nice to meet you! I’m Margaret. How are you?', pt: 'Prazer! Eu sou a Margaret. Como você está?' }, opts: [{ en: 'I’m fine, thanks. And you?', pt: 'Estou bem, obrigado(a). E você?' }, { en: 'Good, thanks. You?', pt: 'Bem, obrigado(a). E você?' }, { en: 'Is fine, thanks.', pt: 'Tá bem, obrigado(a).', fix: '“Estou bem” é I’m fine. O sujeito não some.' }] },
  { m: { en: 'Good, good. Come in! This is my son, Zach.', pt: 'Que bom. Entra! Este é o meu filho, Zach.' }, opts: [{ en: 'Hi, Zach! Nice to meet you.', pt: 'Oi, Zach! Prazer.' }, { en: 'Hello, Zach.', pt: 'Olá, Zach.' }, { en: 'Hi, Zach! Nice to see you.', pt: 'Oi, Zach! Bom te ver.', fix: 'Na primeira vez é Nice to meet you. Nice to see you é para quem você já conhece.' }] },
  { m: { en: 'Zach is a student. And you?', pt: 'O Zach é estudante. E você?' }, opts: [{ en: 'I’m a student too.', pt: 'Eu também sou estudante.' }, { en: 'I’m an engineer.', pt: 'Eu sou engenheiro(a).' }, { en: 'I’m designer.', pt: 'Eu sou designer.', fix: 'Profissão pede artigo: I’m a designer.' }] },
  { m: { en: 'Oh, nice! Bye, see you!', pt: 'Ah, que legal! Tchau, até mais!' }, opts: [{ en: 'Bye! See you.', pt: 'Tchau! Até mais.' }, { en: 'Bye-bye!', pt: 'Tchau-tchau!', fix: 'Bye-bye soa infantil na boca de um adulto. Use Bye ou See you.' }] }
];
const FIVE = [
  { k: 'CUMPRIMENTO', title: '“HOW ARE YOU?” NÃO É UMA PERGUNTA', body: 'Este é o mal-entendido número um do brasileiro nos Estados Unidos. How are you?, How’s it going? e What’s up? não são perguntas sobre a sua vida. São cumprimentos — o equivalente funcional do nosso “tudo bem?” dito de passagem no corredor.', body2: 'A resposta esperada é curta e devolve a bola. Duas trocas e a conversa segue para outro assunto.',
    rows: [{ q: 'How are you?', en: 'Good, thanks. You?', pt: 'Bem, obrigado. E você?' }, { q: 'How’s it going?', en: 'Pretty good. And you?', pt: 'Tudo certo. E você?' }, { q: 'What’s up?', en: 'Not much. You?', pt: 'Nada demais. E você?' }, { q: 'How are you doing?', en: 'I’m good, thanks.', pt: 'Estou bem, obrigado.' }],
    callout: 'Para o brasileiro nos Estados Unidos, o risco não é ser formal demais. É levar o How are you? a sério e travar.' },
  { k: 'CORPO', title: 'O APERTO DE MÃO, E O QUE NÃO FAZER', bullets: ['Aperto de mão firme, dois ou três segundos, olho no olho. Mão mole é lida como falta de confiança.', 'Beijo no rosto não é padrão com quem você acabou de conhecer. Abraço, só entre pessoas próximas — e geralmente depois de algum tempo.', 'Distância maior do que a brasileira: cerca de um braço estendido. Chegar perto demais desconforta sem que a pessoa saiba dizer por quê.', 'Ao ser apresentado, repita o nome da pessoa: “Nice to meet you, Ana.” Os americanos fazem isso o tempo todo, e funciona.'] },
  { k: 'NOMES', title: 'O PRIMEIRO NOME CHEGA QUASE IMEDIATAMENTE', body: 'Você pode começar com Mr. Woods numa situação profissional, mas espere ouvir “Please, call me Robert” em poucos minutos — inclusive de chefes, clientes e professores. Insistir no sobrenome depois disso soa distante.', body2: 'A exceção é criança falando com adulto: Zach chama Barbara de Mrs. Baker mesmo conhecendo-a desde sempre. Médicos e professores universitários também mantêm o título: Dr. Kim, Professor Nair.' },
  { k: 'CONVERSA', title: 'SMALL TALK NÃO É INVASÃO DE PRIVACIDADE', body: 'No Brasil, puxar conversa com um desconhecido no elevador é opcional. Nos Estados Unidos, o silêncio é que incomoda. Comentar o tempo, o trânsito ou o fim de semana é comportamento esperado e educado.',
    badLabel: 'EVITE', rows: [{ en: 'Clima, trânsito, fim de semana', bad: 'Salário, quanto custou, aluguel' }, { en: 'Esporte local, comida, cachorro', bad: 'Idade, peso, aparência' }, { en: 'Viagem, série, notícia leve', bad: 'Religião, voto, estado civil' }, { en: 'Elogiar a cidade ou o lugar', bad: 'Por que você não tem filhos' }] },
  { k: 'PALAVRA-CHAVE', title: 'EXCUSE ME RESOLVE QUASE TUDO', body: 'Não existe em inglês americano um equivalente a “senhor” ou “moça” para chamar a atenção de um desconhecido. O que existe é Excuse me — e ele serve para pedir passagem, chamar o garçom, pedir informação e interromper educadamente. Quando errar, use Sorry. Dois cartões que abrem quase todas as portas.' }
];
const REAL = [
  { book: 'I’m fine, thank you. And you?', street: 'Good, thanks. You?', why: 'A versão completa soa de livro didático. Ninguém repara se você usar, mas ninguém fala assim.' },
  { book: 'Nice to meet you.', street: 'Nice to meet you (1ª vez) · Nice to see you (depois)', why: 'Este é o erro mais denunciador de todos. Dizer meet you para quem você já conhece sinaliza que você não lembra da pessoa.' },
  { book: 'Thank you very much.', street: 'Thanks.', why: 'O superlativo puxa peso demais para um favor pequeno.' },
  { book: 'Bye-bye.', street: 'Bye · See you · Take care', why: 'Bye-bye soa infantil na boca de um adulto.' },
  { book: 'Hello.', street: 'Hi · Hey', why: 'Hey é completamente neutro nos EUA — não é grosseiro nem íntimo.' },
  { book: '—', street: 'You too.', why: 'Resposta padrão a Nice to meet you. Duas palavras que resolvem tudo.' },
  { book: '—', street: 'Have a good one.', why: 'Despedida informal muito comum. Serve para qualquer hora do dia.' },
  { book: '—', street: 'I’m Ana. Nice to meet you, Sarah.', why: 'Repetir o nome de quem acabou de se apresentar é hábito americano. Copie.' }
];
const R1 = 'Lição 1 · Take a Lesson', R2 = 'Lição 2 · Take a Lesson';
const TEST = [
  { title: 'PARTE A · ESCOLHA A ALTERNATIVA CORRETA', qs: [
    { n: 1, q: '________ Robert.', opts: ['Am', 'I’m', 'Is'], a: 1, rev: R1, ep: 1 },
    { n: 2, q: 'She ________ a designer.', opts: ['is', 'are', 'am'], a: 0, rev: R2, ep: 2 },
    { n: 3, q: 'This is my father. ________ name is Robert.', opts: ['Her', 'His', 'Your'], a: 1, rev: R2, ep: 2 },
    { n: 4, q: 'He’s ________ engineer.', opts: ['a', 'an', '—'], a: 1, rev: R2, ep: 2 },
    { n: 5, q: 'I’m ________ student.', opts: ['a', 'an', '—'], a: 0, rev: R2, ep: 2 },
    { n: 6, q: '________ this? — It’s Mrs. Baker.', opts: ['What’s', 'Who’s', 'How’s'], a: 1, rev: R2, ep: 2 },
    { n: 7, q: 'How are you? — ________', opts: ['I’m Ana.', 'Good, thanks.', 'Nice to meet you.'], a: 1, rev: R1, ep: 1 },
    { n: 8, q: 'Qual forma está correta em inglês americano?', opts: ['Mrs Baker', 'Mrs. Barbara', 'Mrs. Baker'], a: 2, rev: R1, ep: 1 }] },
  { title: 'PARTE B · COMPLETE', qs: [
    { n: 9, q: 'Hello! My ________ is Ana.', acc: ['name'], show: 'name', rev: 'Lição 1 · Take Away', ep: 1, step: 8 },
    { n: 10, q: '________ to meet you.', acc: ['nice'], show: 'Nice', rev: 'Lição 1 · Take Away', ep: 1, step: 8 },
    { n: 11, q: 'I’m fine, thanks. ________ you?', acc: ['and'], show: 'And', rev: 'Lição 1 · Take Away', ep: 1, step: 8 },
    { n: 12, q: '________ is my mother. Her name is Sonia.', acc: ['this'], show: 'This', rev: R2, ep: 2 },
    { n: 13, q: 'She’s my sister. ________ a student.', acc: ["she's"], show: 'She’s', rev: R2, ep: 2 }] },
  { title: 'PARTE C · TRADUZA PARA O INGLÊS', qs: [
    { n: 14, q: 'Bom dia. Eu sou a Ana.', acc: ["good morning i'm ana"], show: 'Good morning. I’m Ana.', rev: R1, ep: 1 },
    { n: 15, q: 'Ela é engenheira.', acc: ["she's an engineer"], show: 'She’s an engineer.', rev: R2, ep: 2 },
    { n: 16, q: 'Este é o meu pai. O nome dele é Paulo.', acc: ['this is my father his name is paulo', 'this is my dad his name is paulo'], show: 'This is my father. His name is Paulo.', rev: R2, ep: 2 },
    { n: 17, q: 'Quem é essa aqui? — É a nossa vizinha.', acc: ["who's this she's our neighbor", "who's this it's our neighbor"], show: 'Who’s this? — She’s our neighbor.', rev: R2, ep: 2 }] },
  { title: 'PARTE D · PRONÚNCIA', qs: [
    { n: 18, q: 'Em qual palavra o H é um sopro de ar?', opts: ['hour', 'hello', 'honest'], a: 1, rev: 'Lição 1 · nota de pronúncia', ep: 1 },
    { n: 19, q: 'Qual pronúncia está correta?', opts: ['“iscool”', '“school” com S inicial', '“eschool”'], a: 1, rev: 'Lição 2 · nota de pronúncia', ep: 2 },
    { n: 20, q: 'Ouça o áudio e escolha o que você ouviu:', opts: ['eye', 'hi'], a: 1, audio: 'hi', rev: 'Lição 1 · nota de pronúncia', ep: 1 }] }
];
const TEST_ALL = TEST.reduce((acc, p) => acc.concat(p.qs), []);
const norm = (x) => String(x || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[.,!?;:—–"“”()\-]/g, ' ')
  .replace(/\bi am\b/g, "i'm").replace(/\bshe is\b/g, "she's").replace(/\bhe is\b/g, "he's").replace(/\bit is\b/g, "it's").replace(/\bwho is\b/g, "who's")
  .replace(/\s+/g, ' ').trim();
const TITLES = ['Good Morning', 'This Is My Family', 'Sunday Lunch', 'A Trip to Brazil', 'Welcome to Beacon', 'A Room Upstairs', 'Breakfast with Barbara', 'The Train to the City', 'An Empty Store', 'Paint and Coffee', 'The Roaster', 'Beans from Home', 'Opening Day', 'First in Line', 'A Busy Saturday', 'The Menu Board', "Zach's Band", 'Rain on Main Street', 'Fall in the Valley', 'A Full House'];

  TIE.data = Object.assign(TIE.data || {}, { STEPS, CAST, EB1_SCOPE, EPS, CHAT, LEAD, FIVE, REAL, TEST, TEST_ALL, norm, TITLES });
})();
