# Pi's MCP API — research notes

Reference for `pi-agent-resource` MCP configuration management and pack server registration.

| | |
|---|---|
| Pi version researched | `@earendil-works/pi-coding-agent` **0.99.1** (globally installed; MCP shipped in 0.99.0) |
| Primary sources | `docs/mcp.md`, `docs/cli.md`, `docs/extensions.md`, `docs/sdk.md`, `docs/settings.md`, `dist/core/mcp-servers.d.ts`, `dist/extensions/mcp/*.d.ts`, `dist/extensions/codemode/tool.js`, `@earendil-works/pi-codemode` README |
| Public API surface | Only `McpExposure`, `McpServerConfig`, `McpServerEntry`, `LoadedMcpConfig`, `RegisteredMcpServer`, `McpServersChangeEvent`, `createMcpExtension` are exported from the package root. The `mcp.json` mutators (`addMcpServerConfig`, `updateMcpServerConfig`, `loadMcpConfig`) are **internal** and must not be imported. |
| Cross-harness | See [`mcp-config-comparison.md`](./mcp-config-comparison.md) for how this shape deviates from Codex and Claude Code. |

---

## 1. Mental model

Pi runs MCP as a **built-in extension** named `builtin:mcp`. It is one of four built-ins (with `builtin:codemode`, `builtin:tool-search`, `builtin:llama.cpp`).

```
                          ┌──────────────────────────────────────────────┐
   ~/.pi/agent/mcp.json ──┤                                              │
   .pi/mcp.json (trusted) ┤   builtin:mcp  (the only thing that connects) │
   pi.registerMcpServer() ┤            │                                 │
        (extensions) ─────┤            │                                 │
                          └────────────┼─────────────────────────────────┘
                                       │  session_start
                                       ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  transport                 stdio            streamable HTTP  │
        │  ───────────────────────────────────────────────────────────  │
        │  child process  ◄──────►  JSON-RPC over stdio pipes         │
        │  HTTP POST      ◄──────►  JSON-RPC over one endpoint         │
        └──────────────────────────────────────────────────────────────┘
                                       │ tools/list
                                       ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  register each tool as   mcp__<server>__<tool>              │
        │  apply exposure  ─────────────┬──────────────┬───────────────│
        │                               │              │               │
        │                     declared  │  not declared │  unreachable │
        │                     to model  │               │               │
        └──────────────────────────────────────────────────────────────┘
             exposure: direct    deferred        codemode
                                    │          codemode-deferred
                                    │               │
                          tool_search tool    codemode tool (scripts)
```

Two independent consumers of the same tool registry:

- **The model** — sees tool declarations in the system prompt. Every declaration costs context on *every* turn.
- **A codemode script** — sees the same tools as JavaScript functions. Nested results stay in the script; only the script's output reaches the model.

That split is the single most important thing to understand about MCP in Pi. A server with 200 tools declared directly is expensive on every request; the same server at `exposure: "codemode"` costs ~0 declarations and is reachable from JavaScript.

---

## 2. Configuration

Two files, same `mcpServers` shape as Claude Desktop / Claude Code / Cursor:

| Scope | Path | Read when |
|---|---|---|
| Global | `~/.pi/agent/mcp.json` | Always |
| Project | `<project>/.pi/mcp.json` | Only when the project is trusted (stdio servers run commands) |

