import { z } from 'zod';
import { BACKUP, LIMITS } from '../constants';
import { EpisodeStatus } from '../content/schema';
import {
  BLOB_KEYS,
  BlobRow,
  EbookEdit,
  EbookRow,
  EpisodeEdit,
  EpisodeRow,
  ExerciseItemRow,
  ExerciseRow,
  MicPhraseRow,
  OptionListItemInput,
  OptionListRow,
  PreviewRes,
  PublishBody,
  Release,
  SeasonEdit,
  SeasonRow,
  TestQuestionRow,
} from './admin';
import type { ApiTokenScope } from './apiTokens';
import { BackupRow } from './backups';
import { Timestamp } from './common';
import { endpoint } from './http';
import {
  SeasonTestQuestionInput,
  SeasonTestQuestionPatch,
  SeasonTestQuestionRow,
  SeasonTestQuestionStatus,
  SeasonTestReviewBody,
} from './seasonTest';

// MCP server in tie-admin (spec 07, feature D): lets an AI agent (Claude) read and edit content
// through the Model Context Protocol, Streamable HTTP transport, stateless, JSON responses only.
//
//   POST /admin-api/mcp   Authorization: Bearer tie_pat_…   Content-Type: application/json
//   body: one JSON-RPC 2.0 message (no batches). Requests answer 200 application/json with the
//   JSON-RPC response; notifications (no id) answer 202 with no body. GET/DELETE answer 405.
//   No cookie is read or set, so the route is CSRF-exempt (worker-core csrf `bearer` option) but
//   only for requests that carry a Bearer token and no Cookie header.
//
// Methods: initialize, notifications/initialized, ping, tools/list, tools/call. tools/list
// publishes each MCP_TOOLS input as JSON Schema (z.toJSONSchema(input, { io: 'input' })).
// tools/call validates `arguments` with the tool's schema; a validation or domain error is a tool
// result with isError: true (pt-BR/English message), not a JSON-RPC error.
//
// Every write reuses the admin route's rules (same checks, same audit action as the admin UI, e.g.
// content.episodes.update) with actor_user_id = token creator, actor_role = AUDIT_AGENT_ROLE and the
// diff extended with `_agent: { tokenId, tokenName, tool }`.
//
// Full autonomy (added after spec 07 D, docs/MCP.md): generic create/update/delete over every content
// entity of the admin CMS (CONTENT_ENTITIES, same rules as /admin-api/content/*), blobs and option
// lists and content backups (content.edit); with the content.publish scope also episode/extra status,
// season test review and publish, and releases (publish, rollback). Deleting still refuses rows that
// learner data points at (in_use): an agent never destroys learner progress.

