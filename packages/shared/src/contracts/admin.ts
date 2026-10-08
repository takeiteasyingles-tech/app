import { z } from 'zod';
import { Permission, Role } from '../authz';
import { LIMITS, MEDIA_MIME } from '../constants';
import {
  AssistantVoice,
  AwayExp,
  Bilingual,
  Block,
  ChatTurn,
  ClipState,
  ContentManifest,
  DialogLine,
  EbookExtraCard,
  EpisodeDone,
  EpisodeStatus,
  ExtraCast,
  ExtraLine,
  KaraokeLine,
  LeadTurn,
  LyricLine,
  MicMode,
  MissionTurn,
  PointKind,
  PronNote,
  RealCard,
} from '../content/schema';
import { QuotaInfo } from '../state';
import { Feedback, PronTip, ReportResult } from './ai';
import {
  Email,
  IdParams,
  IdString,
  Ok,
  Page,
  PageQuery,
  Password,
  PasswordAttempt,
  QueryBool,
  Timestamp,
  TurnstileToken,
} from './common';
import { BadgeRule } from './game';
import { type EndpointDef, endpoint } from './http';

// Admin API (/admin-api). Bodies are strict (unknown keys rejected). Every staff endpoint names the
// permission it needs; every mutation is audited with a JSON diff. Media fields are media ids.

const MediaId = IdString.nullable();
const Reason = z.string().trim().min(1).max(LIMITS.freeTextMax);

// ---------- Auth ----------

export const AdminUser = z.object({ id: z.string(), email: z.string(), roles: z.array(Role) });
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminAuthRes = z.object({ user: AdminUser, permissions: z.array(Permission) });
export type AdminAuthRes = z.infer<typeof AdminAuthRes>;

export const AdminLoginBody = z.strictObject({
  email: Email,
  password: PasswordAttempt,
  turnstileToken: TurnstileToken,
});
export type AdminLoginBody = z.infer<typeof AdminLoginBody>;

export const InviteParams = z.object({ token: z.string().min(16).max(200) });
export const InviteInfo = z.object({ email: z.string(), role: Role, expiresAt: Timestamp });
export type InviteInfo = z.infer<typeof InviteInfo>;

/** Staff passwords are longer than the student minimum (spec 05 note #3). */
export const STAFF_PASSWORD_MIN = 10;
export const StaffPassword = Password.pipe(z.string().min(STAFF_PASSWORD_MIN));

export const InviteAcceptBody = z.strictObject({
  token: z.string().min(16).max(200),
  password: StaffPassword,
  turnstileToken: TurnstileToken,
});
export type InviteAcceptBody = z.infer<typeof InviteAcceptBody>;

/** Staff password change: every session of the account is revoked; this device gets a fresh one. */
export const AdminPasswordBody = z.strictObject({
  currentPassword: PasswordAttempt,
  newPassword: StaffPassword,
});
export type AdminPasswordBody = z.infer<typeof AdminPasswordBody>;

/** Creates an admin_invite token for a new staff member; the granter must be allowed to grant `role`. */
export const CreateInviteBody = z.strictObject({ email: Email, role: Role.exclude(['super_admin']) });
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export const LinkRes = z.object({ url: z.string(), expiresAt: Timestamp });
export type LinkRes = z.infer<typeof LinkRes>;

// ---------- Users ----------