Project entries **replace** global entries with the same name.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "exposure": "direct"
    }
  },
  "autoEnableCodemode": true
}
```

### 2.1 Server config fields

| Field | Applies to | Meaning |
|---|---|---|
| `type` | both | Optional. `command` implies `stdio`, `url` implies `http`. Explicit values: `stdio`, `http`, `streamable-http`. **`sse` is rejected.** |
| `command` | stdio | One executable. Not a shell string. |
| `args` | stdio | Array of strings, passed to the executable. |
| `env` | stdio | String map. Values may be `${NAME}` or `!command`. |
| `cwd` | stdio | Relative paths resolve against the session directory. A leading `~/` means home. |
| `url` | http | Must parse as `http:` or `https:`. |
| `headers` | http | String map. Values may be `${NAME}` or `!command`. |
| `oauth` | http | See §7. |
| `exposure` | both | `codemode` (default), `codemode-deferred`, `deferred`, `direct`, `hidden`. |
| `toolExposure` | both | Per-tool exposure overrides; keys are tool names or `*` patterns. |
| `enabled` | both | `false` keeps the entry listed but never connects. |
| `timeout` | both | Per-request timeout in **seconds**, default `60`. Server progress notifications reset it. Must be a positive number. |
| `autoEnableCodemode` | file top level | Default `true`. Activates the `codemode` tool when a `codemode`/`codemode-deferred` server connects. Project value overrides global. |

### 2.2 Secrets

Never write literal secrets. Two interpolation forms, shared with provider API keys:

| Form | Example | Notes |
|---|---|---|
| `${NAME}` | `"Authorization": "Bearer ${GITHUB_TOKEN}"` | Environment variable, expanded at connect time. |
| `!command` | `"Authorization": "!echo Bearer $(gh auth token)"` | The command must produce the **entire** value, so it must print the scheme too. |

### 2.3 Validation rules

`validateMcpServerConfig(name, value)` returns the config or an error string. Invalid entries are skipped and reported once at startup; other servers still connect.

| Rule | Error |
|---|---|
| Name matches `^[A-Za-z0-9_-]+$` | `invalid server name "..." (use letters, digits, "_" and "-")` |
| Entry is an object | `server "..." must be an object` |
| `exposure` ∈ the five modes | `exposure must be one of ...` |
| `toolExposure` maps names to valid exposures | `toolExposure ... must be one of ...` |
| `enabled` is boolean | `enabled must be a boolean` |
| `timeout` is a positive number | `timeout must be a positive number of seconds` |
| `type: "sse"` | `legacy SSE transport is not supported; use the streamable HTTP URL` |
| `url` is http/https | `url must be an http or https URL` |
| `headers` string map | `headers must map names to strings` |
| `args` is a string array | `args must be an array of strings` |
| `env` string map / `cwd` string | `env must map names to strings` / `cwd must be a string` |
| Has `command` or `url` | `needs either "command" (stdio) or "url" (streamable HTTP)` |

Note the shape of the validator: **anything with a valid `url` is treated as HTTP, anything with a valid `command` as stdio**, and having neither is the only "missing transport" failure. A typo'd `command` key silently produces that last error rather than a key-specific one.

---

## 3. Connection lifecycle

```
t0  session starts
    ├─ global mcp.json read
    ├─ project .pi/mcp.json read (trusted projects only)
    ├─ pi.registerMcpServer() registrations collected (made during extension load)
    └─ connections opened in parallel ─────────────────────────────┐
                                                                  │
t1  first prompt arrives                                           │
    └─ waits up to 10s (startupWaitMs) for pending connections ◄──┘
        ├─ connected in time  → tools declared / registered
        └─ still connecting  → tools appear later, mid-session

later
    ├─ HTTP network error or 408/429/5xx  → retried twice
    ├─ dropped connection                → shows disconnected, reconnects on next call
    ├─ tools/list_changed notification    → new tools added, withdrawn tools unreachable
    └─ extension calls registerMcpServer  → connects immediately (no wait)
```

| Behaviour | Detail |
|---|---|
| First-prompt wait | 10 s. A slow server's tools simply arrive late. |
| Startup reporting | Config errors, failed connections, and servers needing sign-in are reported **once**. |
| Log file | MCP logging notifications are appended to `~/.pi/agent/mcp.log` as `<time> [<server>] <level> <logger>: <message>`; rotated to `mcp.log.1` past 5 MB. |
| stdio shutdown | stdin close → `SIGTERM` → `SIGKILL` to the whole **process group**, so `npx`/`uvx` wrappers do not linger. |
| Retries | Only *reads* (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) retry once on transient HTTP errors. **Tool calls never retry** — the server may already have run them. |

---

## 4. Tools: naming and exposure

Every tool is registered as `mcp__<server>__<tool>`. Each server is also a **tool namespace** named `mcp__<server>`, whose description is the server's `instructions` field when it sends one — which is how the codemode description explains what a server is for.

### 4.1 The five exposures

| Exposure | In model declarations? | In `codemode` description? | Callable from scripts? | Reaches tool? | Activates |
|---|---|---|---|---|---|
| `codemode` **(default)** | no | yes, with TypeScript declarations | yes | — | `codemode` |
| `codemode-deferred` | no | no, only server name + tool count | yes | — | `codemode` |
| `deferred` | only after `tool_search` loads them | no | yes | yes | `tool_search` |
| `direct` | **yes** | yes | yes | — | — |
| `hidden` | no | no | no | no | — |

```
                     ┌───────────────────────────────────────────┐
                     │              THE MODEL                    │
                     │   can only call what is DECLARED here     │
                     └───────────────┬───────────────────────────┘
                                     │ declared
        direct ──────────────────────┤
        deferred ──(after tool_search)┤
        codemode / codemode-deferred ─┤  (not declared)
        hidden ───────────────────────┤  (unreachable, and not script-callable)

                     ┌───────────────────────────────────────────┐
                     │           CODEMODE SCRIPT                 │
                     │   tools.<name>(args) for every callable   │
                     │   tool regardless of the active tool set  │
                     └───────────────────────────────────────────┘
