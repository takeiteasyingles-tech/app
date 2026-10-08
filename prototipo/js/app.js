// Casca do app: guardas de rota, desenho das telas, delegação de eventos, avisos e pontos.
window.TIE = window.TIE || {};
(function () {
  const app = {}; let lastPath = null, current = null, vroot, content, fxroot, depth = 0;
  const layout = () => (window.innerWidth >= 900 && !TIE.store.s.settings.phone ? 'desktop' : 'mobile');
  app.layout = layout; app.isDesktop = () => layout() === 'desktop';
  const SECTION = (n) => ({ inicio: 'inicio', trilha: 'trilha', ebook: 'trilha', ebookx: 'trilha', player: 'trilha', concluido: 'trilha', extra: 'extra', extraDetail: 'extra', extraPlay: 'extra', musica: 'extra', desafio: 'extra', maggie: 'maggie', relatorio: 'maggie', revisao: 'revisao', perfil: 'perfil', conquistas: 'conquistas' }[n] || '');
  app.render = function () { if (depth > 4) { console.error('[TIE] redirecionamento em loop'); return; } depth++; try { draw(); } finally { depth--; } };
  function draw() {
    const s = TIE.store.s, r = TIE.router.parse();
    if (!s.user && r.name !== 'entrar' && r.name !== 'cadastro') return TIE.router.replace('entrar');
    if (s.user && !s.profile && r.name !== 'cadastro') return TIE.router.replace('cadastro/' + (s.onbStep || 1));
    if (r.name === 'raiz' || (s.profile && (r.name === 'entrar' || r.name === 'cadastro'))) return TIE.router.replace(s.profile ? 'inicio' : 'entrar');
    const scr = TIE.screens[r.name]; if (!scr) return TIE.router.replace('inicio');
    const fresh = s.profile ? TIE.review.sync() : 0;
    const changed = r.path !== lastPath;
    if (changed && current && current.leave) { try { current.leave(); } catch (e) { console.error(e); } }
    const oldScroll = content.querySelector('.scroll'), scrollTop = oldScroll ? oldScroll.scrollTop : 0;
    const ae = document.activeElement, focusId = ae && ae.id && content.contains(ae) ? ae.id : '', selS = ae && ae.selectionStart, selE = ae && ae.selectionEnd;
    let out; try { out = scr.render(r.params, r.q) || {}; } catch (e) { console.error(e); out = { html: '<div class="wrap"><div class="card mt24"><div class="h3">Algo deu errado nesta tela.</div><pre class="xs">' + TIE.u.esc(e.stack || e) + '</pre></div></div>' }; }
    const L = layout(), tabs = !!out.tabs, nav = out.nav || SECTION(r.name);
    document.documentElement.style.setProperty('--ts', s.settings.ts);
    document.body.classList.toggle('phone-mode', !!s.settings.phone && window.innerWidth >= 900);
    vroot.setAttribute('data-layout', L); vroot.setAttribute('data-theme', out.theme || 'cream');
    content.innerHTML = (tabs && L === 'desktop' ? TIE.C.side(nav) : '') + '<div class="view' + (tabs ? ' has-tabs' : '') + (changed ? ' enter' : '') + '">' + (out.html || '') + '</div>' + (tabs && L === 'mobile' ? TIE.C.tabbar(nav) : '') + (out.overlay || '');
    const sc = content.querySelector('.scroll'); if (sc && !changed) sc.scrollTop = scrollTop;
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selE); } catch (e) {} } }
    lastPath = r.path; current = scr; document.title = (out.title ? out.title + ' · ' : '') + 'Take It Easy';
    if (scr.after) { try { scr.after(content, r.params, changed, r.q); } catch (e) { console.error(e); } }
    devToggle();
    if (fresh) app.toast(fresh + (fresh > 1 ? ' cartões novos' : ' cartão novo') + ' na Revisão.');
  }
  app.toast = (msg, ms) => { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; fxroot.appendChild(t); setTimeout(() => t.remove(), ms || 2600); };
  app.points = (n) => { TIE.sound.sfx.points(); const t = document.createElement('div'); t.className = 'pts-toast'; t.textContent = '+' + n + ' pontos'; fxroot.appendChild(t); setTimeout(() => t.remove(), 1700); const gb = content.querySelector('.gamebar'); if (gb) gb.outerHTML = TIE.C.gamebar(); };
  app.confetti = () => { if (!TIE.store.s.settings.fx) return; const c = document.createElement('div'); c.className = 'confetti'; const cols = ['#2A6FF5', '#F45A28', '#1F7A4C', '#E9A200', '#0F2A55']; c.innerHTML = Array.from({ length: 40 }, (_, i) => '<i style="left:' + (Math.random() * 100) + '%;background:' + cols[i % 5] + ';animation-delay:' + (Math.random() * .4) + 's;animation-duration:' + (1.3 + Math.random()) + 's"></i>').join(''); fxroot.appendChild(c); setTimeout(() => c.remove(), 2600); };

  function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; }); o[ks[ks.length - 1]] = val; }
  function bind() {
    document.addEventListener('click', (ev) => {
      const go = ev.target.closest('[data-go]'), act = ev.target.closest('[data-act]'); const target = act && go ? (act.contains(go) ? go : act) : (act || go);
      if (!target || target.disabled) return;
      if (target.hasAttribute('data-go')) { ev.preventDefault(); TIE.sound.sfx.tick(); TIE.router.go(target.getAttribute('data-go')); return; }
      const fn = TIE.act[target.getAttribute('data-act')]; if (fn) { ev.preventDefault(); TIE.sound.sfx.tick(); fn(target.getAttribute('data-arg'), target, ev); }
    });
    document.addEventListener('input', (ev) => { const el = ev.target; const m = el.getAttribute && el.getAttribute('data-model'); if (m) { setPath(TIE.store.s, m, el.type === 'checkbox' ? el.checked : el.value); TIE.store.save(); } const u = el.getAttribute && el.getAttribute('data-ui'); if (u) setPath(TIE.ui, u, el.value); });
    document.addEventListener('change', (ev) => { const el = ev.target; const a = el.getAttribute && el.getAttribute('data-file'); if (a && TIE.act[a] && el.files && el.files[0]) TIE.act[a](el.files[0], el); });
    document.addEventListener('keydown', (ev) => { if (ev.key !== 'Enter') return; const el = ev.target, a = el.getAttribute && el.getAttribute('data-enter'); if (a && TIE.act[a]) { ev.preventDefault(); TIE.act[a](el.value, el, ev); } });
    window.addEventListener('hashchange', () => { TIE.store.checkReset(); app.render(); showFlash(); });
    let lastL = null; window.addEventListener('resize', () => { const L = layout(); if (L !== lastL) { lastL = L; app.render(); } });
  }
  // Aviso deixado pelo store (ex.: depois do ?reset=true).
  function showFlash() { if (TIE.store.flash) { app.toast(TIE.store.flash, 3200); TIE.store.flash = ''; } }
  function devToggle() { let el = document.getElementById('devtoggle'); if (!el) { el = document.createElement('div'); el.id = 'devtoggle'; el.className = 'devtoggle'; document.body.appendChild(el); } const phone = !!TIE.store.s.settings.phone; el.innerHTML = '<button class="' + (phone ? 'on' : '') + '" data-act="setPhone" data-arg="1">' + TIE.icon('phone', 16) + 'Celular</button><button class="' + (!phone ? 'on' : '') + '" data-act="setPhone" data-arg="0">' + TIE.icon('desktop', 16) + 'Computador</button><button class="' + (TIE.store.s.settings.free ? 'on' : '') + '" data-act="setFree" title="Avançar as etapas do episódio sem concluir o que falta">' + TIE.icon('lock', 16) + 'Etapas livres</button>'; }
  TIE.act.setFree = () => TIE.store.set((s) => ({ settings: Object.assign(s.settings, { free: !s.settings.free }) }));
  TIE.act.setPhone = (v) => TIE.store.set((s) => ({ settings: Object.assign(s.settings, { phone: v === '1' }) }));
  app.start = async function () {
    const stage = document.getElementById('stage');
    stage.innerHTML = '<div class="app" id="app"><div id="content" style="display:contents"></div><div id="fxroot"></div></div>';
    vroot = document.getElementById('app'); content = document.getElementById('content'); fxroot = document.getElementById('fxroot');
    bind(); if (TIE.store.s.profile) TIE.game.touch(); app.render(); showFlash(); await TIE.ai.init(); app.render();
  };
  TIE.app = app; document.addEventListener('DOMContentLoaded', () => app.start());
})();