export const UserStatus = z.enum(['active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatus>;

export const AdminUserRow = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  status: UserStatus,
  roles: z.array(Role),
  planSlug: z.string().nullable(),
  points: z.int().min(0),
  createdAt: Timestamp,
  lastLoginAt: Timestamp.nullable(),
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;

export const UsersQuery = PageQuery.extend({
  q: z.string().trim().max(200).optional(),
  status: UserStatus.optional(),
  role: Role.optional(),
  plan: z.string().max(60).optional(),
});
export type UsersQuery = z.infer<typeof UsersQuery>;

export const Plan = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  aiMinutesMonth: z.int().min(0),
  features: z.record(z.string(), z.unknown()),
  isDefault: z.boolean(),
  active: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Plan = z.infer<typeof Plan>;

export const UserDetail = z.object({
  id: z.string(),
  email: z.string(),
  status: UserStatus,
  tz: z.string(),
  roles: z.array(Role),
  createdAt: Timestamp,
  lastLoginAt: Timestamp.nullable(),
  failedLogins: z.int().min(0),
  lockedUntil: Timestamp.nullable(),
  termsVersion: z.string().nullable(),
  termsAcceptedAt: Timestamp.nullable(),
  plan: z.object({ plan: Plan, assignedAt: Timestamp, expiresAt: Timestamp.nullable() }).nullable(),
  profile: z
    .object({
      name: z.string().nullable(),
      fullName: z.string().nullable(),
      ageBand: z.string().nullable(),
      level: z.string(),
      onbStep: z.int(),
      onbCompletedAt: Timestamp.nullable(),
    })
    .nullable(),
  stats: z.object({ points: z.int().min(0), streak: z.int().min(0), lastDay: z.string().nullable() }),
  quota: QuotaInfo,
  photo: z.object({ uploadId: z.string(), url: z.string(), status: z.enum(['active', 'removed']) }).nullable(),
  micSessions: z.int().min(0),
});
export type UserDetail = z.infer<typeof UserDetail>;

export const SuspendBody = z.strictObject({ suspended: z.boolean(), reason: Reason });
export const SuspendRes = z.object({ status: UserStatus });
export const DeleteUserBody = z.strictObject({ reason: Reason });
export const AssignPlanBody = z.strictObject({ planId: IdString, expiresAt: Timestamp.nullable() });
export const AssignPlanRes = z.object({ planId: z.string(), expiresAt: Timestamp.nullable() });
export const ProgressResetBody = z.strictObject({ reason: Reason });
export const RoleParams = z.object({ id: IdString, role: Role });
export const RolesRes = z.object({ roles: z.array(Role) });

// ---------- Mic transcripts (moderator; every read is audited) ----------

export const AdminMicSessionRow = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  assistant: z.string(),
  mode: MicMode,
  mission: z.string().nullable(),
  extraId: z.string().nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
  secs: z.int().min(0),
  turns: z.int().min(0),
  flagged: z.boolean(),
});
export type AdminMicSessionRow = z.infer<typeof AdminMicSessionRow>;

export const AdminMicTurn = z.object({
  idx: z.int().min(0),
  who: z.enum(['me', 'her', 'coach']),
  en: z.string(),
  pt: z.string().nullable(),
  feedback: Feedback.nullable(),
  pron: z.array(PronTip).nullable(),
  words: z.array(Bilingual).nullable(),
  source: z.string().nullable(),
  createdAt: Timestamp,
});
export type AdminMicTurn = z.infer<typeof AdminMicTurn>;

export const AdminMicSession = AdminMicSessionRow.extend({
  report: ReportResult.nullable(),
  turnsList: z.array(AdminMicTurn),
});
export type AdminMicSession = z.infer<typeof AdminMicSession>;

export const MicSessionsQuery = PageQuery.extend({
  userId: IdString.optional(),
  flagged: QueryBool.optional(),
});

// ---------- Plans ----------

const PlanSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const PlanInput = z.strictObject({
  slug: PlanSlug,
  name: z.string().trim().min(1).max(80),
  aiMinutesMonth: z.int().min(0).max(100_000),
  features: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof PlanInput>;
export const PlanPatch = PlanInput.partial();
export type PlanPatch = z.infer<typeof PlanPatch>;
export const PlanRow = Plan.extend({ users: z.int().min(0) });

// ---------- Content entities (DB rows, camelCase; JSON columns typed) ----------

export const EpisodeRow = z.object({
  num: z.int().positive(),
  title: z.string(),
  seasonN: z.int().positive().nullable(),
  status: EpisodeStatus,
  ebookNum: z.int().positive().nullable(),
  synopsis: z.string().nullable(),
  introMedia: MediaId,
  songMedia: MediaId,
  songTitle: z.string().nullable(),
  sceneMedia: MediaId,
  sceneNote: z.string().nullable(),
  dialogTitle: z.string().nullable(),
  dialogSub: z.string().nullable(),
  lyrics: z.array(LyricLine),
  castNames: z.array(z.string()),
  visual: z.array(Bilingual),
  dialog: z.array(DialogLine),
  lesson: z.array(Block),
  pron: PronNote.nullable(),
  awayExp: z.array(AwayExp),
  awayWords: z.array(z.string()),
  done: EpisodeDone.nullable(),
  updatedAt: Timestamp,
  updatedBy: z.string().nullable(),
});
export type EpisodeRow = z.infer<typeof EpisodeRow>;

export const MicPhraseRow = z.object({
  id: z.string(),
  episodeNum: z.int().positive(),
  sort: z.int(),
  en: z.string(),
  tip: z.string().nullable(),
  demoResult: z.int().min(0).max(10).nullable(),
  blue: z.boolean(),
  fb: z.string().nullable(),
});
export type MicPhraseRow = z.infer<typeof MicPhraseRow>;

export const ExerciseRow = z.object({
  id: z.string(),
  episodeNum: z.int().positive(),
  sort: z.int(),
  kind: z.string(),
  title: z.string(),
  intro: z.string().nullable(),
  audio: z.enum(['tts', 'song']).nullable(),
  audioLabel: z.string().nullable(),
});
export type ExerciseRow = z.infer<typeof ExerciseRow>;

export const ExerciseItemRow = z.object({
  id: z.string(),
  exerciseId: z.string(),
  sort: z.int(),
  q: z.string(),
  opts: z.array(z.string()).min(2).max(4),
  answerIdx: z.int().min(0).max(3),
  fix: z.string().nullable(),
  say: z.string().nullable(),
});
export type ExerciseItemRow = z.infer<typeof ExerciseItemRow>;

export const EbookRow = z.object({
  num: z.int().positive(),
  title: z.string(),
  epsLabel: z.string().nullable(),
  scope: z.string().nullable(),
  five: z.array(Block),
  real: z.array(RealCard),
  lead: z.array(LeadTurn),
  chat: z.array(ChatTurn),
  extrasCards: z.array(EbookExtraCard),
  pdfMedia: MediaId,
  passScore: z.int().min(0),
  updatedAt: Timestamp,
});
export type EbookRow = z.infer<typeof EbookRow>;

export const TestQuestionRow = z.object({
  id: z.string(),
  ebookNum: z.int().positive(),
  partIdx: z.int().min(0),
  partTitle: z.string(),
  n: z.int().positive(),
  q: z.string(),
  rev: z.string().nullable(),
  epNum: z.int().positive().nullable(),
  step: z.int().min(1).max(10).nullable(),
  opts: z.array(z.string()).nullable(),
  answerIdx: z.int().min(0).nullable(),
  accept: z.array(z.string()).nullable(),
  show: z.string().nullable(),
  audio: z.string().nullable(),
});
export type TestQuestionRow = z.infer<typeof TestQuestionRow>;

export const ExtraRow = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string().nullable(),
  format: z.string(),
  genres: z.array(z.string()),
  themes: z.array(z.string()),
  level: z.string().nullable(),
  cefr: z.int().min(1).max(3).nullable(),
  epLabel: z.string().nullable(),
  dur: z.string().nullable(),
  coverMedia: MediaId,
  sceneMedia: MediaId,
  synopsis: z.string().nullable(),
  cast: z.array(ExtraCast),
  dub: z.string().nullable(),
  premiere: z.boolean(),
  locked: z.boolean(),
  premium: z.boolean(),
  lines: z.array(ExtraLine),
  vocab: z.array(Bilingual),
  sort: z.int(),
  status: z.enum(['draft', 'published']),
});
export type ExtraRow = z.infer<typeof ExtraRow>;

export const AlbumRow = z.object({
  id: z.string(),
  title: z.string(),
  sub: z.string().nullable(),
  level: z.string().nullable(),
  imgMedia: MediaId,
  genres: z.array(z.string()),
  sort: z.int(),
});
export type AlbumRow = z.infer<typeof AlbumRow>;

export const TrackRow = z.object({
  id: z.string(),
  albumId: z.string(),
  sort: z.int(),
  title: z.string(),
  srcFrom: z.string().nullable(),
  audioMedia: MediaId,
  epNum: z.int().positive().nullable(),
  bpm: z.int().positive().nullable(),
  musicKey: z.int().min(0).max(11).nullable(),
  lines: z.array(KaraokeLine).nullable(),
});
export type TrackRow = z.infer<typeof TrackRow>;

/** Persona is edited through its own admin-only endpoint and never listed here. */
export const AssistantRow = z.object({
  key: z.string(),
  name: z.string(),
  fullName: z.string(),
  art: z.enum(['a', 'o']),
  age: z.int().nullable(),
  aka: z.array(z.string()),
  role: z.string().nullable(),
  tag: z.string().nullable(),
  style: z.string().nullable(),
  helloEn: z.string().nullable(),
  helloPt: z.string().nullable(),
  voice: AssistantVoice.omit({ tts: true }),
  ttsSpeaker: z.string(),
  posterMedia: MediaId,
  thumbMedia: MediaId,
  clips: z.partialRecord(ClipState, IdString),
  sort: z.int(),
  active: z.boolean(),
});
export type AssistantRow = z.infer<typeof AssistantRow>;

export const MissionRow = z.object({
  key: z.string(),
  title: z.string(),
  role: z.string().nullable(),
  goal: z.string().nullable(),
  turns: z.array(MissionTurn).min(1),
  sort: z.int(),
});
export type MissionRow = z.infer<typeof MissionRow>;

/** content_blobs keys the compiler reads (hardcoded prototype constants moved to D1). */
export const BLOB_KEYS = [
  'focus',
  'personalize',
  'extras_shelves',
  'srs_grades',
  'mic_modes',
  'mic_openers',
  'mic_follow',
  'mic_pron',
  'mic_help',
  'ebook_teasers',
  'scene_images',
  'ui_images',
  'onboarding_meta',
] as const;

