// Personalização: perfil do cadastro → o que o app mostra e em que ordem. Função pura.
window.TIE = window.TIE || {};
(function () {
  const D = () => TIE.data;
  const label = (list, k) => { const f = (list || []).find((x) => (Array.isArray(x) ? x[0] : x.k) === k); return f ? (Array.isArray(f) ? f[1] : f.t) : k; };
  const FORMAT_WORD = { series: 'séries', novelas: 'novelas', filmes: 'filmes', animes: 'animes', musica: 'música', games: 'games', viagens: 'viagens', artes: 'artes', business: 'business' };
  // Viagens e Business não são formatos de tela: no EXTRA eles puxam os títulos com o tema correspondente.
  const FORMAT_THEME = { viagens: 'viagem', business: 'negocios' };
  const GENRE_WORD = (k) => { for (const list of Object.values(D().ONB.GENRES)) { const f = list.find((g) => g[0] === k); if (f) return f[1].toLowerCase(); } return k; };
  const levelInfo = (p) => D().ONB.LEVELS.find((l) => l.k === (p && p.level)) || D().ONB.LEVELS[0];

  function rankExtras(p) {
    const cefrN = { A1: 1, 'A1+': 1, A2: 2, B1: 3 }[levelInfo(p).cefr] || 1;
    return D().EXTRAS.map((x) => {
      let score = 0, why = '';
      if (p.formats.includes(x.format)) { score += 4; why = 'Porque você curte ' + FORMAT_WORD[x.format]; }
      const g = x.genres.find((k) => p.genres.includes(k));
      if (g) { score += 2; why = why ? why + ' e ' + GENRE_WORD(g) : 'Porque você marcou ' + GENRE_WORD(g); }
      const themes = p.themes.concat(p.formats.map((f) => FORMAT_THEME[f]).filter(Boolean));
      const t = x.themes.find((k) => themes.includes(k));
      if (t) { score += 1; if (!why) why = 'Tem a ver com ' + label(D().ONB.THEMES, t).toLowerCase(); }
      if (p.goals.includes('series') && ['series', 'filmes', 'novelas', 'animes'].includes(x.format)) { score += 1; if (!why) why = 'Para ver sem legenda'; }
      const gap = Math.abs(x.cefr - cefrN); score += gap === 0 ? 1.5 : gap === 1 ? .5 : -1;
      if (x.locked) score -= 3;
      if (!why) why = gap === 0 ? 'No seu nível, ' + x.level : 'Para variar o repertório';
      return Object.assign({}, x, { score, why });
    }).sort((a, b) => b.score - a.score);
  }
  function rankAlbums(p) {
    return D().ALBUMS.map((k) => { let score = p.formats.includes('musica') ? 2 : 0; const g = k.genres.find((x) => p.genres.includes(x)); if (g) score += 2; return Object.assign({}, k, { score, why: g ? 'Porque você curte ' + GENRE_WORD(g) : p.formats.includes('musica') ? 'Porque você marcou música' : 'Músicas do curso' }); }).sort((a, b) => b.score - a.score);
  }
  const FOCUS = {
    listening: { t: 'Treinar o ouvido', b: 'Nesta semana o diálogo começa em 0,75× e as legendas ficam em inglês e português.', cta: 'Ouvir o diálogo', go: 'episodio/1/5' },
    speaking: { t: 'Falar sem travar', b: 'Cinco minutos por dia com {oA}, no modo treino. Ninguém dá nota, só dicas.', cta: 'Falar com {oA}', go: 'maggie' },
    pron: { t: 'O H de hello', b: 'O seu alvo é o /h/ inicial, que costuma sair como o R de “rato”. São 7 frases no Take the Mic.', cta: 'Treinar as frases', go: 'episodio/1/6' },
    grammar: { t: 'To be sem armadilha', b: 'A aula mostra o erro número um de quem fala português: o sujeito que some.', cta: 'Abrir a aula', go: 'episodio/1/7' },
    vocab: { t: 'Mais palavras, menos esforço', b: 'Palavras dos episódios e dos Extras que você viu, em sessões de 3 minutos.', cta: 'Revisar agora', go: 'revisao' },
    writing: { t: 'Frases curtas por escrito', b: 'O Take Action tem exercícios de completar e traduzir. Comece pelo episódio 1.', cta: 'Fazer os exercícios', go: 'episodio/1/9' },
    time: { t: 'Cinco minutos por vez', b: 'O episódio foi dividido em pedaços curtos. O lembrete toca no horário que você escolheu.', cta: 'Fazer 5 minutos agora', go: 'episodio/1' },
    shy: { t: 'Treino sem plateia', b: 'No modo treino {oA} não mostra nota. Errar ali não conta para nada.', cta: 'Conversar sem nota', go: 'maggie' }
  };
  // {oA} vira "a Maggie" / "o Robert", conforme o assistente escolhido no Mic.
  const focus = (p) => { const f = FOCUS[p.mainDiff || p.diffs[0]] || FOCUS.speaking, oA = TIE.assist.the(TIE.assist.get(p.assistant)), out = { k: p.mainDiff || p.diffs[0] || 'speaking' }; Object.keys(f).forEach((x) => { out[x] = String(f[x]).split('{oA}').join(oA); }); return out; };
  function missions(p) { const M = D().MAGGIE.MISSIONS; const keys = (p.goals.length ? p.goals : ['gente']).filter((k) => M[k]); if (!keys.length) keys.push('gente'); return keys.map((k) => Object.assign({ k }, M[k])); }
  function defaults(p) { const d = p.diffs || []; return { speed: d.includes('listening') ? 0.75 : 1, subs: d.includes('listening') ? 'both' : p.goals.includes('series') ? 'en' : 'both', training: d.includes('shy') || p.feedback === 'suave', micro: d.includes('time') || p.minutes <= 10 }; }
  function tutorContext(p) {
    const O = D().ONB;
    return { name: p.name, level: levelInfo(p).cefr, levelLabel: levelInfo(p).t, age: label(O.AGES, p.age), occupation: label(O.OCCUP, p.occup) + (p.area ? ' · ' + label(O.AREAS, p.area) : ''), goals: p.goals.map((k) => label(O.GOALS, k)), deadline: label(O.DEADLINES, p.deadline), formats: p.formats.map((k) => label(O.FORMATS, k)), genres: p.genres.map(GENRE_WORD), themes: p.themes.map((k) => label(O.THEMES, k)), difficulties: p.diffs.map((k) => label(O.DIFFS, k)), mainDifficulty: label(O.DIFFS, p.mainDiff), styles: (p.styles || []).map((k) => label(O.STYLES.map((s) => [s[0], s[1]]), k)), feedback: label(O.FEEDBACK, p.feedback), motives: (p.motives || []).map((k) => label(O.MOTIVES, k)), why: p.why || '', training: defaults(p).training };
  }
  function build(p) { if (!p) return null; return { level: levelInfo(p), extras: rankExtras(p), albums: rankAlbums(p), focus: focus(p), missions: missions(p), defaults: defaults(p), ctx: tutorContext(p) }; }
  // Horários de lembrete em ordem ("07:00", "20:30"…). Perfis antigos tinham um só, em p.remind.
  const reminders = (p) => (p ? (p.reminders || (p.remind ? [p.remind] : [])) : []).filter(Boolean).slice().sort();
  const hour = (t) => { const [h, m] = String(t).split(':'); return (+h) + 'h' + (m && m !== '00' ? m : ''); };
  TIE.personalize = { build, levelInfo, label, reminders, hour, FORMAT_WORD, GENRE_WORD };
})();
