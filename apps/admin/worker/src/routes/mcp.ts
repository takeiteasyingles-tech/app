// POST /admin-api/mcp: the Model Context Protocol server of tie-admin (spec 07, feature D), over the
// Streamable HTTP transport, stateless (no Mcp-Session-Id), answering application/json only (no SSE).
// Auth is an API token (`Authorization: Bearer tie_pat_…`, lib/agent), never a cookie; the CSRF
// middleware lets such a request through without Origin checks (createApp `bearer`).
//
// Per request: Origin check (DNS rebinding) → MCP-Protocol-Version check → token → RL_API by token →
// JSON-RPC. Requests answer 200 with the JSON-RPC response, notifications and client responses 202
// with no body. Batches (JSON arrays) are accepted for 2025-03-26 clients and refused when the
// request declares MCP-Protocol-Version 2025-06-18, which removed them. GET/DELETE answer 405.
import {
  ApiError,
  JSON_RPC_ERRORS,
  type JsonRpcId,
  JsonRpcMessage,
  type JsonRpcResponse,
  MCP_PATH,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  type McpToolName,
  type McpToolResult,
} from '@tie/shared';
import { type AppEnv, checkRateLimit, zodIssues } from '@tie/worker-core';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { type AgentToken, agentWriter, authenticateAgent, tokenCan } from '../lib/agent';
import type { Ctx } from '../lib/http';
import { TOOL_HANDLERS } from '../lib/mcpTools';

const routes = new Hono<AppEnv>();

/** Implementation-defined JSON-RPC server error (auth / rate limit), in the -32000..-32099 range. */
const AUTH_ERROR = -32001;
const RATE_ERROR = -32002;
const LATEST_WITHOUT_BATCHES = '2025-06-18';

const INSTRUCTIONS = [
  'Take It Easy is an English course for Brazilian learners. These tools read and edit the course content in the admin database.',
  'Learner-facing copy is Brazilian Portuguese (pt-BR); English lines, dialog and vocabulary stay in English. Keep the placeholders {N} (learner name) and {A}/{oA} (assistant name). Never write "XP" or "ofensiva"; the brand words are pontos, sequência, meta, medalha.',
  'Read before you write: update_* tools replace whole sections and accept expectedUpdatedAt from your last read to avoid overwriting someone else.',
  'Nothing you change reaches learners until a human publishes a release in the admin; there is no publish tool. Run preview_release after edits to check for problems. Season test questions you draft stay drafts until staff approve them.',
].join('\n');

// ---------- JSON-RPC helpers ----------

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
const err = (id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

function rpcError(c: Ctx, status: ContentfulStatusCode, code: number, message: string): Response {
  return c.json(err(null, code, message), status);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The id of a message when it has a valid one (for error answers to malformed requests). */
function idOf(msg: unknown): JsonRpcId | null {
  if (!isObj(msg)) return null;
  const id = msg.id;
  return typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id)) ? id : null;
}

// ---------- tools/list ----------

let toolList: unknown[] | null = null;

