import type {
  Album,
  ExtraMeta,
  FocusCard,
  LevelOption,
  Mission,
  OnboardingLists,
  PersonalizeMaps,
} from '../content/schema';
import type { Profile } from '../state';
import { type AssistantRef, assistantThe, getAssistant } from './assist';

// prototipo/js/core/personalize.js: onboarding profile → what the app shows and in which order.
// Pure; the catalog content comes in as an argument instead of TIE.data globals.

export const FORMAT_WORD: Readonly<Record<string, string>> = {
  series: 'séries',
  novelas: 'novelas',
  filmes: 'filmes',
  animes: 'animes',
  musica: 'música',
  games: 'games',
  viagens: 'viagens',
  artes: 'artes',
  business: 'business',
};

/** Viagens and Business are not screen formats: in EXTRA they pull titles with the matching theme. */
export const FORMAT_THEME: Readonly<Record<string, string>> = { viagens: 'viagem', business: 'negocios' };

/** Prototype FOCUS ("Foco da semana") per difficulty key; {oA} = "a Maggie" / "o Robert". */
export const FOCUS: Readonly<Record<string, FocusCard>> = {
  listening: {
    t: 'Treinar o ouvido',
    b: 'Nesta semana o diálogo começa em 0,75× e as legendas ficam em inglês e português.',
    cta: 'Ouvir o diálogo',
    go: 'episodio/1/5',
  },
  speaking: {
    t: 'Falar sem travar',
    b: 'Cinco minutos por dia com {oA}, no modo treino. Ninguém dá nota, só dicas.',
    cta: 'Falar com {oA}',
    go: 'maggie',
  },
  pron: {
    t: 'O H de hello',
    b: 'O seu alvo é o /h/ inicial, que costuma sair como o R de “rato”. São 7 frases no Take the Mic.',
    cta: 'Treinar as frases',
    go: 'episodio/1/6',
  },
  grammar: {
    t: 'To be sem armadilha',
    b: 'A aula mostra o erro número um de quem fala português: o sujeito que some.',
    cta: 'Abrir a aula',
    go: 'episodio/1/7',
  },
  vocab: {
    t: 'Mais palavras, menos esforço',
    b: 'Palavras dos episódios e dos Extras que você viu, em sessões de 3 minutos.',
    cta: 'Revisar agora',
    go: 'revisao',
  },
  writing: {
    t: 'Frases curtas por escrito',
    b: 'O Take Action tem exercícios de completar e traduzir. Comece pelo episódio 1.',
    cta: 'Fazer os exercícios',
    go: 'episodio/1/9',
  },
  time: {
    t: 'Cinco minutos por vez',
    b: 'O episódio foi dividido em pedaços curtos. O lembrete toca no horário que você escolheu.',
    cta: 'Fazer 5 minutos agora',
    go: 'episodio/1',
  },
  shy: {
    t: 'Treino sem plateia',
    b: 'No modo treino {oA} não mostra nota. Errar ali não conta para nada.',
    cta: 'Conversar sem nota',
    go: 'maggie',
  },
};

/** Profile fields read here; prototype profiles could lack styles/motives/why. */
export type PersonalizeProfile = Pick<
  Profile,
  | 'name'
  | 'level'
  | 'age'
  | 'occup'
  | 'area'
  | 'goals'
  | 'deadline'
  | 'formats'
  | 'genres'
  | 'themes'
  | 'diffs'
  | 'mainDiff'
  | 'feedback'
  | 'minutes'
  | 'assistant'
> &
  Partial<Pick<Profile, 'styles' | 'motives' | 'why'>>;

type Opt = { k: string | number; t: string };

export type PersonalizeLists = Pick<
  OnboardingLists,
  | 'levels'
  | 'ages'
  | 'occup'
  | 'areas'
  | 'goals'
  | 'deadlines'
  | 'formats'
  | 'genres'
  | 'themes'
  | 'diffs'
  | 'styles'
  | 'feedback'
  | 'motives'
>;

export type RankableExtra = Pick<ExtraMeta, 'id' | 'format' | 'genres' | 'themes' | 'cefr' | 'level' | 'locked'>;
export type RankableAlbum = Pick<Album, 'genres'>;
export type Ranked<T> = T & { score: number; why: string };

/** The catalog slice personalization reads (a full Catalog fits). */
export interface PersonalizeContent<X extends RankableExtra = ExtraMeta, A extends RankableAlbum = Album> {
  onboarding: PersonalizeLists;
  extras: readonly X[];
  albums: readonly A[];
  focus?: Readonly<Record<string, FocusCard>>;
  personalize?: PersonalizeMaps;
  mic: { missions: readonly Mission[] };
  assistants: readonly AssistantRef[];
}

