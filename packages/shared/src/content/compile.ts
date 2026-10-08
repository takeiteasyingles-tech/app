// Content compiler: D1 content rows → the Zod-validated JSON snapshots published to R2 under
// content/{ver}/ (catalog.json, ep/{n}.json, ebook/{n}.json, extra/{id}.json) plus their manifest.
// Pure and runtime-neutral (Workers, Node, browser): the seed calls it from Node, the admin publish
// route from the admin Worker. Media ids become '/m/<r2_key>' URLs; assistant personas never leave.
//
// The version is the sha256 (hex) of every file's canonical text, computed with catalog.version = ''
// and then written into the catalog, so republishing identical content yields the same version.

import type { z } from 'zod';
import { mediaUrl } from '../contracts/content';
import {
  type Album,
  type AssistantPublic,
  type Block,
  Catalog,
  CONTENT_FILES,
  type ContentManifest,
  ContentManifest as ContentManifestSchema,
  Ebook,
  type EbookIndexEntry,
  Episode,
  type EpisodeIndexEntry,
  Extra,
  type ExtraMeta,
  type MicCatalog,
  type OnboardingLists,
  type OptionItem,
  POINT_KINDS,
  type PointKind,
  type TestPart,
  type TestQuestion,
} from './schema';

// ---------- Row shapes (D1 columns as `SELECT *` returns them: JSON columns are text) ----------

type Text = string | null;
type Num = number | null;

export interface MediaRowDb {
  id: string;
  r2_key: string;
  kind: string;
  mime: string;
  bytes: number;
  sha256: string;
  width?: Num;
  height?: Num;
  duration_ms?: Num;
  source_path?: Text;
  created_at: number;
}
export interface StepRowDb {
  n: number;
  name: string;
  pt: string;
  group_label: Text;
}
export interface SeasonRowDb {
  n: number;
  title: string;
  synopsis: Text;
}
export interface CastRowDb {
  name: string;
  initials: string;
  color: string;
}
export interface EpisodeRowDb {
  num: number;
  title: string;
  season_n: Num;
  status: string;
  ebook_num: Num;
  synopsis: Text;
  intro_media: Text;
  song_media: Text;
  song_title: Text;
  scene_media: Text;
  scene_note: Text;
  dialog_title: Text;
  dialog_sub: Text;
  lyrics: string;
  cast_names: string;
  visual: string;
  dialog: string;
  lesson: string;
  pron: Text;
  away_exp: string;
  away_words: string;
  done: Text;
  updated_at: number;
  updated_by?: Text;
}
export interface MicPhraseRowDb {
  id: string;
  episode_num: number;
  sort: number;
  en: string;
  tip: Text;
  demo_result: Num;
  blue: number;
  fb: Text;
}
export interface ExerciseRowDb {
  id: string;
  episode_num: number;
  sort: number;
  kind: string;
  title: string;
  intro: Text;
  audio: Text;
  audio_label: Text;
}
export interface ExerciseItemRowDb {
  id: string;
  exercise_id: string;
  sort: number;
  q: string;
  opts: string;
  answer_idx: number;
  fix: Text;
  say: Text;
}
export interface EbookRowDb {
  num: number;
  title: string;
  eps_label: Text;
  scope: Text;
  five: string;
  real: string;
  lead: string;
  chat: string;
  extras_cards: string;
  pdf_media: Text;
  pass_score: number;
  updated_at: number;
}
export interface TestQuestionRowDb {
  id: string;
  ebook_num: number;
  part_idx: number;
  part_title: string;
  n: number;
  q: string;
  rev: Text;
  ep_num: Num;
  step: Num;
  opts: Text;
  answer_idx: Num;
  accept: Text;
  show: Text;
  audio: Text;
}
export interface ExtraRowDb {
  id: string;
  title: string;
  kind: Text;
  format: string;
  genres: string;
  themes: string;
  level: Text;
  cefr: Num;
  ep_label: Text;
  dur: Text;
  cover_media: Text;
  scene_media: Text;
  synopsis: Text;
  cast_list: string;
  dub: Text;
  premiere: number;
  locked: number;
  premium: number;
  lines: string;
  vocab: string;
  sort: number;
  status: string;
}
export interface AlbumRowDb {
  id: string;
  title: string;
  sub: Text;
  level: Text;
  img_media: Text;
  genres: string;
  sort: number;
}
export interface TrackRowDb {
  id: string;
  album_id: string;
  sort: number;
  title: string;
  src_from: Text;
  audio_media: Text;
  ep_num: Num;
  bpm: Num;
  music_key: Num;
  lines: Text;
}
export interface AssistantRowDb {
  key: string;
  name: string;
  full_name: string;
  art: string;
  age: Num;
  aka: string;
  role: Text;
  tag: Text;
  style: Text;
  hello_en: Text;
  hello_pt: Text;
  voice: string;
  tts_speaker: string;
  /** Present in `SELECT *`; compile never reads it. */
  persona?: string;
  poster_media: Text;
  thumb_media: Text;
  sort: number;
  active: number;
}
export interface AssistantClipRowDb {
  assistant_key: string;
  state: string;
  media_id: string;
}
export interface MissionRowDb {
  key: string;
  title: string;
  role: Text;
  goal: Text;
  turns: string;
  sort: number;
}
export interface BlobRowDb {
  key: string;
  json: string;
  updated_at?: number;
  updated_by?: Text;
}
export interface OptionRowDb {
  list_key: string;
  scope: string;
  item_key: string;
  sort: number;
  label: string;
  sub: Text;
  icon: Text;
  img_media: Text;
  extra: Text;
}
export interface PointRuleRowDb {
  kind: string;
  points: number;
  daily_cap: Num;
  verifiable: number;
}
export interface LevelRowDb {
  n: number;
  min_points: number;
  name: string;
}
export interface BadgeRowDb {
  id: string;
  title: string;
  sub: string;
  icon: string;
  rule: string;
  sort: number;
}

