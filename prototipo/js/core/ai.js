// Cérebro do assistente do Mic: Gemini pelo servidor local (/api/*) ou, sem servidor, roteiros + regras (modo demo).
window.TIE = window.TIE || {};
(function () {
  const { pick, sub } = TIE.u;
  const ai = { online: false, model: '' };
  ai.init = async function () { if (!/^https?:$/.test(location.protocol)) return false; try { const j = await (await fetch('/api/health', { cache: 'no-store' })).json(); ai.online = !!j.ai; ai.model = j.model || ''; } catch (e) { ai.online = false; } return ai.online; };
  async function post(path, body, ms) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 20000); try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }

  const PAST = { go: 'went', eat: 'ate', see: 'saw', have: 'had', do: 'did', make: 'made', take: 'took', buy: 'bought', watch: 'watched', play: 'played', visit: 'visited' };
  const THIRD = { have: 'has', do: 'does', go: 'goes', watch: 'watches' };
  const JOBS = 'engineer|designer|student|teacher|doctor|nurse|lawyer|developer|programmer|manager|architect|journalist|accountant|dentist|chef|artist|actor|singer|writer|salesperson|farmer|agronomist|analyst|consultant';
  const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  const RULES = [
    { re: /\bi\s+(?:have|has)\s+(\d+|[a-z-]+)\s+years?(?:\s+old)?\b/i, fix: (m) => 'I’m ' + m[1], exp: 'Idade em inglês usa o verbo to be: I’m 30. O have fica de fora.', cat: 'Idade com to be' },
    { re: /^(am|is)\s+(\w+)/i, fix: (m) => (m[1].toLowerCase() === 'am' ? 'I’m ' : 'It’s ') + m[2], exp: 'Toda frase em inglês precisa de sujeito: I’m…, It’s…. Só o verbo não basta.', cat: 'Sujeito que some' },
    { re: new RegExp('\\b(i’?m|i\'m|i am|he’?s|he\'s|she’?s|she\'s|he is|she is|you’?re|you\'re|you are)\\s+(' + JOBS + ')\\b', 'i'), fix: (m) => m[1] + ' ' + an(m[2]), exp: 'Profissão pede artigo em inglês: I’m a designer, I’m an engineer.', cat: 'Artigo antes de profissão' },
    { re: /\bpeople\s+is\b/i, fix: () => 'people are', exp: 'People é plural em inglês: people are.', cat: 'Concordância' },
    { re: /\b(?:i’?m|i'm|i am)\s+agree\b/i, fix: () => 'I agree', exp: 'Agree já é verbo: I agree. Sem o am.', cat: 'Falso amigo' },
    { re: /\bmake\s+(?:a|one|some)\s+questions?\b/i, fix: () => 'ask a question', exp: 'Pergunta se faz com ask: ask a question.', cat: 'Colocação' },
    { re: /\bexplain\s+me\b/i, fix: () => 'explain to me', exp: 'Explain pede to: explain to me.', cat: 'Preposição' },
    { re: /\bdepends?\s+of\b/i, fix: () => 'depends on', exp: 'Em inglês é depends on, não of.', cat: 'Preposição' },
    { re: /\b(he|she|it)\s+(have|do|go|like|want|work|live|play|watch|need|love|speak|study)\b/i, fix: (m) => m[1] + ' ' + (THIRD[m[2].toLowerCase()] || m[2] + 's'), exp: 'Com he, she e it o verbo ganha -s: she likes, he has.', cat: 'Terceira pessoa' },
    { re: /\b(he|she|it)\s+don’?'?t\b/i, fix: (m) => m[1] + ' doesn’t', exp: 'Com he, she e it a negativa é doesn’t.', cat: 'Terceira pessoa' },
    { re: /\bin\s+the\s+weekend\b/i, fix: () => 'on the weekend', exp: 'No inglês americano é on the weekend.', cat: 'Preposição' },
    { re: /\bi\s+like\s+(?:very much|so much)\s+(\w+)/i, fix: (m) => 'I really like ' + m[1], exp: 'Very much não vai no meio. Diga I really like anime.', cat: 'Ordem da frase' },
    { re: /\b(yesterday|last\s+(?:week|night|year|month|weekend|friday|saturday|sunday))\b[^.?!]*?\b(i|we|they|he|she)\s+(go|eat|see|have|do|make|take|buy|watch|play|visit)\b/i, fix: (m) => m[2] + ' ' + PAST[m[3].toLowerCase()], exp: 'Com yesterday e last week o verbo vai para o passado: I went, I watched.', cat: 'Passado' },
    { re: /\bi\s+want\s+that\s+you\b/i, fix: () => 'I want you to', exp: 'Em inglês: I want you to…, sem that.', cat: 'Estrutura' },
    { re: /\bsince\s+(\d+|two|three|four|five|ten)\s+(years|months|days|weeks)\b/i, fix: (m) => 'for ' + m[1] + ' ' + m[2], exp: 'Duração é com for: for 3 years. Since marca o começo: since 2020.', cat: 'For × since' }
  ];
  const PT = /\b(não|nao|você|voce|eu|que|muito|também|tambem|porque|obrigad[oa]|legal|mas|com|para|gosto|sim)\b/i;
  const PRAISE = ['Frase clara e completa.', 'Isso. Soou natural.', 'Boa: sujeito, verbo e complemento no lugar.', 'Entendi de primeira. É esse o objetivo.', 'Certinho. Pode seguir nesse ritmo.'];
  function analyze(text) {
    const t = String(text || '').trim(), words = t.split(/\s+/).filter(Boolean);
    for (const r of RULES) { const m = t.match(r.re); if (m) { const corrected = (t.slice(0, m.index) + r.fix(m) + t.slice(m.index + m[0].length)).replace(/^\w/, (c) => c.toUpperCase()); return { status: 'ajuste', original: t, corrected, explain_pt: r.exp, cat: r.cat }; } }
    if (PT.test(t)) return { status: 'natural', original: t, corrected: '', explain_pt: 'Tudo bem misturar. Quando faltar a palavra, pergunte: How do you say “…” in English?', cat: 'Português no meio' };
    if (words.length <= 2) return { status: 'natural', original: t, corrected: '', explain_pt: 'Resposta curta funciona. Para treinar, tente uma frase inteira, começando com I…', cat: 'Resposta curta' };
    return { status: 'certo', original: t, corrected: '', explain_pt: pick(PRAISE), cat: '' };
  }
  function pronWatch(text) {
    const out = [], seen = new Set();
    for (const w of (String(text).toLowerCase().match(/[a-z’']+/g) || [])) {
      if (seen.has(w) || out.length >= 2) continue; let tip = '';
      if (/^h/.test(w) && !/^(hour|honest|honor)/.test(w)) tip = 'O h de ' + w + ' é só ar. Nada de R de “rato”.';
      else if (/^s[ptkcmnlw]/.test(w)) tip = 'Comece pelo S: sss-' + w.slice(1) + '. Sem “i” antes.';
      else if (/^th/.test(w)) tip = 'Th: língua entre os dentes e sopro.';
      else if (/[bdgkp]$/.test(w) && w.length >= 3) tip = 'Termine ' + w + ' seco, sem “' + w + 'i” no fim.';
      if (tip) { out.push({ word: w, tip_pt: tip }); seen.add(w); }
    }
    return out;
  }
  function recast(c) { if (!c || c.split(' ').length > 8) return ''; let r = ' ' + c.replace(/[.!?]+$/, '') + ' '; r = r.replace(/ I’m /gi, ' you’re ').replace(/ I am /gi, ' you are ').replace(/ I /g, ' you ').replace(/ my /gi, ' your ').replace(/ me /gi, ' you '); return 'Oh, ' + r.trim() + '. '; }
  function hintFor(line) {
    const l = String(line || '');
    if (/how old/i.test(l)) return ['I’m … years old.', 'Eu tenho … anos.'];
    if (/where are you from/i.test(l)) return ['I’m from São Paulo, in Brazil.', 'Eu sou de São Paulo, no Brasil.'];
    if (/where are you flying|where.*going/i.test(l)) return ['I’m flying to New York.', 'Vou para Nova York.'];
    if (/passport|can i see/i.test(l)) return ['Sure. Here you go.', 'Claro. Aqui está.'];
    if (/bags|luggage/i.test(l)) return ['Yes, one bag, please.', 'Sim, uma mala, por favor.'];
    if (/window or/i.test(l)) return ['Window, please.', 'Janela, por favor.'];
    if (/about yourself/i.test(l)) return ['I’m Ana. I’m a designer and I love music.', 'Sou a Ana. Sou designer e amo música.'];
    if (/favorite/i.test(l)) return ['My favorite is …', 'O meu favorito é …'];
    if (/why/i.test(l)) return ['Because it’s fun and I learn a lot.', 'Porque é divertido e eu aprendo muito.'];
    if (/how long/i.test(l)) return ['For six months.', 'Por seis meses.'];
    if (/how was|how’s your day|how is your day/i.test(l)) return ['It was good, thanks. And you?', 'Foi bom, obrigado. E você?'];
    if (/would you like/i.test(l)) return ['Yes, please.', 'Sim, por favor.'];
    if (/\bdo you\b|^are you|^is it|^was it/i.test(l)) return ['Yes, I do. I really like it.', 'Sim. Eu gosto muito.'];
    if (/what.*(watching|listening|playing)/i.test(l)) return ['I’m watching Woods & Beans.', 'Estou vendo Woods & Beans.'];
    if (/what do you do\b/i.test(l)) return ['I’m a student. I study design.', 'Sou estudante. Estudo design.'];
    if (/questions? for me/i.test(l)) return ['Yes. What’s a normal day like here?', 'Sim. Como é um dia normal aqui?'];
    return ['I think …', 'Eu acho que …'];
  }
  function script(sess) {
    const M = TIE.data.MAGGIE;
    if (sess.mode === 'missao') return M.MISSIONS[sess.mission || 'gente'].turns;
    if (sess.mode === 'extra') { const x = TIE.data.EXTRAS.find((e) => e.id === sess.extraId) || TIE.data.EXTRAS[0]; return M.MISSIONS.series.turns.map((t, i) => i === 0 ? { en: 'So, did you watch ' + x.title + '? What happened in the episode?', pt: 'E aí, você viu ' + x.title + '? O que aconteceu no episódio?', words: t.words } : t); }
    const f = (sess.ctxFormats || [])[0]; return [M.OPENERS[f] || M.OPENERS._].concat(M.FOLLOW);
  }
  // Roteiros do modo demo: {N} = nome do aluno, {A} = nome do assistente, {oA} = "a Maggie" / "o Robert".
  const lines = (t, sess) => sub(t, sess.name).split('{A}').join(sess.aName || 'Maggie').split('{oA}').join(sess.aThe || 'a Maggie');
  ai.opener = (sess) => { const s = script(sess)[0]; return { reply_en: lines(s.en, sess), reply_pt: lines(s.pt, sess), mood: 'happy', words: s.words || [] }; };
  function demoReply(sess, text) {
    const turns = script(sess), next = turns[Math.min(sess.turn + 1, turns.length - 1)], fb = analyze(text);
    const pre = fb.status === 'ajuste' ? recast(fb.corrected) : fb.status === 'certo' ? pick(['Nice. ', 'Cool. ', 'Oh, I see. ', 'Great. ', '']) : '';
    const hint = hintFor(next.en);
    return { reply_en: lines(pre + next.en, sess), reply_pt: lines(next.pt, sess), feedback: fb, pron_watch: pronWatch(text), new_words: (next.words || []).map(([en, pt]) => ({ en, pt })), mood: fb.status === 'ajuste' ? 'correcting' : pick(['happy', 'curious']), end: !!next.end || sess.turn + 1 >= turns.length - 1, hint_en: hint[0], hint_pt: hint[1], source: 'demo' };
  }
  ai.hint = (line) => { const h = hintFor(line); return { en: h[0], pt: h[1] }; };
  ai.tutor = async function (sess, text) {
    if (ai.online) { try { const j = await post('/api/tutor', { mode: sess.mode, mission: sess.mission, extraId: sess.extraId, ctx: sess.ctx, persona: sess.persona, assistantName: sess.aName, history: sess.turns.slice(-12).map((t) => ({ who: t.who, en: t.en })), text, turn: sess.turn, script: script(sess).map((t) => t.en) }, 25000); if (j && j.reply_en) { const fb = j.feedback || { status: 'certo' }; if (!fb.original) fb.original = text; return Object.assign({ pron_watch: [], new_words: [], mood: 'happy', end: false }, j, { feedback: fb, source: 'ia' }); } } catch (e) { console.warn('[TIE] /api/tutor falhou, usando o modo demo:', e.message); } }
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 500)); return demoReply(sess, text);
  };
  ai.report = async function (sess) {
    const mine = sess.turns.filter((t) => t.who === 'me');
    if (ai.online && mine.length) { try { const j = await post('/api/report', { ctx: sess.ctx, assistantName: sess.aName, mode: sess.mode, mission: sess.mission, turns: sess.turns.map((t) => ({ who: t.who, en: t.en, feedback: t.fb ? { status: t.fb.status, corrected: t.fb.corrected } : null })) }, 30000); if (j && j.summary_pt) return Object.assign(j, { source: 'ia' }); } catch (e) { console.warn('[TIE] /api/report falhou:', e.message); } }
    const fixes = mine.filter((t) => t.fb && t.fb.status === 'ajuste').map((t) => ({ said: t.fb.original, better: t.fb.corrected, why_pt: t.fb.explain_pt, cat: t.fb.cat }));
    const good = mine.filter((t) => t.fb && t.fb.status === 'certo'); const pron = []; mine.forEach((t) => (t.pron || []).forEach((p) => { if (!pron.find((x) => x.word === p.word)) pron.push(p); }));
    const words = []; sess.turns.forEach((t) => (t.words || []).forEach((w) => { if (!words.find((x) => x.en === w.en)) words.push(w); }));
    const cats = {}; fixes.forEach((f) => { cats[f.cat] = (cats[f.cat] || 0) + 1; }); const top = Object.keys(cats).sort((a, b) => cats[b] - cats[a])[0];
    const strengths = []; if (good.length) strengths.push(good.length + (good.length > 1 ? ' falas saíram certas de primeira.' : ' fala saiu certa de primeira.'));
    if (mine.some((t) => t.en.split(' ').length >= 6)) strengths.push('Você arriscou frases longas, e isso é o que mais faz a fala destravar.');
    if (mine.some((t) => /\?$/.test(t.en.trim()) || /\b(and you|you\?)\b/i.test(t.en))) strengths.push('Você devolveu perguntas. Conversa em inglês é assim: sempre devolva a bola.');
    if (!strengths.length) strengths.push('Você ficou até o fim da conversa. Voltar amanhã vale mais do que acertar tudo hoje.');
    return { summary_pt: mine.length ? 'Você falou ' + mine.length + (mine.length > 1 ? ' vezes' : ' vez') + ' com ' + (sess.aThe || 'a Maggie') + (fixes.length ? ' e ' + fixes.length + (fixes.length > 1 ? ' falas pediram ajuste.' : ' fala pediu ajuste.') : ' sem nenhum ajuste.') : 'A conversa terminou antes de você falar. Tudo bem: tente de novo com a Dica ligada.', strengths, fixes, pron: pron.slice(0, 4), words: words.slice(0, 8), next_goal_pt: top ? 'Próxima meta: ' + top.toLowerCase() + '. ' + (sess.aThe || 'a Maggie').replace(/^./, (c) => c.toUpperCase()) + ' vai puxar esse ponto na próxima conversa.' : 'Próxima meta: frases mais longas. Tente juntar duas ideias com and ou because.', source: 'demo' };
  };
  ai.pronounce = async function (b64, target, heard) {
    if (ai.online && b64) { try { const j = await post('/api/pronounce', { audio: b64, target }, 30000); if (j && typeof j.score === 'number') return Object.assign(j, { source: 'ia' }); } catch (e) { console.warn('[TIE] /api/pronounce falhou:', e.message); } }
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z' ]/g, '').split(/\s+/).filter(Boolean), T = norm(target), H = norm(heard);
    const hit = T.filter((w) => H.includes(w)).length, score = heard ? Math.max(4, Math.round(hit / Math.max(1, T.length) * 10)) : 7, miss = T.filter((w) => !H.includes(w));
    const issues = (miss.length ? miss : T).slice(0, 2).map((w) => { const p = pronWatch(w)[0]; return { word: w, issue_pt: miss.includes(w) ? 'Não deu para entender esta palavra.' : 'Ponto de atenção para quem fala português.', tip_pt: p ? p.tip_pt : 'Fale mais devagar e marque a sílaba forte.' }; });
    return { score, heard: heard || '', issues: score >= 9 ? [] : issues, praise_pt: score >= 9 ? 'Entendi tudo de primeira.' : score >= 7 ? 'Quase lá. Ajuste os pontos abaixo.' : 'Tente de novo, mais devagar.', source: 'demo' };
  };
  ai.tts = async function (text, gender, voice) { const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, gender, voice }) }); if (!r.ok) return null; return await r.arrayBuffer(); };
  ai.analyze = analyze; ai.pronWatch = pronWatch; TIE.ai = ai;
})();
