// Feature D (spec 07): API tokens (create once, list, revoke, audit) and the MCP endpoint (Streamable
// HTTP, JSON-RPC 2.0): handshake, tools/list, read and write tools reusing the content checks, scopes,
// token states, no cookie, batches, and the agent audit trail.
import {
  API_TOKEN_DISPLAY_LEN,
  API_TOKEN_PREFIX,
  AUDIT_AGENT_ROLE,
  adminApi,
  buildPath,
  DURATIONS,
  MCP_PATH,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
} from '@tie/shared';
import { sha256Hex } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, auditRows, Client, exec, ins, one, resetDb, seedContent, staff } from './helpers';

const T = adminApi.apiTokens;

async function createToken(
  by: Account,
  body: { name?: string; scopes?: string[]; expiresInDays?: number | null } = {},
): Promise<{ id: string; token: string }> {
  const res = await by.client.json(T.create.path, {
    json: { name: body.name ?? 'Claude', scopes: body.scopes ?? ['content.read', 'content.edit'], ...body },
  });
  expect(res.status).toBe(201);
  return { id: res.body.item.id, token: res.body.token };
}

let rpcId = 0;
/** A JSON-RPC call the way an agent sends it: Bearer token, no cookie, no Origin. */
async function rpc(token: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const client = new Client();
  return client.json(MCP_PATH, {
    json: { jsonrpc: '2.0', id: ++rpcId, method, ...(params === undefined ? {} : { params }) },
    noOrigin: true,
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
}

async function callTool(token: string, name: string, args: unknown) {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result as { content: { text: string }[]; isError?: boolean; structuredContent?: unknown };
  // biome-ignore lint/suspicious/noExplicitAny: tool outputs are asserted field by field.
  return { isError: !!result.isError, data: JSON.parse(result.content[0]?.text ?? 'null') as any, result };
}

describe('API tokens', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });

  it('creates a token shown once, stores only its hash and audits without the plaintext', async () => {
    const since = Date.now();
    const res = await admin.client.json(T.create.path, { json: { name: 'Claude Code', scopes: ['content.read'] } });
    expect(res.status).toBe(201);
    const { item, token } = res.body;
    expect(token).toMatch(new RegExp(`^${API_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
    expect(item).toMatchObject({
      name: 'Claude Code',
      prefix: token.slice(0, API_TOKEN_DISPLAY_LEN),
      scopes: ['content.read'],
      createdBy: admin.id,
      createdByEmail: admin.email,
      lastUsedAt: null,
      revokedAt: null,
    });
    // Default lifetime.
    expect(Math.abs(item.expiresAt - (item.createdAt + DURATIONS.apiTokenDefaultMs))).toBeLessThan(1000);
    const row = await one<{ token_hash: string }>('SELECT token_hash FROM api_tokens WHERE id = ?', item.id);
    expect(row?.token_hash).toBe(await sha256Hex(token));
    const [audit] = await auditRows('api_token.create', since);
    expect(audit?.actor_user_id).toBe(admin.id);
    expect(audit?.diff).not.toContain(token);
    expect(audit?.diff).not.toContain(token.slice(API_TOKEN_DISPLAY_LEN));

    // The list never carries the plaintext.
    const list = await admin.client.json(T.list.path);
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it('honours an explicit expiry or none, and refuses unknown or repeated scopes', async () => {
    const days = await admin.client.json(T.create.path, {
      json: { name: 'a', scopes: ['content.read'], expiresInDays: 7 },
    });
    expect(days.body.item.expiresAt - days.body.item.createdAt).toBe(7 * 86_400_000);
    const never = await admin.client.json(T.create.path, {
      json: { name: 'b', scopes: ['content.read'], expiresInDays: null },
    });
    expect(never.body.item.expiresAt).toBeNull();
    expect((await admin.client.send(T.create.path, { json: { name: 'c', scopes: ['content.publish'] } })).status).toBe(
      400,
    );
    expect(
      (await admin.client.send(T.create.path, { json: { name: 'c', scopes: ['content.read', 'content.read'] } }))
        .status,
    ).toBe(400);
  });

  it('revokes (idempotent, audited) and only admins manage tokens', async () => {
    const since = Date.now();
    const { id } = await createToken(admin);
    const path = buildPath(T.revoke.path, { id });
    const first = await admin.client.json(path, { method: 'DELETE' });
    expect(first.body.item.revokedAt).toBeGreaterThan(0);
    expect(first.body.item.revokedBy).toBe(admin.id);
    const again = await admin.client.json(path, { method: 'DELETE' });
    expect(again.body.item.revokedAt).toBe(first.body.item.revokedAt);
    expect(await auditRows('api_token.revoke', since)).toHaveLength(1);
    const editor = await staff(['editor']);
    expect((await editor.client.send(T.list.path)).status).toBe(403);
  });
});

describe('MCP endpoint', () => {
  let admin: Account;
  let token: string;
  let tokenId: string;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    admin = await staff(['admin']);
    ({ token, id: tokenId } = await createToken(admin, { name: 'Claude' }));
  });

  it('negotiates the protocol version on initialize, without cookies', async () => {
    const res = await rpc(token, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(res.status).toBe(200);
    expect(res.res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(res.res.headers.getSetCookie()).toEqual([]);
    expect(res.res.headers.get('Mcp-Session-Id')).toBeNull();
    expect(res.body).toMatchObject({
      jsonrpc: '2.0',
      id: rpcId,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO },
    });
    expect(res.body.result.instructions).toContain('publish');
    const unknown = await rpc(token, 'initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    expect(unknown.body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);

    // notifications/initialized: 202, no body.
    const note = await new Client().send(MCP_PATH, {
      json: { jsonrpc: '2.0', method: 'notifications/initialized' },
      noOrigin: true,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe('');
    expect((await rpc(token, 'ping')).body.result).toEqual({});
    expect((await rpc(token, 'resources/list')).body.error.code).toBe(-32601);
  });

  it('lists every tool with a JSON Schema input and the read-only hint', async () => {
    const res = await rpc(token, 'tools/list');
    const tools = res.body.result.tools as {
      name: string;
      inputSchema: { type: string; properties?: Record<string, unknown> };
      annotations: { readOnlyHint: boolean };
    }[];
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOL_NAMES);
    expect(tools.map((t) => t.name)).not.toContain('publish');
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.annotations.readOnlyHint, t.name).toBe(MCP_TOOLS[t.name as keyof typeof MCP_TOOLS].readOnly);
    }
    const upd = tools.find((t) => t.name === 'update_episode');
    expect(Object.keys(upd?.inputSchema.properties ?? {})).toEqual(['num', 'patch', 'expectedUpdatedAt']);
  });

  it('reads an episode (sections, includes) and a season', async () => {
    const ep = await callTool(token, 'get_episode', {
      num: 1,
      sections: ['lyrics'],
      include: ['micPhrases', 'exercises'],
    });
    expect(ep.isError).toBe(false);
    expect(Object.keys(ep.data.item).sort()).toEqual(['lyrics', 'num', 'title', 'updatedAt']);
    expect(ep.data.item.lyrics[0].en).toBe('Hi! Good morning!');
    expect(ep.data.micPhrases.map((p: { id: string }) => p.id)).toEqual(['e1-mic-0']);
    expect(ep.data.exercises[0].items.map((i: { id: string }) => i.id)).toEqual(['e1-ex0-i0']);
    expect(ep.result.structuredContent).toEqual(ep.data);

    const season = await callTool(token, 'get_season', { n: 1 });
    expect(season.data.item).toMatchObject({ n: 1, title: 'Arrival', testPassPct: 70, testPublished: false });
    expect(season.data.episodes.map((e: { num: number }) => e.num)).toEqual([1, 2]);
    const list = await callTool(token, 'list_seasons', {});
    expect(list.data.items[0]).toMatchObject({ n: 1, episodes: 2 });
    const eps = await callTool(token, 'list_episodes', { status: 'published' });
    expect(eps.data.items.map((e: { num: number }) => e.num)).toEqual([1]);
    expect((await callTool(token, 'get_episode', { num: 99 })).data.error).toBe('not_found');
  });

  it('updates an episode as the token creator, audited as the agent', async () => {
    const since = Date.now();
    const before = await callTool(token, 'get_episode', { num: 1, sections: ['synopsis'] });
    const res = await callTool(token, 'update_episode', {
      num: 1,
      patch: { synopsis: 'Nova sinopse' },
      expectedUpdatedAt: before.data.item.updatedAt,
    });
    expect(res.isError).toBe(false);
    expect(res.data.item).toMatchObject({ num: 1, synopsis: 'Nova sinopse', status: 'published', updatedBy: admin.id });
    const row = await one<{ synopsis: string; updated_by: string }>(
      'SELECT synopsis, updated_by FROM episodes WHERE num = 1',
    );
    expect(row).toEqual({ synopsis: 'Nova sinopse', updated_by: admin.id });
    const [audit] = await auditRows('content.episodes.update', since);
    expect(audit?.actor_user_id).toBe(admin.id);
    expect(audit?.actor_role).toBe(AUDIT_AGENT_ROLE);
    const diff = JSON.parse(audit?.diff ?? '{}');
    expect(diff.synopsis).toEqual({ from: 'Sinopse', to: 'Nova sinopse' });
    expect(diff._agent).toEqual({ tokenId, tokenName: 'Claude', tool: 'update_episode' });

    // A stale read is refused.
    const stale = await callTool(token, 'update_episode', {
      num: 1,
      patch: { synopsis: 'Outra' },
      expectedUpdatedAt: before.data.item.updatedAt,
    });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toBe('conflict');
  });

  it('returns validation problems as readable tool errors', async () => {
    // Schema: bad shape and the forbidden status key.
    const shape = await callTool(token, 'update_episode', { num: 1, patch: { lyrics: [{ en: 1 }] } });
    expect(shape.isError).toBe(true);
    expect(shape.data.error).toBe('invalid_arguments');
    expect(shape.data.issues.length).toBeGreaterThan(0);
    const status = await callTool(token, 'update_episode', { num: 1, patch: { status: 'draft' } });
    expect(status.data.error).toBe('invalid_arguments');
    // Server rule: a published episode needs its Concluído screen.
    const rule = await callTool(token, 'update_episode', { num: 1, patch: { done: null } });
    expect(rule.isError).toBe(true);
    expect(rule.data.error).toBe('validation_failed');
    expect(rule.data.issues[0]).toMatchObject({ path: 'done', code: 'required' });
    // Reference check: unknown season.
    const ref = await callTool(token, 'update_episode', { num: 2, patch: { seasonN: 9 } });
    expect(ref.data.issues[0]).toMatchObject({ path: 'seasonN', code: 'unknown_ref' });
    expect((await one<{ synopsis: string }>('SELECT synopsis FROM episodes WHERE num = 1'))?.synopsis).toBe('Sinopse');
    // Unknown tool: JSON-RPC invalid params.
    expect((await rpc(token, 'tools/call', { name: 'publish', arguments: {} })).body.error.code).toBe(-32602);
  });

  it('edits seasons and drafts season test questions that always need staff review', async () => {
    const since = Date.now();
    const season = await callTool(token, 'update_season', { n: 1, patch: { title: 'Chegada', testPassPct: 80 } });
    expect(season.data.item).toMatchObject({ n: 1, title: 'Chegada', testPassPct: 80, updatedBy: admin.id });

    const draft = await callTool(token, 'draft_season_test_questions', {
      seasonN: 1,
      questions: [
        { q: 'Como se diz "porta"?', accept: ['  The Door ', 'door'], epNum: 1 },
        { q: '___ Robert.', opts: ['Am', 'I’m'], answerIdx: 1 },
      ],
    });
    expect(draft.isError).toBe(false);
    expect(draft.data.items).toHaveLength(2);
    expect(draft.data.items[0]).toMatchObject({
      status: 'draft',
      source: 'agent',
      accept: ['the door', 'door'],
      sort: 0,
    });
    expect(draft.data.items[1]).toMatchObject({ sort: 1, opts: ['Am', 'I’m'], answerIdx: 1 });
    const [drafted] = await auditRows('season_test.question.draft', since);
    expect(drafted?.actor_role).toBe(AUDIT_AGENT_ROLE);

    const bad = await callTool(token, 'draft_season_test_questions', {
      seasonN: 1,
      questions: [{ q: 'Sem resposta', epNum: 77 }],
    });
    expect(bad.isError).toBe(true);

    // Staff approve one; an agent edit sends it back to draft.
    const id = draft.data.items[1].id as string;
    await exec("UPDATE season_test_questions SET status = 'approved' WHERE id = ?", id);
    const upd = await callTool(token, 'update_season_test_question', { seasonN: 1, id, patch: { q: '___ Zach.' } });
    expect(upd.data.item).toMatchObject({ q: '___ Zach.', status: 'draft', answerIdx: 1 });
    const pair = await callTool(token, 'update_season_test_question', { seasonN: 1, id, patch: { answerIdx: 5 } });
    expect(pair.data.issues[0]).toMatchObject({ path: 'answerIdx', code: 'out_of_range' });
    expect(await auditRows('season_test.question.update', since)).toHaveLength(1);

    const listed = await callTool(token, 'list_season_test_questions', { seasonN: 1, status: 'draft' });
    expect(listed.data.items).toHaveLength(2);
    const preview = await callTool(token, 'preview_release', {});
    expect(preview.isError).toBe(false);
    expect(preview.data.errors).toEqual([]);
    expect(preview.data.changed).toContain('catalog.json');
  });

  it('enforces scopes: a read-only token cannot edit', async () => {
    const ro = await createToken(admin, { name: 'leitura', scopes: ['content.read'] });
    expect((await callTool(ro.token, 'get_episode', { num: 1 })).isError).toBe(false);
    const res = await callTool(ro.token, 'update_episode', { num: 1, patch: { synopsis: 'x' } });
    expect(res.isError).toBe(true);
    expect(res.data.error).toBe('forbidden');
    expect((await one<{ synopsis: string }>('SELECT synopsis FROM episodes WHERE num = 1'))?.synopsis).toBe('Sinopse');
    const draft = await callTool(ro.token, 'draft_season_test_questions', {
      seasonN: 1,
      questions: [{ q: 'x', accept: ['x'] }],
    });
    expect(draft.data.error).toBe('forbidden');
  });

  it('answers 401 for missing, unknown, revoked, expired or powerless tokens', async () => {
    const anon = await new Client().json(MCP_PATH, {
      json: { jsonrpc: '2.0', id: 1, method: 'ping' },
      noOrigin: true,
    });
    // No bearer and no Origin: the CSRF guard refuses it before the route; same-origin, the route says 401.
    expect(anon.status).toBe(403);
    const sameOrigin = await new Client().json(MCP_PATH, { json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(sameOrigin.status).toBe(401);
    const unknown = await rpc(`${API_TOKEN_PREFIX}${'A'.repeat(43)}`, 'ping');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe(-32001);
    expect(unknown.res.headers.get('WWW-Authenticate')).toContain('Bearer');

    const expired = await createToken(admin, { name: 'velho' });
    await exec('UPDATE api_tokens SET expires_at = ? WHERE id = ?', Date.now() - 1000, expired.id);
    expect((await rpc(expired.token, 'ping')).status).toBe(401);

    await admin.client.send(buildPath(T.revoke.path, { id: tokenId }), { method: 'DELETE' });
    expect((await rpc(token, 'ping')).status).toBe(401);

    // The creator loses the content permission: the token stops working.
    const editor = await staff(['editor']);
    await ins('api_tokens', {
      id: 'tok-editor',
      name: 'x',
      token_hash: await sha256Hex(`${API_TOKEN_PREFIX}${'B'.repeat(43)}`),
      token_prefix: 'tie_pat_BBBB',
      created_by: editor.id,
      scopes: ['content.read'],
      created_at: Date.now(),
    });
    expect((await rpc(`${API_TOKEN_PREFIX}${'B'.repeat(43)}`, 'ping')).status).toBe(200);
    await exec('DELETE FROM user_roles WHERE user_id = ?', editor.id);
    expect((await rpc(`${API_TOKEN_PREFIX}${'B'.repeat(43)}`, 'ping')).status).toBe(401);
  });

  it('records last use, refuses GET, a cookie without Origin, and foreign origins', async () => {
    await rpc(token, 'ping');
    const row = await one<{ last_used_at: number | null }>('SELECT last_used_at FROM api_tokens WHERE id = ?', tokenId);
    expect(row?.last_used_at).toBeGreaterThan(0);

    const get = await new Client().send(MCP_PATH, { headers: { Authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');

    // A browser-like request carrying a cookie is CSRF-checked as usual.
    const withCookie = new Client();
    withCookie.cookies.set('tie_adm', 'x');
    const csrf = await withCookie.send(MCP_PATH, {
      json: { jsonrpc: '2.0', id: 1, method: 'ping' },
      noOrigin: true,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(csrf.status).toBe(403);
    const foreign = await new Client().send(MCP_PATH, {
      json: { jsonrpc: '2.0', id: 1, method: 'ping' },
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const version = await rpc(token, 'ping', undefined, { 'MCP-Protocol-Version': '2024-01-01' });
    expect(version.status).toBe(400);
  });

  it('accepts batches for 2025-03-26 and refuses them for 2025-06-18', async () => {
    const send = (headers: Record<string, string>) =>
      new Client().json(MCP_PATH, {
        json: [
          { jsonrpc: '2.0', id: 'a', method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
        ],
        noOrigin: true,
        headers: { Authorization: `Bearer ${token}`, ...headers },
      });
    const old = await send({ 'MCP-Protocol-Version': '2025-03-26' });
    expect(old.status).toBe(200);
    expect(old.body.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
    expect((await send({ 'MCP-Protocol-Version': '2025-06-18' })).status).toBe(400);
    const parse = await new Client().json(MCP_PATH, {
      body: '{nope',
      noOrigin: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    expect(parse.body.error.code).toBe(-32700);
  });
});