export const MCP_PATH = '/admin-api/mcp';
/** Preferred first. initialize answers the client's version when listed here, else the first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
export const MCP_SERVER_INFO = { name: 'take-it-easy-admin', title: 'Take It Easy (admin)', version: '1.0.0' } as const;

// ---------- JSON-RPC 2.0 ----------

export const JsonRpcId = z.union([z.string().max(200), z.int()]);
export type JsonRpcId = z.infer<typeof JsonRpcId>;

/** Top-level keys are stripped, not rejected (protocol messages may grow); params stay as sent. */
export const JsonRpcMessage = z.object({
  jsonrpc: z.literal('2.0'),
  /** Absent for notifications. */
  id: JsonRpcId.optional(),
  method: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type JsonRpcMessage = z.infer<typeof JsonRpcMessage>;

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export const JsonRpcErrorObject = z.object({ code: z.int(), message: z.string(), data: z.unknown().optional() });

export const JsonRpcResponse = z.union([
  z.object({ jsonrpc: z.literal('2.0'), id: JsonRpcId, result: z.unknown() }),
  z.object({ jsonrpc: z.literal('2.0'), id: JsonRpcId.nullable(), error: JsonRpcErrorObject }),
]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

/** tools/call result: the JSON output as text, plus structuredContent (MCP 2025-06-18). */
export const McpToolResult = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});
export type McpToolResult = z.infer<typeof McpToolResult>;

export const adminMcpApi = {
  rpc: endpoint({
    method: 'POST',
    path: MCP_PATH,
    access: 'agent',
    body: JsonRpcMessage,
    res: JsonRpcResponse,
    rateLimit: 'RL_API',
  }),
} as const;

// ---------- Tools ----------

const SeasonN = z.int().positive();
const EpisodeNum = z.int().positive();
const EbookNum = z.int().positive();

/** Episode keys an agent may ask for in get_episode (num, title and updatedAt always come). */
export const EPISODE_SECTIONS = [
  'seasonN',
  'status',
  'ebookNum',
  'synopsis',
  'introMedia',
  'songMedia',
  'songTitle',
  'sceneMedia',
  'sceneNote',
  'dialogTitle',
  'dialogSub',
  'lyrics',
  'castNames',
  'visual',
  'dialog',
  'lesson',
  'pron',
  'awayExp',
  'awayWords',
  'done',
] as const satisfies readonly (keyof EpisodeRow)[];
export const EpisodeSection = z.enum(EPISODE_SECTIONS);

/**
 * update_episode patch: any EpisodeEdit field except the number and the status (an agent never
 * changes what is published). Each key replaces that whole section; the merged episode must still
 * be valid (same checks as PUT /admin-api/content/episodes/:id).
 */
export const AgentEpisodePatch = EpisodeEdit.update.omit({ num: true, status: true });
export const AgentEbookPatch = EbookEdit.update.omit({ num: true });
export const AgentSeasonPatch = SeasonEdit.update.omit({ n: true });

/** Optimistic concurrency: refuse the write (isError, conflict) when the row changed since this read. */
const ExpectedUpdatedAt = Timestamp.optional();

/** Every CMS entity of /admin-api/content/<name> (admin worker lib/entities ENTITIES). */
export const CONTENT_ENTITIES = [
  'seasons',
  'episodes',
  'mic-phrases',
  'exercises',
  'items',
  'ebooks',
  'test-questions',
  'extras',
  'albums',
  'tracks',
  'assistants',
  'missions',
] as const;
export const ContentEntity = z.enum(CONTENT_ENTITIES);
export type ContentEntity = z.infer<typeof ContentEntity>;
/** A row id: a number for seasons, episodes and ebooks, a text id otherwise. */
const ContentId = z.union([z.int().positive(), z.string().min(1).max(120)]);
/** A content row in API shape; the server validates it with the entity's own strict schema. */
const ContentItem = z.record(z.string(), z.unknown());
const BlobKey = z.enum(BLOB_KEYS);
const OptionListKey = z.string().regex(/^[a-z_]{1,40}$/);

export const McpEpisodeSummary = EpisodeRow.pick({
  num: true,
  title: true,
  seasonN: true,
  status: true,
  ebookNum: true,
  updatedAt: true,
});

interface ToolDef {
  /** Human title for clients. */
  title: string;
  /** For the model (English): what it does and when to use it. */
  description: string;
  scope: ApiTokenScope;
  readOnly: boolean;
  input: z.ZodType;
  output: z.ZodType;
}

const tool = <const T extends ToolDef>(def: T): T => def;

export const MCP_TOOLS = {
  list_seasons: tool({
    title: 'List seasons',
    description:
      'Lists every season with its title, synopsis and season-test settings, plus how many episodes it has and whether its test is published.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({}),
    output: z.object({
      items: z.array(SeasonRow.extend({ episodes: z.int().min(0), testPublished: z.boolean() })),
    }),
  }),
  get_season: tool({
    title: 'Get season',
    description: 'Returns one season and the summary of its episodes.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ n: SeasonN }),
    output: z.object({
      item: SeasonRow.extend({ testPublished: z.boolean() }),
      episodes: z.array(McpEpisodeSummary),
    }),
  }),
  update_season: tool({
    title: 'Update season',
    description:
      'Edits a season (title, synopsis in Brazilian Portuguese, test pass percentage, test question count). Learners see title/synopsis only after a human publishes a release.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ n: SeasonN, patch: AgentSeasonPatch, expectedUpdatedAt: ExpectedUpdatedAt }),
    output: z.object({ item: SeasonRow }),
  }),
  list_episodes: tool({
    title: 'List episodes',
    description: 'Lists episodes (number, title, season, status, e-book), optionally filtered by season or status.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ seasonN: SeasonN.optional(), status: EpisodeStatus.optional() }),
    output: z.object({ items: z.array(McpEpisodeSummary) }),
  }),
  get_episode: tool({
    title: 'Get episode',
    description:
      'Returns one episode. Pass `sections` to fetch only some keys (lyrics, dialog, lesson…) and keep the answer small; `include` adds the read-only Mic phrases and exercises (with items).',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({
      num: EpisodeNum,
      sections: z.array(EpisodeSection).min(1).optional(),
      include: z.array(z.enum(['micPhrases', 'exercises'])).optional(),
    }),
    output: z.object({
      item: EpisodeRow.partial().required({ num: true, title: true, updatedAt: true }),
      micPhrases: z.array(MicPhraseRow).optional(),
      exercises: z.array(ExerciseRow.extend({ items: z.array(ExerciseItemRow) })).optional(),
    }),
  }),
  update_episode: tool({
    title: 'Update episode',
    description:
      'Replaces whole sections of an episode (e.g. {"lesson": [...]} or {"synopsis": "..."}); omitted sections stay. Cannot change the number or the status. Content copy is Brazilian Portuguese; English lines stay English. Nothing reaches learners until a human publishes a release.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ num: EpisodeNum, patch: AgentEpisodePatch, expectedUpdatedAt: ExpectedUpdatedAt }),
    output: z.object({ item: EpisodeRow }),
  }),
  list_ebooks: tool({
    title: 'List e-books',
    description: 'Lists every e-book (number, title, episodes label, pass score).',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({}),
    output: z.object({
      items: z.array(
        EbookRow.pick({ num: true, title: true, epsLabel: true, scope: true, passScore: true, updatedAt: true }),
      ),
    }),
  }),
  get_ebook: tool({
    title: 'Get e-book',
    description: 'Returns one e-book; `includeTest` adds its test questions.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ num: EbookNum, includeTest: z.boolean().optional() }),
    output: z.object({ item: EbookRow, test: z.array(TestQuestionRow).optional() }),
  }),
  update_ebook: tool({
    title: 'Update e-book',
    description:
      'Replaces whole sections of an e-book (five, real, lead, chat, extrasCards, title…); omitted sections stay. Nothing reaches learners until a human publishes a release.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ num: EbookNum, patch: AgentEbookPatch, expectedUpdatedAt: ExpectedUpdatedAt }),
    output: z.object({ item: EbookRow }),
  }),
  list_season_test_questions: tool({
    title: 'List season test questions',
    description: 'Lists the questions of a season test (all statuses unless `status` is given), with answers.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ seasonN: SeasonN, status: SeasonTestQuestionStatus.optional() }),
    output: z.object({ items: z.array(SeasonTestQuestionRow) }),
  }),
  draft_season_test_questions: tool({
    title: 'Draft season test questions',
    description:
      'Creates new season test questions as DRAFTS (source "agent"). Staff review and approve them in the admin; drafts never reach learners. A question is multiple choice (opts + answerIdx) or typed (accept), written for Brazilian learners of English.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({
      seasonN: SeasonN,
      questions: z.array(SeasonTestQuestionInput).min(1).max(LIMITS.seasonTestDraftMax),
    }),
    output: z.object({ items: z.array(SeasonTestQuestionRow) }),
  }),
  update_season_test_question: tool({
    title: 'Update season test question',
    description:
      'Edits one season test question. Any edit made through this tool sends the question back to "draft" for staff review.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ seasonN: SeasonN, id: z.string().min(1).max(120), patch: SeasonTestQuestionPatch }),
    output: z.object({ item: SeasonTestQuestionRow }),
  }),
  preview_release: tool({
    title: 'Preview release',
    description:
      'Compiles the current content exactly as a publish would and returns the validation problems and the changed files, WITHOUT publishing. Use it after edits to check your work.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({}),
    output: PreviewRes,
  }),

  // ---------- Generic content CRUD (every CMS table) ----------

  describe_content: tool({
    title: 'Describe content entity',
    description:
      'Explains one content entity before you create or edit it: its id key, its parent (e.g. exercises belong to an episode, items to an exercise), the JSON Schema of a full item and an example read from the database. Entities: seasons, episodes, mic-phrases, exercises, items (exercise items), ebooks, test-questions (e-book test), extras, albums, tracks, assistants, missions.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ entity: ContentEntity }),
    output: z.object({
      entity: ContentEntity,
      idKey: z.string(),
      numericId: z.boolean(),
      parent: z.object({ key: z.string(), entity: z.string() }).nullable(),
      hasStatus: z.boolean(),
      schema: z.unknown(),
      example: ContentItem.nullable(),
    }),
  }),
  list_content: tool({
    title: 'List content',
    description:
      'Lists every row of a content entity, or only the children of `parent` (an episode number for mic-phrases/exercises, an exercise id for items, an e-book number for test-questions, an album id for tracks).',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ entity: ContentEntity, parent: ContentId.optional() }),
    output: z.object({ items: z.array(ContentItem) }),
  }),
  get_content: tool({
    title: 'Get content',
    description: 'Returns one row of a content entity by its id (number for seasons, episodes and ebooks).',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ entity: ContentEntity, id: ContentId }),
    output: z.object({ item: ContentItem }),
  }),
  create_content: tool({
    title: 'Create content',
    description:
      'Creates a row of any content entity (a season, an episode, an exercise and its items, a Mic phrase, an e-book test question, an extra…). `item` must be a FULL valid item: call describe_content first for its schema. A new episode also gets its own e-book and extra drafts. Creating something already "published" needs the content.publish scope.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ entity: ContentEntity, item: ContentItem }),
    output: z.object({ item: ContentItem }),
  }),
  update_content: tool({
    title: 'Update content',
    description:
      'Edits a row of any content entity. `patch` replaces whole keys and keeps the others; the merged row must stay valid. The id never changes. Moving a status to or from "published" needs the content.publish scope. Pass expectedUpdatedAt from your last read when the entity has updatedAt.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({
      entity: ContentEntity,
      id: ContentId,
      patch: ContentItem,
      expectedUpdatedAt: ExpectedUpdatedAt,
    }),
    output: z.object({ item: ContentItem }),
  }),
  delete_content: tool({
    title: 'Delete content',
    description:
      'Deletes a row of a content entity (children go with it: an exercise takes its items). Refused with in_use while learner data (progress, answers, ratings) points at it: unpublish or edit instead. Take a create_backup first when deleting a lot.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ entity: ContentEntity, id: ContentId }),
    output: z.object({ ok: z.literal(true), deleted: ContentItem }),
  }),

  // ---------- Blobs and option lists ----------

  list_blobs: tool({
    title: 'List content blobs',
    description:
      'Returns the JSON blobs that configure the app (focus cards, Mic modes/openers/follow-ups/pronunciation/help, Extras shelves, SRS grades, e-book teasers, scene and UI images, onboarding meta).',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ key: BlobKey.optional() }),
    output: z.object({ items: z.array(BlobRow) }),
  }),
  put_blob: tool({
    title: 'Replace content blob',
    description: 'Replaces one whole JSON blob (read it with list_blobs first; same validation as the admin).',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ key: BlobKey, json: z.unknown() }),
    output: z.object({ item: BlobRow }),
  }),
  list_option_lists: tool({
    title: 'List onboarding option lists',
    description:
      'Returns the onboarding option lists (goals, levels, formats, genres, themes, days, minutes…), optionally one list.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({ listKey: OptionListKey.optional() }),
    output: z.object({ items: z.array(OptionListRow) }),
  }),
  put_option_list: tool({
    title: 'Replace an option list',
    description: 'Replaces every item of one onboarding option list (same validation as the admin).',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ listKey: OptionListKey, items: z.array(OptionListItemInput).max(200) }),
    output: z.object({ items: z.array(OptionListRow) }),
  }),

  // ---------- Backups ----------

  create_backup: tool({
    title: 'Back up the content',
    description:
      'Saves a backup of all course content (the draft tables) that staff can restore in Admin → Backup. Do it before large or destructive changes.',
    scope: 'content.edit',
    readOnly: false,
    input: z.strictObject({ note: z.string().trim().max(BACKUP.noteMax).optional() }),
    output: z.object({ item: BackupRow }),
  }),

  // ---------- Publishing (content.publish) ----------

  set_episode_status: tool({
    title: 'Set episode status',
    description:
      'Moves an episode between "title_only" (shown as coming soon), "draft" (hidden) and "published" (needs its done screen). Learners see it after the next publish_release.',
    scope: 'content.publish',
    readOnly: false,
    input: z.strictObject({ num: EpisodeNum, status: EpisodeStatus, expectedUpdatedAt: ExpectedUpdatedAt }),
    output: z.object({ item: EpisodeRow }),
  }),
  review_season_test_questions: tool({
    title: 'Review season test questions',
    description: 'Approves, rejects or sends back to draft season test questions (only approved ones reach learners).',
    scope: 'content.publish',
    readOnly: false,
    input: z.strictObject({ seasonN: SeasonN, ...SeasonTestReviewBody.shape }),
    output: z.object({ items: z.array(SeasonTestQuestionRow) }),
  }),
  publish_season_test: tool({
    title: 'Publish season test',
    description:
      "Opens (published: true) or closes the season test for learners. Opening needs at least the season's question count of approved questions.",
    scope: 'content.publish',
    readOnly: false,
    input: z.strictObject({ seasonN: SeasonN, published: z.boolean() }),
    output: z.object({ seasonN: SeasonN, published: z.boolean() }),
  }),
  list_releases: tool({
    title: 'List releases',
    description: 'Lists the published releases, newest first, and which one learners get now.',
    scope: 'content.read',
    readOnly: true,
    input: z.strictObject({}),
    output: z.object({ items: z.array(Release.omit({ manifest: true })), current: z.string().nullable() }),
  }),
  publish_release: tool({
    title: 'Publish release',
    description:
      'Publishes the current draft to every learner at once (same as Admin → Publicações). Run preview_release first: a release with problems is refused. Write short pt-BR notes saying what changed.',
    scope: 'content.publish',
    readOnly: false,
    input: PublishBody,
    output: z.object({ release: Release.omit({ manifest: true }), changed: z.array(z.string()) }),
  }),
  rollback_release: tool({
    title: 'Roll back release',
    description: 'Makes an earlier release (id from list_releases) the one learners get. The draft does not change.',
    scope: 'content.publish',
    readOnly: false,
    input: z.strictObject({ id: z.string().min(1).max(120) }),
    output: z.object({ current: z.string() }),
  }),
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];
export type McpToolInput<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]['input']>;
export type McpToolOutput<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]['output']>;
