// Proves the content schemas fit the real prototype data after the transforms the seed will apply
// (deterministic ids, tuples → objects, media paths → URLs, closure constants via acorn).
import { beforeAll, describe, expect, it } from 'vitest';
import { TTS_SPEAKERS } from '../src/constants';
import { Album, Catalog, ContentManifest, Ebook, Episode, Extra, type OptionItem } from '../src/content/schema';
import { BadgeRule } from '../src/contracts/game';
import { type Any, extractConst, loadPrototypeData } from './helpers/prototype';

const url = (p: string | undefined | null) => (p ? `/m/media/00000000/${p.replace(/^assets\//, '')}` : null);
const pairs = (list: [string, string][]): OptionItem[] => list.map(([k, t]) => ({ k, t }));
const GO: Record<string, string> = { ep2: 'episodio/2', ebook1: 'ebook/1', home: 'inicio' };

let T: Any;
let D: Any;

beforeAll(() => {
  T = loadPrototypeData();
  D = T.data;
});

function episode(n: number) {
  const E = D.EPS[n];
  const gaps: string[] = D.EP_GAPS[n] ?? [];
  return {
    num: E.num,
    title: E.title,
    status: 'published',
    season: 1,
    ebook: E.ebook,
    ebookEps: E.ebookEps,
    ebookTitle: E.ebookTitle,
    scope: E.scope,
    synopsis: E.synopsis,
    introAudio: url(E.introAudio),
    songAudio: url(E.songAudio),
    songTitle: E.songTitle,
    sceneVideo: url(E.sceneVideo),
    sceneImage: url(n === 2 ? 'assets/img/gen/scene/cafe-counter.webp' : 'assets/img/gen/bg/home.webp'),
    sceneNote: E.sceneNote,
    lyrics: E.lyrics.map((l: Any, i: number) => ({ ...l, ...(gaps[i] ? { gap: gaps[i] } : {}) })),
    cast: E.cast,
    visual: E.visual,
    dialogTitle: E.dialogTitle,
    dialogSub: E.dialogSub,
    dialog: E.dialog,
    mic: E.mic.map((m: Any, i: number) => ({ id: `e${n}-mic-${i}`, ...m })),
    lesson: E.lesson,
    pron: E.pron ?? null,
    awayExp: E.awayExp,
    awayWords: E.awayWords,
    ex: E.ex.map((x: Any, i: number) => ({
      id: `e${n}-ex${i}`,
      ...x,
      items: x.items.map((it: Any, j: number) => ({ id: `e${n}-ex${i}-i${j}`, ...it })),
    })),
    done: { ...E.done, go: GO[E.done.go] },
  };
}

function extra(x: Any) {
  return {
    ...x,
    cover: url(x.cover),
    scene: url(x.scene),
    cast: x.cast.map(([name, initials, color]: string[]) => ({ name, initials, color })),
    premiere: !!x.premiere,
    locked: !!x.locked,
    premium: false,
    vocab: x.vocab.map(([en, pt]: string[]) => ({ en, pt })),
  };
}

function albums() {
  return D.ALBUMS.map((a: Any) => ({
    ...a,
    img: url(a.img),
    tracks: a.tracks.map((t: Any, i: number) => ({
      id: `${a.id}-t${i}`,
      title: t.title,
      from: t.from,
      audio: url(t.audio),
      ...(t.ep ? { ep: t.ep } : {}),
      ...(t.bpm ? { bpm: t.bpm } : {}),
      ...(t.key !== undefined ? { key: t.key } : {}),
      lines:
        t.lines ??
        D.EPS[t.ep].lyrics.map((l: Any, j: number) => ({
          en: l.en,
          pt: l.pt,
          gap: D.EP_GAPS[t.ep]?.[j] ?? l.en.split(' ')[0],
        })),
    })),
  }));
}

