import { z } from 'zod';

// Published content snapshots (R2 content/{ver}/*). Field names follow the prototype's js/data/* so the
// screen port stays mechanical; tuples ([en, pt], [name, ini, color]) became objects.
// Every array item that user state or an award key points at carries a stable `id`.
// Media fields hold app URLs (/m/...) resolved by compile; null means "none".

export const MediaUrl = z.string().min(1);
export const OptMedia = MediaUrl.nullable();
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const Bilingual = z.object({ en: z.string(), pt: z.string() });
export type Bilingual = z.infer<typeof Bilingual>;

// ---------- Course structure ----------

export const Step = z.object({
  n: z.int().min(1).max(10),
  name: z.string(),
  pt: z.string(),
  group: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

export const Season = z.object({ n: z.int().positive(), title: z.string(), synopsis: z.string().nullable() });
export type Season = z.infer<typeof Season>;

export const CastMember = z.object({ initials: z.string(), color: HexColor });
export type CastMember = z.infer<typeof CastMember>;

export const EpisodeStatus = z.enum(['title_only', 'draft', 'published']);
export type EpisodeStatus = z.infer<typeof EpisodeStatus>;

export const EpisodeIndexEntry = z.object({
  num: z.int().positive(),
  title: z.string(),
  status: EpisodeStatus,
  season: z.int().positive().nullable(),
  ebook: z.int().positive().nullable(),
});
export type EpisodeIndexEntry = z.infer<typeof EpisodeIndexEntry>;

export const EbookIndexEntry = z.object({
  num: z.int().positive(),
  title: z.string(),
  epsLabel: z.string().nullable(),
  scope: z.string().nullable(),
  episodes: z.array(z.int().positive()),
  available: z.boolean(),
});
export type EbookIndexEntry = z.infer<typeof EbookIndexEntry>;

// ---------- Onboarding option lists (option_lists table) ----------

export const OptionItem = z.object({
  k: z.string(),
  t: z.string(),
  s: z.string().optional(),
  icon: z.string().optional(),
  img: MediaUrl.optional(),
});
export type OptionItem = z.infer<typeof OptionItem>;

export const LevelOption = OptionItem.extend({ season: z.int().positive(), cefr: z.string() });
export type LevelOption = z.infer<typeof LevelOption>;

export const OnbStep = z.object({
  k: z.string(),
  t: z.string(),
  h: z.string(),
  s: z.string(),
  skip: z.boolean().optional(),
});
export type OnbStep = z.infer<typeof OnbStep>;

export const MinutesOption = z.object({ k: z.int().positive(), t: z.string() });

export const OnboardingLists = z.object({
  steps: z.array(OnbStep),
  ages: z.array(OptionItem),
  occup: z.array(OptionItem),
  areas: z.array(OptionItem),
  levels: z.array(LevelOption),
  goals: z.array(OptionItem),
  deadlines: z.array(OptionItem),
  history: z.array(OptionItem),
  fails: z.array(OptionItem),
  formats: z.array(OptionItem),
  /** Keyed by format. Genre keys repeat across formats (option_lists.scope = format). */
  genres: z.record(z.string(), z.array(OptionItem)),
  themes: z.array(OptionItem),
  diffs: z.array(OptionItem),
  styles: z.array(OptionItem),
  company: z.array(OptionItem),
  feedback: z.array(OptionItem),
  days: z.array(z.string()).length(7),
  minutes: z.array(MinutesOption),
  remindMax: z.int().positive(),
  motives: z.array(OptionItem),
});
export type OnboardingLists = z.infer<typeof OnboardingLists>;

/** Foco da semana per difficulty key; {oA} is replaced with "a Maggie" / "o Robert". */
export const FocusCard = z.object({ t: z.string(), b: z.string(), cta: z.string(), go: z.string() });
export type FocusCard = z.infer<typeof FocusCard>;

export const PersonalizeMaps = z.object({
  formatWord: z.record(z.string(), z.string()),
  /** Formats that are not screen formats map to an Extras theme (viagens→viagem, business→negocios). */
  formatTheme: z.record(z.string(), z.string()),
});
export type PersonalizeMaps = z.infer<typeof PersonalizeMaps>;

export const Shelf = z.object({ k: z.string(), t: z.string() });
export type Shelf = z.infer<typeof Shelf>;

// ---------- Assistants (public fields only; persona never leaves the server) ----------

export const ClipState = z.enum(['idle', 'talk', 'talk-happy', 'talk-soft']);
export type ClipState = z.infer<typeof ClipState>;

export const AssistantVoice = z.object({
  gender: z.enum(['female', 'male']),
  pitch: z.number(),
  rate: z.number(),
  /** Server TTS speaker (allowlisted). */
  tts: z.string(),
  /** Preferred browser voice name, e.g. "Ana" for Zach. */
  prefer: z.string().optional(),
  preferPitch: z.number().optional(),
  preferRate: z.number().optional(),
});
export type AssistantVoice = z.infer<typeof AssistantVoice>;

export const AssistantPublic = z.object({
  k: z.string(),
  name: z.string(),
  full: z.string(),
  art: z.enum(['a', 'o']),
  age: z.int().nullable(),
  aka: z.array(z.string()),
  role: z.string(),
  tag: z.string(),
  style: z.string(),
  hello: Bilingual,
  voice: AssistantVoice,
  poster: OptMedia,
  thumb: OptMedia,
  clips: z.partialRecord(ClipState, MediaUrl),
});
export type AssistantPublic = z.infer<typeof AssistantPublic>;

// ---------- Extras and albums ----------

export const ExtraCast = z.object({ name: z.string(), initials: z.string(), color: HexColor });
export type ExtraCast = z.infer<typeof ExtraCast>;

export const ExtraMeta = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  format: z.string(),
  genres: z.array(z.string()),
  themes: z.array(z.string()),
  level: z.string(),
  cefr: z.int().min(1).max(3),
  ep: z.string(),
  dur: z.string(),
  cover: OptMedia,
  scene: OptMedia,
  synopsis: z.string(),
  cast: z.array(ExtraCast),
  dub: z.string(),
  premiere: z.boolean(),
  locked: z.boolean(),
  premium: z.boolean(),
});
export type ExtraMeta = z.infer<typeof ExtraMeta>;

