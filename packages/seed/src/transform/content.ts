// Prototype TIE.data + extracted constants → content table rows (the exact shape compile reads).
// Tuples become objects, positional items get stable ids, EP_GAPS fold into lyrics, asset paths
// become media ids. All 20 TITLES become episodes; only the scripted ones are published.

import { TTS_SPEAKERS } from '@tie/shared/constants';
import type {
  AlbumRowDb,
  AssistantClipRowDb,
  AssistantRowDb,
  BlobRowDb,
  ContentRows,
  EbookRowDb,
  EpisodeRowDb,
  ExerciseItemRowDb,
  ExerciseRowDb,
  ExtraRowDb,
  MicPhraseRowDb,
  MissionRowDb,
  OnboardingMetaBlob,
  OptionRowDb,
  SceneImagesBlob,
  TestQuestionRowDb,
  TrackRowDb,
} from '@tie/shared/content/compile';
import { norm } from '@tie/shared/domain/norm';
import type { Extracted } from '../extract';
import type { Any } from '../loadPrototype';
import { ids } from './ids';
import { type MediaIndex, mediaRow } from './media';

const json = (v: unknown): string => JSON.stringify(v);
const b = (v: unknown): number => (v ? 1 : 0);

/** Episodes with a full script in the prototype. */
export const PUBLISHED_EPISODES = [1, 2, 5] as const;
export const SEASON_OF_ALL_EPISODES = 1;
export const EBOOK_COUNT = 10;
export const EPISODES_PER_EBOOK = 2;

/** The prototype's done.go shortcuts → hash routes (curso.js concluido). */
const DONE_GO: Record<string, string> = { ep2: 'episodio/2/1', ebook1: 'ebook/1', home: 'inicio' };

export const ebookOfEpisode = (num: number): number => Math.ceil(num / EPISODES_PER_EBOOK);

export interface SeedContent extends ContentRows {}

