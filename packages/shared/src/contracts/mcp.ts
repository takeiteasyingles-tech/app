import { z } from 'zod';
import { LIMITS } from '../constants';
import { EpisodeStatus } from '../content/schema';
import {
  EbookEdit,
  EbookRow,
  EpisodeEdit,
  EpisodeRow,
  ExerciseItemRow,
  ExerciseRow,
  MicPhraseRow,
  PreviewRes,
  SeasonEdit,
  SeasonRow,
  TestQuestionRow,
} from './admin';
import type { ApiTokenScope } from './apiTokens';
import { Timestamp } from './common';
import { endpoint } from './http';
import {
  SeasonTestQuestionInput,
  SeasonTestQuestionPatch,
  SeasonTestQuestionRow,
  SeasonTestQuestionStatus,
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
// diff extended with `_agent: { tokenId, tokenName, tool }`. There is deliberately NO publish tool.

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
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];
export type McpToolInput<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]['input']>;
export type McpToolOutput<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]['output']>;