export const BlobRow = z.object({
  key: z.string(),
  json: z.unknown(),
  updatedAt: Timestamp,
  updatedBy: z.string().nullable(),
});
export type BlobRow = z.infer<typeof BlobRow>;

export const OptionListRow = z.object({
  listKey: z.string(),
  /** Format key for genres, '' otherwise. */
  scope: z.string(),
  itemKey: z.string(),
  sort: z.int(),
  label: z.string(),
  sub: z.string().nullable(),
  icon: z.string().nullable(),
  imgMedia: MediaId,
  extra: z.unknown().nullable(),
});
export type OptionListRow = z.infer<typeof OptionListRow>;

/** Create body = the row's editable columns (strict); update body = the same, all optional. */
function editable<T extends z.ZodRawShape>(row: z.ZodObject<T>) {
  const create = z.strictObject(row.shape);
  return { create, update: create.partial() };
}

function crud<Item extends z.ZodType, Create extends z.ZodType, Update extends z.ZodType>(
  name: string,
  item: Item,
  create: Create,
  update: Update,
) {
  const base = `/admin-api/content/${name}` as const;
  const one = z.object({ item });
  return {
    list: endpoint({
      method: 'GET',
      path: base,
      access: 'staff',
      perm: 'content.edit',
      query: z.object({ parent: z.string().max(120).optional() }),
      res: z.object({ items: z.array(item) }),
    }),
    get: endpoint({
      method: 'GET',
      path: `${base}/:id`,
      access: 'staff',
      perm: 'content.edit',
      params: IdParams,
      res: one,
    }),
    create: endpoint({ method: 'POST', path: base, access: 'staff', perm: 'content.edit', body: create, res: one }),
    update: endpoint({
      method: 'PUT',
      path: `${base}/:id`,
      access: 'staff',
      perm: 'content.edit',
      params: IdParams,
      body: update,
      res: one,
    }),
    remove: endpoint({
      method: 'DELETE',
      path: `${base}/:id`,
      access: 'staff',
      perm: 'content.edit',
      params: IdParams,
      res: Ok,
    }),
  };
}

export const EpisodeEdit = editable(EpisodeRow.omit({ updatedAt: true, updatedBy: true }));
export const MicPhraseEdit = editable(MicPhraseRow);
export const ExerciseEdit = editable(ExerciseRow);
export const ExerciseItemEdit = editable(ExerciseItemRow);
export const EbookEdit = editable(EbookRow.omit({ updatedAt: true }));
export const TestQuestionEdit = editable(TestQuestionRow);
export const ExtraEdit = editable(ExtraRow);
export const AlbumEdit = editable(AlbumRow);
export const TrackEdit = editable(TrackRow);
export const AssistantEdit = editable(AssistantRow);
export const MissionEdit = editable(MissionRow);
/**
 * Assistant create also takes an optional persona (spec 05 note #1): the column is NOT NULL, so it
 * is stored as '' when absent. Sending it needs ai.persona; afterwards it is edited only through
 * adminAiApi.setPersona.
 */
export const AssistantCreateBody = AssistantEdit.create.extend({
  persona: z.string().trim().min(1).max(4000).optional(),
});
export type AssistantCreateBody = z.infer<typeof AssistantCreateBody>;

export const OptionListItemInput = z.strictObject({
  scope: z.string().max(40).default(''),
  itemKey: z.string().min(1).max(60),
  sort: z.int(),
  label: z.string().min(1).max(200),
  sub: z.string().max(300).nullable().default(null),
  icon: z.string().max(40).nullable().default(null),
  imgMedia: MediaId.default(null),
  extra: z.unknown().nullable().default(null),
});
export const OptionListPutBody = z.strictObject({ items: z.array(OptionListItemInput).max(200) });
export const OptionListParams = z.object({ listKey: z.string().regex(/^[a-z_]{1,40}$/) });

export const BlobPutBody = z.strictObject({ json: z.unknown() });
export const BlobParams = z.object({ key: z.enum(BLOB_KEYS) });

// ---------- AI configuration (admin) ----------

export const PersonaRes = z.object({ key: z.string(), persona: z.string() });
export const PersonaBody = z.strictObject({ persona: z.string().trim().min(1).max(4000) });

export const PromptRow = z.object({
  key: z.string(),
  template: z.string(),
  version: z.int().positive(),
  updatedBy: z.string().nullable(),
  updatedAt: Timestamp,
});
export type PromptRow = z.infer<typeof PromptRow>;
/** `expectedVersion` guards against overwriting a newer edit (409 conflict). */
export const PromptPutBody = z.strictObject({
  template: z.string().min(1).max(20_000),
  expectedVersion: z.int().positive().optional(),
});
export const KeyParams = z.object({ key: z.string().min(1).max(80) });

