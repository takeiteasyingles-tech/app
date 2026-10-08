// Utilitários, estado persistido (localStorage) e rotas por hash.
window.TIE = window.TIE || {};
TIE.screens = TIE.screens || {};
TIE.act = TIE.act || {};
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + pad2(t % 60); };
  const sub = (t, name) => String(t || '').split('{N}').join(name || '');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);
  TIE.u = { esc, pad2, fmt, sub, pick, shuffle, uid, today };

  // v6: a conta nova começa do zero (episódio 1, nenhum e-book, nenhum cartão, 60 min de Maggie).
  // Trocar a chave descarta o progresso de exemplo que a v5 deixava salvo no navegador.
  const KEY = 'tie.v6';
  const fresh = () => ({
    v: 6, user: null, profile: null, onbStep: 1,
    draft: { fullName: '', name: '', birth: '', email: '', pass: '', goals: [], formats: [], genres: [], themes: [], diffs: [], mainDiff: '', styles: [], company: 'desafio', feedback: 'direto', days: [1, 2, 3, 4, 5], minutes: 20, reminders: ['20:00'], voice: null },
    prog: {}, ebooks: {}, epsDone: {}, stepOk: {},
    scores: {}, exAns: {}, testAns: {}, testDone: false, testScore: null,
    deck: [], due: 0,
    extras: { seen: {}, dubs: {}, best: 0, lastId: '' },
    maggie: { secLeft: 60 * 60, sessions: [] },
    game: { points: 0, streak: 1, lastDay: '', daily: {}, badges: [], log: [] },
    settings: { ts: 1, sound: true, hd: false, trans: true, slow: false, remind: true, phone: false, fx: true, free: true }
  });
  function load() {
    try {
      localStorage.removeItem('tie.v5');
      const raw = localStorage.getItem(KEY);
      if (raw) { const saved = JSON.parse(raw); if (saved && saved.v === 6) { const b = fresh(); const deep = ['settings', 'draft', 'extras', 'maggie', 'game']; const out = Object.assign(fresh(), saved); deep.forEach((k) => { out[k] = Object.assign(b[k] || {}, saved[k] || {}); }); return out; } }
    } catch (e) {}
    return fresh();
  }
  let saveT = 0;
  const store = {
    s: load(),
    save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store.s)); } catch (e) {} }, 120); },
    set(patch, opts) { const p = typeof patch === 'function' ? patch(store.s) : patch; if (p) Object.assign(store.s, p); store.save(); if (!(opts && opts.silent) && TIE.app) TIE.app.render(); },
    reset() { try { localStorage.removeItem(KEY); } catch (e) {} store.s = fresh(); },
    // Zera o progresso (aulas, e-books, notas, exercícios, revisão, Extras, Maggie, pontos e medalhas).
    // Conta, cadastro e ajustes ficam: a pessoa volta ao episódio 1 sem refazer o cadastro.
    resetProgress() { const b = fresh(); ['prog', 'ebooks', 'epsDone', 'stepOk', 'scores', 'exAns', 'testAns', 'testDone', 'testScore', 'deck', 'due', 'extras', 'maggie', 'game'].forEach((k) => { store.s[k] = b[k]; }); try { localStorage.setItem(KEY, JSON.stringify(store.s)); } catch (e) {} },
    flash: ''
  };
  TIE.store = store; TIE.ui = {};

  // ?reset=true na URL (antes ou depois do #) zera o progresso e abre Hoje. Roda ao abrir a página e a cada
  // troca de # (trocar só o # não recarrega a página). O parâmetro sai da URL, para um recarregar não zerar de novo.
  store.checkReset = function () {
    const isReset = (kv) => /^reset=(true|1)$/i.test(kv), keep = (qs) => (qs || '').split('&').filter((kv) => kv && !/^reset=/i.test(kv)).join('&');
    const hq = location.hash.split('?')[1] || '';
    if (!location.search.slice(1).split('&').some(isReset) && !hq.split('&').some(isReset)) return false;
    store.resetProgress(); store.flash = 'Progresso zerado. Você está de volta ao episódio 1.';
    const qs = keep(location.search.slice(1)), url = location.pathname + (qs ? '?' + qs : '') + '#/inicio';
    // Em file:// o navegador pode recusar trocar a query sem recarregar; aí recarrega sem o parâmetro.
    try { history.replaceState(null, '', url); } catch (e) { location.replace(url); }
    return true;
  };
  store.checkReset();

  const ROUTES = [
    [/^$/, 'raiz'], [/^entrar$/, 'entrar'], [/^cadastro(?:\/(\d+))?$/, 'cadastro', ['step']],
    [/^inicio$/, 'inicio'], [/^trilha$/, 'trilha'],
    [/^episodio\/(\d+)(?:\/(\d+))?$/, 'player', ['ep', 'step']], [/^concluido\/(\d+)$/, 'concluido', ['ep']],
    [/^ebook\/1$/, 'ebook'], [/^ebook\/1\/(five|real|lead|teste)$/, 'ebookx', ['part']],
    [/^extra$/, 'extra'], [/^extra\/musica\/([\w-]+)$/, 'musica', ['id']], [/^extra\/desafio$/, 'desafio'], [/^extra\/([\w-]+)$/, 'extraDetail', ['id']], [/^extra\/([\w-]+)\/assistir$/, 'extraPlay', ['id']],
    [/^maggie$/, 'maggie'], [/^maggie\/relatorio(?:\/([\w-]+))?$/, 'relatorio', ['id']],
    [/^revisao$/, 'revisao'], [/^perfil$/, 'perfil'], [/^conquistas$/, 'conquistas']
  ];
  TIE.router = {
    parse() {
      const raw = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
      const [path, qs] = raw.split('?'); const q = {};
      (qs || '').split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); q[k] = v || ''; });
      for (const [re, name, keys] of ROUTES) { const m = path.match(re); if (m) { const params = {}; (keys || []).forEach((k, i) => { params[k] = m[i + 1]; }); return { name, params, q, path }; } }
      return { name: 'raiz', params: {}, q, path };
    },
    go(path) { const h = '#/' + String(path).replace(/^#?\/?/, ''); if (location.hash === h) TIE.app.render(); else location.hash = h; },
    replace(path) { history.replaceState(null, '', '#/' + String(path).replace(/^#?\/?/, '')); TIE.app.render(); }
  };
})();