/** Option label by key; falls back to the key itself. */
export function label(list: readonly Opt[] | undefined, k: string): string {
  const f = (list || []).find((x) => x.k === k);
  return f ? f.t : k;
}

/** Lowercased genre label, searching every format's list in catalog order. */
export function genreWord(genres: Readonly<Record<string, readonly Opt[]>>, k: string): string {
  for (const list of Object.values(genres)) {
    const f = list.find((g) => g.k === k);
    if (f) return f.t.toLowerCase();
  }
  return k;
}
/** Prototype name for genreWord. */
export const GENRE_WORD = genreWord;

export function levelInfo(levels: readonly LevelOption[], p: Pick<Profile, 'level'> | null | undefined): LevelOption {
  const l = levels.find((x) => x.k === p?.level) ?? levels[0];
  if (!l) throw new Error('level list is empty');
  return l;
}

const CEFR_N: Readonly<Record<string, number>> = { A1: 1, 'A1+': 1, A2: 2, B1: 3 };
const SCREEN_FORMATS = ['series', 'filmes', 'novelas', 'animes'];

export function rankExtras<X extends RankableExtra>(
  p: PersonalizeProfile,
  c: Pick<PersonalizeContent<X>, 'onboarding' | 'extras' | 'personalize'>,
): Ranked<X>[] {
  const O = c.onboarding;
  const formatWord = c.personalize?.formatWord ?? FORMAT_WORD;
  const formatTheme = c.personalize?.formatTheme ?? FORMAT_THEME;
  const cefrN = CEFR_N[levelInfo(O.levels, p).cefr] || 1;
  return c.extras
    .map((x) => {
      let score = 0;
      let why = '';
      if (p.formats.includes(x.format)) {
        score += 4;
        why = `Porque você curte ${formatWord[x.format]}`;
      }
      const g = x.genres.find((k) => p.genres.includes(k));
      if (g) {
        score += 2;
        why = why ? `${why} e ${genreWord(O.genres, g)}` : `Porque você marcou ${genreWord(O.genres, g)}`;
      }
      const themes = p.themes.concat(p.formats.map((f) => formatTheme[f]).filter((t): t is string => !!t));
      const t = x.themes.find((k) => themes.includes(k));
      if (t) {
        score += 1;
        if (!why) why = `Tem a ver com ${label(O.themes, t).toLowerCase()}`;
      }
      if (p.goals.includes('series') && SCREEN_FORMATS.includes(x.format)) {
        score += 1;
        if (!why) why = 'Para ver sem legenda';
      }
      const gap = Math.abs(x.cefr - cefrN);
      score += gap === 0 ? 1.5 : gap === 1 ? 0.5 : -1;
      if (x.locked) score -= 3;
      if (!why) why = gap === 0 ? `No seu nível, ${x.level}` : 'Para variar o repertório';
      return { ...x, score, why };
    })
    .sort((a, b) => b.score - a.score);
}

export function rankAlbums<A extends RankableAlbum>(
  p: PersonalizeProfile,
  c: Pick<PersonalizeContent<RankableExtra, A>, 'onboarding' | 'albums'>,
): Ranked<A>[] {
  return c.albums
    .map((k) => {
      let score = p.formats.includes('musica') ? 2 : 0;
      const g = k.genres.find((x) => p.genres.includes(x));
      if (g) score += 2;
      const why = g
        ? `Porque você curte ${genreWord(c.onboarding.genres, g)}`
        : p.formats.includes('musica')
          ? 'Porque você marcou música'
          : 'Músicas do curso';
      return { ...k, score, why };
    })
    .sort((a, b) => b.score - a.score);
}

export type FocusOut = FocusCard & { k: string };

/** Foco da semana for the main difficulty, with {oA} filled for the chosen assistant. */
export function focus(
  p: PersonalizeProfile,
  c: Pick<PersonalizeContent<RankableExtra, RankableAlbum>, 'focus' | 'assistants'>,
): FocusOut {
  const cards = c.focus ?? FOCUS;
  const key = p.mainDiff || p.diffs[0];
  const f = (key !== undefined ? cards[key] : undefined) ?? cards.speaking ?? FOCUS.speaking;
  if (!f) throw new Error('focus cards missing');
  const oA = assistantThe(getAssistant(c.assistants, p.assistant));
  const fill = (s: string) => String(s).split('{oA}').join(oA);
  return { k: p.mainDiff || p.diffs[0] || 'speaking', t: fill(f.t), b: fill(f.b), cta: fill(f.cta), go: fill(f.go) };
}