export const PointRuleRow = z.object({
  kind: PointKind,
  points: z.int().min(0).max(1000),
  dailyCap: z.int().min(0).nullable(),
  verifiable: z.boolean(),
});
export const LevelRow = z.object({ n: z.int().positive(), minPoints: z.int().min(0), name: z.string().min(1) });
export const BadgeRow = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().min(1),
  sub: z.string(),
  icon: z.string().min(1),
  rule: BadgeRule,
  sort: z.int(),
});
export const Gamification = z.object({
  pointRules: z.array(PointRuleRow),
  levels: z.array(LevelRow).min(1),
  badges: z.array(BadgeRow),
});
export type Gamification = z.infer<typeof Gamification>;
export const GamificationBody = z.strictObject({
  pointRules: z.array(z.strictObject(PointRuleRow.shape)),
  levels: z.array(z.strictObject(LevelRow.shape)).min(1),
  badges: z.array(z.strictObject(BadgeRow.shape)),
});

// ---------- Publish and releases ----------

export const PreviewIssue = z.object({ file: z.string(), path: z.string(), message: z.string() });
export const PreviewRes = z.object({
  version: z.string(),
  manifest: ContentManifest,
  /** Files whose content differs from the current release. */
  changed: z.array(z.string()),
  errors: z.array(PreviewIssue),
});
export type PreviewRes = z.infer<typeof PreviewRes>;

export const Release = z.object({
  id: z.string(),
  version: z.string(),
  manifest: ContentManifest,
  notes: z.string().nullable(),
  publishedBy: z.string(),
  publishedAt: Timestamp,
});
export type Release = z.infer<typeof Release>;
export const PublishBody = z.strictObject({ notes: z.string().max(LIMITS.freeTextMax).optional() });
export const ReleasesRes = z.object({ items: z.array(Release), current: z.string().nullable() });

// ---------- Media ----------

export const MediaKind = z.enum(['image', 'audio', 'video', 'pdf']);
export const MediaRow = z.object({
  id: z.string(),
  r2Key: z.string(),
  url: z.string(),
  kind: MediaKind,
  mime: z.string(),
  bytes: z.int().min(0),
  sha256: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  durationMs: z.int().nullable(),
  sourcePath: z.string().nullable(),
  createdAt: Timestamp,
});
export type MediaRow = z.infer<typeof MediaRow>;
export const MediaQuery = PageQuery.extend({ kind: MediaKind.optional(), q: z.string().max(200).optional() });
export const MediaRef = z.object({ table: z.string(), id: z.string(), column: z.string() });
export const MediaRefsRes = z.object({ refs: z.array(MediaRef) });

// ---------- Moderation ----------

