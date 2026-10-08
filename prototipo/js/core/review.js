// Revisão: o baralho nasce do que a pessoa já fez. Etapa concluída do episódio vira cartão
// (Take a Look: palavras da cena; Take Away: expressões-chave). Extras e Mic entram pelo toque na palavra.
// Agenda curta: De novo volta no fim da fila, Difícil em 10 min, Bom em 2 dias, Fácil em 5 dias.
window.TIE = window.TIE || {};
(function () {
  const MIN = 6e4, DAY = 864e5;
  const GRADES = [['De novo', '< 1 min', 0], ['Difícil', '10 min', 10 * MIN], ['Bom', '2 dias', 2 * DAY], ['Fácil', '5 dias', 5 * DAY]];
  // [etapa, cartões que ela libera quando é concluída]
  const FROM = [
    [4, (E) => (E.visual || []).map((x) => ({ en: x.en, pt: x.pt, scene: 'Ep. ' + E.num + ' · Take a Look' }))],
    [8, (E) => (E.awayExp || []).map((x) => ({ en: x.en, pt: x.pt, note: x.note || '', scene: 'Ep. ' + E.num + ' · Take Away' }))]
  ];
  const S = () => TIE.store.s, key = (en) => TIE.data.norm(en);
  const find = (en) => S().deck.find((c) => key(c.en) === key(en));
  // Etapa concluída = a pessoa já seguiu para a próxima (prog guarda a etapa mais longe alcançada).
  const reached = (num) => (S().epsDone[num] ? 11 : S().prog[num] || 1);
  const cardsOf = (E, upTo) => FROM.filter(([n]) => n < (upTo || 11)).flatMap(([, f]) => f(E));
  const queue = () => { const now = Date.now(); return S().deck.filter((c) => (c.at || 0) <= now).sort((a, b) => (a.at || 0) - (b.at || 0)); };

  // Traz para o baralho o que as etapas concluídas liberaram e recalcula quantos cartões vencem agora.
  function sync() {
    const s = S(), now = Date.now(); let added = 0;
    Object.values(TIE.data.EPS).forEach((E) => { if (E) cardsOf(E, reached(E.num)).forEach((c) => { if (!find(c.en)) { s.deck.push(Object.assign(c, { at: now })); added++; } }); });
    const due = queue().length;
    if (added || due !== s.due) { s.due = due; TIE.store.save(); }
    return added;
  }
  function add(en, pt, scene) { const s = S(); if (find(en)) return false; s.deck.unshift({ en, pt, scene, at: Date.now() }); s.due = queue().length; TIE.store.save(); return true; }
  function grade(en, i) { const c = find(en), g = GRADES[+i]; if (!c || !g) return; c.at = Date.now() + g[2]; c.reps = (c.reps || 0) + 1; S().due = queue().length; TIE.store.save(); }
  // Quando volta o próximo cartão, em texto: "em 10 min", "amanhã", "em 2 dias".
  function nextIn() {
    const at = S().deck.reduce((m, c) => Math.min(m, c.at || 0), Infinity), d = at - Date.now();
    if (!isFinite(at)) return ''; if (d < 60 * MIN) return 'em ' + Math.max(1, Math.ceil(d / MIN)) + ' min'; if (d < DAY) return 'em ' + Math.ceil(d / (60 * MIN)) + ' h';
    const n = Math.ceil(d / DAY); return n === 1 ? 'amanhã' : 'em ' + n + ' dias';
  }
  TIE.review = { GRADES, sync, queue, add, grade, cardsOf, nextIn };
})();