/** Every table compile reads, in the shape `SELECT * FROM <table>` returns. */
export interface ContentRows {
  media: MediaRowDb[];
  steps: StepRowDb[];
  seasons: SeasonRowDb[];
  cast_members: CastRowDb[];
  episodes: EpisodeRowDb[];
  mic_phrases: MicPhraseRowDb[];
  exercises: ExerciseRowDb[];
  exercise_items: ExerciseItemRowDb[];
  ebooks: EbookRowDb[];
  ebook_test_questions: TestQuestionRowDb[];
  extras: ExtraRowDb[];
  albums: AlbumRowDb[];
  album_tracks: TrackRowDb[];
  assistants: AssistantRowDb[];
  assistant_clips: AssistantClipRowDb[];
  mic_missions: MissionRowDb[];
  content_blobs: BlobRowDb[];
  option_lists: OptionRowDb[];
  point_rules: PointRuleRowDb[];
  levels: LevelRowDb[];
  badges: BadgeRowDb[];
}

/** Table names compile reads (for `SELECT * FROM` loops in the seed and the admin publish). */
export const CONTENT_TABLES = [
  'media',
  'steps',
  'seasons',
  'cast_members',
  'episodes',
  'mic_phrases',
  'exercises',
  'exercise_items',
  'ebooks',
  'ebook_test_questions',
  'extras',
  'albums',
  'album_tracks',
  'assistants',
  'assistant_clips',
  'mic_missions',
  'content_blobs',
  'option_lists',
  'point_rules',
  'levels',
  'badges',
] as const satisfies readonly (keyof ContentRows)[];

// ---------- Blob shapes (content_blobs.json) ----------

/** content_blobs.scene_images: Take a Look stills (media ids). */
export interface SceneImagesBlob {
  default: string | null;
  episodes: Record<string, string>;
}
/** content_blobs.ebook_teasers: "Na próxima" card per e-book. */
export type EbookTeasersBlob = Record<string, { title: string; sub: string }>;
/** content_blobs.ui_images: key ('bg/home', 'avatar/user-1') → media id. */
export type UiImagesBlob = Record<string, string>;
/** content_blobs.onboarding_meta. */
export interface OnboardingMetaBlob {
  remindMax: number;
}

// ---------- Output ----------

export interface CompileIssue {
  file: string;
  path: string;
  message: string;
}