```

The cross-over is deliberate and total:

- Scripts can call `deferred` and `direct` tools too.
- `tool_search` can load `codemode`-exposure tools.
- Scripts survive `/tree`, resume, and fork; they do not depend on the active tool set.
- Tools loaded by `tool_search` are recorded in the transcript like any other tool change and stay declared **on that branch only**.

> **Why the default is `codemode`:** a mid-sized server (GitHub, Playwright) can declare 50–200 tools. Declared, that is 10k–40k tokens of system prompt on *every* request. At `codemode`, the same server costs a bounded slice of the codemode description, and the model can batch, loop, and filter.

### 4.2 `toolExposure`

Per-tool overrides win over the server's `exposure`:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "exposure": "deferred",
      "toolExposure": {
        "search_code": "direct",
        "get_*": "codemode",
        "delete_*": "hidden"
      }
    }
  }
}
```

Resolution order (`getMcpToolExposure`):

1. Exact tool name in `toolExposure`.
2. Otherwise the first matching `*` pattern **in object key order**.
3. Otherwise the server's `exposure`.

`hidden` composes: server `hidden` + a few `direct` entries exposes exactly those few. `pi mcp list` and the `/mcp` tools view mark tools whose exposure differs from the server's.

### 4.3 Result size

| Consumer | Text over 20 KB |
|---|---|
| Model (direct call) | Middle cut out around a `…N chars truncated…` marker; full text saved to a temp file named in the result. |
| Codemode script | Always the **whole** result. This is the main reason to prefer `codemode`: filter a 5 MB response in the script and return 40 lines. |

Inside a script, an MCP tool resolves to its full `CallToolResult`:

```ts
type CallToolResult<T = { [key: string]: unknown }> = {
  _meta?: MetaObject;
  content: ContentBlock[];              // text | image | audio | resource_link | resource
  isError?: boolean;
  structuredContent?: T;
  [key: string]: unknown;
};
```

These types are prepended to the codemode description automatically whenever MCP tools are callable, and each MCP tool is declared as `Promise<CallToolResult<T>>`. A result with `isError: true` **resolves** in a script (it is not a rejection); on a direct call it is reported to the model as an error.

---

## 5. Resources

When any connected server offers MCP resources, `builtin:mcp` registers three Codex-compatible tools:

| Tool | Input | Output |
|---|---|---|
| `list_mcp_resources` | `{ server?, cursor? }` | `{ server?, resources: [{ server, uri, name, ... }], nextCursor? }` |
| `list_mcp_resource_templates` | `{ server?, cursor? }` | same shape, for resources not listed by the servers |
| `read_mcp_resource` | `{ server, uri }` | model: text as text, images as images, other binary saved to a temp file whose path the model sees. Script: `{ server, uri, contents }` |

| Rule | Detail |
|---|---|
| Eligibility | Every **enabled** server that has resources and whose exposure is not `hidden`. |
| Combined exposure | Widest among them: `direct` if any is `direct`, else `codemode`, else `codemode-deferred`, else `deferred`. |
| Excluded | MCP Apps resources (`ui://` URIs, `text/html;profile=mcp-app`) and resource icons — Pi does not render them. |
| Annotations | Marked read-only. |
| Retries | Listing and reading retry once on transient HTTP errors. |

Resource links inside tool results name `read_mcp_resource` and the server, so the model gets a pointer it can follow.

---

## 6. Permissions

Every MCP call goes through the normal tool pipeline, so `tool_call` / `tool_result` handlers and permission gates apply exactly as for built-in tools.

