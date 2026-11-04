# Editing content with Claude (MCP)

tie-admin runs an [MCP](https://modelcontextprotocol.io) server. An AI agent such as Claude Code, Claude Desktop or Codex can use it to create, edit and delete every part of the course: seasons, episodes (with their Concluído screen), exercises and their items, Mic phrases, e-books and their tests, season tests, Extras, albums, assistants, Mic missions, the JSON blobs and the onboarding lists. Edits land in the **draft**. With the `content.publish` scope the agent can also publish: episode status, season test review and opening, and releases (publish and rollback). Without it, someone on the team publishes in Admin → Publicações.

- Endpoint: `POST https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp` (locally `http://localhost:8788/admin-api/mcp`).
- Transport: MCP Streamable HTTP, stateless, JSON responses only (no SSE, no `Mcp-Session-Id`). Protocol versions `2025-06-18` and `2025-03-26`.
- Auth: `Authorization: Bearer tie_pat_…`, an API token created in the admin. No cookie is read or set.
- Spec: `docs/spec/07-v1.md` §3 and §8 D, extended by §10 (full autonomy). Contracts: `packages/shared/src/contracts/mcp.ts` (tools) and `apiTokens.ts` (tokens). Code: `apps/admin/worker/src/routes/mcp.ts`, `lib/mcpTools.ts`, `lib/agent.ts`, `lib/entityCrud.ts`, `routes/apiTokens.ts`.

## 1. Create a token

You need the `admin` or `super_admin` role (permission `api_tokens.manage`).

1. Open Admin → **Configurações → Integrações**.
2. Under "Novo token", fill in:
   - **Nome**: who or what uses it, for example "Claude Code da Ana".
   - **Validade**: 30, 90 (the default), 180 or 365 days, or "Sem validade".
   - **Permissões**:
     - "Ler conteúdo" (`content.read`): the list, get and describe tools, `list_releases` and `preview_release`.
     - "Criar, editar e excluir" (`content.edit`): the create, update, delete and draft tools, blobs, option lists and `create_backup`.
     - "Publicar" (`content.publish`): `set_episode_status`, `review_season_test_questions`, `publish_season_test`, `publish_release`, `rollback_release`, and any create, update or delete that moves a status to or from `published`. The creator needs the `content.publish` permission (editor and up).

   All three are on by default, which gives the agent full autonomy. Turn "Publicar" off to keep a person between the agent and the learners.
3. Click **Criar token** and copy the token (`tie_pat_…`) right away. It is shown only once; the panel keeps only its first 12 characters.

Give each person or machine its own token, so you can revoke one without breaking the others. To cut access, click **Revogar** next to the token; it stops working on the next request.

A token acts as the admin who created it, and never beyond that person's **current** roles. If the creator is suspended, deleted or loses the content permission, the token stops working (401).

## 2. Connect Claude

### Claude Code

```powershell
claude mcp add --transport http take-it-easy https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp --header "Authorization: Bearer <token>"
```

Then run `/mcp` inside Claude Code. It should list `take-it-easy` as connected, with 30 tools. Add `--scope user` to make the server available in every project. Without it, the server applies to the current project only.

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

The token goes in `env` because some systems split arguments that contain spaces.

### Codex (OpenAI)

Codex talks to Streamable HTTP servers directly. Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.take-it-easy]
url = "https://tie-admin.takeiteasyingles.workers.dev/admin-api/mcp"
bearer_token_env_var = "TIE_TOKEN"
```

Then set the token in the environment before you start Codex (PowerShell: `$env:TIE_TOKEN = "tie_pat_…"`). Inside Codex, `/mcp` lists the server and its tools.

The Integrações screen shows all these snippets with the right URL, and fills in the token right after you create it.

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
| `describe_content` | read | `{entity}`: the id key, the parent, the JSON Schema of a full item and an example row. Call it before `create_content`. |
| `list_content` | read | `{entity, parent?}`: every row, or the children of a parent (an episode number for `mic-phrases` and `exercises`, an exercise id for `items`, an e-book number for `test-questions`, an album id for `tracks`). |
| `get_content` | read | `{entity, id}`: one row. |
| `create_content` | edit | `{entity, item}`: creates a full row. A new episode gets its own e-book and Extra drafts. |
| `update_content` | edit | `{entity, id, patch, expectedUpdatedAt?}`: each key replaces that whole value. The id never changes. |
| `delete_content` | edit | `{entity, id}`: deletes the row and its children (an exercise takes its items). Refused with `in_use` while learner data points at it. |
| `list_blobs`, `put_blob` | read, edit | The JSON blobs (focus cards, Mic modes, openers, follow-ups, pronunciation and help, Extras shelves, SRS grades, e-book teasers, scene and UI images, onboarding meta). `put_blob` replaces one whole blob. |
| `list_option_lists`, `put_option_list` | read, edit | The onboarding lists (goals, levels, formats, genres, themes, days, minutes…). `put_option_list` replaces one list. |
| `create_backup` | edit | `{note?}`: a content backup that staff can restore in Admin → Backup. Ask for one before large changes. |
| `set_episode_status` | publish | `{num, status}`: `title_only`, `draft` or `published` (which needs the `done` screen). |
| `review_season_test_questions` | publish | `{seasonN, ids, status}`: approves, rejects or returns questions to draft. |
| `publish_season_test` | publish | `{seasonN, published}`: opens or closes the season test (it needs enough approved questions). |
| `list_releases` | read | Published releases, newest first, and the current one. |
| `publish_release` | publish | `{notes?}`: publishes the draft to every learner, like Publicações. Refused when `preview_release` reports problems. |
| `rollback_release` | publish | `{id}`: makes an earlier release current. The draft does not change. |

Entities of the `*_content` tools: `seasons`, `episodes`, `mic-phrases`, `exercises`, `items` (exercise items), `ebooks`, `test-questions` (e-book test), `extras`, `albums`, `tracks`, `assistants`, `missions`. The episode's Concluído screen is its `done` key.

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
{ "name": "create_content", "arguments": { "entity": "exercises", "item": { "id": "e3-ex2", "episodeNum": 3, "sort": 2, "kind": "escrito", "title": "Complete as frases", "intro": null, "audio": null, "audioLabel": null } } }
{ "name": "publish_release", "arguments": { "notes": "Episódio 3: novo exercício de escrita" } }
```