export class ContentCompileError extends Error {
  readonly issues: CompileIssue[];
  constructor(issues: CompileIssue[]) {
    super(
      `content does not compile (${issues.length} issue${issues.length === 1 ? '' : 's'}): ` +
        issues
          .slice(0, 5)
          .map((i) => `${i.file}${i.path ? `#${i.path}` : ''}: ${i.message}`)
          .join('; '),
    );
    this.name = 'ContentCompileError';
    this.issues = issues;
  }
}

export interface CompiledContent {
  version: string;
  manifest: ContentManifest;
  catalog: Catalog;
  /** Published path inside content/{ver}/ → JSON text. Excludes manifest.json (see manifestFile). */
  files: Record<string, string>;
  /** Extra ids flagged premium (the content route gates their files by plan feature). */
  premiumExtras: string[];
}

export const MANIFEST_FILE = 'manifest.json';

/** R2 key of a content file. */
export const contentKey = (version: string, file: string): string => `content/${version}/${file}`;

export interface CompileOptions {
  publishedAt: number;
}

// ---------- Helpers ----------

function parseJson<T>(text: string | null | undefined, fallback: T, where: string, issues: CompileIssue[]): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    issues.push({ file: 'rows', path: where, message: 'invalid JSON column' });
    return fallback;
  }
}

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
const str = (v: string | null | undefined): string => v ?? '';

// UTF-8 + SHA-256 through the platform globals (typed locally: this package compiles without DOM/Node libs).
interface PlatformCrypto {
  subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> };
}
interface PlatformGlobals {
  crypto?: PlatformCrypto;
  TextEncoder?: new () => { encode(s: string): Uint8Array };
}

export async function sha256HexText(text: string): Promise<string> {
  const g = globalThis as unknown as PlatformGlobals;
  if (!g.crypto?.subtle || !g.TextEncoder) throw new Error('WebCrypto/TextEncoder are not available');
  const digest = await g.crypto.subtle.digest('SHA-256', new g.TextEncoder().encode(text));
  let out = '';
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0');
  return out;
}

function validate<S extends z.ZodType>(schema: S, value: unknown, file: string, issues: CompileIssue[]): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  for (const i of r.error.issues.slice(0, 20)) {
    issues.push({ file, path: i.path.map(String).join('.'), message: i.message });
  }
  return value as z.output<S>;
}

// ---------- Compile ----------