export const ModerationKind = z.enum(['photo', 'transcript', 'recording', 'report']);
export const ModerationStatus = z.enum(['pending', 'approved', 'removed', 'dismissed']);
export const ModerationItem = z.object({
  id: z.string(),
  kind: ModerationKind,
  subjectUserId: z.string().nullable(),
  reporterUserId: z.string().nullable(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  reason: z.string().nullable(),
  guardCategories: z.array(z.string()).nullable(),
  excerpt: z.string().nullable(),
  priority: z.int(),
  status: ModerationStatus,
  createdAt: Timestamp,
  reviewedBy: z.string().nullable(),
  reviewedAt: Timestamp.nullable(),
  notes: z.string().nullable(),
  /** Photo preview (owner/admin media URL) when kind = 'photo'. */
  mediaUrl: z.string().nullable(),
});
export type ModerationItem = z.infer<typeof ModerationItem>;
export const ModerationQuery = PageQuery.extend({
  status: ModerationStatus.optional(),
  kind: ModerationKind.optional(),
});
export const DecisionBody = z.strictObject({
  decision: ModerationStatus.exclude(['pending']),
  notes: z.string().max(LIMITS.freeTextMax).optional(),
});

// ---------- Audit, flags, settings, stats ----------

export const AuditEntry = z.object({
  id: z.int(),
  at: Timestamp,
  actorUserId: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ipHash: z.string().nullable(),
  ua: z.string().nullable(),
  diff: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditQuery = PageQuery.extend({
  actor: IdString.optional(),
  action: z.string().max(80).optional(),
  targetType: z.string().max(60).optional(),
  targetId: z.string().max(120).optional(),
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
});

export const FeatureFlag = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rolloutPct: z.int().min(0).max(100),
  rules: z.unknown().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: Timestamp,
});
export type FeatureFlag = z.infer<typeof FeatureFlag>;
export const FlagPutBody = z.strictObject({
  enabled: z.boolean(),
  rolloutPct: z.int().min(0).max(100).default(100),
  rules: z.unknown().nullable().default(null),
});

export const AppSetting = z.object({
  key: z.string(),
  value: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: Timestamp,
});
export type AppSetting = z.infer<typeof AppSetting>;
export const SettingPutBody = z.strictObject({ value: z.string().max(10_000) });

export const AdminStats = z.object({
  users: z.object({
    total: z.int(),
    /** Distinct learners active since local midnight (America/Sao_Paulo). */
    activeToday: z.int(),
    active7d: z.int(),
    active30d: z.int(),
    new7d: z.int(),
    suspended: z.int(),
  }),
  ai: z.object({
    secondsThisMonth: z.int(),
    /** secondsThisMonth / 60, rounded up. */
    minutesThisMonth: z.int(),
    calls24h: z.int(),
    errors24h: z.int(),
    /** errors24h / calls24h (0 when there were no calls), 0..1. */
    failureRate24h: z.number().min(0).max(1),
  }),
  moderation: z.object({ pending: z.int(), flaggedSessions: z.int() }),
  content: z.object({ current: z.string().nullable(), publishedAt: Timestamp.nullable() }),
});
export type AdminStats = z.infer<typeof AdminStats>;

// ---------- Endpoints ----------

const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const adminAuthApi = {
  login: endpoint({
    method: 'POST',
    path: '/admin-api/auth/login',
    access: 'public',
    body: AdminLoginBody,
    res: AdminAuthRes,
    rateLimit: 'RL_AUTH',
  }),
  logout: endpoint({ method: 'POST', path: '/admin-api/auth/logout', access: 'public', res: Ok }),
  me: endpoint({ method: 'GET', path: '/admin-api/auth/me', access: 'staff', res: AdminAuthRes }),
  inviteInfo: endpoint({
    method: 'GET',
    path: '/admin-api/auth/invite/:token',
    access: 'public',
    params: InviteParams,
    res: InviteInfo,
    rateLimit: 'RL_AUTH',
  }),
  inviteAccept: endpoint({
    method: 'POST',
    path: '/admin-api/auth/invite/accept',
    access: 'public',
    body: InviteAcceptBody,
    res: AdminAuthRes,
    rateLimit: 'RL_AUTH',
  }),
} as const;

/**
 * The signed-in staff member's own account (any staff role, no permission). Kept out of `adminApi`
 * because every endpoint listed there names a permission (shared contracts test); the admin Worker
 * routes it all the same.
 */
export const adminAccountApi = {
  password: endpoint({
    method: 'POST',
    path: '/admin-api/auth/password',
    access: 'staff',
    body: AdminPasswordBody,
    res: Ok,
    rateLimit: 'RL_AUTH',
  }),
} as const;

export const adminUsersApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/users',
    access: 'staff',
    perm: 'users.read',
    query: UsersQuery,
    res: Page(AdminUserRow),
  }),
  get: endpoint({
    method: 'GET',
    path: '/admin-api/users/:id',
    access: 'staff',
    perm: 'users.read',
    params: IdParams,
    res: UserDetail,
  }),
  suspend: endpoint({
    method: 'POST',
    path: '/admin-api/users/:id/suspend',
    access: 'staff',
    perm: 'users.suspend',
    params: IdParams,
    body: SuspendBody,
    res: SuspendRes,
  }),
  remove: endpoint({
    method: 'DELETE',
    path: '/admin-api/users/:id',
    access: 'staff',
    perm: 'users.delete',
    params: IdParams,
    body: DeleteUserBody,
    res: Ok,
  }),
  assignPlan: endpoint({
    method: 'PUT',
    path: '/admin-api/users/:id/plan',
    access: 'staff',
    perm: 'users.plan',
    params: IdParams,
    body: AssignPlanBody,
    res: AssignPlanRes,
  }),
  resetLink: endpoint({
    method: 'POST',
    path: '/admin-api/users/:id/reset-link',
    access: 'staff',
    perm: 'users.reset_link',
    params: IdParams,
    res: LinkRes,
  }),
  progressReset: endpoint({
    method: 'POST',
    path: '/admin-api/users/:id/progress-reset',
    access: 'staff',
    perm: 'users.progress_reset',
    params: IdParams,
    body: ProgressResetBody,
    res: Ok,
  }),
  /** Route also checks canGrantRole(actor, role): admin needs roles.grant_admin. */
  grantRole: endpoint({
    method: 'PUT',
    path: '/admin-api/users/:id/roles/:role',
    access: 'staff',
    perm: 'roles.grant_staff',
    params: RoleParams,
    res: RolesRes,
  }),
  revokeRole: endpoint({
    method: 'DELETE',
    path: '/admin-api/users/:id/roles/:role',
    access: 'staff',
    perm: 'roles.grant_staff',
    params: RoleParams,
    res: RolesRes,
  }),
  invite: endpoint({
    method: 'POST',
    path: '/admin-api/invites',
    access: 'staff',
    perm: 'roles.grant_staff',
    body: CreateInviteBody,
    res: LinkRes,
  }),
  micSessions: endpoint({
    method: 'GET',
    path: '/admin-api/mic-sessions',
    access: 'staff',
    perm: 'transcripts.read',
    query: MicSessionsQuery,
    res: Page(AdminMicSessionRow),
    audited: true,
  }),
  micSession: endpoint({
    method: 'GET',
    path: '/admin-api/mic-sessions/:id',
    access: 'staff',
    perm: 'transcripts.read',
    params: IdParams,
    res: z.object({ session: AdminMicSession }),
    audited: true,
  }),
} as const;

