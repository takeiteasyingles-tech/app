// Avatar do assistente do Mic (Maggie, Robert, Becky, Zach, Barbara; ver js/data/assistants.js), em vídeo.
// Clipes gerados por tools/tie_mic_videos.mjs (lista em js/data/mic-clips.js): "idle" quando não está falando e,
// enquanto a voz sai, um de três clipes falando escolhido pelo humor da resposta (lipsync simulado):
// talk (conversa), talk-happy (elogio, animação), talk-soft (correção, pensando). Sem clipes: as iniciais.
// API: TIE.avatar.mount(el, chave?) → { mouth(v), mood(m), talking(on), listening(on), destroy() }
window.TIE = window.TIE || {};
(function () {
  const DIR = 'assets/img/gen/avatar/', VDIR = 'assets/video/mic/';
  const TALK = { encouraging: 'talk-happy', thinking: 'talk-soft', correcting: 'talk-soft' }; // o resto: talk
  // Se faltar o clipe pedido, usa outro clipe falando (a boca mexe); só sem nenhum fica no idle.
  const ORDER = { talk: ['talk', 'talk-soft', 'talk-happy'], 'talk-happy': ['talk-happy', 'talk', 'talk-soft'], 'talk-soft': ['talk-soft', 'talk', 'talk-happy'], idle: [] };
  const A = (k) => (k ? TIE.assist.get(k) : TIE.assist.cur());
  const has = (a) => !!(a.clips && a.clips.length);
  const initials = (a) => a.name[0] + a.full.split(' ').slice(-1)[0][0];
  // Miniatura (seletor, card de Hoje): quadro do rosto tirado do clipe idle; sem clipes, as iniciais.
  const thumb = (k, size) => { const a = A(k); return has(a) ? '<img src="' + DIR + 'as-' + a.k + '-thumb.webp" alt="">' : '<span class="av-ini" style="--s:' + (size || 60) + 'px">' + initials(a) + '</span>'; };

  function mount(el, k) {
    const noop = { mouth() {}, mood() {}, talking() {}, listening() {}, destroy() {} };
    if (!el) return noop;
    const a = A(k), wrap = document.createElement('div'); wrap.className = 'av2d vid';
    wrap.innerHTML = has(a) ? a.clips.map((s) => '<video data-k="' + s + '" src="' + VDIR + a.k + '-' + s + '.mp4" muted loop playsinline preload="auto"' + (s === 'idle' ? ' poster="' + DIR + 'as-' + a.k + '-poster.webp"' : '') + '></video>').join('') : '<div class="av-empty"><span class="av-ini" style="--s:120px">' + initials(a) + '</span></div>';
    el.appendChild(wrap);
    if (!has(a)) return noop;
    const st = { mood: 'happy', talking: false, alive: true, cur: '' };
    const pickClip = (s) => (ORDER[s] || []).find((x) => a.clips.includes(x)) || 'idle';
    const show = (s) => {
      if (st.cur === s) return; st.cur = s;
      wrap.querySelectorAll('video').forEach((v) => {
        const on = v.getAttribute('data-k') === s; v.classList.toggle('on', on);
        // O clipe que entra começa do início (a fala começa com a boca parada); o que sai pausa depois do cross-fade.
        if (on) { try { v.currentTime = 0; } catch (e) {} const p = v.play(); if (p && p.catch) p.catch(() => {}); } else setTimeout(() => { if (!v.classList.contains('on')) v.pause(); }, 300);
      });
    };
    const pick = () => { if (st.alive) show(pickClip(st.talking ? TALK[st.mood] || 'talk' : 'idle')); };
    pick();
    return {
      mouth() {}, // o clipe falando já mexe a boca
      mood(m) { st.mood = m || 'happy'; if (st.talking) pick(); },
      talking(on) { st.talking = !!on; pick(); },
      listening() {},
      destroy() { st.alive = false; wrap.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); wrap.remove(); }
    };
  }
  TIE.avatar = { mount, DIR, thumb };
})();