export async function compileContent(rows: ContentRows, opts: CompileOptions): Promise<CompiledContent> {
  const issues: CompileIssue[] = [];
  const J = <T>(text: string | null | undefined, fallback: T, where: string) =>
    parseJson(text, fallback, where, issues);

  // Media id → URL. An unknown id is a broken reference and fails the compile.
  const mediaById = new Map(rows.media.map((m) => [m.id, m]));
  const url = (id: string | null | undefined, where: string): string | null => {
    if (!id) return null;
    const m = mediaById.get(id);
    if (!m) {
      issues.push({ file: 'rows', path: where, message: `unknown media id "${id}"` });
      return null;
    }
    return mediaUrl(m.r2_key);
  };

  const blobs = new Map(rows.content_blobs.map((b) => [b.key, b]));
  const blob = <T>(key: string, fallback: T): T => J(blobs.get(key)?.json, fallback, `content_blobs.${key}`);

  // ----- Course structure -----
  const steps = [...rows.steps]
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ n: s.n, name: s.name, pt: s.pt, ...(s.group_label ? { group: s.group_label } : {}) }));
  const seasons = [...rows.seasons]
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ n: s.n, title: s.title, synopsis: s.synopsis }));
  const cast = Object.fromEntries(rows.cast_members.map((c) => [c.name, { initials: c.initials, color: c.color }]));

  const episodesSorted = [...rows.episodes].sort((a, b) => a.num - b.num);
  const ebooksSorted = [...rows.ebooks].sort((a, b) => a.num - b.num);
  const ebookByNum = new Map(ebooksSorted.map((e) => [e.num, e]));
  const questionsByEbook = new Map<number, TestQuestionRowDb[]>();
  for (const q of rows.ebook_test_questions) {
    const list = questionsByEbook.get(q.ebook_num) ?? [];
    list.push(q);
    questionsByEbook.set(q.ebook_num, list);
  }
  const epsOfEbook = (n: number) => episodesSorted.filter((e) => e.ebook_num === n).map((e) => e.num);

  /** An e-book is available when it has its own pages or a test (the prototype only has e-book 1). */
  const ebookAvailable = (e: EbookRowDb): boolean =>
    (questionsByEbook.get(e.num)?.length ?? 0) > 0 ||
    J<unknown[]>(e.five, [], `ebooks.${e.num}.five`).length > 0 ||
    J<unknown[]>(e.lead, [], `ebooks.${e.num}.lead`).length > 0;

  const episodeIndex: EpisodeIndexEntry[] = episodesSorted.map((e) => ({
    num: e.num,
    title: e.title,
    status: e.status as EpisodeIndexEntry['status'],
    season: e.season_n,
    ebook: e.ebook_num,
  }));
  const ebookIndex: EbookIndexEntry[] = ebooksSorted.map((e) => ({
    num: e.num,
    title: e.title,
    epsLabel: e.eps_label,
    scope: e.scope,
    episodes: epsOfEbook(e.num),
    available: ebookAvailable(e),
  }));

  // ----- Onboarding option lists -----
  const optionRows = [...rows.option_lists].sort((a, b) => a.sort - b.sort);
  const listRows = (key: string, scope = '') => optionRows.filter((o) => o.list_key === key && o.scope === scope);
  const item = (o: OptionRowDb): OptionItem => ({
    k: o.item_key,
    t: o.label,
    ...(o.sub != null ? { s: o.sub } : {}),
    ...(o.icon != null ? { icon: o.icon } : {}),
    ...(o.img_media ? { img: url(o.img_media, `option_lists.${o.list_key}.${o.item_key}`) ?? '' } : {}),
  });
  const list = (key: string) => listRows(key).map(item);
  const extraOf = <T>(o: OptionRowDb, fallback: T) => J(o.extra, fallback, `option_lists.${o.list_key}.${o.item_key}`);

  const genreScopes = [...new Set(optionRows.filter((o) => o.list_key === 'genres').map((o) => o.scope))];
  const onboarding: OnboardingLists = {
    steps: listRows('onb_steps').map((o) => {
      const x = extraOf<{ h?: string; skip?: boolean }>(o, {});
      return { k: o.item_key, t: o.label, h: x.h ?? '', s: str(o.sub), ...(x.skip ? { skip: true } : {}) };
    }),
    ages: list('ages'),
    occup: list('occup'),
    areas: list('areas'),
    levels: listRows('levels').map((o) => {
      const x = extraOf<{ season?: number; cefr?: string }>(o, {});
      return { ...item(o), season: x.season ?? 1, cefr: x.cefr ?? '' };
    }),
    goals: list('goals'),
    deadlines: list('deadlines'),
    history: list('history'),
    fails: list('fails'),
    formats: list('formats'),
    genres: Object.fromEntries(genreScopes.map((scope) => [scope, listRows('genres', scope).map(item)])),
    themes: list('themes'),
    diffs: list('diffs'),
    styles: list('styles'),
    company: list('company'),
    feedback: list('feedback'),
    days: listRows('days').map((o) => o.label),
    minutes: listRows('minutes').map((o) => ({ k: Number(o.item_key), t: o.label })),
    remindMax: blob<OnboardingMetaBlob>('onboarding_meta', { remindMax: 5 }).remindMax,
    motives: list('motives'),
  };

  // ----- Assistants (public fields only) -----
  const clipsOf = (key: string) =>
    Object.fromEntries(
      rows.assistant_clips
        .filter((c) => c.assistant_key === key)
        .map((c) => [c.state, url(c.media_id, `assistant_clips.${key}.${c.state}`) ?? '']),
    );
  const assistants: AssistantPublic[] = [...rows.assistants]
    .filter((a) => a.active)
    .sort(bySort)
    .map((a) => {
      const voice = J<Record<string, unknown>>(a.voice, {}, `assistants.${a.key}.voice`);
      return {
        k: a.key,
        name: a.name,
        full: a.full_name,
        art: a.art as 'a' | 'o',
        age: a.age,
        aka: J<string[]>(a.aka, [], `assistants.${a.key}.aka`),
        role: str(a.role),
        tag: str(a.tag),
        style: str(a.style),
        hello: { en: str(a.hello_en), pt: str(a.hello_pt) },
        voice: { ...(voice as object), tts: a.tts_speaker } as AssistantPublic['voice'],
        poster: url(a.poster_media, `assistants.${a.key}.poster`),
        thumb: url(a.thumb_media, `assistants.${a.key}.thumb`),
        clips: clipsOf(a.key),
      };
    });

  // ----- Extras and albums -----
  const publishedExtras = [...rows.extras].filter((x) => x.status === 'published').sort(bySort);
  const extraMeta = (x: ExtraRowDb): ExtraMeta => ({
    id: x.id,
    title: x.title,
    kind: str(x.kind),
    format: x.format,
    genres: J<string[]>(x.genres, [], `extras.${x.id}.genres`),
    themes: J<string[]>(x.themes, [], `extras.${x.id}.themes`),
    level: str(x.level),
    cefr: x.cefr ?? 1,
    ep: str(x.ep_label),
    dur: str(x.dur),
    cover: url(x.cover_media, `extras.${x.id}.cover`),
    scene: url(x.scene_media, `extras.${x.id}.scene`),
    synopsis: str(x.synopsis),
    cast: J(x.cast_list, [], `extras.${x.id}.cast_list`),
    dub: str(x.dub),
    premiere: !!x.premiere,
    locked: !!x.locked,
    premium: !!x.premium,
  });

  const lyricsOf = (e: EpisodeRowDb) =>
    J<{ id?: string; en: string; pt: string; gap?: string }[]>(e.lyrics, [], `episodes.${e.num}.lyrics`).map(
      (l, i) => ({
        ...l,
        id: l.id ?? `e${e.num}-ly${i}`,
      }),
    );
  const episodeByNum = new Map(episodesSorted.map((e) => [e.num, e]));
  const albums: Album[] = [...rows.albums].sort(bySort).map((a) => ({
    id: a.id,
    title: a.title,
    sub: str(a.sub),
    level: str(a.level),
    img: url(a.img_media, `albums.${a.id}.img`),
    genres: J<string[]>(a.genres, [], `albums.${a.id}.genres`),
    tracks: rows.album_tracks
      .filter((t) => t.album_id === a.id)
      .sort(bySort)
      .map((t) => {
        const ep = t.ep_num != null ? episodeByNum.get(t.ep_num) : undefined;
        const own = J<{ en: string; pt: string; gap: string }[] | null>(t.lines, null, `album_tracks.${t.id}.lines`);
        // Episode tracks sing the episode lyrics; a line without a gap blanks its first word (extra.js tracksOf).
        const lines =
          own ??
          (ep ? lyricsOf(ep).map((l) => ({ en: l.en, pt: l.pt, gap: l.gap || (l.en.split(' ')[0] ?? '') })) : []);
        return {
          id: t.id,
          title: t.title,
          from: str(t.src_from),
          audio: url(t.audio_media, `album_tracks.${t.id}.audio`),
          ...(t.ep_num != null ? { ep: t.ep_num } : {}),
          ...(t.bpm != null ? { bpm: t.bpm } : {}),
          ...(t.music_key != null ? { key: t.music_key } : {}),
          lines,
        };
      }),
  }));

  // ----- Mic -----
  const mic: MicCatalog = {
    modes: blob('mic_modes', []),
    openers: blob('mic_openers', {}),
    follow: blob('mic_follow', []),
    missions: [...rows.mic_missions].sort(bySort).map((m) => ({
      k: m.key,
      t: m.title,
      role: str(m.role),
      goal: str(m.goal),
      turns: J(m.turns, [], `mic_missions.${m.key}.turns`),
    })),
    pron: blob<{ id?: string; en: string; target: string; tip: string }[]>('mic_pron', []).map((p, i) => ({
      ...p,
      id: p.id ?? `pron-${i}`,
    })),
    help: blob('mic_help', []),
  };

  // ----- Game -----
  const points = Object.fromEntries(POINT_KINDS.map((k) => [k, 0])) as Record<PointKind, number>;
  for (const r of rows.point_rules) {
    if ((POINT_KINDS as readonly string[]).includes(r.kind)) points[r.kind as PointKind] = r.points;
  }
  const game = {
    points,
    levels: [...rows.levels].sort((a, b) => a.n - b.n).map((l) => ({ n: l.n, min: l.min_points, name: l.name })),
    badges: [...rows.badges].sort(bySort).map((b) => ({ id: b.id, t: b.title, s: b.sub, icon: b.icon })),
  };

  const uiImages = blob<UiImagesBlob>('ui_images', {});
  const images = Object.fromEntries(
    Object.entries(uiImages).map(([k, id]) => [k, url(id, `content_blobs.ui_images.${k}`) ?? '']),
  );

  const catalogDraft: Catalog = {
    version: '',
    steps,
    seasons,
    titles: episodesSorted.map((e) => e.title),
    episodes: episodeIndex,
    ebooks: ebookIndex,
    cast,
    onboarding,
    focus: blob('focus', {}),
    personalize: blob('personalize', { formatWord: {}, formatTheme: {} }),
    assistants,
    extras: publishedExtras.map(extraMeta),
    extrasShelves: blob('extras_shelves', []),
    albums,
    mic,
    game,
    srs: { grades: blob('srs_grades', []) },
    images,
  };
  const catalog = validate(Catalog, catalogDraft, CONTENT_FILES.catalog, issues);

  // ----- Episodes (published only) -----
  const scenes = blob<SceneImagesBlob>('scene_images', { default: null, episodes: {} });
  const phrasesOf = (n: number) => rows.mic_phrases.filter((p) => p.episode_num === n).sort(bySort);
  const exercisesOf = (n: number) => rows.exercises.filter((x) => x.episode_num === n).sort(bySort);
  const itemsOf = (id: string) => rows.exercise_items.filter((i) => i.exercise_id === id).sort(bySort);

  const files: Record<string, string> = {};
  const episodeNums: number[] = [];
  for (const e of episodesSorted) {
    if (e.status !== 'published') continue;
    const file = CONTENT_FILES.episode(e.num);
    const eb = e.ebook_num != null ? ebookByNum.get(e.ebook_num) : undefined;
    if (!eb) issues.push({ file, path: 'ebook', message: `published episode ${e.num} has no e-book row` });
    const w = (col: string) => `episodes.${e.num}.${col}`;
    const draft = {
      num: e.num,
      title: e.title,
      status: e.status,
      season: e.season_n,
      ebook: e.ebook_num,
      ebookEps: str(eb?.eps_label),
      ebookTitle: str(eb?.title).toUpperCase(),
      scope: str(eb?.scope),
      synopsis: str(e.synopsis),
      introAudio: url(e.intro_media, w('intro_media')),
      songAudio: url(e.song_media, w('song_media')),
      songTitle: str(e.song_title),
      sceneVideo: url(e.scene_media, w('scene_media')),
      sceneImage: url(scenes.episodes[String(e.num)] ?? scenes.default, 'content_blobs.scene_images'),
      sceneNote: str(e.scene_note),
      lyrics: lyricsOf(e),
      cast: J<string[]>(e.cast_names, [], w('cast_names')),
      visual: J<{ id?: string; en: string; pt: string }[]>(e.visual, [], w('visual')).map((v, i) => ({
        ...v,
        id: v.id ?? `e${e.num}-vi${i}`,
      })),
      dialogTitle: str(e.dialog_title),
      dialogSub: str(e.dialog_sub),
      dialog: J<{ id?: string }[]>(e.dialog, [], w('dialog')).map((d, i) => ({ ...d, id: d.id ?? `e${e.num}-dl${i}` })),
      mic: phrasesOf(e.num).map((p) => ({
        id: p.id,
        en: p.en,
        tip: str(p.tip),
        result: p.demo_result ?? 7,
        ...(p.blue ? { blue: true } : {}),
        fb: str(p.fb),
      })),
      lesson: J<Block[]>(e.lesson, [], w('lesson')),
      pron: J(e.pron, null, w('pron')),
      awayExp: J(e.away_exp, [], w('away_exp')),
      awayWords: J<string[]>(e.away_words, [], w('away_words')),
      ex: exercisesOf(e.num).map((x) => ({
        id: x.id,
        kind: x.kind,
        title: x.title,
        ...(x.intro != null ? { intro: x.intro } : {}),
        ...(x.audio ? { audio: x.audio } : {}),
        ...(x.audio_label != null ? { audioLabel: x.audio_label } : {}),
        items: itemsOf(x.id).map((it) => ({
          id: it.id,
          q: it.q,
          opts: J<string[]>(it.opts, [], `exercise_items.${it.id}.opts`),
          a: it.answer_idx,
          ...(it.fix != null ? { fix: it.fix } : {}),
          ...(it.say != null ? { say: it.say } : {}),
        })),
      })),
      done: J(e.done, null, w('done')),
    };
    files[file] = JSON.stringify(validate(Episode, draft, file, issues));
    episodeNums.push(e.num);
  }

  // ----- E-books (available only) -----
  const teasers = blob<EbookTeasersBlob>('ebook_teasers', {});
  const ebookNums: number[] = [];
  for (const eb of ebooksSorted) {
    if (!ebookAvailable(eb)) continue;
    const file = CONTENT_FILES.ebook(eb.num);
    const episodes = epsOfEbook(eb.num);
    const qs = [...(questionsByEbook.get(eb.num) ?? [])].sort((a, b) => a.part_idx - b.part_idx || a.n - b.n);
    const parts: TestPart[] = [];
    for (const q of qs) {
      let part = parts[q.part_idx];
      if (!part) {
        part = { title: q.part_title, qs: [] };
        parts[q.part_idx] = part;
      }
      const opts = J<string[] | null>(q.opts, null, `ebook_test_questions.${q.id}.opts`);
      const acc = J<string[] | null>(q.accept, null, `ebook_test_questions.${q.id}.accept`);
      const out: TestQuestion = {
        id: q.id,
        n: q.n,
        q: q.q,
        rev: str(q.rev),
        ep: q.ep_num ?? episodes[0] ?? 1,
        step: q.step ?? 7,
        ...(opts && q.answer_idx != null ? { opts, a: q.answer_idx } : {}),
        ...(acc ? { acc } : {}),
        ...(q.show != null ? { show: q.show } : {}),
        ...(q.audio != null ? { audio: q.audio } : {}),
      };
      part.qs.push(out);
    }
    const draft = {
      num: eb.num,
      title: eb.title,
      epsLabel: str(eb.eps_label),
      scope: str(eb.scope),
      episodes,
      five: J(eb.five, [], `ebooks.${eb.num}.five`),
      real: J(eb.real, [], `ebooks.${eb.num}.real`),
      lead: J(eb.lead, [], `ebooks.${eb.num}.lead`),
      chat: J(eb.chat, [], `ebooks.${eb.num}.chat`),
      extrasCards: J(eb.extras_cards, [], `ebooks.${eb.num}.extras_cards`),
      pdf: url(eb.pdf_media, `ebooks.${eb.num}.pdf_media`),
      passScore: eb.pass_score,
      test: parts.filter(Boolean),
      teaser: teasers[String(eb.num)] ?? null,
    };
    files[file] = JSON.stringify(validate(Ebook, draft, file, issues));
    ebookNums.push(eb.num);
  }

  // ----- Extras -----
  const extraIds: string[] = [];
  const premiumExtras: string[] = [];
  for (const x of publishedExtras) {
    if (!/^[\w-]+$/.test(x.id)) {
      issues.push({ file: 'rows', path: `extras.${x.id}`, message: 'extra id must match [A-Za-z0-9_-]+' });
      continue;
    }
    const file = CONTENT_FILES.extra(x.id);
    const draft = {
      ...extraMeta(x),
      lines: J(x.lines, [], `extras.${x.id}.lines`),
      vocab: J(x.vocab, [], `extras.${x.id}.vocab`),
    };
    files[file] = JSON.stringify(validate(Extra, draft, file, issues));
    extraIds.push(x.id);
    if (x.premium) premiumExtras.push(x.id);
  }

  if (issues.length) throw new ContentCompileError(issues);

  // ----- Version: hash of the whole set (catalog.version blank), then stamp it -----
  files[CONTENT_FILES.catalog] = JSON.stringify(catalog);
  const paths = Object.keys(files).sort();
  const canonical = paths.map((p) => `${p}\n${files[p]}\n`).join('');
  const version = await sha256HexText(canonical);
  catalog.version = version;
  files[CONTENT_FILES.catalog] = JSON.stringify(catalog);

  const manifest = ContentManifestSchema.parse({
    version,
    publishedAt: opts.publishedAt,
    files: { catalog: CONTENT_FILES.catalog, episodes: episodeNums, ebooks: ebookNums, extras: extraIds },
  });

  const ordered: Record<string, string> = {};
  for (const p of Object.keys(files).sort()) ordered[p] = files[p] as string;
  return { version, manifest, catalog, files: ordered, premiumExtras };
}