export function buildContent(D: Any, X: Extracted, media: MediaIndex, now: number): SeedContent {
  const updated_at = now;

  // ----- Course structure -----
  const steps = (D.STEPS as Any[]).map((s) => ({ n: s.n, name: s.name, pt: s.pt, group_label: s.group ?? null }));
  const seasons = X.SEASONS.map((title, i) => ({
    n: i + 1,
    title,
    synopsis: i + 1 === SEASON_OF_ALL_EPISODES ? X.seasonSynopsis : null,
  }));
  const cast_members = Object.entries(D.CAST as Record<string, [string, string]>).map(([name, [initials, color]]) => ({
    name,
    initials,
    color,
  }));

  // ----- Episodes -----
  const episodes: EpisodeRowDb[] = [];
  const mic_phrases: MicPhraseRowDb[] = [];
  const exercises: ExerciseRowDb[] = [];
  const exercise_items: ExerciseItemRowDb[] = [];
  const titles = D.TITLES as string[];
  titles.forEach((title, i) => {
    const num = i + 1;
    const E = D.EPS[num];
    const base: EpisodeRowDb = {
      num,
      title,
      season_n: SEASON_OF_ALL_EPISODES,
      status: 'title_only',
      ebook_num: ebookOfEpisode(num),
      synopsis: null,
      intro_media: null,
      song_media: null,
      song_title: null,
      scene_media: null,
      scene_note: null,
      dialog_title: null,
      dialog_sub: null,
      lyrics: '[]',
      cast_names: '[]',
      visual: '[]',
      dialog: '[]',
      lesson: '[]',
      pron: null,
      away_exp: '[]',
      away_words: '[]',
      done: null,
      updated_at,
      updated_by: null,
    };
    if (!E) {
      episodes.push(base);
      return;
    }
    if (E.title !== title) throw new Error(`episode ${num}: EPS title "${E.title}" differs from TITLES "${title}"`);
    if (E.ebook !== ebookOfEpisode(num))
      throw new Error(`episode ${num}: e-book ${E.ebook} breaks the 2-per-e-book rule`);
    const gaps: string[] = D.EP_GAPS?.[num] ?? [];
    const done = { ...E.done, go: DONE_GO[E.done.go] ?? E.done.go };
    episodes.push({
      ...base,
      status: (PUBLISHED_EPISODES as readonly number[]).includes(num) ? 'published' : 'draft',
      synopsis: E.synopsis ?? null,
      intro_media: media.id(E.introAudio),
      song_media: media.id(E.songAudio),
      song_title: E.songTitle ?? null,
      scene_media: media.id(E.sceneVideo),
      scene_note: E.sceneNote ?? null,
      dialog_title: E.dialogTitle ?? null,
      dialog_sub: E.dialogSub ?? null,
      lyrics: json(
        (E.lyrics as Any[]).map((l, j) => ({
          id: ids.lyric(num, j),
          en: l.en,
          pt: l.pt,
          ...(gaps[j] ? { gap: gaps[j] } : {}),
        })),
      ),
      cast_names: json(E.cast ?? []),
      visual: json((E.visual as Any[]).map((v, j) => ({ id: ids.visual(num, j), en: v.en, pt: v.pt }))),
      dialog: json((E.dialog as Any[]).map((d, j) => ({ id: ids.dialog(num, j), ...d }))),
      lesson: json(E.lesson ?? []),
      pron: E.pron ? json(E.pron) : null,
      away_exp: json(E.awayExp ?? []),
      away_words: json(E.awayWords ?? []),
      done: json(done),
    });
    (E.mic as Any[]).forEach((m, j) => {
      mic_phrases.push({
        id: ids.micPhrase(num, j),
        episode_num: num,
        sort: j,
        en: m.en,
        tip: m.tip ?? null,
        demo_result: m.result ?? null,
        blue: b(m.blue),
        fb: m.fb ?? null,
      });
    });
    (E.ex as Any[]).forEach((x, xi) => {
      const exId = ids.exercise(num, xi);
      exercises.push({
        id: exId,
        episode_num: num,
        sort: xi,
        kind: x.kind,
        title: x.title,
        intro: x.intro ?? null,
        audio: x.audio ?? null,
        audio_label: x.audioLabel ?? null,
      });
      (x.items as Any[]).forEach((it, j) => {
        exercise_items.push({
          id: ids.exerciseItem(num, xi, j),
          exercise_id: exId,
          sort: j,
          q: it.q,
          opts: json(it.opts),
          answer_idx: it.a,
          fix: it.fix ?? null,
          say: it.say ?? null,
        });
      });
    });
  });
  for (const n of Object.keys(D.EPS).map(Number)) {
    if (!titles[n - 1]) throw new Error(`EPS has episode ${n} but TITLES does not`);
  }

  // ----- E-books (1..10, two episodes each; e-book 1 has the prototype's extras and test) -----
  const scopeOf = (n: number): string | null => {
    if (n === 1) return D.EB1_SCOPE;
    const ep = [n * 2 - 1, n * 2].map((e) => D.EPS[e]).find(Boolean);
    return ep?.scope ?? null;
  };
  const ebooks: EbookRowDb[] = Array.from({ length: EBOOK_COUNT }, (_, i) => {
    const n = i + 1;
    const one = n === 1;
    return {
      num: n,
      title: X.ebookTitles[n] ?? '',
      eps_label: `${n * 2 - 1}–${n * 2}`,
      scope: scopeOf(n),
      five: json(one ? D.FIVE : []),
      real: json(one ? D.REAL : []),
      lead: json(one ? D.LEAD : []),
      chat: json(one ? D.CHAT : []),
      extras_cards: json(one ? X.EXTRAS_EB : []),
      pdf_media: null,
      pass_score: 14,
      updated_at,
    };
  });
  for (const e of episodes) {
    const E = D.EPS[e.num];
    if (E?.ebookTitle && ebooks[(e.ebook_num ?? 0) - 1]?.title.toUpperCase() !== E.ebookTitle) {
      throw new Error(`episode ${e.num}: ebookTitle "${E.ebookTitle}" does not match the Trilha e-book title`);
    }
  }
  const ebook_test_questions: TestQuestionRowDb[] = (D.TEST as Any[]).flatMap((part, partIdx) =>
    (part.qs as Any[]).map((q) => ({
      id: ids.testQuestion(1, q.n),
      ebook_num: 1,
      part_idx: partIdx,
      part_title: part.title,
      n: q.n,
      q: q.q,
      rev: q.rev ?? null,
      ep_num: q.ep ?? null,
      step: q.step ?? 7,
      opts: q.opts ? json(q.opts) : null,
      answer_idx: q.opts ? q.a : null,
      accept: q.acc ? json((q.acc as string[]).map(norm)) : null,
      show: q.show ?? null,
      audio: q.audio ?? null,
    })),
  );

  // ----- Extras and albums -----
  const extras: ExtraRowDb[] = (D.EXTRAS as Any[]).map((x, i) => ({
    id: x.id,
    title: x.title,
    kind: x.kind ?? null,
    format: x.format,
    genres: json(x.genres ?? []),
    themes: json(x.themes ?? []),
    level: x.level ?? null,
    cefr: x.cefr ?? null,
    ep_label: x.ep ?? null,
    dur: x.dur ?? null,
    cover_media: media.id(x.cover),
    scene_media: media.id(x.scene),
    synopsis: x.synopsis ?? null,
    cast_list: json(
      (x.cast as [string, string, string][]).map(([name, initials, color]) => ({ name, initials, color })),
    ),
    dub: x.dub ?? null,
    premiere: b(x.premiere),
    locked: b(x.locked),
    premium: 0,
    lines: json(x.lines ?? []),
    vocab: json((x.vocab as [string, string][]).map(([en, pt]) => ({ en, pt }))),
    sort: i,
    status: 'published',
  }));
  const albums: AlbumRowDb[] = (D.ALBUMS as Any[]).map((a, i) => ({
    id: a.id,
    title: a.title,
    sub: a.sub ?? null,
    level: a.level ?? null,
    img_media: media.id(a.img),
    genres: json(a.genres ?? []),
    sort: i,
  }));
  const album_tracks: TrackRowDb[] = (D.ALBUMS as Any[]).flatMap((a) =>
    (a.tracks as Any[]).map((t, j) => ({
      id: ids.track(a.id, j),
      album_id: a.id,
      sort: j,
      title: t.title,
      src_from: t.from ?? null,
      audio_media: media.id(t.audio),
      ep_num: t.ep ?? null,
      bpm: t.bpm ?? null,
      music_key: t.key ?? null,
      // Episode tracks sing the episode lyrics (compile inlines them with the gaps).
      lines: t.lines ? json(t.lines) : null,
    })),
  );

  // ----- Assistants -----
  const assistants: AssistantRowDb[] = (D.ASSISTANTS as Any[]).map((a, i) => {
    const { tts: _browserHd, ...voice } = a.voice;
    const speaker = TTS_SPEAKERS[a.k];
    if (!speaker) throw new Error(`assistant ${a.k} has no TTS speaker`);
    const poster = `assets/img/gen/avatar/as-${a.k}-poster.webp`;
    const thumb = `assets/img/gen/avatar/as-${a.k}-thumb.webp`;
    return {
      key: a.k,
      name: a.name,
      full_name: a.full,
      art: a.art,
      age: a.age ?? null,
      aka: json(a.aka ?? []),
      role: a.role ?? null,
      tag: a.tag ?? null,
      style: a.style ?? null,
      hello_en: a.hello?.en ?? null,
      hello_pt: a.hello?.pt ?? null,
      voice: json(voice),
      tts_speaker: speaker,
      persona: a.persona ?? '',
      poster_media: media.has(poster) ? media.id(poster) : null,
      thumb_media: media.has(thumb) ? media.id(thumb) : null,
      sort: i,
      active: 1,
    };
  });
  const assistant_clips: AssistantClipRowDb[] = (D.ASSISTANTS as Any[]).flatMap((a) =>
    (a.clips as string[]).map((state) => ({
      assistant_key: a.k,
      state,
      media_id: media.id(`assets/video/mic/${a.k}-${state}.mp4`) as string,
    })),
  );

  // ----- Mic -----
  const M = D.MAGGIE;
  const mic_missions: MissionRowDb[] = Object.entries(M.MISSIONS as Record<string, Any>).map(([key, m], i) => ({
    key,
    title: m.t,
    role: m.role ?? null,
    goal: m.goal ?? null,
    turns: json(
      (m.turns as Any[]).map((t) => ({
        en: t.en,
        pt: t.pt,
        words: (t.words as [string, string][]).map(([en, pt]) => ({ en, pt })),
        ...(t.end ? { end: true } : {}),
      })),
    ),
    sort: i,
  }));

  // ----- Blobs -----
  const sceneImages: SceneImagesBlob = {
    default: media.id(X.sceneImages.default),
    episodes: Object.fromEntries(
      Object.entries(X.sceneImages.episodes).map(([n, ref]) => [n, media.id(ref) as string]),
    ),
  };
  const uiImages: Record<string, string> = {};
  const uiKey = (ref: string) =>
    ref
      .replace(/^assets\/img\/gen\//, '')
      .replace(/^assets\//, '')
      .replace(/\.\w+$/, '');
  for (const ref of X.hardcodedAssets) uiImages[uiKey(ref)] = media.id(ref) as string;
  for (const f of media.under(`${X.avatarDir}user-`)) uiImages[uiKey(`assets/${f.rel}`)] = f.id;
  const blobs: Record<string, unknown> = {
    focus: X.FOCUS,
    personalize: { formatWord: X.FORMAT_WORD, formatTheme: X.FORMAT_THEME },
    extras_shelves: X.SHELVES.map(([k, t]) => ({ k, t })),
    srs_grades: X.GRADES.map(([label, hint, ms]) => ({ label, hint, ms })),
    mic_modes: M.MODES,
    mic_openers: M.OPENERS,
    mic_follow: M.FOLLOW,
    mic_pron: (M.PRON as Any[]).map((p, i) => ({ id: ids.pron(i), en: p.en, target: p.target, tip: p.tip })),
    mic_help: M.HELP,
    ebook_teasers: { 1: X.ebookTeaser },
    scene_images: sceneImages,
    ui_images: uiImages,
    onboarding_meta: { remindMax: D.ONB.REMIND_MAX } satisfies OnboardingMetaBlob,
  };
  const content_blobs: BlobRowDb[] = Object.entries(blobs).map(([key, v]) => ({
    key,
    json: json(v),
    updated_at,
    updated_by: null,
  }));

  return {
    media: media.files.map((f) => mediaRow(f, now)),
    steps,
    seasons,
    cast_members,
    episodes,
    mic_phrases,
    exercises,
    exercise_items,
    ebooks,
    ebook_test_questions,
    extras,
    albums,
    album_tracks,
    assistants,
    assistant_clips,
    mic_missions,
    content_blobs,
    option_lists: buildOptionLists(D.ONB, media),
    point_rules: [],
    levels: [],
    badges: [],
  };
}

function each<T>(list: readonly T[], fn: (item: T, index: number) => void): void {
  for (let i = 0; i < list.length; i++) fn(list[i] as T, i);
}

/** Onboarding lists → option_lists rows; GENRES rows are scoped by format (keys repeat across formats). */
export function buildOptionLists(O: Any, media: MediaIndex): OptionRowDb[] {
  const rows: OptionRowDb[] = [];
  const add = (
    list_key: string,
    item_key: string,
    sort: number,
    label: string,
    more: Partial<Pick<OptionRowDb, 'scope' | 'sub' | 'icon' | 'img_media' | 'extra'>> = {},
  ): void => {
    rows.push({
      list_key,
      scope: more.scope ?? '',
      item_key,
      sort,
      label,
      sub: more.sub ?? null,
      icon: more.icon ?? null,
      img_media: more.img_media ?? null,
      extra: more.extra ?? null,
    });
  };
  const pairs = (key: string, list: [string, string][]) => each(list, ([k, t], i) => add(key, k, i, t));

  each(O.STEPS as Any[], (s, i) =>
    add('onb_steps', s.k, i, s.t, { sub: s.s, extra: json({ h: s.h, ...(s.skip ? { skip: true } : {}) }) }),
  );
  pairs('ages', O.AGES);
  pairs('occup', O.OCCUP);
  pairs('areas', O.AREAS);
  each(O.LEVELS as Any[], (l, i) =>
    add('levels', l.k, i, l.t, { sub: l.s, extra: json({ season: l.season, cefr: l.cefr }) }),
  );
  each(O.QUIZ as Any[], (q, i) => add('quiz', `q${i}`, i, q.q, { extra: json({ opts: q.opts, a: q.a }) }));
  each(O.GOALS as Any[], (g, i) => add('goals', g.k, i, g.t, { sub: g.s, icon: g.icon }));
  pairs('deadlines', O.DEADLINES);
  pairs('history', O.HISTORY);
  pairs('fails', O.FAILS);
  each(O.FORMATS as Any[], (f, i) => add('formats', f.k, i, f.t, { img_media: media.id(f.img) }));
  for (const [format, list] of Object.entries(O.GENRES as Record<string, [string, string][]>)) {
    each(list, ([k, t], i) => add('genres', k, i, t, { scope: format }));
  }
  pairs('themes', O.THEMES);
  each(O.DIFFS as Any[], (d, i) => add('diffs', d.k, i, d.t, { icon: d.icon }));
  each(O.STYLES as [string, string, string][], ([k, t, icon], i) => add('styles', k, i, t, { icon }));
  pairs('company', O.COMPANY);
  pairs('feedback', O.FEEDBACK);
  each(O.DAYS as string[], (d, i) => add('days', String(i), i, d));
  each(O.MINUTES as [number, string][], ([k, t], i) => add('minutes', String(k), i, t));
  pairs('motives', O.MOTIVES);
  return rows;
}
