// Prototype data (TIE.data) → the TS content shapes the domain/demo ports take, the same transforms
// the seed applies (tuples → objects, deterministic ids). Asset paths are kept as-is so outputs
// compare 1:1 with the prototype's.
import type {
  AssistantPublic,
  ExtraMeta,
  FocusCard,
  LevelOption,
  MicCatalog,
  Mission,
  OnboardingLists,
  OptionItem,
  Step,
} from '../../src/content/schema';
import { type Any, extractConst } from './prototype';

const pairs = (list: [string, string][]): OptionItem[] => list.map(([k, t]) => ({ k, t }));

export interface TsContent {
  onboarding: OnboardingLists;
  extras: (ExtraMeta & { scene: string })[];
  albums: { id: string; genres: string[] }[];
  focus: Record<string, FocusCard>;
  personalize: { formatWord: Record<string, string>; formatTheme: Record<string, string> };
  mic: MicCatalog;
  assistants: Pick<AssistantPublic, 'k' | 'name' | 'art' | 'aka'>[];
  steps: Step[];
  episodes: number[];
}

export function tsContent(D: Any): TsContent {
  const O = D.ONB;
  const M = D.MAGGIE;
  return {
    onboarding: {
      steps: O.STEPS,
      ages: pairs(O.AGES),
      occup: pairs(O.OCCUP),
      areas: pairs(O.AREAS),
      levels: O.LEVELS as LevelOption[],
      goals: O.GOALS,
      deadlines: pairs(O.DEADLINES),
      history: pairs(O.HISTORY),
      fails: pairs(O.FAILS),
      formats: O.FORMATS.map((f: Any) => ({ k: f.k, t: f.t, img: f.img })),
      genres: Object.fromEntries(Object.entries(O.GENRES).map(([k, v]) => [k, pairs(v as [string, string][])])),
      themes: pairs(O.THEMES),
      diffs: O.DIFFS,
      styles: O.STYLES.map(([k, t, icon]: string[]) => ({ k, t, icon })),
      company: pairs(O.COMPANY),
      feedback: pairs(O.FEEDBACK),
      days: O.DAYS,
      minutes: O.MINUTES.map(([k, t]: [number, string]) => ({ k, t })),
      remindMax: O.REMIND_MAX,
      motives: pairs(O.MOTIVES),
    },
    extras: D.EXTRAS.map((x: Any) => ({
      id: x.id,
      title: x.title,
      kind: x.kind,
      format: x.format,
      genres: x.genres,
      themes: x.themes,
      level: x.level,
      cefr: x.cefr,
      ep: x.ep,
      dur: x.dur,
      cover: x.cover,
      scene: x.scene,
      synopsis: x.synopsis,
      cast: x.cast.map(([name, initials, color]: string[]) => ({ name, initials, color })),
      dub: x.dub,
      premiere: !!x.premiere,
      locked: !!x.locked,
      premium: false,
    })),
    albums: D.ALBUMS.map((a: Any) => ({ id: a.id, genres: a.genres })),
    focus: extractConst('js/core/personalize.js', 'FOCUS'),
    personalize: {
      formatWord: extractConst('js/core/personalize.js', 'FORMAT_WORD'),
      formatTheme: extractConst('js/core/personalize.js', 'FORMAT_THEME'),
    },
    mic: {
      modes: M.MODES,
      openers: M.OPENERS,
      follow: M.FOLLOW,
      missions: Object.entries(M.MISSIONS).map(
        ([k, m]: [string, Any]): Mission => ({
          k,
          t: m.t,
          role: m.role,
          goal: m.goal,
          turns: m.turns.map((t: Any) => ({ ...t, words: t.words.map(([en, pt]: string[]) => ({ en, pt })) })),
        }),
      ),
      pron: M.PRON.map((p: Any, i: number) => ({ id: `pron-${i}`, ...p })),
      help: M.HELP,
    },
    assistants: D.ASSISTANTS.map((a: Any) => ({ k: a.k, name: a.name, art: a.art, aka: a.aka })),
    steps: D.STEPS,
    episodes: Object.keys(D.EPS).map(Number),
  };
}

/** An episode with the stable ids state v7 uses (e1-mic-0, e1-ex0-i3). */
export function tsEpisode(D: Any, n: number) {
  const E = D.EPS[n];
  return {
    num: E.num as number,
    ebook: E.ebook as number,
    sceneVideo: (E.sceneVideo as string) || null,
    visual: E.visual,
    awayExp: E.awayExp,
    mic: E.mic.map((_m: Any, i: number) => ({ id: `e${n}-mic-${i}` })),
    ex: E.ex.map((x: Any, i: number) => ({
      id: `e${n}-ex${i}`,
      items: x.items.map((_it: Any, j: number) => ({ id: `e${n}-ex${i}-i${j}` })),
    })),
  };
}