```ts
pi.on("tool_call", async (event, ctx) => {
  const hints = pi.getAllTools().find((t) => t.name === event.toolName)?.annotations;
  const needsApproval =
    hints?.destructiveHint === true ||
    (!hints?.readOnlyHint && ((hints?.destructiveHint ?? true) || (hints?.openWorldHint ?? true)));

  if (needsApproval && !(await ctx.ui.confirm("Allow tool call?", event.toolName))) {
    return { block: true, reason: `${event.toolName} was not approved` };
  }
});
```

- `pi.getAllTools()` surfaces the server's own `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` annotations, so a permission extension can gate on the server's declared semantics instead of a name allowlist.
- Calls made **from a codemode script** carry the `codemode` call's id as `parentToolCallId`. A permission prompt therefore fires for the `codemode` call, naming the outer tool, while the nested MCP calls still run through the pipeline.
- One `isError: true` from a server is data, not a policy failure: the permission layer sees a successful call whose result reports an error.

---

## 7. OAuth

HTTP servers without an `Authorization` header get OAuth when they answer `401`. Pi does dynamic client registration, stores tokens in `~/.pi/agent/mcp-auth.json`, and refreshes automatically.

```json
{ "mcpServers": { "sentry": { "url": "https://mcp.sentry.dev/mcp" } } }
```

For servers without dynamic registration:

| `oauth` field | Meaning |
|---|---|
| `clientId` | Pre-registered client. Without it, Pi registers itself. |
| `clientSecret` | Optional; supports `${NAME}` and `!cmd`. |
| `callbackPort` | Loopback callback port → `http://127.0.0.1:<port>/callback`. |
| `callbackUrl` | Full redirect URI, must be `http` on `localhost`, `127.0.0.1`, or `[::1]`. No port → `callbackPort` or a free port is added (RFC 8252). |
| `scope` | Space-separated scopes for servers that do not advertise the ones they need. |

Sign-in flows: `/mcp login <server>`, `pi mcp login <server>` (default 300 s timeout, accepts a pasted redirect URL for SSH/remote-browser cases), and `/mcp` → select server → *Sign in*. A running session uses new credentials on its next turn. Sign-out deletes the stored credentials. If a server later demands more scope than granted, it shows as needing sign-in again.

---

## 8. Extension API

```ts
pi.registerMcpServer("jira", { url: "https://mcp.example.com/jira", exposure: "codemode" });
pi.unregisterMcpServer("jira");
pi.getMcpServers(); // RegisteredMcpServer[] — { name, config, extensionPath }
pi.on("mcp_servers_change", (event) => { /* event.servers — every registered server */ });
```

| Contract | Detail |
|---|---|
| Config shape | Exactly an `mcpServers` entry from `mcp.json`. Same validation, same `McpServerConfig` type. |
| Timing | Registered **during extension load** → connects on `session_start`, together with `mcp.json` servers. Registered **later** → connects immediately. |
| Persistence | **Not saved.** Register again on every load. `/reload` and a new session both re-run extension load, so re-registration is the mechanism, not a cache. |
| Ownership | `unregisterMcpServer` only removes a server this extension registered. |
| Precedence | A `mcp.json` server of the same name **wins**; `/mcp` lists the registration as overridden. |
| Re-registration | Registering the same name again replaces the extension's own earlier registration. |
| Throws | Invalid config, invalid name, and a name **another extension** already registered. |
| No connector | If no loaded extension handles MCP servers (another extension registered `/mcp` and replaced the built-in), each registration is reported as an extension error. |
| `/mcp` source | Registered servers appear with the registering extension path as their source; their enable/disable and exposure changes are **session-only** and are not written to any file. |
| `pi mcp` shell | Does **not** load extensions, so it never sees registered servers. |

Events and ownership in one picture:

```
extension load
  ├─ pi.registerMcpServer("sentry", {...})  ─┐
  └─ pi.registerMcpServer("jira",   {...})  ─┤
                                              ▼
session_start ──► builtin:mcp reads pi.getMcpServers() + mcp.json
                   mcp.json wins on name collision, others connect
                   ...
later            ──► pi.registerMcpServer("linear", {...})  → connects now
                   pi.on("mcp_servers_change") fires for other extensions
```

For an extension that wants to *be* the MCP host (e.g. `pi-mcp-adapter`), it handles `mcp_servers_change` and reads `pi.getMcpServers()` on `session_start`. Handling that event is what marks an extension as the one responsible for connecting registered servers.

---

## 9. Operator surface

### 9.1 Shell (works without a session, does not load extensions)