export const adminPlansApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/plans',
    access: 'staff',
    perm: 'plans.manage',
    res: items(PlanRow),
  }),
  create: endpoint({
    method: 'POST',
    path: '/admin-api/plans',
    access: 'staff',
    perm: 'plans.manage',
    body: PlanInput,
    res: z.object({ plan: Plan }),
  }),
  update: endpoint({
    method: 'PUT',
    path: '/admin-api/plans/:id',
    access: 'staff',
    perm: 'plans.manage',
    params: IdParams,
    body: PlanPatch,
    res: z.object({ plan: Plan }),
  }),
  /** Deactivates; 409 in_use while users are assigned or it is the default plan. */
  remove: endpoint({
    method: 'DELETE',
    path: '/admin-api/plans/:id',
    access: 'staff',
    perm: 'plans.manage',
    params: IdParams,
    res: Ok,
  }),
} as const;

/** `list` accepts ?parent= (episode num, exercise id, ebook num or album id) for child entities. */
export const adminContentApi = {
  episodes: crud('episodes', EpisodeRow, EpisodeEdit.create, EpisodeEdit.update),
  micPhrases: crud('mic-phrases', MicPhraseRow, MicPhraseEdit.create, MicPhraseEdit.update),
  exercises: crud('exercises', ExerciseRow, ExerciseEdit.create, ExerciseEdit.update),
  items: crud('items', ExerciseItemRow, ExerciseItemEdit.create, ExerciseItemEdit.update),
  ebooks: crud('ebooks', EbookRow, EbookEdit.create, EbookEdit.update),
  testQuestions: crud('test-questions', TestQuestionRow, TestQuestionEdit.create, TestQuestionEdit.update),
  extras: crud('extras', ExtraRow, ExtraEdit.create, ExtraEdit.update),
  albums: crud('albums', AlbumRow, AlbumEdit.create, AlbumEdit.update),
  tracks: crud('tracks', TrackRow, TrackEdit.create, TrackEdit.update),
  assistants: crud('assistants', AssistantRow, AssistantCreateBody, AssistantEdit.update),
  missions: crud('missions', MissionRow, MissionEdit.create, MissionEdit.update),
  blobs: {
    list: endpoint({
      method: 'GET',
      path: '/admin-api/content/blobs',
      access: 'staff',
      perm: 'content.edit',
      res: items(BlobRow),
    }),
    get: endpoint({
      method: 'GET',
      path: '/admin-api/content/blobs/:key',
      access: 'staff',
      perm: 'content.edit',
      params: BlobParams,
      res: z.object({ item: BlobRow }),
    }),
    put: endpoint({
      method: 'PUT',
      path: '/admin-api/content/blobs/:key',
      access: 'staff',
      perm: 'content.edit',
      params: BlobParams,
      body: BlobPutBody,
      res: z.object({ item: BlobRow }),
    }),
  },
  optionLists: {
    list: endpoint({
      method: 'GET',
      path: '/admin-api/content/option-lists',
      access: 'staff',
      perm: 'content.edit',
      res: items(OptionListRow),
    }),
    /** Replaces every row of one list (all scopes). */
    put: endpoint({
      method: 'PUT',
      path: '/admin-api/content/option-lists/:listKey',
      access: 'staff',
      perm: 'content.edit',
      params: OptionListParams,
      body: OptionListPutBody,
      res: items(OptionListRow),
    }),
  },
  preview: endpoint({
    method: 'POST',
    path: '/admin-api/content/preview',
    access: 'staff',
    perm: 'content.publish',
    res: PreviewRes,
  }),
  publish: endpoint({
    method: 'POST',
    path: '/admin-api/content/publish',
    access: 'staff',
    perm: 'content.publish',
    body: PublishBody,
    res: z.object({ release: Release }),
  }),
} as const;