export const ExtraLine = z.object({ who: z.string(), en: z.string(), pt: z.string() });
export type ExtraLine = z.infer<typeof ExtraLine>;

/** extra/{id}.json */
export const Extra = ExtraMeta.extend({
  lines: z.array(ExtraLine),
  vocab: z.array(Bilingual),
});
export type Extra = z.infer<typeof Extra>;

export const KaraokeLine = z.object({ en: z.string(), pt: z.string(), gap: z.string() });
export type KaraokeLine = z.infer<typeof KaraokeLine>;

export const Track = z.object({
  id: z.string(),
  title: z.string(),
  from: z.string(),
  audio: OptMedia,
  ep: z.int().positive().optional(),
  bpm: z.int().positive().optional(),
  /** Synth key, 0..11 semitones. */
  key: z.int().min(0).max(11).optional(),
  /** Compile inlines the episode lyrics (with their gaps) for tracks that point at an episode. */
  lines: z.array(KaraokeLine),
});
export type Track = z.infer<typeof Track>;

export const Album = z.object({
  id: z.string(),
  title: z.string(),
  sub: z.string(),
  level: z.string(),
  img: OptMedia,
  genres: z.array(z.string()),
  tracks: z.array(Track),
});
export type Album = z.infer<typeof Album>;

// ---------- Mic (maggie.js) ----------

export const MicMode = z.enum(['livre', 'missao', 'pronuncia', 'extra']);
export type MicMode = z.infer<typeof MicMode>;

export const MicModeCard = z.object({ k: MicMode, t: z.string(), s: z.string(), icon: z.string() });
export type MicModeCard = z.infer<typeof MicModeCard>;

/** {N} = student name, {A} = assistant name, {oA} = "a Maggie" / "o Robert". */
export const ScriptLine = Bilingual.extend({ end: z.boolean().optional() });
export type ScriptLine = z.infer<typeof ScriptLine>;

export const MissionTurn = ScriptLine.extend({ words: z.array(Bilingual) });
export type MissionTurn = z.infer<typeof MissionTurn>;

export const Mission = z.object({
  k: z.string(),
  t: z.string(),
  role: z.string(),
  goal: z.string(),
  turns: z.array(MissionTurn).min(1),
});
export type Mission = z.infer<typeof Mission>;

export const PronPhrase = z.object({ id: z.string(), en: z.string(), target: z.string(), tip: z.string() });
export type PronPhrase = z.infer<typeof PronPhrase>;

export const MicCatalog = z.object({
  modes: z.array(MicModeCard),
  /** Keyed by format, plus "_" as the fallback opener. */
  openers: z.record(z.string(), Bilingual),
  follow: z.array(ScriptLine),
  missions: z.array(Mission),
  pron: z.array(PronPhrase),
  help: z.array(Bilingual),
});
export type MicCatalog = z.infer<typeof MicCatalog>;

// ---------- Gamification and SRS ----------

export const POINT_KINDS = [
  'step',
  'episode',
  'ex_right',
  'mic_try',
  'mic_good',
  'song',
  'maggie_turn',
  'maggie_session',
  'extra',
  'dub',
  'card',
  'quiz_hit',
  'test_pass',
  'mission',
  'word',
] as const;
export const PointKind = z.enum(POINT_KINDS);
export type PointKind = z.infer<typeof PointKind>;