Things you can ask Claude:

- "List the episodes of season 1 and tell me which ones have no lesson yet."
- "Rewrite the synopsis of episode 4 in a warmer tone, in Brazilian Portuguese, then run preview_release."
- "Draft 10 questions for the season 1 test from the vocabulary of episodes 1 to 5."
- "Take a backup, create season 2 with episodes 21 to 25 and a draft exercise in each, and publish once preview_release is clean."

## 4. Rules the server enforces

- **Same validation as the admin.** An update merges the patch over the stored row, then runs the same strict Zod schema and the same server checks as `PUT /admin-api/content/*`: references (season, e-book, episode), media kinds, and cross-field rules such as "a published episode needs its Concluído screen". A failed check comes back as a tool result with `isError: true` and readable `issues` (`path`, `code`, `message`). Nothing is written in that case.
- **No lost updates.** Pass the `updatedAt` from your last read as `expectedUpdatedAt`. If someone saved in between, the tool answers `conflict`; read again and redo the edit.
- **Scopes.** A `content.read` token gets `forbidden` from every write tool. Without `content.publish`, a token cannot publish, open tests or move a status to or from `published`.
- **Season test questions.** The agent's new questions are drafts (source `agent`), and an agent edit sends an approved question back to draft. Approving questions and opening the test take the `content.publish` tools, or staff in the admin. Typed answers are stored normalized (`norm()`). A season holds at most 100 draft and approved questions.
- **Learner data is safe.** Deleting is refused while learner progress, answers or ratings point at a row. No tool touches users, media uploads, settings, prompts or personas (a persona sent with a new assistant needs the creator's `ai.persona` permission).
- **Audit.** Every write lands in Auditoria with the same action as the admin UI (`content.<entity>.create`, `.update` and `.delete`, `content.blobs.put`, `content.option_lists.put`, `season_test.question.*`, `season_test.publish`, `content.publish`, `content.rollback`, `backup.create`). Its actor is the token's creator, with role `agent`, and the diff carries `_agent: {tokenId, tokenName, tool}`. Creating and revoking tokens is audited as `api_token.create` and `api_token.revoke`. The plaintext token is never stored, logged or audited.
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
- **Your edit does not appear in the app**: edits stay in the draft until a release is published (`publish_release`, or Admin → Publicações).
- **Undo a bad change**: roll the release back (`rollback_release`, or Publicações) to fix what learners see, and restore a backup in Admin → Backup to fix the draft.
