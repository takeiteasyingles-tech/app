// Guia do dia: transforma perfil + progresso em um plano curto e ordenado ("agora você faz X").
window.TIE = window.TIE || {};
(function () {
  // Episódio atual: o primeiro, na ordem da trilha, que ainda não foi concluído.
  // O protótipo só tem alguns episódios roteirizados (TIE.data.EPS); os outros ficam de fora.
  function current() {
    const s = TIE.store.s, order = Object.keys(TIE.data.EPS).map(Number).sort((a, b) => a - b);
    const num = order.find((n) => !s.epsDone[n]) || order[order.length - 1];
    return { num, ep: TIE.data.EPS[num], step: s.prog[num] || 1, started: !!s.prog[num], allDone: order.every((n) => s.epsDone[n]) };
  }
  function plan() {
    const s = TIE.store.s, p = s.profile, P = TIE.personalize.build(p), g = TIE.game.summary(), d = g.daily, D = TIE.data;
    const cur = current(), step = D.STEPS[cur.step - 1];
    const tasks = [];
    tasks.push({ k: 'ep', t: 'Episódio ' + cur.num + ' · ' + step.name, sub: 'Etapa ' + cur.step + ' de 10 · ' + step.pt, min: 8, go: 'episodio/' + cur.num, icon: 'play', pts: 10, done: d.steps >= 1, img: 'assets/img/gen/bg/home.webp' });
    if (s.due > 0) tasks.push({ k: 'cards', t: 'Rebobinar ' + Math.min(s.due, 5) + ' cartões', sub: 'Palavras dos episódios e dos Extras', min: 3, go: 'revisao', icon: 'review', pts: 10, done: d.cards >= 5 });
    const m = P.missions[0];
    tasks.push({ k: 'maggie', t: TIE.assist.cur().name + ' · ' + m.t, sub: m.goal, min: 5, go: 'maggie?modo=missao&m=' + m.k, icon: 'mic', pts: 30, done: d.maggieSec >= 120 });
    const x = P.extras.find((e) => !e.locked && !s.extras.seen[e.id]) || P.extras[0];
    if (p.minutes >= 20) tasks.push({ k: 'extra', t: 'EXTRA · ' + x.title, sub: x.why + ' · ' + x.dur, min: 8, go: 'extra/' + x.id + '/assistir', icon: 'tv', pts: 20, done: !!s.extras.seen[x.id], img: x.scene });
    // Ordem conforme o jeito de aprender.
    const st = p.styles || [];
    const w = (t) => (t.k === 'ep' ? -10 : 0) + (t.k === 'maggie' && st.includes('falando') ? -2 : 0) + (t.k === 'extra' && st.includes('vendo') ? -1 : 0) + (t.k === 'cards' && st.includes('lendo') ? -1 : 0);
    tasks.sort((a, b) => w(a) - w(b));
    const now = tasks.find((t) => !t.done) || null;
    const total = tasks.reduce((a, t) => a + t.min, 0);
    return { tasks, now, total, focus: P.focus, allDone: !now };
  }
  TIE.guide = { plan, current };
})();
