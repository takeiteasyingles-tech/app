// Cadastro em 7 etapas. O que a pessoa responde vira o perfil que personaliza o app.
(function () {
  const { esc } = TIE.u, C = TIE.C, I = TIE.icon;
  const O = () => TIE.data.ONB, d = () => TIE.store.s.draft;
  TIE.ui.onb = TIE.ui.onb || { err: {}, show: false, voice: 'idle' };
  const N = () => O().STEPS.length, key = (n) => O().STEPS[n - 1].k;
  const chips = (list, sel, act, single) => '<div class="chips">' + list.map((x) => { const k = Array.isArray(x) ? x[0] : x.k, l = Array.isArray(x) ? x[1] : x.t; return C.chip(l, { on: single ? sel === k : sel.includes(k), act, arg: k }); }).join('') + '</div>';
  const block = (title, inner, sub) => '<div class="stack mt24" style="--gap:8px"><div><div class="lbl">' + title + '</div>' + (sub ? '<div class="xs mt4">' + sub + '</div>' : '') + '</div>' + inner + '</div>';
  const field = (label, input, err) => '<label class="field"><span>' + label + '</span>' + input + '</label>' + (err ? '<span class="field"><span class="err">' + err + '</span></span>' : '');

  // Idade a partir da data de nascimento (AAAA-MM-DD). A faixa (AGES) segue para a Maggie.
  function ageOf(birth) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || ''); if (!m) return null; const t = new Date(); let a = t.getFullYear() - m[1]; if (t.getMonth() + 1 < +m[2] || (t.getMonth() + 1 === +m[2] && t.getDate() < +m[3])) a--; return a; }
  const ageBand = (a) => (a == null ? '' : a < 18 ? '-18' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 60 ? '45-59' : '60+');
  const firstName = (full) => (full || '').trim().split(/\s+/)[0] || '';
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
  function accountErrors() {
    const D = d(), e = {}, a = ageOf(D.birth);
    if (D.fullName.trim().split(/\s+/).length < 2) e.fullName = 'Digite o nome e o sobrenome.';
    if (!D.name.trim() && !e.fullName) D.name = firstName(D.fullName);
    if (D.name.trim().length < 2) e.name = 'Diga como quer ser chamado.';
    if (a == null || a < 5 || a > 110) e.birth = 'Confira a data de nascimento.';
    if (!emailOk(D.email)) e.email = 'Confira o e-mail.';
    if (D.pass.length < 6) e.pass = 'A senha precisa de pelo menos 6 caracteres.';
    return e;
  }

  function valid(n) {
    const D = d(), k = key(n);
    if (k === 'objetivo') return D.goals.length > 0;
    if (k === 'gostos') return D.formats.length > 0;
    if (k === 'trava') return D.diffs.length > 0;
    if (k === 'estilo') return D.styles.length > 0;
    if (k === 'ritmo') return D.days.length > 0;
    return true;
  }
  function profileFromDraft() { const D = d(); return { name: (D.name || firstName(D.fullName) || 'Ana').trim(), fullName: D.fullName.trim(), birth: D.birth, age: ageBand(ageOf(D.birth)), occup: '', area: '', level: 'zero', goals: D.goals.slice(), formats: D.formats.slice(), genres: D.genres.slice(), themes: D.themes.slice(), diffs: D.diffs.slice(), mainDiff: D.mainDiff || D.diffs[0] || '', styles: D.styles.slice(), company: D.company, feedback: D.feedback, days: D.days.slice(), minutes: D.minutes, reminders: TIE.personalize.reminders(D), voice: D.voice }; }
  TIE.profileFromDraft = profileFromDraft;

  const B = {
    conta() { const D = d(), e = TIE.ui.onb.err || {}, U = TIE.ui.onb; return '<div class="stack" style="--gap:14px">' +
      field('Nome completo', '<input class="input" id="onb-fullname" autocomplete="name" placeholder="Seu nome e sobrenome" value="' + esc(D.fullName) + '" data-model="draft.fullName">', e.fullName) +
      field('Como você quer ser chamado', '<input class="input" id="onb-name" autocomplete="nickname" placeholder="Ex.: Ana" value="' + esc(D.name) + '" data-model="draft.name">', e.name) +
      field('Data de nascimento', '<input class="input" id="onb-birth" type="date" autocomplete="bday" min="1910-01-01" max="' + TIE.u.today() + '" value="' + esc(D.birth) + '" data-model="draft.birth">', e.birth) +
      field('E-mail', '<input class="input" id="onb-email" type="email" inputmode="email" autocomplete="email" placeholder="voce@email.com" value="' + esc(D.email) + '" data-model="draft.email">', e.email) +
      field('Senha', '<span class="input-wrap"><input class="input" id="onb-pass" type="' + (U.show ? 'text' : 'password') + '" autocomplete="new-password" placeholder="Mínimo de 6 caracteres" value="' + esc(D.pass) + '" data-model="draft.pass" data-enter="onbNext"><button class="iconbtn" data-act="onbShow" aria-label="Mostrar senha">' + I(U.show ? 'eyeoff' : 'eye', 20) + '</button></span>', e.pass) +
      '<p class="xs">Ao continuar você aceita os Termos de Uso e a Política de Privacidade. O primeiro episódio é grátis para sempre.</p></div>'; },
    objetivo() { const D = d(); return '<div class="sm" style="font-weight:700">' + D.goals.length + ' de 3 escolhidos</div><div class="stack mt12" style="--gap:10px">' + O().GOALS.map((g) => '<button class="optcard' + (D.goals.includes(g.k) ? ' on' : '') + '" data-act="onbGoal" data-arg="' + g.k + '"><span class="ico">' + I(g.icon, 22) + '</span><span class="grow"><span class="h3" style="display:block">' + esc(g.t) + '</span><span class="sm">' + esc(g.s) + '</span></span>' + (D.goals.includes(g.k) ? I('check', 22, 'style="color:var(--orange)"') : '') + '</button>').join('') + '</div>'; },
    gostos() { const D = d(); const fmts = '<div class="fmt-grid">' + O().FORMATS.map((f) => '<button class="fmt' + (D.formats.includes(f.k) ? ' on' : '') + '" data-act="onbFormat" data-arg="' + f.k + '"><img src="' + f.img + '" alt=""><span>' + esc(f.t) + '</span><i class="ck">' + (D.formats.includes(f.k) ? I('check', 16) : '') + '</i></button>').join('') + '</div>'; const genres = D.formats.map((k) => { const f = O().FORMATS.find((x) => x.k === k); return block('Em ' + f.t.toLowerCase() + ', o que você curte?', chips(O().GENRES[k], D.genres, 'onbGenre')); }).join(''); return fmts + genres + block('E fora da tela?', chips(O().THEMES, D.themes, 'onbTheme')); },
    trava() { const D = d(); return '<div class="stack" style="--gap:10px">' + O().DIFFS.map((x) => '<button class="optcard' + (D.diffs.includes(x.k) ? ' on' : '') + '" data-act="onbDiff" data-arg="' + x.k + '" style="min-height:60px"><span class="ico">' + I(x.icon, 22) + '</span><span class="h3 grow">' + esc(x.t) + '</span>' + (D.diffs.includes(x.k) ? I('check', 22, 'style="color:var(--orange)"') : '') + '</button>').join('') + '</div>' + (D.diffs.length > 1 ? '<div class="card or mt16 stack" style="--gap:10px"><div class="lbl or">Qual trava mais?</div>' + chips(D.diffs.map((k) => O().DIFFS.find((x) => x.k === k)), D.mainDiff || D.diffs[0], 'onbMain', true) + '<p class="xs">Vira o foco da semana na tela Hoje.</p></div>' : ''); },
    estilo() { const D = d(); return '<div class="grid3">' + O().STYLES.map(([k, l, ic]) => '<button class="optcard' + (D.styles.includes(k) ? ' on' : '') + '" data-act="onbStyle" data-arg="' + k + '" style="flex-direction:column;text-align:center;gap:8px;padding:14px 8px"><span class="ico">' + I(ic, 22) + '</span><span class="h3" style="font-size:.95rem">' + l + '</span></button>').join('') + '</div>' + block('Você rende mais…', chips(O().COMPANY, D.company, 'onbCompany', true)) + block('Quando você erra, prefere que a Maggie…', chips(O().FEEDBACK, D.feedback, 'onbFeedback', true)); },
    ritmo() {
      const D = d(), R = D.reminders, max = O().REMIND_MAX;
      const rows = R.map((t, i) => '<div class="row" style="--gap:10px">' + I('bell', 22, 'style="color:var(--blue);flex:none"') + '<input class="input grow" id="onb-rem' + i + '" type="time" value="' + esc(t) + '" data-model="draft.reminders.' + i + '" aria-label="Horário do lembrete ' + (i + 1) + '"><button class="iconbtn" data-act="onbRemDel" data-arg="' + i + '" aria-label="Remover lembrete ' + (i + 1) + '">' + I('close', 18) + '</button></div>').join('');
      return block('Dias da semana', '<div class="days">' + O().DAYS.map((l, i) => '<button class="' + (D.days.includes(i) ? 'on' : '') + '" data-act="onbDay" data-arg="' + i + '" aria-label="dia ' + i + '">' + l + '</button>').join('') + '</div>', D.days.length + ' dias por semana · ' + (D.days.length >= 5 ? 'ritmo da série' : D.days.length >= 3 ? 'ritmo tranquilo' : 'ritmo leve')) +
        block('Minutos por dia', chips(O().MINUTES, D.minutes, 'onbMin', true)) +
        block('Lembretes', '<div class="stack" style="--gap:10px">' + (rows || '<div class="sm">Sem lembrete. Dá para adicionar agora ou depois, no seu perfil.</div>') + (R.length < max ? '<button class="btn light compact" data-act="onbRemAdd" style="align-self:flex-start">' + I('plus', 18) + '<span>' + (R.length ? 'Adicionar outro lembrete' : 'Adicionar lembrete') + '</span></button>' : '') + '</div>', 'Escolha o horário. Você pode ter mais de um.');
    },
    voz() { const D = d(), U = TIE.ui.onb, name = D.name || 'Ana', res = D.voice; return '<div class="stack" style="--gap:16px">' + C.stage({ id: 'av-onb', status: U.voice === 'rec' ? 'Ouvindo' : 'Maggie', listening: U.voice === 'rec', caption: '<div class="caption"><span class="en">Hi, ' + esc(name) + '. Can you say this for me?</span><span class="ptl"><span>Oi, ' + esc(name) + '. Você consegue dizer isto para mim?</span></span></div>' }) + '<div class="card stack tc" style="--gap:12px;align-items:center"><div class="lbl">Diga em voz alta</div><div class="h1">Hi, I’m ' + esc(name) + '.</div><div class="fb tip" style="text-align:left;width:100%"><b>Dica de boca:</b> o H de hi é só ar. Nada de R de “rato”.</div><div class="vu" style="width:100%">' + Array.from({ length: 18 }, (_, i) => '<i id="vu' + i + '"></i>').join('') + '</div><div class="row" style="--gap:12px"><button class="btn light compact" data-act="onbHear">' + I('speaker', 18) + '<span>Ouvir a Maggie</span></button><button class="mic' + (U.voice === 'rec' ? ' rec' : '') + '" data-act="onbRecord" aria-label="Gravar">' + I(U.voice === 'rec' ? 'stop' : 'mic', 28) + '</button></div><div class="sm" style="font-weight:700">' + (U.voice === 'rec' ? 'Ouvindo… toque para parar' : U.voice === 'busy' ? 'A Maggie está ouvindo a gravação…' : res ? 'Toque para tentar de novo' : 'Toque no microfone e diga a frase') + '</div>' + (res ? '<div class="stack pop" style="--gap:10px;width:100%;text-align:left"><div class="row center base" style="--gap:4px"><span class="num" style="font-size:2.8rem">' + res.score + '</span><span class="h3 muted">/10</span></div><div class="fb ' + (res.score >= 8 ? 'ok' : 'fix') + '"><b>' + esc(res.praise_pt) + '</b>' + (res.issues || []).map((x) => '<br>' + esc(x.word) + ': ' + esc(x.tip_pt)).join('') + '</div></div>' : '') + '</div><p class="xs">O microfone só liga quando você toca no botão. O áudio serve para a nota e não fica guardado.' + (TIE.ai.online ? '' : ' No modo demo a nota é estimada.') + '</p></div>'; }
  };

  TIE.screens.cadastro = {
    title: 'Cadastro',
    render(params) {
      const n = Math.min(N(), Math.max(1, +params.step || 1)); TIE.store.s.onbStep = n;
      const st = O().STEPS[n - 1], ok = valid(n), last = n === N();
      const next = last ? (d().voice ? C.btn('Começar o curso', { act: 'onbFinish', cls: 'grow', iconR: 'play' }) : C.btn('Pular por enquanto', { kind: 'ghost', act: 'onbFinish', cls: 'grow' }))
        : (st.skip ? C.btn('Pular', { kind: 'ghost', act: 'onbSkip' }) : '') + C.btn('Continuar', { act: 'onbNext', cls: 'grow', iconR: 'next', dis: !ok && n !== 1 });
      return { html: '<div class="scroll"><div class="wiz-head"><div class="row" style="--gap:10px">' + (n > 1 ? '<button class="iconbtn" data-act="onbBack" aria-label="Voltar">' + I('back', 20) + '</button>' : '<button class="iconbtn" data-go="entrar" aria-label="Sair">' + I('close', 20) + '</button>') + '<div class="grow"><div class="lbl">Etapa ' + n + ' de ' + N() + ' · ' + esc(st.t) + '</div><div class="steps mt8">' + O().STEPS.map((_, i) => '<i class="' + (i + 1 < n ? 'done' : i + 1 === n ? 'now' : '') + '"></i>').join('') + '</div></div></div></div>' +
        '<div class="wiz-body"><div class="stack" style="--gap:6px;margin-bottom:18px"><h1 class="h1">' + esc(st.h) + '</h1><p class="p muted">' + esc(st.s) + '</p></div>' + B[st.k]() + '</div><div class="wiz-foot">' + next + '</div></div>' };
    },
    after(root, p) { if (this.av) { this.av.destroy(); this.av = null; } if (key(TIE.store.s.onbStep || 1) === 'voz') this.av = TIE.avatar.mount(document.getElementById('av-onb')); },
    leave() { if (this.av) { this.av.destroy(); this.av = null; } TIE.speech.stop(); }
  };
  const go = (n) => { TIE.store.s.onbStep = n; TIE.store.save(); TIE.router.go('cadastro/' + n); };
  const tg = (arr, k, max) => { const i = arr.indexOf(k); if (i >= 0) arr.splice(i, 1); else if (!max || arr.length < max) arr.push(k); else return false; return true; };
  const re = () => { TIE.store.save(); TIE.app.render(); };
  TIE.act.onbShow = () => { TIE.ui.onb.show = !TIE.ui.onb.show; TIE.app.render(); };
  TIE.act.onbBack = () => go(Math.max(1, (TIE.store.s.onbStep || 1) - 1));
  TIE.act.onbNext = () => {
    const n = TIE.store.s.onbStep || 1, D = d();
    if (key(n) === 'conta') { const e = accountErrors(); TIE.ui.onb.err = e; if (Object.keys(e).length) return re(); if (!TIE.store.s.user) TIE.store.s.user = { name: D.name.trim(), fullName: D.fullName.trim(), email: D.email }; }
    if (!valid(n)) return; if (key(n) === 'trava' && !D.mainDiff) D.mainDiff = D.diffs[0]; go(n + 1);
  };
  TIE.act.onbSkip = () => go(Math.min(N(), (TIE.store.s.onbStep || 1) + 1));
  const setter = (k) => (v) => { d()[k] = v; re(); };
  const toggler = (k, max) => (v) => { if (!tg(d()[k], v, max)) TIE.app.toast('Até ' + max + '. Desmarque um para trocar.'); re(); };
  TIE.act.onbCompany = setter('company'); TIE.act.onbFeedback = setter('feedback'); TIE.act.onbMain = setter('mainDiff');
  TIE.act.onbMin = (v) => { d().minutes = +v; re(); };
  TIE.act.onbGoal = toggler('goals', 3); TIE.act.onbGenre = toggler('genres'); TIE.act.onbTheme = toggler('themes'); TIE.act.onbStyle = toggler('styles');
  TIE.act.onbDay = (v) => { tg(d().days, +v); d().days.sort(); re(); };
  // Lembretes: cada novo sugere um horário que ainda não está na lista; a pessoa ajusta no campo.
  TIE.act.onbRemAdd = () => { const R = d().reminders; if (R.length >= O().REMIND_MAX) return; R.push(['07:00', '12:30', '20:00', '09:00', '18:00', '22:00'].find((t) => !R.includes(t)) || '12:00'); re(); const el = document.getElementById('onb-rem' + (R.length - 1)); if (el) el.focus(); };
  TIE.act.onbRemDel = (i) => { d().reminders.splice(+i, 1); re(); };
  TIE.act.onbFormat = (k) => { const D = d(); tg(D.formats, k); if (!D.formats.includes(k)) { const own = O().GENRES[k].map((g) => g[0]), others = D.formats.flatMap((f) => O().GENRES[f].map((g) => g[0])); D.genres = D.genres.filter((g) => !own.includes(g) || others.includes(g)); } re(); };
  TIE.act.onbDiff = (k) => { const D = d(); tg(D.diffs, k); if (!D.diffs.includes(D.mainDiff)) D.mainDiff = D.diffs[0] || ''; re(); };
  TIE.act.onbHear = () => { const name = d().name || 'Ana', av = TIE.screens.cadastro.av; av && av.talking(true); TIE.speech.say('Hi, ' + name + '. Can you say this for me? Hi, I’m ' + name + '.', { mouth: (v) => av && av.mouth(v) }).then(() => av && av.talking(false)); };
  TIE.act.onbRecord = async () => {
    const U = TIE.ui.onb, name = d().name || 'Ana', target = 'Hi, I’m ' + name + '.', av = TIE.screens.cadastro.av;
    if (U.voice === 'rec') { U.stopper && U.stopper(); return; }
    if (!TIE.speech.canRecord) { TIE.app.toast('Este navegador não grava áudio. Pule esta etapa ou use o Chrome.'); return; }
    let rec, heard = '', lis = null;
    try { rec = await TIE.speech.record({ maxMs: 5000, onLevel: (v) => { for (let i = 0; i < 18; i++) { const el = document.getElementById('vu' + i); if (!el) continue; const h = Math.max(.08, v * (0.55 + 0.45 * Math.sin((i + performance.now() / 90) * .9) ** 2)); el.style.height = Math.round(h * 100) + '%'; el.className = h > .7 ? 'hot' : h > .35 ? 'mid' : ''; } } }); }
    catch (e) { TIE.app.toast('Não deu para usar o microfone. Confira a permissão do navegador.'); return; }
    TIE.sound.sfx.rec(); if (TIE.speech.canListen) lis = TIE.speech.listen({ onInterim: (t) => { heard = t; }, onFinal: (t) => { heard = t; } });
    U.voice = 'rec'; av && av.listening(true); TIE.app.render();
    U.stopper = async () => { U.stopper = null; lis && lis.stop(); U.voice = 'busy'; TIE.app.render(); const out = await rec.stop(); const r = await TIE.ai.pronounce(out.b64, target, heard); d().voice = { score: r.score, praise_pt: r.praise_pt, issues: r.issues || [], heard: r.heard || heard }; U.voice = 'idle'; r.score >= 8 ? TIE.sound.sfx.ok() : TIE.sound.sfx.soft(); re(); };
    setTimeout(() => U.voice === 'rec' && U.stopper && U.stopper(), 4200);
  };
  TIE.act.onbFinish = () => { const p = profileFromDraft(), P = TIE.personalize.build(p); TIE.store.set((s) => ({ profile: p, user: s.user || { name: p.name, fullName: p.fullName, email: s.draft.email }, settings: Object.assign(s.settings, { slow: P.defaults.speed < 1 }) }), { silent: true }); TIE.game.touch(); TIE.app.confetti(); TIE.app.toast('Tudo pronto. Bem-vindo a Beacon, ' + p.name + '.'); TIE.router.go('inicio'); };
})();
