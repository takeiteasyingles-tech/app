// Entrar: e-mail e senha, social (simulado) e conta demo.
(function () {
  const { esc } = TIE.u, C = TIE.C, I = TIE.icon;
  TIE.ui.login = TIE.ui.login || { email: '', pass: '', show: false, err: {} };
  const DEMO = { name: 'Ana', age: '25-34', occup: 'trabalho', area: 'criativo', level: 'basico', goals: ['viagem', 'series'], deadline: '6m', history: ['escola', 'app'], fails: ['falar', 'tempo'], formats: ['animes', 'series', 'musica'], genres: ['comedia', 'shonen', 'musical', 'pop', 'anos80'], themes: ['comida', 'viagem'], diffs: ['pron', 'listening', 'shy'], mainDiff: 'pron', styles: ['vendo', 'falando'], company: 'desafio', feedback: 'direto', days: [1, 2, 3, 4, 5], minutes: 20, reminders: ['20:00'], motives: ['viagem', 'vergonha'], why: '', voice: null };
  TIE.DEMO_PROFILE = DEMO;
  TIE.screens.entrar = {
    title: 'Entrar',
    render() {
      const L = TIE.ui.login, e = L.err || {};
      return { theme: 'cream', html: '<div class="scroll"><div class="auth"><div class="hero" style="background-image:url(assets/img/gen/bg/login.webp);background-position:62% 42%">' + C.logo({ size: 30, desc: true, white: true }) + '<h1 class="h1 mt16" style="color:#fff">Você não faz lições. Você acompanha uma história.</h1><p class="p mt8" style="color:var(--onNavy)">Uma série do zero ao B2, com a Maggie para conversar quando você quiser.</p></div>' +
        '<div class="formwrap"><div class="card formcard stack" style="--gap:12px"><div class="h2">Entrar</div>' +
        '<label class="field"><span>E-mail</span><input class="input" id="login-email" type="email" inputmode="email" autocomplete="email" placeholder="voce@email.com" value="' + esc(L.email) + '" data-ui="login.email"></label>' + (e.email ? '<div class="field"><span class="err">' + esc(e.email) + '</span></div>' : '') +
        '<label class="field"><span>Senha</span><span class="input-wrap"><input class="input" id="login-pass" type="' + (L.show ? 'text' : 'password') + '" autocomplete="current-password" placeholder="Mínimo de 6 caracteres" value="' + esc(L.pass) + '" data-ui="login.pass" data-enter="login"><button class="iconbtn" data-act="loginShow" aria-label="Mostrar senha">' + I(L.show ? 'eyeoff' : 'eye', 20) + '</button></span></label>' + (e.pass ? '<div class="field"><span class="err">' + esc(e.pass) + '</span></div>' : '') +
        '<div class="row between"><button class="btn link" data-act="forgot">Esqueci a senha</button></div>' + C.btn('Entrar', { act: 'login', cls: 'block' }) + '<div class="divider">ou</div>' +
        '<div class="grid2">' + C.btn('Google', { kind: 'light compact', act: 'social', arg: 'Google', icon: 'google' }) + C.btn('Apple', { kind: 'light compact', act: 'social', arg: 'Apple', icon: 'apple' }) + '</div>' +
        C.btn('Criar conta grátis', { kind: 'ghost', go: 'cadastro/1', cls: 'block' }) +
        '<button class="btn link" data-act="demoLogin" style="--fg:var(--orange)">Entrar na conta demo (Ana)</button><p class="xs tc">Protótipo: nenhum dado sai do seu navegador.</p></div></div></div></div>' };
    }
  };
  TIE.act.loginShow = () => { TIE.ui.login.show = !TIE.ui.login.show; TIE.app.render(); };
  TIE.act.forgot = () => TIE.app.toast('No app de verdade, enviaríamos um link para o seu e-mail.');
  TIE.act.login = () => {
    const L = TIE.ui.login; L.err = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(L.email || '')) L.err.email = 'Confira o e-mail. Ele precisa ter @ e um domínio.';
    if ((L.pass || '').length < 6) L.err.pass = 'A senha tem pelo menos 6 caracteres.';
    if (L.err.email || L.err.pass) return TIE.app.render();
    const raw = L.email.split('@')[0].replace(/[._-]+/g, ' ').trim(), name = raw.charAt(0).toUpperCase() + raw.slice(1).split(' ')[0];
    TIE.store.set({ user: { name, email: L.email }, profile: Object.assign({}, DEMO, { name }) }); TIE.router.go('inicio');
  };
  TIE.act.social = (who) => { TIE.app.toast('Login com ' + who + ' simulado. Vamos montar o seu plano.'); TIE.store.set((s) => ({ user: { name: 'Ana', email: 'ana@exemplo.com', via: who }, draft: Object.assign(s.draft, { name: s.draft.name || 'Ana', email: 'ana@exemplo.com', pass: '••••••' }), onbStep: 2 }), { silent: true }); TIE.router.go('cadastro/2'); };
  TIE.act.demoLogin = () => { TIE.store.set({ user: { name: 'Ana', email: 'ana@exemplo.com', demo: true }, profile: Object.assign({}, DEMO) }); TIE.router.go('inicio'); };
})();