| Command | Effect |
|---|---|
| `pi mcp add <server> [opts] -- <command> [args...]` | Add/replace a stdio server. `--env KEY=VALUE` (repeatable), `--cwd <dir>`, `--exposure <mode>`, `-l`/`--local` for the project file. Does not connect. |
| `pi mcp add <server> --url <url>` | Add/replace an HTTP server. `--header K=V` (repeatable), `--bearer-token-env-var NAME`, `--oauth-client-id`, `--oauth-client-secret`, `--oauth-callback-port`. |
| `pi mcp remove <server>` | Remove the entry. Stored OAuth credentials are kept. |
| `pi mcp list [--json]` | Connects to every enabled server, prints state, tools, errors. Exit `1` if anything is wrong. |
| `pi mcp login <server> [--timeout <s>]` | Browser sign-in, default 300 s. |
| `pi mcp logout <server>` | Delete stored credentials. |

### 9.2 In session

`/mcp` opens the manager: state, tool count, exposure, and source (global vs project vs extension), with servers needing attention first. Per server: sign in, inspect tools/command/URL plus the full connection error (including the tail of a stdio server's stderr), reconnect, sign out, change exposure, enable/disable. Exposure and enable changes are saved into the `mcp.json` that defines the server; for extension-registered servers they apply to the session only.

Outside the TUI, `/mcp` prints status, and `/mcp login|logout|reconnect <server>` run directly.

### 9.3 Disabling

| Method | Effect |
|---|---|
| `"extensions": ["-builtin:mcp"]` in settings | Built-in MCP off; `pi mcp` shell commands still work. |
| `pi config` → Built-in | Same, interactively. |
| An extension registering `/mcp` (e.g. `pi-mcp-adapter`) | Replaces built-in MCP entirely: no `mcp.json` reading, no connections, `/mcp` belongs to it. Remove the extension to restore. |
| An extension registering a tool named `codemode` or `tool_search` | Replaces that built-in tool. |

---

## 10. Code mode

`codemode` is the other half of MCP in Pi. It is a **single tool** that runs model-written JavaScript in a QuickJS (WASM) sandbox whose only capability is calling other tools. Nested results never enter the model's context; only the script's `text()` output and `return` value do.

### 10.1 Why it exists, visually

```
WITHOUT codemode — 4 MCP tools, model must call each one itself

  model ──▶ mcp__github__search_code("auth")     ──▶ 8 000 tokens back
  model ──▶ mcp__github__get_file("auth.ts")      ──▶ 4 000 tokens back
  model ──▶ mcp__github__get_file("index.ts")     ──▶ 6 000 tokens back
  model ──▶ mcp__github__get_file("types.ts")     ──▶ 3 000 tokens back
                                                       ───────────────
                            4 round trips, 21 000 tokens of context

WITH codemode — one tool call, model sees 4 lines

  model ──▶ codemode { code }
              │
              │   ┌────────────────────────────────────────────┐
              │   │  const files = ["auth.ts","index.ts",     │
              │   │                  "types.ts"];              │
              │   │  const results = await Promise.allSettled( │
              │   │    files.map(p => tools.mcp__github__get_file(  │
              │   │      { path: p })));                      │
              │   │  return results                            │
              │   │    .filter(r => r.status === "fulfilled")  │
              │   │    .map(r => r.value.content[0].text      │
              │   │      .split("\n").slice(0, 3).join("\n")); │
              │   └────────────────────────────────────────────┘
              │        21 000 tokens in, ~200 tokens out
              ▼
           1 round trip, 200 tokens of context
```

Three wins in one: **fan-out** (parallel calls), **filtering** (results never had to be in context), and **control flow** (loops, error handling, retries — impossible one tool call at a time).

### 10.2 The sandbox boundary

```
        ┌──────────────────────── QuickJS VM (WASM, 256 MB) ───────────────────────┐
        │                                                                            │
   JS ──┼──▶  tools.<name>(args) ──┐                                                 │
        │  text() image() console   │  no Node, no fs, no network, no timers,        │
        │  store() load() exit()    │  no require, no WebAssembly                    │
        │  ALL_TOOLS                │                                                 │
        │  searchTools()            │                                                 │
        │  models.*                 │                                                 │
        └───────────────────────────┼────────────────────────────────────────────────┘
                                        │  one host-call entry point
                                        ▼
                        host thread: ctx.executeTool(name, args)
                                        │
                        ┌───────────────┴────────────────┐
                        │ validation, tool_call hooks,   │
                        │ permission gates, results     │
                        └────────────────────────────────┘
```

- `code` is the **body of an async function**: top-level `await` and `return` work.
- The script is a fresh VM per call, on a worker thread; QuickJS runs synchronously, so a spinning script would otherwise block the host event loop.
- `eval`/`Function` work, but only produce more code inside the same VM.
- Calls still running when the script returns are cancelled and reported as `cancelled`; unawaited promises are discarded.
- **Side effects are real.** A script that fails halfway does not undo earlier calls.
- 256 MB memory limit; exceeding it throws `InternalError: out of memory`. Filter instead of accumulating.

### 10.3 Script API

| Global | Signature | Notes |
|---|---|---|
| `tools` | `tools.<name>(args) => Promise` | Names are normalized to valid identifiers: `my-tool` is also `tools.my_tool` and `tools["my-tool"]`. `mcp__github__get_file` needs no change. |
| `ALL_TOOLS` | `{ name, description }[]` | Metadata for every enabled nested tool. |
| `searchTools` | `(query, { limit?, namespace? }) => Promise<{name,description}[]>` | BM25 ranking, default limit `8`. `namespace: "mcp__github"` scopes to one server. The escape hatch for `codemode-deferred` tools. |
| `describeTool` | `(name) => Promise<string \| undefined>` | Full description + TypeScript declaration. |
| `text` | `(value) => void` | Appends a text item. Non-strings are JSON-stringified. |
| `image` | `(dataUrlOrItem \| ImageContent) => void` | Accepts a base64 `data:` URL, `{ image_url }`, or an MCP `ImageContent` block — so `image(result.content[0])` forwards a server's image. Remote URLs are rejected. |
| `console.*` | `log/info/warn/error/debug` | Append text items like `text()`. |
| `return` | `return value` | Appended like `text()`. |
| `exit` | `() => void` | Ends the script successfully, keeping output and store writes. |
| `store` / `load` | `(key, value) => void` / `(key) => value` | JSON values across `codemode` calls in the same session. `store(key, undefined)` deletes. Writes are kept **only if the script succeeds**, and each successful script appends a `codemode-store` custom entry to the session — so resumed sessions keep them and each branch sees only its own path. Limits: 256 KiB per value, 1 MiB total. |
| `models` | `getModelsOfType`, `getAvailableOfType`, `getModelOfType`, `classify` | Model catalog and classifiers, on the session's credentials. At most 4 concurrent `classify` calls per script. |

An options line may be the first line:

```js
// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}
```

`max_output_tokens` defaults to 10000; longer output keeps its start and end and writes the full text to a temp file named in the result. `timeout_ms` is a hard deadline, unset by default. Invalid JSON, unknown fields, or an options line with no code throw a source error before anything runs.

Result envelope, from the model's side:

```
Script completed  1.2s
<script output>
```

```
Script failed  0.4s
<partial output>
Script error: TypeError: undefined is not a function
```

### 10.4 Result shapes in scripts

| Tool kind | Resolves to |
|---|---|
| Declares `outputSchema` | `structuredContent` — also for error results that carry one |
| MCP tool | Full `CallToolResult<T>` (`content`, `structuredContent`, `isError`) |
| Everything else | Its text content as one string |
| Failed / blocked / invalid | **Rejects** with an `Error` carrying the tool's error text |

`bash` is the canonical structured one:

```ts
{ output, truncated, full_output_path?, exit_code, wall_time_seconds }
```

`output` holds up to 1 MiB there — not the 2000 lines / 50 KB the model sees.

### 10.5 How the model learns what it can call

The `codemode` tool description is assembled per call from the current loadout:

```
codemode description
├── intro + global helper reference (exit/text/image/store/load/ALL_TOOLS/searchTools)
├── MCP_TYPESCRIPT_PREAMBLE            (only when MCP tools are callable)
│     type CallToolResult<T> = { content: ContentBlock[]; isError?: boolean; ... }
├── models.* declarations              (only when the namespace is exposed)
├── namespace: mcp__github             (description = server `instructions`)
│     get_file(args: { path: string }): Promise<CallToolResult<{…}>>
│     search_code(args: { q: string; page?: number }): Promise<CallToolResult<{…}>>
├── namespace: mcp__playwright         (5 of 31 tools shown)
│     … and "26 more tools not listed; use await searchTools(query)"
└── deferred guidance: some tools are callable but unlisted
```

| Setting | Default | Effect |
|---|---|---|
| `codemode.mode` | `"on"` | `on`: declared tools stay declared, and their descriptions gain a "how to call me from a script" section. `only`: declared tools are **hidden** from the model and listed in the codemode description instead — everything goes through scripts. |
| `codemode.inlineBudget` | `3000` | Estimated tokens (chars ÷ 4) for declarations. Every namespace is still listed with its tool count either way, and the description says whether the listing is complete. `0` lists namespaces only. |

Two activation paths:

| Path | How |
|---|---|
| Automatic | A `codemode`/`codemode-deferred` server connects and `autoEnableCodemode` is not `false`. A `deferred` server activates `tool_search` instead. |
| Explicit | `"defaultTools": ["+codemode"]` in `~/.pi/agent/settings.json` or `.pi/settings.json`. `+name` adds to the defaults; `--tools` **replaces** them, so it must name everything. |

If neither `codemode` nor `tool_search` ends up active while non-direct MCP tools exist, Pi warns once that the tools cannot be called.

### 10.6 Worked examples

Fan out and reduce — the canonical use:

```js
// @options: {"timeout_ms": 60000, "max_output_tokens": 1500}
const paths = ["src/index.ts", "src/app.ts", "src/db.ts"];

const results = await Promise.allSettled(
  paths.map((path) => tools.mcp__github__get_file({ path })),
);

for (const [i, result] of results.entries()) {
  if (result.status === "rejected") {
    text(`${paths[i]}: FAILED ${result.reason}`);
    continue;
  }
  const call = result.value;
  if (call.isError) {
    text(`${paths[i]}: server error`);
    continue;
  }
  const source = call.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  text(`${paths[i]}: ${source.split("\n").length} lines, exports ${
    (source.match(/^export /gm) ?? []).length
  }`);
}
```

Discover an omitted tool, then call it — required for `codemode-deferred`:

```js
const [hit] = await searchTools("create issue", { namespace: "mcp__github", limit: 3 });
if (!hit) {
  text("github has no issue-creation tool");
  return;
}

text(hit.name);
const created = await tools.mcp__github__create_issue({
  title: "Codemode smoke test",
  body: load("lastSummary") ?? "No prior summary in this session.",
});
text(`opened ${created.structuredContent?.html_url ?? created.content[0]?.text}`);
```

Carry state between calls, and forward an image:

```js
const pages = await tools.list_mcp_resources({ server: "sentry" });
store("sentryPages", pages.resources.map((r) => r.uri));

const shot = await tools.mcp__playwright__browser_take_screenshot({ type: "png" });
image(shot.content.find((b) => b.type === "image"));
```

### 10.7 `tool_search`, the other half

`tool_search` is off by default (`"defaultTools": ["+tool_search"]`). It ranks **un-declared** tools with the same BM25 as `searchTools()` and declares the matches for the next model call, after which the model calls them directly — no scripts.

| | `codemode` | `tool_search` |
|---|---|---|
| Model writes | JavaScript | Nothing |
| Reaches tools | All callable, in parallel, with filtering | One at a time, direct |
| Best for | Many calls, big results, loops, branching | One-off calls to a huge server |
| Transcript | Script output | Individual tool results |
| Branch behavior | Script-callable tools stay callable after `/tree`, resume, fork | Loaded declarations stay on that branch only |

### 10.8 Code mode without MCP

`codemode` is not an MCP feature. With no servers at all it still batches built-in tools, filters `bash` output before it reaches the context, and calls classifier models:

```js
const files = await tools.find({ pattern: "**/*.ts", path: "src" });
const counts = await Promise.allSettled(
  files.slice(0, 200).map((f) => tools.read({ path: f })),
);
text(`${counts.filter((c) => c.status === "fulfilled").length} readable of ${files.length}`);
```

### 10.9 SDK

SDK sessions do not load built-in extensions. Add them yourself:

```ts
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: getAgentDir(),
  extensionFactories: [
    createCodemodeExtension({ mode: "on" }),
    createToolSearchExtension(),
    createMcpExtension(),
  ],
});
await resourceLoader.reload();

const settingsManager = SettingsManager.create(cwd);
settingsManager.applyOverrides({ defaultTools: ["+codemode", "+tool_search"] });

const { session } = await createAgentSession({ resourceLoader, settingsManager, sessionManager });
await session.bindExtensions({}); // emits session_start → MCP servers connect
```

`createCodemodeExtension` options: `mode`, `inlineBudget`, `models` (default `true`).
`createMcpExtension` options: `loadConfig`, `createTransport`, `credentials`, `logPath`, `openUrl`, `updateConfig`, `startupWaitMs` (default `10000`).

---

## 11. What this means for packs

Design notes for `pi-agent-resource`, not yet implemented.

| Question | Answer from the API |
|---|---|
| Can a pack ship MCP servers? | Yes, via `pi.registerMcpServer()` at extension load. There is no declarative pack mechanism — Pi reads `mcp.json` files and extension registrations, nothing else. |
| When to register? | During extension load, so servers connect on the same `session_start` wave as `mcp.json` servers. `builtin:mcp` reads `pi.getMcpServers()` there. |
| How does the pack know which servers to register? | The pack selection is already resolved at load time (the `--resource:load-pack` flag plus the temp selection file), so registration can be gated on the same read the `resources_discover` handler uses. |
| Are they persisted? | No. Every load re-registers. That is the correct model for packs: the pack *is* the config. |
| Reload / new session? | Both re-run extension load, so registration re-happens automatically. `resource:pack:session:reload` needs no MCP-specific work. |
| Name collisions across packs? | A name registered by another extension **throws**. Prefix by pack (`<pack>__<server>`) or namespace by pack. Names must match `^[A-Za-z0-9_-]+$` — note `__` is fine. |
| Collision with `mcp.json`? | `mcp.json` silently wins and `/mcp` shows the override. A pack cannot override a user's `mcp.json` entry. |
| Which exposure for a pack? | `codemode` (the default) is almost always right: the pack's tools stay out of every request's declarations and remain reachable from scripts. Use `direct` only for a two-or-three-tool pack server the model should always see. |
| OAuth servers in a pack? | Supported: a URL server with no `Authorization` header triggers the sign-in flow. The pack should surface `/mcp` in its instructions, and the user signs in out of band. |
| Can the pack edit `mcp.json` for the user? | The mutators are internal. It would have to read/parse/write the JSON itself and then call `/reload` (or `ctx.reload()` from a command). That is the same "edit" workflow the other managers already have. |
| What about `--edit`-style flags? | `pi.registerFlag()` is the extension-side mechanism (the pack already uses `pi.getFlag()` for `--resource:load-pack`). A pack-scoped MCP flag should follow that same pattern rather than a new file format. |

### Suggested pack layout

```
.pi/packs/<pack>/
  skills/…                       existing
  prompts/…                      existing
  mcp.json                       optional: `mcpServers` map, the same shape as Pi's
```

`mcp.json` inside the pack keeps the pack self-describing and copyable. The extension reads it, validates each entry (rejecting `sse`, bad names, and missing `command`/`url` up front with a clear message), and registers each entry under a pack-prefixed name.

---

## 12. Gotchas

1. **Default exposure is `codemode`, not `direct`.** A newly added server will appear to "not work" until the model writes a script. Check that `codemode` is active (`/mcp` shows the tool count; `autoEnableCodemode: false` or `"-builtin:codemode"` silences it).
2. **`type: "sse"` is rejected.** Servers that document `/sse` usually serve streamable HTTP at `/mcp`.
3. **`command` is not a shell string.** `"npx -y server"` fails; use `command` + `args`.
4. **A `!command` value must print the whole value**, including `Bearer `.
5. **A `url` on an entry that also has `command` wins** — the entry is treated as HTTP and `command` is ignored.
6. **Invalid entries are skipped, not fatal.** One bad server does not stop the others; it is reported once at startup.
7. **Tool names contain `__` and cannot be renamed.** `mcp__<server>__<tool>` is what permission rules, `toolExposure` (which uses the *bare* tool name), and codemode identifiers are keyed on. `toolExposure` takes the name **as the server offers it**, without the prefix.
8. **Tool calls are never retried.** A timeout may still have run the tool on the server. Do not build retry loops on write tools.
9. **Resource tools take the widest exposure** of all resource-bearing servers, so one `direct` server makes all three resource tools `direct`.
10. **Registered servers are invisible to `pi mcp list`** — that command does not load extensions.
11. **A `mcp.json` entry silently beats a pack/extension registration** of the same name.
12. **Project `.pi/mcp.json` needs project trust.** A pack that ships stdio servers in a repo will not connect in an untrusted project.
