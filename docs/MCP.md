# Editing content with Claude (MCP)

tie-admin runs an [MCP](https://modelcontextprotocol.io) server. An AI agent such as Claude Code or Claude Desktop can use it to read and edit the course content: seasons, episodes, e-books and season test questions. The agent works on the **draft** only. Nothing it changes reaches learners until someone on the team publishes a release in Admin → Publicações. There is no publish tool.

- Endpoint: `POST https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp` (locally `http://localhost:8788/admin-api/mcp`).
- Transport: MCP Streamable HTTP, stateless, JSON responses only (no SSE, no `Mcp-Session-Id`). Protocol versions `2025-06-18` and `2025-03-26`.
- Auth: `Authorization: Bearer tie_pat_…`, an API token created in the admin. No cookie is read or set.
- Spec: `docs/spec/07-v1.md` §3 and §8 D. Contracts: `packages/shared/src/contracts/mcp.ts` (tools) and `apiTokens.ts` (tokens). Code: `apps/admin/worker/src/routes/mcp.ts`, `lib/mcpTools.ts`, `lib/agent.ts`, `routes/apiTokens.ts`.

## 1. Create a token

You need the `admin` or `super_admin` role (permission `api_tokens.manage`).

1. Open Admin → **Configurações → Integrações**.
2. Under "Novo token", fill in:
   - **Nome**: who or what uses it, for example "Claude Code da Ana".
   - **Validade**: 30, 90 (the default), 180 or 365 days, or "Sem validade".
   - **Permissões**:
     - "Ler conteúdo" (`content.read`) for the list and get tools and `preview_release`.
     - "Editar e rascunhar" (`content.edit`) for the update and draft tools.
3. Click **Criar token** and copy the token (`tie_pat_…`) right away. It is shown only once; the panel keeps only its first 12 characters.

Give each person or machine its own token, so you can revoke one without breaking the others. To cut access, click **Revogar** next to the token; it stops working on the next request.

A token acts as the admin who created it, and never beyond that person's **current** roles. If the creator is suspended, deleted or loses the content permission, the token stops working (401).

## 2. Connect Claude

### Claude Code

```powershell
claude mcp add --transport http take-it-easy https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp --header "Authorization: Bearer <token>"
```

Then run `/mcp` inside Claude Code. It should list `take-it-easy` as connected, with 13 tools. Add `--scope user` to make the server available in every project. Without it, the server applies to the current project only.

To share the setup through a project's `.mcp.json` without committing the token, use an environment variable:

```json
{
  "mcpServers": {
    "take-it-easy": {
      "type": "http",
      "url": "https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp",
      "headers": { "Authorization": "Bearer ${TIE_ADMIN_TOKEN}" }
    }
  }
}
```

### Claude Desktop

Claude Desktop reaches a remote server that needs a header through the `mcp-remote` bridge, so Node.js must be installed. Open Settings → Developer → Edit Config, add the following to `claude_desktop_config.json`, and restart the app:

```json
{
  "mcpServers": {
    "take-it-easy": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp", "--header", "Authorization:${TIE_TOKEN}"],
      "env": { "TIE_TOKEN": "Bearer <token>" }
    }
  }
}
```

The token goes in `env` because some systems split arguments that contain spaces. The Integrações screen shows both snippets with the right URL, and fills in the token right after you create it.

The token is a password. Do not paste it into chats, e-mails, tickets or repositories.

## 3. Tools

Every tool takes a JSON object. `tools/list` publishes its JSON Schema, generated from the same Zod schemas the admin uses. Results come back as JSON text, plus `structuredContent`.

| Tool | Scope | What it does |
|---|---|---|
| `list_seasons` | read | Every season with its title, synopsis and test settings, its episode count and whether its test is published. |
| `get_season` | read | `{n}`: one season and the summaries of its episodes. |
| `update_season` | edit | `{n, patch, expectedUpdatedAt?}`: edits the title, synopsis, `testPassPct` or `testQuestionCount`. |
| `list_episodes` | read | `{seasonN?, status?}`: number, title, season, status, e-book. |
| `get_episode` | read | `{num, sections?, include?}`: one episode. `sections` limits the answer to some keys (`lyrics`, `dialog`, `lesson`…), and `include` adds `micPhrases` and `exercises`, which are read-only. |
| `update_episode` | edit | `{num, patch, expectedUpdatedAt?}`: each key replaces that whole section. It cannot change the number or the status. |
| `list_ebooks` | read | Every e-book (number, title, episodes label, pass score). |
| `get_ebook` | read | `{num, includeTest?}`: one e-book, optionally with its test questions. |
| `update_ebook` | edit | `{num, patch, expectedUpdatedAt?}`: replaces sections (`five`, `real`, `lead`, `chat`, `extrasCards`, `title`…). |
| `list_season_test_questions` | read | `{seasonN, status?}`: the season test questions, with their answers. |
| `draft_season_test_questions` | edit | `{seasonN, questions[1..30]}`: creates questions with status **draft** and source `agent`. |
| `update_season_test_question` | edit | `{seasonN, id, patch}`: edits a question. Any edit sends it back to **draft**. |
| `preview_release` | read | Compiles the content exactly as a publish would and returns the problems and the changed files. It publishes nothing. |

Examples of `tools/call` arguments:

```json
{ "name": "get_episode", "arguments": { "num": 3, "sections": ["synopsis", "lesson"] } }
{ "name": "update_episode", "arguments": { "num": 3, "patch": { "synopsis": "Zach conhece a família…" }, "expectedUpdatedAt": 1760000000000 } }
{ "name": "update_season", "arguments": { "n": 1, "patch": { "testPassPct": 75 } } }
{ "name": "draft_season_test_questions", "arguments": { "seasonN": 1, "questions": [
  { "q": "Complete: ___ name is Zach.", "opts": ["My", "Me", "I"], "answerIdx": 0, "epNum": 1, "rev": "Ep. 1 · Lição" },
  { "q": "Como se diz \"porta\" em inglês?", "accept": ["door", "the door"], "show": "door" }
] } }
{ "name": "preview_release", "arguments": {} }
```

Things you can ask Claude:

- "List the episodes of season 1 and tell me which ones have no lesson yet."
- "Rewrite the synopsis of episode 4 in a warmer tone, in Brazilian Portuguese, then run preview_release."
- "Draft 10 questions for the season 1 test from the vocabulary of episodes 1 to 5."

## 4. Rules the server enforces

- **Same validation as the admin.** An update merges the patch over the stored row, then runs the same strict Zod schema and the same server checks as `PUT /admin-api/content/*`: references (season, e-book, episode), media kinds, and cross-field rules such as "a published episode needs its Concluído screen". A failed check comes back as a tool result with `isError: true` and readable `issues` (`path`, `code`, `message`). Nothing is written in that case.
- **No lost updates.** Pass the `updatedAt` from your last read as `expectedUpdatedAt`. If someone saved in between, the tool answers `conflict`; read again and redo the edit.
- **Scopes.** A `content.read` token gets `forbidden` from the update and draft tools.
- **Season test questions.** The agent's questions are always drafts (source `agent`), and an agent edit sends an approved question back to draft. Staff approve questions and open the test in the admin. Typed answers are stored normalized (`norm()`). A season holds at most 100 draft and approved questions.
- **No publish.** No tool publishes content, publishes a season test, deletes anything, or touches users, media, settings or prompts.
- **Audit.** Every write lands in Auditoria with the same action as the admin UI (`content.episodes.update`, `content.seasons.update`, `content.ebooks.update`, `season_test.question.draft`, `season_test.question.update`). Its actor is the token's creator, with role `agent`, and the diff carries `_agent: {tokenId, tokenName, tool}`. Creating and revoking tokens is audited as `api_token.create` and `api_token.revoke`. The plaintext token is never stored, logged or audited.
- **Rate limit.** `RL_API` per token (100 requests every 10 s). Over the limit the server answers HTTP 429 with a JSON-RPC error.

## 5. Protocol details (for client authors)

- `POST` carries one JSON-RPC 2.0 message, and answers `200 application/json`. A notification (for example `notifications/initialized`) or a client response answers `202` with no body.
- Batches (JSON arrays) are accepted from clients on `2025-03-26`. They are refused (400) when the request says `MCP-Protocol-Version: 2025-06-18`, which removed them. `initialize` must not be batched.
- `initialize` answers the client's `protocolVersion` when it is supported, else `2025-06-18`, with `capabilities: {tools: {listChanged: false}}`, `serverInfo` and short `instructions`.
- Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`. Any other method answers `-32601`. An unknown tool name answers `-32602`.
- HTTP errors:

  | Status | When |
  |---|---|
  | 400 | Parse error `-32700`, an invalid request, or an unsupported `MCP-Protocol-Version`. |
  | 401 | A missing, unknown, revoked or expired token, or a creator who lost the permission. The JSON-RPC code is `-32001`, with `WWW-Authenticate: Bearer`. |
  | 403 | A foreign `Origin` header, or a request that carries a cookie and fails the CSRF check. |
  | 405 | `GET` or `DELETE`. |
  | 429 | The rate limit. The JSON-RPC code is `-32002`. |
- Tool failures are results, not protocol errors: `{"content":[{"type":"text","text":"{\"error\":\"validation_failed\",…}"}],"isError":true}`.

## 6. Troubleshooting

- **401 "Unauthorized"**: the token is mistyped, revoked or expired, or its creator no longer has an editor or admin role. Create a new token.
- **Claude Code says the server needs authentication, or offers an OAuth login**: the header did not reach the server. Run `claude mcp get take-it-easy`, then remove the server and add it again with `--header`.
- **Claude Desktop shows no tools**: check that `npx` works in a terminal, then read the MCP log (Settings → Developer → Open logs folder).
- **Your edit does not appear in the app**: that is expected. Publish under Admin → Publicações.