describe('prototype content fits the schemas', () => {
  it('episodes 1, 2 and 5', () => {
    for (const n of [1, 2, 5]) {
      const r = Episode.safeParse(episode(n));
      expect(r.success, JSON.stringify(r.error?.issues?.slice(0, 3))).toBe(true);
    }
  });

  it('e-book 1 with its 20-question test', () => {
    const eb = {
      num: 1,
      title: 'Nice to Meet You',
      epsLabel: '1–2',
      scope: D.EB1_SCOPE,
      episodes: [1, 2],
      five: D.FIVE,
      real: D.REAL,
      lead: D.LEAD,
      chat: D.CHAT,
      extrasCards: extractConst('js/screens/curso.js', 'EXTRAS_EB'),
      pdf: null,
      passScore: 14,
      test: D.TEST.map((p: Any) => ({
        title: p.title,
        qs: p.qs.map((q: Any) => ({ id: `eb1-t${q.n}`, ...q, step: q.step ?? 7 })),
      })),
      teaser: { title: 'O almoço de domingo está na mesa, e o Robert ainda não contou a novidade.', sub: 'E-book 2' },
    };
    const r = Ebook.safeParse(eb);
    expect(r.success, JSON.stringify(r.error?.issues?.slice(0, 3))).toBe(true);
    expect(r.data?.test.flatMap((p) => p.qs)).toHaveLength(20);
  });

  it('every extra (including locked ones) and album', () => {
    for (const x of D.EXTRAS) {
      const r = Extra.safeParse(extra(x));
      expect(r.success, `${x.id}: ${JSON.stringify(r.error?.issues?.slice(0, 3))}`).toBe(true);
    }
    for (const a of albums()) expect(Album.safeParse(a).success, a.id).toBe(true);
  });

  it('a full catalog, with closure constants extracted by acorn', () => {
    const O = D.ONB;
    const M = D.MAGGIE;
    const SEASONS: string[] = extractConst('js/screens/curso.js', 'SEASONS');
    const FOCUS = extractConst('js/core/personalize.js', 'FOCUS');
    const POINTS = extractConst('js/core/game.js', 'POINTS');
    const LEVELS: [number, string][] = extractConst('js/core/game.js', 'LEVELS');
    const BADGES: Any[] = extractConst('js/core/game.js', 'BADGES');
    const GRADES: [string, string, number][] = extractConst('js/core/review.js', 'GRADES', { MIN: 6e4, DAY: 864e5 });
    const SHELVES: [string, string][] = extractConst('js/screens/extra.js', 'SHELVES');

    const catalog = {
      version: 'test',
      steps: D.STEPS,
      seasons: SEASONS.map((title, i) => ({ n: i + 1, title, synopsis: null })),
      titles: D.TITLES,
      episodes: D.TITLES.map((title: string, i: number) => ({
        num: i + 1,
        title,
        status: [1, 2, 5].includes(i + 1) ? 'published' : 'title_only',
        season: 1,
        ebook: Math.ceil((i + 1) / 2),
      })),
      ebooks: [
        { num: 1, title: 'Nice to Meet You', epsLabel: '1–2', scope: D.EB1_SCOPE, episodes: [1, 2], available: true },
      ],
      cast: Object.fromEntries(
        Object.entries(D.CAST as Record<string, [string, string]>).map(([k, [initials, color]]) => [
          k,
          { initials, color },
        ]),
      ),
      onboarding: {
        steps: O.STEPS,
        ages: pairs(O.AGES),
        occup: pairs(O.OCCUP),
        areas: pairs(O.AREAS),
        levels: O.LEVELS,
        goals: O.GOALS,
        deadlines: pairs(O.DEADLINES),
        history: pairs(O.HISTORY),
        fails: pairs(O.FAILS),
        formats: O.FORMATS.map((f: Any) => ({ k: f.k, t: f.t, img: url(f.img) })),
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
      focus: FOCUS,
      personalize: {
        formatWord: extractConst('js/core/personalize.js', 'FORMAT_WORD'),
        formatTheme: extractConst('js/core/personalize.js', 'FORMAT_THEME'),
      },
      assistants: D.ASSISTANTS.map((a: Any) => ({
        k: a.k,
        name: a.name,
        full: a.full,
        art: a.art,
        age: a.age,
        aka: a.aka,
        role: a.role,
        tag: a.tag,
        style: a.style,
        hello: a.hello,
        voice: { ...a.voice, tts: TTS_SPEAKERS[a.k] },
        poster: url(`assets/img/gen/avatar/as-${a.k}-poster.webp`),
        thumb: url(`assets/img/gen/avatar/as-${a.k}-thumb.webp`),
        clips: Object.fromEntries(a.clips.map((c: string) => [c, url(`assets/video/mic/${a.k}-${c}.mp4`)])),
      })),
      extras: D.EXTRAS.map((x: Any) => {
        const { lines: _l, vocab: _v, ...meta } = extra(x);
        return meta;
      }),
      extrasShelves: SHELVES.map(([k, t]) => ({ k, t })),
      albums: albums(),
      mic: {
        modes: M.MODES,
        openers: M.OPENERS,
        follow: M.FOLLOW,
        missions: Object.entries(M.MISSIONS).map(([k, m]: [string, Any]) => ({
          k,
          ...m,
          turns: m.turns.map((t: Any) => ({ ...t, words: t.words.map(([en, pt]: string[]) => ({ en, pt })) })),
        })),
        pron: M.PRON.map((p: Any, i: number) => ({ id: `pron-${i}`, ...p })),
        help: M.HELP,
      },
      game: {
        points: POINTS,
        levels: LEVELS.map(([min, name], i) => ({ n: i + 1, min, name })),
        badges: BADGES.map((b) => ({ id: b.id, t: b.t, s: b.s, icon: b.icon })),
      },
      srs: { grades: GRADES.map(([label, hint, ms]) => ({ label, hint, ms })) },
    };
    const r = Catalog.safeParse(catalog);
    expect(r.success, JSON.stringify(r.error?.issues?.slice(0, 5))).toBe(true);
    expect(r.data?.game.badges).toHaveLength(14);
  });

  it('badge rules cover the 14 prototype badges', () => {
    const rules: Record<string, unknown> = {
      'first-step': { type: 'count', kind: 'step', min: 1 },
      'first-episode': { type: 'count', kind: 'episode', min: 1 },
      'first-talk': { type: 'count', kind: 'maggie_turn', min: 1 },
      'talk-10': { type: 'count', kind: 'maggie_turn', min: 10 },
      'mic-8': { type: 'count', kind: 'mic_good', min: 1 },
      cinema: { type: 'count', kind: 'extra', min: 1 },
      dub: { type: 'count', kind: 'dub', min: 1 },
      'cards-20': { type: 'count', kind: 'card', min: 20 },
      'streak-3': { type: 'streak', min: 3 },
      'streak-7': { type: 'streak', min: 7 },
      'pts-500': { type: 'points', min: 500 },
      test: { type: 'count', kind: 'test_pass', min: 1 },
      song: { type: 'count', kind: 'song', min: 1 },
      'goal-5': { type: 'goal_days', min: 5 },
    };
    const BADGES: Any[] = extractConst('js/core/game.js', 'BADGES');
    for (const b of BADGES) expect(BadgeRule.safeParse(rules[b.id]).success, b.id).toBe(true);
  });

  it('manifest shape', () => {
    expect(
      ContentManifest.safeParse({
        version: 'a'.repeat(64),
        publishedAt: 1,
        files: { catalog: 'catalog.json', episodes: [1, 2, 5], ebooks: [1], extras: ['woods-and-beans'] },
      }).success,
    ).toBe(true);
  });
});