function toolsList(): unknown[] {
  if (toolList) return toolList;
  toolList = MCP_TOOL_NAMES.map((name) => {
    const def = MCP_TOOLS[name];
    const { $schema: _s, ...inputSchema } = z.toJSONSchema(def.input, {
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    return {
      name,
      title: def.title,
      description: `${def.description}${def.readOnly ? '' : ' (needs the content.edit scope)'}`,
      inputSchema,
      annotations: { title: def.title, readOnlyHint: def.readOnly, openWorldHint: false },
    };
  });
  return toolList;
}

// ---------- tools/call ----------

function toolResult(value: unknown, isError = false): McpToolResult {
  const out: McpToolResult = { content: [{ type: 'text', text: JSON.stringify(value) }] };
  if (isError) out.isError = true;
  else out.structuredContent = value;
  return out;
}

async function callTool(c: Ctx, token: AgentToken, params: Record<string, unknown> | undefined) {
  const name = params?.name;
  if (typeof name !== 'string' || !Object.hasOwn(MCP_TOOLS, name)) {
    return { error: `Unknown tool: ${typeof name === 'string' ? name : '(missing name)'}` };
  }
  const tool = name as McpToolName;
  const def = MCP_TOOLS[tool];
  if (!tokenCan(token, def.scope)) {
    return {
      result: toolResult(
        {
          error: 'forbidden',
          message: `This API token cannot use ${tool}: it needs the "${def.scope}" scope (and its creator must still have content editing rights). Ask an admin for a token with that scope.`,
        },
        true,
      ),
    };
  }
  const args = params?.arguments ?? {};
  const parsed = def.input.safeParse(args);
  if (!parsed.success) {
    return {
      result: toolResult(
        {
          error: 'invalid_arguments',
          message: 'The arguments do not match the tool schema.',
          issues: zodIssues(parsed.error),
        },
        true,
      ),
    };
  }
  try {
    const handler = TOOL_HANDLERS[tool] as (
      a: unknown,
      t: Parameters<(typeof TOOL_HANDLERS)[McpToolName]>[1],
    ) => Promise<unknown>;
    const out = await handler(parsed.data, { c, db: c.env.DB, token, writer: agentWriter(c, token, tool) });
    return { result: toolResult(out) };
  } catch (e) {
    if (e instanceof ApiError) {
      const details = isObj(e.details) ? e.details : {};
      return { result: toolResult({ error: e.code, message: e.message, ...details }, true) };
    }
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'mcp tool failed',
        tool,
        tokenId: token.id,
        requestId: c.get('requestId'),
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return {
      result: toolResult({ error: 'internal', message: 'The tool failed unexpectedly. Try again later.' }, true),
    };
  }
}

// ---------- Dispatch ----------

/** One JSON-RPC message → its response, or null when nothing is owed (notification, client response). */
async function handleMessage(
  c: Ctx,
  token: AgentToken,
  raw: unknown,
  inBatch: boolean,
): Promise<JsonRpcResponse | null> {
  if (!isObj(raw)) return err(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  // A response to a server request (we never send any): accept and ignore.
  if (!('method' in raw) && ('result' in raw || 'error' in raw)) return null;
  const parsed = JsonRpcMessage.safeParse(raw);
  if (!parsed.success) return err(idOf(raw), JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  const msg = parsed.data;
  if (msg.id === undefined) return null; // notifications/initialized, notifications/cancelled, …
  const id = msg.id;
  switch (msg.method) {
    case 'initialize': {
      if (inBatch) return err(id, JSON_RPC_ERRORS.invalidRequest, 'initialize must not be part of a batch');
      const asked = msg.params?.protocolVersion;
      const version = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
        ? (asked as string)
        : MCP_PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: toolsList() });
    case 'tools/call': {
      const r = await callTool(c, token, msg.params);
      return 'error' in r && r.error ? err(id, JSON_RPC_ERRORS.invalidParams, r.error) : ok(id, r.result);
    }
    default:
      return err(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${msg.method}`);
  }
}

/** Browsers send Origin; agents do not. A foreign Origin is refused (DNS-rebinding guard, MCP spec). */
function originAllowed(c: Ctx): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return true;
  const allowed = new Set<string>();
  for (const u of [c.env.APP_ORIGIN, c.req.url]) {
    try {
      allowed.add(new URL(u).origin);
    } catch {
      // unset APP_ORIGIN
    }
  }
  return allowed.has(origin);
}

routes.post(MCP_PATH, async (c) => {
  if (!originAllowed(c)) return rpcError(c, 403, JSON_RPC_ERRORS.invalidRequest, 'Origin not allowed');
  const declared = c.req.header('MCP-Protocol-Version');
  if (declared && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(declared)) {
    return rpcError(c, 400, JSON_RPC_ERRORS.invalidRequest, `Unsupported MCP-Protocol-Version: ${declared}`);
  }

  const token = await authenticateAgent(c);
  if (!token) {
    const res = rpcError(
      c,
      401,
      AUTH_ERROR,
      'Unauthorized: send a valid, unrevoked API token as Authorization: Bearer.',
    );
    res.headers.set('WWW-Authenticate', 'Bearer realm="tie-admin"');
    return res;
  }
  try {
    await checkRateLimit(c.env, 'RL_API', `tok:${token.id}`);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'rate_limited') {
      const res = rpcError(c, 429, RATE_ERROR, 'Too many requests. Wait a few seconds and try again.');
      res.headers.set('Retry-After', '10');
      return res;
    }
    throw e;
  }

  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return rpcError(c, 400, JSON_RPC_ERRORS.parseError, 'Parse error');
  }

  if (Array.isArray(body)) {
    if (declared === LATEST_WITHOUT_BATCHES) {
      return rpcError(c, 400, JSON_RPC_ERRORS.invalidRequest, `Batches are not supported in ${LATEST_WITHOUT_BATCHES}`);
    }
    if (body.length === 0) return rpcError(c, 400, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
    const out: JsonRpcResponse[] = [];
    // Sequential on purpose: writes in one batch apply in order.
    for (const m of body) {
      const r = await handleMessage(c, token, m, true);
      if (r) out.push(r);
    }
    return out.length ? c.json(out) : c.body(null, 202);
  }

  const r = await handleMessage(c, token, body, false);
  if (!r) return c.body(null, 202);
  const invalid =
    'error' in r && (r.error.code === JSON_RPC_ERRORS.invalidRequest || r.error.code === JSON_RPC_ERRORS.parseError);
  return c.json(r, invalid ? 400 : 200);
});

// Stateless JSON-only server: no SSE stream to open (GET) and no session to end (DELETE).
routes.on(['GET', 'DELETE'], MCP_PATH, (c) =>
  c.json(err(null, JSON_RPC_ERRORS.invalidRequest, 'Method not allowed: POST JSON-RPC messages.'), 405, {
    Allow: 'POST',
  }),
);

export default routes;