export const adminAiApi = {
  persona: endpoint({
    method: 'GET',
    path: '/admin-api/assistants/:key/persona',
    access: 'staff',
    perm: 'ai.persona',
    params: KeyParams,
    res: PersonaRes,
  }),
  setPersona: endpoint({
    method: 'PUT',
    path: '/admin-api/assistants/:key/persona',
    access: 'staff',
    perm: 'ai.persona',
    params: KeyParams,
    body: PersonaBody,
    res: PersonaRes,
  }),
  prompts: endpoint({
    method: 'GET',
    path: '/admin-api/prompts',
    access: 'staff',
    perm: 'ai.prompts',
    res: items(PromptRow),
  }),
  setPrompt: endpoint({
    method: 'PUT',
    path: '/admin-api/prompts/:key',
    access: 'staff',
    perm: 'ai.prompts',
    params: KeyParams,
    body: PromptPutBody,
    res: z.object({ item: PromptRow }),
  }),
  gamification: endpoint({
    method: 'GET',
    path: '/admin-api/gamification',
    access: 'staff',
    perm: 'game.rules',
    res: Gamification,
  }),
  setGamification: endpoint({
    method: 'PUT',
    path: '/admin-api/gamification',
    access: 'staff',
    perm: 'game.rules',
    body: GamificationBody,
    res: Gamification,
  }),
} as const;

export const adminReleasesApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/releases',
    access: 'staff',
    perm: 'releases.manage',
    res: ReleasesRes,
  }),
  rollback: endpoint({
    method: 'POST',
    path: '/admin-api/releases/:id/rollback',
    access: 'staff',
    perm: 'releases.manage',
    params: IdParams,
    res: z.object({ current: z.string() }),
  }),
} as const;

export const adminMediaApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/media',
    access: 'staff',
    perm: 'media.manage',
    query: MediaQuery,
    res: Page(MediaRow),
  }),
  /** multipart/form-data, field "file"; type checked by magic bytes against the allowlist. */
  upload: endpoint({
    method: 'POST',
    path: '/admin-api/media',
    access: 'staff',
    perm: 'media.manage',
    multipart: { field: 'file', maxBytes: LIMITS.mediaMaxBytes, mime: MEDIA_MIME },
    res: z.object({ media: MediaRow }),
    rateLimit: 'RL_UPLOAD',
  }),
  refs: endpoint({
    method: 'GET',
    path: '/admin-api/media/:id/refs',
    access: 'staff',
    perm: 'media.manage',
    params: IdParams,
    res: MediaRefsRes,
  }),
  /** 409 in_use while anything references it. */
  remove: endpoint({
    method: 'DELETE',
    path: '/admin-api/media/:id',
    access: 'staff',
    perm: 'media.manage',
    params: IdParams,
    res: Ok,
  }),
} as const;

export const adminModerationApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/moderation',
    access: 'staff',
    perm: 'moderation.manage',
    query: ModerationQuery,
    res: Page(ModerationItem),
  }),
  decide: endpoint({
    method: 'POST',
    path: '/admin-api/moderation/:id/decision',
    access: 'staff',
    perm: 'moderation.manage',
    params: IdParams,
    body: DecisionBody,
    res: z.object({ item: ModerationItem }),
  }),
} as const;

export const adminOpsApi = {
  audit: endpoint({
    method: 'GET',
    path: '/admin-api/audit',
    access: 'staff',
    perm: 'audit.read',
    query: AuditQuery,
    res: Page(AuditEntry),
  }),
  flags: endpoint({
    method: 'GET',
    path: '/admin-api/flags',
    access: 'staff',
    perm: 'flags.manage',
    res: items(FeatureFlag),
  }),
  setFlag: endpoint({
    method: 'PUT',
    path: '/admin-api/flags/:key',
    access: 'staff',
    perm: 'flags.manage',
    params: KeyParams,
    body: FlagPutBody,
    res: z.object({ item: FeatureFlag }),
  }),
  settings: endpoint({
    method: 'GET',
    path: '/admin-api/settings',
    access: 'staff',
    perm: 'settings.manage',
    res: items(AppSetting),
  }),
  setSetting: endpoint({
    method: 'PUT',
    path: '/admin-api/settings/:key',
    access: 'staff',
    perm: 'settings.manage',
    params: KeyParams,
    body: SettingPutBody,
    res: z.object({ item: AppSetting }),
  }),
  stats: endpoint({ method: 'GET', path: '/admin-api/stats', access: 'staff', perm: 'stats.read', res: AdminStats }),
} as const;

export const adminApi = {
  auth: adminAuthApi,
  users: adminUsersApi,
  plans: adminPlansApi,
  content: adminContentApi,
  ai: adminAiApi,
  releases: adminReleasesApi,
  media: adminMediaApi,
  moderation: adminModerationApi,
  ops: adminOpsApi,
} as const;

/** Flattens a nested endpoint map (for route tables and tests). */
export function listEndpoints(tree: unknown): EndpointDef[] {
  const out: EndpointDef[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if ('method' in node && 'path' in node && 'access' in node) {
      out.push(node as EndpointDef);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(tree);
  return out;
}