/** Mic missions for the profile goals, falling back to "gente". */
export function missions(p: Pick<Profile, 'goals'>, c: Pick<PersonalizeContent, 'mic'>): Mission[] {
  const byKey = new Map(c.mic.missions.map((m) => [m.k, m]));
  const keys = (p.goals.length ? p.goals : ['gente']).filter((k) => byKey.has(k));
  if (!keys.length) keys.push('gente');
  return keys.flatMap((k) => {
    const m = byKey.get(k);
    return m ? [m] : [];
  });
}

export interface Defaults {
  speed: number;
  subs: 'both' | 'en';
  training: boolean;
  micro: boolean;
}

export function defaults(p: Pick<PersonalizeProfile, 'diffs' | 'goals' | 'feedback' | 'minutes'>): Defaults {
  const d = p.diffs || [];
  return {
    speed: d.includes('listening') ? 0.75 : 1,
    subs: d.includes('listening') ? 'both' : p.goals.includes('series') ? 'en' : 'both',
    training: d.includes('shy') || p.feedback === 'suave',
    micro: d.includes('time') || p.minutes <= 10,
  };
}

export interface TutorContext {
  name: string;
  level: string;
  levelLabel: string;
  age: string;
  occupation: string;
  goals: string[];
  deadline: string;
  formats: string[];
  genres: string[];
  themes: string[];
  difficulties: string[];
  mainDifficulty: string;
  styles: string[];
  feedback: string;
  motives: string[];
  why: string;
  training: boolean;
}

/** Student context the tutor prompt gets (labels in pt-BR, not keys). */
export function tutorContext(
  p: PersonalizeProfile,
  c: Pick<PersonalizeContent<RankableExtra, RankableAlbum>, 'onboarding'>,
): TutorContext {
  const O = c.onboarding;
  const lv = levelInfo(O.levels, p);
  return {
    name: p.name,
    level: lv.cefr,
    levelLabel: lv.t,
    age: label(O.ages, p.age),
    occupation: label(O.occup, p.occup) + (p.area ? ` · ${label(O.areas, p.area)}` : ''),
    goals: p.goals.map((k) => label(O.goals, k)),
    deadline: label(O.deadlines, p.deadline),
    formats: p.formats.map((k) => label(O.formats, k)),
    genres: p.genres.map((k) => genreWord(O.genres, k)),
    themes: p.themes.map((k) => label(O.themes, k)),
    difficulties: p.diffs.map((k) => label(O.diffs, k)),
    mainDifficulty: label(O.diffs, p.mainDiff),
    styles: (p.styles || []).map((k) => label(O.styles, k)),
    feedback: label(O.feedback, p.feedback),
    motives: (p.motives || []).map((k) => label(O.motives, k)),
    why: p.why || '',
    training: defaults(p).training,
  };
}

export interface Personalization<X extends RankableExtra, A extends RankableAlbum> {
  level: LevelOption;
  extras: Ranked<X>[];
  albums: Ranked<A>[];
  focus: FocusOut;
  missions: Mission[];
  defaults: Defaults;
  ctx: TutorContext;
}

/** personalize.build(p). */
export function buildPersonalization<X extends RankableExtra, A extends RankableAlbum>(
  p: PersonalizeProfile,
  c: PersonalizeContent<X, A>,
): Personalization<X, A>;
export function buildPersonalization<X extends RankableExtra, A extends RankableAlbum>(
  p: PersonalizeProfile | null | undefined,
  c: PersonalizeContent<X, A>,
): Personalization<X, A> | null;
export function buildPersonalization<X extends RankableExtra, A extends RankableAlbum>(
  p: PersonalizeProfile | null | undefined,
  c: PersonalizeContent<X, A>,
): Personalization<X, A> | null {
  if (!p) return null;
  return {
    level: levelInfo(c.onboarding.levels, p),
    extras: rankExtras(p, c),
    albums: rankAlbums(p, c),
    focus: focus(p, c),
    missions: missions(p, c),
    defaults: defaults(p),
    ctx: tutorContext(p, c),
  };
}

/** Reminder times in order ("07:00", "20:30"…). Old profiles had a single p.remind. */
export function reminders(
  p: { reminders?: readonly string[] | null; remind?: string | null } | null | undefined,
): string[] {
  const list = p ? p.reminders || (p.remind ? [p.remind] : []) : [];
  return list.filter(Boolean).slice().sort();
}

/** "07:00" → "7h", "20:30" → "20h30". */
export function hour(t: string): string {
  const [h, m] = String(t).split(':');
  return `${Number(h)}h${m && m !== '00' ? m : ''}`;
}