export const LevelDef = z.object({ n: z.int().positive(), min: z.int().min(0), name: z.string() });
export type LevelDef = z.infer<typeof LevelDef>;

export const BadgeDef = z.object({ id: z.string(), t: z.string(), s: z.string(), icon: z.string() });
export type BadgeDef = z.infer<typeof BadgeDef>;

export const GameCatalog = z.object({
  points: z.record(PointKind, z.int().min(0)),
  levels: z.array(LevelDef).min(1),
  badges: z.array(BadgeDef),
});
export type GameCatalog = z.infer<typeof GameCatalog>;

export const SrsGrade = z.object({ label: z.string(), hint: z.string(), ms: z.int().min(0) });
export type SrsGrade = z.infer<typeof SrsGrade>;

// ---------- catalog.json ----------

export const Catalog = z.object({
  version: z.string(),
  steps: z.array(Step).length(10),
  seasons: z.array(Season),
  /** Episode titles by position (index = num - 1), as TIE.data.TITLES. */
  titles: z.array(z.string()),
  episodes: z.array(EpisodeIndexEntry),
  ebooks: z.array(EbookIndexEntry),
  cast: z.record(z.string(), CastMember),
  onboarding: OnboardingLists,
  focus: z.record(z.string(), FocusCard),
  personalize: PersonalizeMaps,
  assistants: z.array(AssistantPublic).min(1),
  extras: z.array(ExtraMeta),
  extrasShelves: z.array(Shelf),
  albums: z.array(Album),
  mic: MicCatalog,
  game: GameCatalog,
  srs: z.object({ grades: z.array(SrsGrade).length(4) }),
});
export type Catalog = z.infer<typeof Catalog>;

// ---------- ep/{n}.json ----------

export const BlockRow = z.object({
  en: z.string(),
  pt: z.string().optional(),
  q: z.string().optional(),
  bad: z.string().optional(),
  note: z.string().optional(),
});
export type BlockRow = z.infer<typeof BlockRow>;

/** Lesson / Take Five block, rendered by TIE.blocks. */
export const Block = z.object({
  k: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  body2: z.string().optional(),
  rows: z.array(BlockRow).optional(),
  bullets: z.array(z.string()).optional(),
  callout: z.string().optional(),
  badLabel: z.string().optional(),
});
export type Block = z.infer<typeof Block>;

export const LyricLine = z.object({ en: z.string(), pt: z.string(), gap: z.string().optional() });
export type LyricLine = z.infer<typeof LyricLine>;

export const DialogLine = z.object({
  /** '' for stage directions, 'All' for everyone. */
  who: z.string(),
  en: z.string(),
  pt: z.string(),
  stage: z.boolean().optional(),
  err: z.string().optional(),
  hook: z.string().optional(),
});
export type DialogLine = z.infer<typeof DialogLine>;

export const MicPhrase = z.object({
  id: z.string(),
  en: z.string(),
  tip: z.string(),
  /** Scripted demo score used when no microphone is available. */
  result: z.int().min(0).max(10),
  blue: z.boolean().optional(),
  fb: z.string(),
});
export type MicPhrase = z.infer<typeof MicPhrase>;

export const PronNote = z.object({
  k: z.string(),
  parts: z.array(z.object({ b: z.string(), t: z.string() })),
  pairs: z.array(z.object({ a: z.string(), b: z.string(), c: z.string() })),
  words: z.array(z.string()),
});
export type PronNote = z.infer<typeof PronNote>;

export const AwayExp = z.object({ en: z.string(), pt: z.string(), note: z.string().optional() });
export type AwayExp = z.infer<typeof AwayExp>;

// Answers ship to the client for instant feedback (as in the prototype); the server re-grades from D1
// before recording answers or awarding points.
export const ExerciseItem = z.object({
  id: z.string(),
  q: z.string(),
  opts: z.array(z.string()).min(2).max(4),
  a: z.int().min(0).max(3),
  fix: z.string().optional(),
  say: z.string().optional(),
});
export type ExerciseItem = z.infer<typeof ExerciseItem>;

export const Exercise = z.object({
  id: z.string(),
  /** 'escrito' | 'com áudio' | 'música' */
  kind: z.string(),
  title: z.string(),
  intro: z.string().optional(),
  audio: z.enum(['tts', 'song']).optional(),
  audioLabel: z.string().optional(),
  items: z.array(ExerciseItem).min(1),
});
export type Exercise = z.infer<typeof Exercise>;

