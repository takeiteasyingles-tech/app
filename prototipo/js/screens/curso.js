// Trilha (mapa do curso), E-book 1, extras do e-book, teste e tela de episódio concluído.
(function () {
  const { esc, pad2, sub } = TIE.u, C = TIE.C, I = TIE.icon, D = () => TIE.data;
  const SEASONS = ['Arrival', 'Settling In', 'Behind the Counter', 'First Customers', 'The Deal', 'Under Pressure', 'Going Big', 'Full Circle'];
  TIE.blocks = (list, badLabel) => (list || []).map((b) => '<div class="card stack" style="--gap:12px"><div class="lbl or">' + esc(b.k || '') + '</div>' + (b.title ? '<div class="h2">' + esc(b.title) + '</div>' : '') + (b.body ? '<p class="p-read">' + esc(b.body) + '</p>' : '') + (b.body2 ? '<p class="p-read">' + esc(b.body2) + '</p>' : '') +
    (b.rows && b.rows.length ? '<div class="stack" style="--gap:8px">' + b.rows.map((r) => '<div class="stack" style="--gap:4px;padding:12px 14px;border-radius:14px;background:var(--cream)">' + (r.q ? '<div class="sm" style="font-weight:700">' + esc(r.q) + '</div>' : '') + '<div class="en" style="font-size:1.06rem">' + esc(r.en) + '</div>' + (r.pt ? '<div class="pt">' + esc(r.pt) + '</div>' : '') + (r.bad ? '<div class="row base mt4" style="--gap:8px"><span class="lbl bl" style="flex:none">' + esc(b.badLabel || badLabel || 'NÃO É') + '</span><span class="strike" style="font-weight:700">' + esc(r.bad) + '</span></div>' : '') + (r.note ? '<div class="sm mt4">' + esc(r.note) + '</div>' : '') + '</div>').join('') + '</div>' : '') +
    (b.bullets && b.bullets.length ? '<div class="stack" style="--gap:10px">' + b.bullets.map((x) => '<div class="row top" style="--gap:10px"><span style="width:8px;height:8px;border-radius:50%;background:var(--orange);flex:none;margin-top:9px"></span><span class="p-read">' + esc(x) + '</span></div>').join('') + '</div>' : '') +
    (b.callout ? '<div class="card navy" style="padding:14px 16px"><div class="h3" style="color:#fff">' + esc(b.callout) + '</div></div>' : '') + '</div>').join('');

  TIE.screens.trilha = {
    title: 'Trilha',
    render() {
      const s = TIE.store.s, P = TIE.personalize.build(s.profile), cur = TIE.guide.current(), desk = TIE.app.isDesktop();
      const doneN = Object.keys(s.epsDone).length, eb1 = s.epsDone[1] && s.epsDone[2];
      let nodes = '';
      for (let e = 1; e <= 10; e++) {
        nodes += '<div class="chapter"><div class="lbl">E-book ' + e + (e === 1 ? ' · Nice to Meet You' : e === 2 ? ' · Sunday Lunch' : e === 3 ? ' · Welcome to Beacon' : '') + '</div></div>';
        [e * 2 - 1, e * 2].forEach((n) => {
          // Só abre o que já foi feito e o episódio atual. Episódios sem roteiro no protótipo ficam como "Em produção".
          const done = !!s.epsDone[n], now = n === cur.num && !done, open = done || now;
          const subl = now ? (cur.started ? D().STEPS[cur.step - 1].name + ' · etapa ' + cur.step + ' de 10' : 'Comece por aqui') : done ? 'Concluído' : n < cur.num ? 'Em produção' : 'A seguir';
          nodes += '<' + (open ? 'a href="#/episodio/' + n + (done ? '/1' : '') + '"' : 'div') + ' class="node ' + (done ? 'done' : now ? 'now' : 'locked') + '"><span class="dot">' + (done ? I('check', 12) : now ? I('play', 10) : '') + '</span><div class="body"><span class="ep">' + pad2(n) + '</span><span class="grow"><span class="h3" style="display:block">' + esc(D().TITLES[n - 1]) + '</span><span class="sm">' + subl + '</span>' + (now ? '<span class="mt8" style="display:block">' + C.segs(cur.step, cur.step) + '</span>' : '') + '</span>' + (now ? '<span class="pill or">Agora</span>' : done ? '<span class="pill gold">+40</span>' : I('lock', 18, 'style="color:var(--muted)"')) + '</div></' + (open ? 'a' : 'div') + '>';
        });
        const x = e === 1 && eb1 ? '<a href="#/ebook/1" class="node aside done"><span class="dot">' + I('check', 12) + '</span><div class="body"><span class="ep">' + I('star', 18) + '</span><span class="grow"><span class="h3" style="display:block;font-size:1rem">Extras e teste do e-book 1</span><span class="sm">Take Five · Take the Lead · Take it for Real · teste' + (s.testDone ? ' · ' + s.testScore + '/20' : '') + '</span></span>' + I('next', 18) + '</div></a>' : '<div class="node aside locked"><span class="dot"></span><div class="body"><span class="ep">' + I('star', 18) + '</span><span class="grow"><span class="h3" style="display:block;font-size:1rem">Extras e teste do e-book ' + e + '</span><span class="sm">' + (e === 10 ? 'Mais o Season Check' : 'Liberam com os dois episódios') + '</span></span></div></div>';
        nodes += x;
      }
      return { tabs: true, html: (desk ? '' : C.topbar({ kicker: 'Temporada 1 · ' + P.level.cefr, title: 'Arrival', right: C.avatarBtn() })) + '<div class="scroll"><div class="wrap stack" style="--wrap:760px;--gap:14px">' + (desk ? '<div><div class="lbl">Temporada 1 · A1 · 20 episódios</div><h1 class="h1 mt4">Arrival</h1></div>' : '') +
        '<div class="card stack" style="--gap:10px"><div class="row" style="--gap:10px"><div class="bar grow"><i style="width:' + Math.round(doneN / 20 * 100) + '%"></i></div><span class="sm" style="font-weight:800;color:var(--navy);white-space:nowrap">' + doneN + ' de 20</span></div><p class="p">A família, a viagem de Robert ao Brasil, a chegada de Lucas e a abertura da loja.</p><details><summary class="sm" style="font-weight:800;color:var(--blue);cursor:pointer">Ver as 8 temporadas</summary><div class="chips mt8">' + SEASONS.map((nm, i) => '<span class="pill' + (i === 0 ? ' navy' : '') + '"><b>' + (i + 1) + '</b>&nbsp;' + nm + '</span>').join('') + '</div></details></div>' +
        '<div class="trail">' + nodes + '</div></div></div>' };
    }
  };

  const EXTRAS_EB = [{ name: 'Take Five', pt: 'dê uma pausa', desc: 'Páginas culturais: How are you?, aperto de mão, primeiro nome, small talk.', meta: '5 páginas', go: 'ebook/1/five' }, { name: 'Take the Lead', pt: 'assuma o comando', desc: 'Conversa com a Margaret na porta da casa dos Woods. Quem conduz é você.', meta: '~4 min', go: 'ebook/1/lead' }, { name: 'Take it for Real', pt: 'leve para a vida real', desc: 'O que os livros ensinam, e o que as pessoas realmente dizem.', meta: '8 dicas', go: 'ebook/1/real' }, { name: 'Take It Out', pt: 'saia por aí', desc: 'A história em quadrinhos deste e-book está em produção.', meta: 'Em produção', go: '' }];
  TIE.screens.ebook = {
    title: 'E-book 1',
    render() {
      const s = TIE.store.s, desk = TIE.app.isDesktop();
      return { tabs: true, nav: 'trilha', html: C.topbar({ back: 'trilha', kicker: 'Temporada 1 · E-book 01', title: 'Nice to Meet You' }) + '<div class="scroll"><div class="wrap stack" style="--wrap:900px;--gap:16px">' +
        '<div class="card stack" style="--gap:10px"><div class="row between"><span class="lbl">Lições 1 e 2 · A1</span><span class="pill">E-book 01</span></div><p class="p-read">' + esc(D().EB1_SCOPE) + '</p></div>' +
        '<div class="stack" style="--gap:8px"><div class="lbl">Os episódios</div>' + [1, 2].map((n) => '<a class="card row" href="#/episodio/' + n + '/1" style="--gap:12px;padding:14px 16px"><span class="num" style="font-size:1.4rem;color:var(--green);width:38px">' + pad2(n) + '</span><span class="grow"><span class="h3" style="display:block">' + D().TITLES[n - 1] + '</span><span class="sm">' + (s.epsDone[n] ? 'Concluído · abrir de novo' : 'A fazer') + '</span></span>' + I('next', 20) + '</a>').join('') + '</div>' +
        '<div class="stack" style="--gap:8px"><div class="lbl">Take some extras · opcionais</div><div style="display:grid;grid-template-columns:' + (desk ? '1fr 1fr' : '1fr') + ';gap:10px">' + EXTRAS_EB.map((x) => '<' + (x.go ? 'a href="#/' + x.go + '" class="card stack"' : 'div class="card dash stack"') + ' style="--gap:6px"><div class="row between base"><span class="h3">' + x.name + '</span><span class="xs" style="font-weight:800;color:' + (x.go ? 'var(--blue)' : 'var(--muted)') + '">' + x.meta + '</span></div><div class="sm" style="font-weight:700">' + x.pt + '</div><div class="p">' + x.desc + '</div></' + (x.go ? 'a' : 'div') + '>').join('') + '</div></div>' +
        '<div class="card navy stack" style="--gap:12px"><div class="lbl" style="color:var(--onNavy)">Take a test</div><div class="h2" style="color:#fff">Take the episode test</div><p class="p">20 questões sobre as Lições 1 e 2. Nota de corte: 70%, ou 14 acertos. Recomenda, não bloqueia.</p>' + (s.testScore != null ? '<div class="h3" style="color:#fff">Última tentativa: ' + s.testScore + '/20</div>' : '') + C.btn(s.testScore != null ? 'Refazer o teste' : 'Fazer o teste · +50 pontos', { go: 'ebook/1/teste' }) + '</div>' +
        '<div class="card dash stack" style="--gap:6px"><div class="lbl or">Na próxima</div><div class="h3">O almoço de domingo está na mesa, e o Robert ainda não contou a novidade.</div><p class="p">E-book 2 · Lições 3 e 4 · Sunday Lunch.</p></div></div></div>' };
    }
  };

  TIE.ui.lead = null;
  const leadReset = () => { const L = D().LEAD; TIE.ui.lead = { msgs: [{ who: 'her', en: L[0].m.en, pt: L[0].m.pt }], turn: 0, fix: [], typing: false, done: false }; };
  const bubble = (m) => '<div class="bub ' + (m.who === 'me' ? 'me' : 'her') + '" style="' + (m.who === 'me' ? '' : 'border:1.5px solid var(--line)') + '">' + (m.who === 'her' ? '<div class="xs" style="font-weight:800;margin-bottom:3px">Margaret</div>' : '') + '<div class="en">' + esc(m.en) + '</div><div class="pt" style="' + (m.who === 'me' ? 'color:#E7ECF7' : '') + '">' + esc(m.pt) + '</div></div>';
  TIE.screens.ebookx = {
    render(p) {
      const s = TIE.store.s, part = p.part, name = s.profile.name;
      const head = (kick, title, ptl) => C.topbar({ back: 'ebook/1', kicker: 'E-book 01 · ' + kick, title }) + '<div class="scroll"><div class="wrap stack" style="--wrap:760px;--gap:14px">' + (ptl ? '<p class="p-read">' + ptl + '</p>' : '');
      const end = '</div></div>'; let html = '';
      if (part === 'five') html = head('Extra', 'Take Five', 'Páginas culturais bilíngues. Opcional, mas é aqui que mora o inglês que o livro não ensina.') + TIE.blocks(D().FIVE, 'EVITE') + end;
      if (part === 'real') html = head('Extra', 'Take it for Real', 'O que os livros ensinam, e o que as pessoas realmente dizem.') + D().REAL.map((r) => '<div class="card cmp"><span class="k" style="color:var(--muted)">LIVRO</span><span class="p">' + esc(r.book) + '</span><span class="k" style="color:var(--orange)">RUA</span><span class="en" style="font-size:1.08rem">' + esc(r.street) + '</span><span></span><span class="sm">' + esc(r.why) + '</span></div>').join('') + '<div class="card navy stack" style="--gap:6px"><div class="lbl" style="color:var(--onNavy)">Uma observação sobre sotaque</div><p class="p">Nada aqui é sobre perder o seu sotaque. O objetivo é você ser entendido de primeira e entender o que ouve.</p></div>' + end;
      if (part === 'lead') {
        if (!TIE.ui.lead) leadReset(); const L = TIE.ui.lead, LEAD = D().LEAD;
        const opts = L.done || L.typing ? '' : '<div class="stack" style="--gap:8px"><div class="lbl">Responda em voz alta ou toque</div>' + LEAD[L.turn].opts.map((o, i) => '<button class="card" data-act="leadSend" data-arg="' + i + '" style="padding:12px 14px;border:2px solid var(--navy)"><div class="en">' + esc(sub(o.en, name)) + '</div><div class="sm">' + esc(sub(o.pt, name)) + '</div></button>').join('') + '<div class="lbl mt8">Frases de socorro</div><div class="chips">' + D().MAGGIE.HELP.map((h) => '<button class="chip" data-act="leadHelp" data-arg="' + esc(h.en) + '"><b>' + esc(h.en) + '</b>&nbsp;<span class="xs">' + esc(h.pt) + '</span></button>').join('') + '</div></div>';
        const fb = L.done ? '<div class="card hi stack pop" style="--gap:12px"><div class="lbl or">Devolutiva</div><div class="h2">Missão cumprida.</div>' + (L.fix.length ? L.fix.slice(0, 3).map((t) => '<div class="fb fix">' + esc(t) + '</div>').join('') : '<div class="fb ok">Nenhum ajuste desta vez. Você cumprimentou, disse o seu nome, respondeu e se despediu.</div>') + '<div class="row wrapx" style="--gap:8px">' + C.btn('Conversar de novo', { kind: 'ghost compact', act: 'leadReset' }) + C.btn('Fazer ao vivo com ' + TIE.assist.the(), { kind: 'compact', go: 'maggie?modo=missao&m=gente', icon: 'mic' }) + '</div></div>' : '';
        html = head('Extra', 'Take the Lead', '') + '<div class="card navy stack" style="--gap:8px"><div class="lbl" style="color:var(--onNavy)">A cena</div><p class="p">Você toca a campainha da casa dos Woods, em Beacon. Margaret Woods abre a porta. Ela não conhece você.</p><p class="sm">Sua missão: cumprimentar, dizer o seu nome, responder quando ela perguntar como você está, e se despedir.</p></div><div class="stack" style="--gap:10px">' + L.msgs.map(bubble).join('') + (L.typing ? '<div class="thinking" style="border:1.5px solid var(--line)"><i></i><i></i><i></i></div>' : '') + '</div>' + opts + fb + end;
      }
      if (part === 'teste') html = testHtml(head, end);
      return { tabs: false, html };
    },
    leave() { TIE.ui.lead = null; }
  };
  TIE.act.leadReset = () => { leadReset(); TIE.app.render(); };
  TIE.act.leadSend = (i) => { const L = TIE.ui.lead, LEAD = D().LEAD, name = TIE.store.s.profile.name, o = LEAD[L.turn].opts[+i]; L.msgs.push({ who: 'me', en: sub(o.en, name), pt: sub(o.pt, name) }); if (o.fix) { L.fix.push(sub(o.fix, name)); TIE.sound.sfx.soft(); } else { TIE.game.award('maggie_turn'); } if (L.turn >= LEAD.length - 1) { L.done = true; return TIE.app.render(); } L.typing = true; TIE.app.render(); setTimeout(() => { if (TIE.ui.lead !== L) return; L.turn++; L.typing = false; L.msgs.push({ who: 'her', en: LEAD[L.turn].m.en, pt: LEAD[L.turn].m.pt }); TIE.app.render(); TIE.speech.say(LEAD[L.turn].m.en, { who: 'Margaret' }); }, 900); };
  TIE.act.leadHelp = (en) => { const L = TIE.ui.lead, cur = D().LEAD[L.turn].m, h = D().MAGGIE.HELP.find((x) => x.en === en); L.msgs.push({ who: 'me', en: h.en, pt: h.pt }); L.typing = true; TIE.app.render(); setTimeout(() => { L.typing = false; L.msgs.push({ who: 'her', en: cur.en, pt: '(de novo, mais devagar) ' + cur.pt }); TIE.app.render(); TIE.speech.say(cur.en, { rate: .75 }); }, 800); };

  function testHtml(head, end) {
    const s = TIE.store.s, T = D().TEST, ALL = D().TEST_ALL, ans = s.testAns;
    const isRight = (q) => { const v = ans[q.n]; return q.opts ? v === q.a : q.acc.includes(D().norm(v)); };
    if (s.testDone) {
      const passed = s.testScore >= 14, wrong = ALL.filter((q) => !isRight(q));
      return head('Take a test', 'Take the episode test', '') + '<div class="card navy stack" style="--gap:10px"><div class="lbl" style="color:var(--onNavy)">Resultado</div><div class="row base" style="--gap:8px"><span class="num" style="font-size:3.6rem">' + s.testScore + '</span><span class="h2" style="color:#fff">/20 · ' + Math.round(s.testScore / 20 * 100) + '%</span></div><div class="h2" style="color:#fff">' + (passed ? 'Acima da nota de corte.' : 'Abaixo de 70%.') + '</div><p class="p">' + (passed ? 'O e-book 1 está fechado. Revise os pontos abaixo antes do E-book 2.' : 'A recomendação é repetir as Lições 1 e 2 antes de seguir. Recomenda, não bloqueia.') + '</p></div>' +
        (wrong.length ? '<div class="lbl">O que revisar</div>' + wrong.map((q) => { const v = ans[q.n]; return '<div class="card stack" style="--gap:8px"><div class="row base" style="--gap:10px"><span class="num" style="color:var(--orange);width:24px">' + q.n + '</span><span class="h3">' + esc(q.q) + '</span></div><div class="fb err cmp"><span class="k" style="color:var(--red)">VOCÊ</span><span>' + esc(q.opts ? (v != null ? q.opts[v] : 'Sem resposta') : ((v && String(v).trim()) || 'Sem resposta')) + '</span></div><div class="fb ok cmp"><span class="k" style="color:var(--green)">CERTO</span><b>' + esc(q.opts ? q.opts[q.a] : q.show) + '</b></div><a class="btn link" href="#/episodio/' + q.ep + '/' + (q.step || 7) + '" style="justify-content:flex-start">Revisar: ' + esc(q.rev) + '</a></div>'; }).join('') : '') +
        '<div class="row wrapx" style="--gap:8px">' + C.btn('Refazer o teste', { kind: 'ghost', act: 'testRedo' }) + C.btn('Voltar à trilha', { go: 'trilha' }) + '</div>' + end;
    }
    const answered = ALL.filter((q) => { const v = ans[q.n]; return q.opts ? v != null : !!(v && String(v).trim()); }).length;
    return head('Take a test', 'Take the episode test', '20 questões sobre as Lições 1 e 2. Nota de corte: 70%, ou 14 acertos. Recomenda, não bloqueia.') + '<div class="row" style="--gap:10px;position:sticky;top:0;z-index:3;background:var(--cream);padding:8px 0"><div class="bar grow"><i style="width:' + Math.round(answered / 20 * 100) + '%"></i></div><span class="sm" style="font-weight:800;color:var(--navy)">' + answered + ' de 20</span></div>' +
      T.map((tp) => '<div class="lbl or mt8">' + esc(tp.title) + '</div>' + tp.qs.map((q) => '<div class="card stack" style="--gap:10px"><div class="row base" style="--gap:10px"><span class="num" style="color:var(--orange);width:24px">' + q.n + '</span><span class="h3">' + esc(q.q) + '</span></div>' + (q.audio ? C.btn('Ouvir o áudio', { kind: 'navy compact', act: 'say', arg: q.audio, icon: 'play' }) : '') + (q.opts ? '<div class="row wrapx" style="--gap:8px">' + q.opts.map((o, i) => '<button class="pillopt' + (ans[q.n] === i ? ' pick' : '') + '" data-act="testPick" data-arg="' + q.n + ':' + i + '">' + esc(o) + '</button>').join('') + '</div>' : '<input class="input" id="tq' + q.n + '" placeholder="Escreva em inglês" value="' + esc(ans[q.n] || '') + '" data-model="testAns.' + q.n + '">') + '</div>').join('')).join('') + C.btn('Entregar o teste', { act: 'testSubmit', cls: 'block' }) + end;
  }
  TIE.act.say = (t) => TIE.speech.say(t);
  // Igual ao say, e marca o botão como já ouvido (a marca vale até recarregar a página).
  TIE.ui.heard = new Set();
  TIE.act.sayMark = (t, el) => { TIE.speech.say(t); TIE.ui.heard.add(t); if (el) el.classList.add('heard'); };
  TIE.act.testPick = (arg) => { const [n, i] = arg.split(':').map(Number); TIE.store.set((s) => ({ testAns: Object.assign({}, s.testAns, { [n]: i }) })); };
  TIE.act.testSubmit = () => { const s = TIE.store.s, ans = s.testAns; const score = D().TEST_ALL.filter((q) => { const v = ans[q.n]; return q.opts ? v === q.a : q.acc.includes(D().norm(v)); }).length; TIE.store.set({ testDone: true, testScore: score }); if (score >= 14) TIE.game.award('test_pass'); else TIE.sound.sfx.soft(); const sc = document.querySelector('.scroll'); if (sc) sc.scrollTop = 0; };
  TIE.act.testRedo = () => TIE.store.set({ testAns: {}, testDone: false });

  TIE.screens.concluido = {
    title: 'Episódio concluído',
    render(p) {
      const s = TIE.store.s, E = D().EPS[+p.ep] || D().EPS[5], dn = E.done, name = s.profile.name, sc = E.mic.map((_, i) => s.scores[E.num + '-' + i]).filter((v) => v != null), avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1).replace('.', ',') : '—';
      const go = dn.go === 'ep2' ? 'episodio/2/1' : dn.go === 'ebook1' ? 'ebook/1' : 'inicio';
      return { html: '<div class="scroll"><div class="wrap stack" style="--wrap:640px;--gap:16px;padding-top:20px"><div class="now-card stack pop" style="--gap:12px"><span class="kick">' + I('check', 12) + ' Episódio ' + pad2(E.num) + ' concluído</span><div class="h1" style="color:#fff">' + esc(dn.title) + '</div><div class="h2" style="color:#fff">' + esc(sub(dn.line, name)) + '</div><span class="pill gold" style="align-self:flex-start">+40 pontos</span></div><div class="grid2"><div class="stat"><div class="num">' + avg + '</div><div class="sm mt8">nota média no Take the Mic</div></div><div class="stat"><div class="num">' + TIE.review.cardsOf(E).length + '</div><div class="sm mt8">cartões na sua Revisão</div></div></div><div class="card stack" style="--gap:12px"><div class="lbl">A seguir</div><div class="row" style="--gap:14px"><span class="num" style="font-size:2rem;color:var(--orange)">' + esc(dn.nextNum) + '</span><div><div class="h3">' + esc(dn.nextTitle) + '</div><div class="sm">' + esc(dn.nextSub) + '</div></div></div><p class="p" style="border-top:1.5px solid var(--line);padding-top:10px">' + esc(dn.nextNote) + '</p></div>' + C.btn(dn.cta, { go, cls: 'block' }) + C.btn('Voltar para Hoje', { kind: 'ghost', go: 'inicio', cls: 'block' }) + '</div></div>' };
    }
  };
})();
