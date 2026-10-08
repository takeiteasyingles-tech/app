// Gamificação: pontos, sequência de dias, meta diária, níveis, medalhas e missões do dia.
// Vocabulário compatível com o brand book: pontos, sequência, meta, medalha (nunca "XP" ou "ofensiva").
window.TIE = window.TIE || {};
(function () {
  const { today } = TIE.u;
  const POINTS = { step: 10, episode: 40, ex_right: 5, mic_try: 5, mic_good: 15, song: 10, maggie_turn: 5, maggie_session: 30, extra: 20, dub: 10, card: 2, quiz_hit: 5, test_pass: 50, mission: 15, word: 3 };
  const LEVELS = [[0, 'Iniciante'], [100, 'Curioso'], [250, 'Aprendiz'], [500, 'Explorador'], [900, 'Conversador'], [1400, 'Viajante'], [2000, 'Anfitrião'], [2800, 'Narrador'], [3800, 'Mestre de Beacon'], [5000, 'Lenda de Beacon']];
  const BADGES = [
    { id: 'first-step', t: 'Primeiro passo', s: 'Concluiu uma etapa', icon: 'flag', test: (g) => g.log.some((l) => l.k === 'step') },
    { id: 'first-episode', t: 'Episódio inteiro', s: 'Fechou um episódio', icon: 'check', test: (g) => g.log.some((l) => l.k === 'episode') },
    { id: 'first-talk', t: 'Quebrou o gelo', s: 'Primeira conversa no Mic', icon: 'mic', test: (g) => g.log.some((l) => l.k === 'maggie_turn') },
    { id: 'talk-10', t: 'Papo bom', s: '10 falas no Mic', icon: 'chat', test: (g) => g.log.filter((l) => l.k === 'maggie_turn').length >= 10 },
    { id: 'mic-8', t: 'Voz clara', s: 'Nota 8 ou mais na pronúncia', icon: 'wave', test: (g) => g.log.some((l) => l.k === 'mic_good') },
    { id: 'cinema', t: 'Sessão pipoca', s: 'Viu um Extra até o fim', icon: 'tv', test: (g) => g.log.some((l) => l.k === 'extra') },
    { id: 'dub', t: 'Dublador', s: 'Dublou um personagem', icon: 'star', test: (g) => g.log.some((l) => l.k === 'dub') },
    { id: 'cards-20', t: 'Memória em dia', s: '20 cartões revisados', icon: 'cards', test: (g) => g.log.filter((l) => l.k === 'card').length >= 20 },
    { id: 'streak-3', t: '3 dias seguidos', s: 'Sequência de 3 dias', icon: 'fire', test: (g) => g.streak >= 3 },
    { id: 'streak-7', t: 'Uma semana', s: 'Sequência de 7 dias', icon: 'fire', test: (g) => g.streak >= 7 },
    { id: 'pts-500', t: 'Explorador', s: '500 pontos', icon: 'coin', test: (g) => g.points >= 500 },
    { id: 'test', t: 'Passou no teste', s: 'Nota de corte no episode test', icon: 'trophy', test: (g) => g.log.some((l) => l.k === 'test_pass') },
    { id: 'song', t: 'Cantou junto', s: 'Terminou um karaokê', icon: 'music', test: (g) => g.log.some((l) => l.k === 'song') },
    { id: 'goal-5', t: 'Meta em dia', s: 'Bateu a meta 5 vezes', icon: 'target', test: (g) => Object.values(g.daily).filter((d) => d.goal).length >= 5 }
  ];
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
  const G = () => TIE.store.s.game;
  function day() { const g = G(), t = today(); if (!g.daily[t]) g.daily[t] = { points: 0, steps: 0, cards: 0, maggieSec: 0, extras: 0, mic: 0, goal: false, missions: {} }; return g.daily[t]; }
  function touch() { const g = G(), t = today(); if (g.lastDay !== t) { g.streak = g.lastDay === yesterday() ? (g.streak || 0) + 1 : 1; g.lastDay = t; } }
  function goalTarget() { const p = TIE.store.s.profile; return Math.max(50, Math.round(((p && p.minutes) || 20) * 5)); }
  function level(points) { let i = LEVELS.findIndex((l, j) => points < l[0] && j > 0); if (i === -1) i = LEVELS.length; const cur = LEVELS[i - 1], next = LEVELS[i]; return { n: i, name: cur[1], from: cur[0], next: next ? next[0] : null, pct: next ? Math.round((points - cur[0]) / (next[0] - cur[0]) * 100) : 100 }; }

  function award(kind, meta) {
    const g = G(), pts = POINTS[kind] || 0; touch(); const d = day();
    const before = level(g.points);
    g.points += pts; d.points += pts; g.log.push({ k: kind, t: Date.now(), p: pts }); if (g.log.length > 400) g.log = g.log.slice(-400);
    if (kind === 'step' || kind === 'episode') d.steps++; if (kind === 'card') d.cards++; if (kind === 'extra') d.extras++; if (kind === 'mic_try' || kind === 'mic_good') d.mic++;
    if (meta && meta.sec) d.maggieSec += meta.sec;
    const wasGoal = d.goal; if (!d.goal && d.points >= goalTarget()) { d.goal = true; }
    // Missões do dia: bônus quando completam.
    const missions = dailyMissions(); missions.forEach((m) => { if (m.done && !d.missions[m.k]) { d.missions[m.k] = true; g.points += POINTS.mission; d.points += POINTS.mission; } });
    const fresh = BADGES.filter((b) => !g.badges.includes(b.id) && b.test(g)); fresh.forEach((b) => g.badges.push(b.id));
    TIE.store.save();
    if (TIE.app) {
      if (pts) TIE.app.points(pts);
      const after = level(g.points);
      if (after.n > before.n) { TIE.sound.sfx.level(); TIE.app.toast('Novo nível: ' + after.name + '.'); TIE.app.confetti(); }
      else if (!wasGoal && d.goal) { TIE.sound.sfx.done(); TIE.app.toast('Meta do dia batida. ' + d.points + ' pontos hoje.'); TIE.app.confetti(); }
      fresh.forEach((b) => setTimeout(() => TIE.app.toast('Medalha: ' + b.t + '. ' + b.s + '.'), 900));
    }
    return pts;
  }
  function dailyMissions() {
    const s = TIE.store.s, d = day(), p = s.profile || {}, P = TIE.personalize.build(s.profile);
    const list = [{ k: 'step', t: 'Fazer 1 etapa do episódio', go: 'episodio/' + TIE.guide.current().num, done: d.steps >= 1 }];
    // Sem cartões na revisão (conta nova), a missão de cartões dá lugar às duas outras.
    if (s.due > 0 || d.cards > 0) list.push({ k: 'cards', t: 'Revisar 5 cartões', go: 'revisao', done: d.cards >= 5 || s.due === 0 });
    const extra = { k: 'extra', t: 'Ver um Extra até o fim', go: 'extra', done: d.extras >= 1 }, maggie = { k: 'maggie', t: '2 minutos com ' + TIE.assist.the(), go: 'maggie', done: d.maggieSec >= 120 };
    const dayN = new Date().getDate();
    if (list.length < 2) list.push(extra, maggie);
    else list.push((p.styles || []).includes('vendo') || dayN % 2 === 0 ? extra : maggie);
    return list;
  }
  function summary() { const g = G(), d = day(); return { points: g.points, level: level(g.points), streak: g.streak || 1, goal: { target: goalTarget(), done: d.points, pct: Math.min(100, Math.round(d.points / goalTarget() * 100)), hit: d.goal }, daily: d, badges: BADGES.map((b) => Object.assign({}, b, { has: g.badges.includes(b.id) })), missions: dailyMissions() }; }
  TIE.game = { award, summary, level, touch, POINTS, BADGES, LEVELS, goalTarget };
})();