export const EpisodeDone = z.object({
  title: z.string(),
  /** {N} = student name. */
  line: z.string(),
  nextNum: z.string(),
  nextTitle: z.string(),
  nextSub: z.string(),
  nextNote: z.string(),
  cta: z.string(),
  /** Hash route without "#/" (the seed maps the prototype's 'ep2'/'ebook1'/'home'). */
  go: z.string(),
});
export type EpisodeDone = z.infer<typeof EpisodeDone>;

export const Episode = z.object({
  num: z.int().positive(),
  title: z.string(),
  status: EpisodeStatus,
  season: z.int().positive().nullable(),
  ebook: z.int().positive(),
  ebookEps: z.string(),
  ebookTitle: z.string(),
  scope: z.string(),
  synopsis: z.string(),
  introAudio: OptMedia,
  songAudio: OptMedia,
  songTitle: z.string(),
  sceneVideo: OptMedia,
  /** Still shown in Take a Look when there is no video. */
  sceneImage: OptMedia,
  sceneNote: z.string(),
  lyrics: z.array(LyricLine),
  cast: z.array(z.string()),
  visual: z.array(Bilingual),
  dialogTitle: z.string(),
  dialogSub: z.string(),
  dialog: z.array(DialogLine),
  mic: z.array(MicPhrase),
  lesson: z.array(Block),
  pron: PronNote.nullable(),
  awayExp: z.array(AwayExp),
  awayWords: z.array(z.string()),
  ex: z.array(Exercise),
  done: EpisodeDone,
});
export type Episode = z.infer<typeof Episode>;

// ---------- ebook/{n}.json ----------

export const RealCard = z.object({ book: z.string(), street: z.string(), why: z.string() });
export type RealCard = z.infer<typeof RealCard>;

/** {N} = student name. A wrong option carries `fix`. */
export const LeadOption = Bilingual.extend({ fix: z.string().optional() });
export const LeadTurn = z.object({ m: Bilingual, opts: z.array(LeadOption).min(1) });
export type LeadTurn = z.infer<typeof LeadTurn>;

export const ChatTurn = z.object({ her: Bilingual, sug: z.array(LeadOption) });
export type ChatTurn = z.infer<typeof ChatTurn>;

export const EbookExtraCard = z.object({
  name: z.string(),
  pt: z.string(),
  desc: z.string(),
  meta: z.string(),
  /** Hash route; '' = "Em produção". */
  go: z.string(),
});
export type EbookExtraCard = z.infer<typeof EbookExtraCard>;

export const TestQuestion = z
  .object({
    id: z.string(),
    n: z.int().positive(),
    q: z.string(),
    rev: z.string(),
    ep: z.int().positive(),
    step: z.int().min(1).max(10),
    opts: z.array(z.string()).min(2).optional(),
    a: z.int().min(0).optional(),
    /** Accepted typed answers, already normalized with norm(). */
    acc: z.array(z.string()).min(1).optional(),
    show: z.string().optional(),
    /** Text spoken by the audio button. */
    audio: z.string().optional(),
  })
  .refine((q) => (q.opts !== undefined && q.a !== undefined) || q.acc !== undefined, {
    message: 'question needs opts+a or acc',
  });
export type TestQuestion = z.infer<typeof TestQuestion>;

export const TestPart = z.object({ title: z.string(), qs: z.array(TestQuestion).min(1) });
export type TestPart = z.infer<typeof TestPart>;

export const Ebook = z.object({
  num: z.int().positive(),
  title: z.string(),
  epsLabel: z.string(),
  scope: z.string(),
  episodes: z.array(z.int().positive()),
  five: z.array(Block),
  real: z.array(RealCard),
  lead: z.array(LeadTurn),
  chat: z.array(ChatTurn),
  extrasCards: z.array(EbookExtraCard),
  pdf: OptMedia,
  passScore: z.int().min(0),
  test: z.array(TestPart),
  /** "Na próxima" teaser card. */
  teaser: z.object({ title: z.string(), sub: z.string() }).nullable(),
});
export type Ebook = z.infer<typeof Ebook>;

// ---------- Manifest ----------

export const ContentManifest = z.object({
  version: z.string(),
  publishedAt: z.int(),
  files: z.object({
    catalog: z.literal('catalog.json'),
    episodes: z.array(z.int().positive()),
    ebooks: z.array(z.int().positive()),
    extras: z.array(z.string()),
  }),
});
export type ContentManifest = z.infer<typeof ContentManifest>;

/** File names inside content/{ver}/, also the :file part of /api/content/v/:ver/:file. */
export const CONTENT_FILES = {
  catalog: 'catalog.json',
  episode: (num: number) => `ep/${num}.json`,
  ebook: (num: number) => `ebook/${num}.json`,
  extra: (id: string) => `extra/${id}.json`,
} as const;
