# Pi vs. Codex vs. Claude Code — MCP configuration deviations

Companion to [`pi-mcp-api.md`](./pi-mcp-api.md). That file documents Pi; this one is about **where Pi's config shape diverges from the other harnesses**, so you know what copies over and what does not.

| | |
|---|---|
| Pi side | `@earendil-works/pi-coding-agent` **0.99.1**, verified against `dist/extensions/mcp/{config,runtime}.js`, `dist/core/{mcp-servers,resolve-config-value}.js` |
| Codex side | `developers.openai.com/codex/mcp` (config reference + MCP page) |
| Claude Code side | `code.claude.com/docs/en/mcp` |
| Date | Pi 0.99.1 as installed; other two as published docs at the time of writing — both ship fast, re-check before relying on a field |

---

## 1. One-glance matrix

| Concern | Pi | Codex | Claude Code |
|---|---|---|---|
| File format | JSON, dedicated file | TOML, shared with all config | JSON, dedicated file |
| Global path | `~/.pi/agent/mcp.json` | `~/.codex/config.toml` | `~/.claude.json` (local + user scopes) |
| Project path | `<proj>/.pi/mcp.json` (trusted only) | `<proj>/.codex/config.toml` (trusted only) | `.mcp.json` in project root (committed, approval prompt) |
| Container key | `mcpServers` | `[mcp_servers.<name>]` tables | `mcpServers` |
| Scopes | 2 (global, project) | 2 (global, project) + managed | 5 (local, project, user, plugin, claude.ai connector) + managed |
| Transports | stdio, streamable HTTP | stdio, streamable HTTP | stdio, HTTP, SSE (deprecated), WebSocket, in-process `sdk` |
| `type` field | optional, inferred | n/a | **required** for `url` entries |
| Duplicate names | project replaces global | project replaces global | highest-precedence scope wins, **no field merging** |
| Default visibility | `codemode` (script-only) | declared to the model | declared to the model |
| Per-tool policy | `toolExposure` (visibility) | `enabled_tools` / `disabled_tools`, `approval_mode`, `output_token_limit` | none in the config file (permission rules instead) |
| Per-request timeout | `timeout` (60 s) | `tool_timeout_sec` (60 s) + `startup_timeout_sec` (10 s) | `timeout` on remote transports |
| Bearer token | write the header yourself | `bearer_token_env_var` | write the header yourself |
| Header helper | `!command` per value | `http_headers_helper` (JSON map) | `headersHelper` (JSON map) |
| Fail startup if down | no | `required = true` | no |
| OAuth client | `oauth.clientId` / `callbackPort` / `callbackUrl` / `scope` | `[mcp_servers.n.oauth]` + global callback URL/port + `iss` validation | `oauth.scopes`, `authServerMetadataUrl` |
| Env forwarding allowlist | no | `env_vars` | n/a (strips credential vars for project scope) |
| Roots / project dir | `cwd` field | `cwd` field | `CLAUDE_PROJECT_DIR` env + MCP `roots/list` |
| Tool name form | `mcp__<server>__<tool>` | bare tool name in config | `mcp__<server>__<tool>` |
| Missing `${VAR}` | **connection fails** | — | warns, loads with the text unexpanded |
| Resources | 3 built-in tools (`list_mcp_resources`, …) | — | — |
| Script access to tools | `codemode` (QuickJS) | — | — |

The last three rows have **no equivalent at all** in the other two. That is the substantive difference; everything else is surface area.

---

## 2. File layout and scopes

```
Pi                              Codex                        Claude Code
────────────────────────────    ──────────────────────────   ─────────────────────────────
~/.pi/agent/mcp.json            ~/.codex/config.toml         ~/.claude.json
  mcpServers + autoEnableCodemode  [mcp_servers.*] + all       local + user scope entries,
                                     other Codex settings        keyed per project path
                                                                       │
<proj>/.pi/mcp.json             <proj>/.codex/config.toml     <proj>/.mcp.json
  read only when trusted          read only when trusted       read after approval; committed
                                                                   │
pi.registerMcpServer()          (none)                       plugins, managed config,
  session-scoped, extension-sourced  no in-process path      claude.ai connectors
```

Deviations that matter:

1. **Pi's `mcp.json` is a dedicated file with exactly one extra top-level key** (`autoEnableCodemode`). Codex puts MCP inside the whole config file, so a Codex user converting to Pi must extract the `[mcp_servers.*]` tables into a new file. Claude Code's `.mcp.json` is as dedicated as Pi's, but its allow/deny lists (`enabledMcpjsonServers`, `disabledMcpjsonServers`) live in `settings.json`, not in the MCP file.
2. **Claude Code has five scopes and an explicit precedence chain**: local → project → user → plugin → claude.ai connector. Pi has two, and the project one wins. There is no user-vs-project-vs-local distinction in Pi — "global" is both.
3. **Claude Code does not merge fields across scopes**: the whole entry from the highest-precedence source is used. Pi behaves the same for the project/global pair (an entry is replaced wholesale), so this one actually matches.
4. **Pi is the only one of the three where an extension can add servers at runtime.** `pi.registerMcpServer()` is session-scoped and is not visible to `pi mcp list` (the shell command does not load extensions). Codex and Claude Code only have file/CLI sources, plus Claude Code's in-process `sdk` type for its own SDK host.
5. **Managed/policy configuration** exists in Claude Code (enterprise-provisioned servers) and has no Pi or Codex equivalent here.

---

## 3. Transport selection

This is the sharpest behavioral difference, and the two harnesses err in **opposite directions**.

```
entry has "url" but no "type"
─────────────────────────────────────────────────────────────────────────────
Claude Code   ✗ HARD ERROR, server skipped
              "MCP server "x" has a "url" but no "type"; add "type": "http""
              (a "type"-less entry is read as stdio, so the server never loads)

Pi            ✓ VALID — inferred as streamable HTTP
              validator: url present && type in {undefined,http,streamable-http} → HTTP

Codex         ✓ VALID — presence of url vs command selects the transport
```

```
entry with BOTH "command" and "url"
─────────────────────────────────────────────────────────────────────────────
Claude Code   type decides; a stdio entry with a stray url is a validation error
Pi            ✗ SILENT — the url branch is checked first, `command` is ignored
Codex         transport chosen by which key is present
```

```
legacy "type": "sse"
─────────────────────────────────────────────────────────────────────────────
Claude Code   ✓ supported, deprecated; recent versions fall back HTTP → SSE automatically
Pi            ✗ REJECTED — "legacy SSE transport is not supported; use the streamable
                 HTTP URL" (validation error, server skipped)
Codex         ✗ not a transport
```

Also unique to Pi: `type: "streamable-http"` is accepted as an alias for `http` (Claude Code accepts the same alias). Pi has no WebSocket and no in-process `sdk` transport.

> **Migration hazard:** a Claude Code entry with `type: "sse"` converts to a Pi entry that will not load. Most servers that document `/sse` also serve streamable HTTP, usually at `/mcp` instead of `/sse` — change the URL, drop the `type`.

---

## 4. Field-by-field

### 4.1 stdio

| Concept | Pi | Codex | Claude Code |
|---|---|---|---|
| Executable | `command` (string) | `command` | `command` |
| Arguments | `args` (string array) | `args` | `args` |
| Working dir | `cwd` (relative → session dir; `~/` expanded) | `cwd` | **no `cwd`** — sets `CLAUDE_PROJECT_DIR` in the child's env instead |
| Env, explicit | `env` map | `env` map | `env` map |
| Env, pass-through | — | `env_vars = ["TOKEN"]` (names to forward from Codex's own env, or `{name, source="remote"}`) | — |
| Env, credential scrubbing | — | — | Strips credential vars (e.g. `ANTHROPIC_API_KEY`) from project-scope and plugin servers |
| Remote execution | — | `experimental_environment = "remote"` | — |
| Roots protocol | not documented | not documented | implements `roots/list` + `notifications/roots/list_changed` |

Notable:

- **No `env_vars` equivalent in Pi.** Codex's pass-through form (`env_vars`) lets a shared config forward a machine-local secret without naming a value. In Pi you must write `"env": { "API_KEY": "${API_KEY}" }` — same effect, but the name appears in the file.
- **Pi expands `~/` in `command`, `args`, and `cwd`** (verified in `runtime.js`: `expandHome` on all three). Claude Code expands `${VAR}` there instead; Pi does **not** interpolate `${VAR}` in `command`/`args` — see §5.

### 4.2 streamable HTTP

| Concept | Pi | Codex | Claude Code |
|---|---|---|---|
| URL | `url` (must be http/https) | `url` | `url` |
| Static headers | `headers` map | `http_headers` map | `headers` map |
| Headers from env | `"${VAR}"` inside a `headers` value | `env_http_headers` = header → env var **name** | `"${VAR}"` inside a `headers` value |
| Header helper command | `"!cmd"` per value; must print the **entire** value | `http_headers_helper` = one command printing a JSON header map | `headersHelper` = one command printing a JSON header map |
| Bearer shortcut | — | `bearer_token_env_var = "NAME"` | — |
| Auth mode switch | — | `auth = "oauth" \| "chatgpt"` (ChatGPT session for first-party origins) | — |
| Timeout | `timeout` seconds (default 60) | `tool_timeout_sec` (60) | `timeout` (remote transports) |
| Eager load | — | — | `alwaysLoad` |
| Helper refresh on 401/403 | n/a (result cached for the process) | re-runs the helper once after a same-origin 401/403, retries only if values changed | helper re-run semantics tied to trust + refresh |
| OAuth | `oauth{clientId,clientSecret,callbackPort,callbackUrl,scope}` | `[mcp_servers.n.oauth] client_id/callback_url/callback_port` + globals `mcp_oauth_callback_url`, `mcp_oauth_callback_port` | `oauth{scopes}`, `authServerMetadataUrl` |

Notable:

- **Codex's `bearer_token_env_var` has no Pi field.** Pi users write the header. Conveniently, `pi mcp add --bearer-token-env-var NAME` writes exactly `"Authorization": "Bearer ${NAME}"` for you, so the CLI is the equalizer.
- **Codex's `env_http_headers` is cleaner than Pi's inline form** for machine-specific headers, because the value is a variable *name*, not an expansion embedded in a string. A pack author targeting both has to pick one.
- **A Pi `!command` result is cached for the process lifetime** (`commandResultCache` in `resolve-config-value.js`). A short-lived token from `!gh auth token` stays stale for the whole session — no 401-triggered refresh like Codex's. This is the one place where Pi is *worse* than Codex for long-lived sessions.
- **Codex's OAuth callback handling is considerably more elaborate**: callback-URL/port defaults, server-specific callback-ID suffixes, `iss` validation against metadata, and rejection rules for mismatches. Pi's model is the simple one: DCR by default, `callbackPort`/`callbackUrl` only for pre-registered clients, RFC 8252 variable loopback ports.
- **Claude Code additionally scrubs ambient credentials** for project-scope servers, so a malicious committed `.mcp.json` cannot exfiltrate `ANTHROPIC_API_KEY`. Pi does not document any scrubbing: a project's `.pi/mcp.json` gets the user's real environment (minus what trust gates), and `env` values are passed through verbatim.

### 4.3 Cross-cutting settings

| Concept | Pi | Codex | Claude Code |
|---|---|---|---|
| Disable a server | `enabled: false` | `enabled = false` | disable via `/mcp` or settings lists |
| Fail startup if it cannot connect | — | `required = true` | — |
| Tool allowlist | — | `enabled_tools = [...]` | — |
| Tool denylist | — | `disabled_tools = [...]` (applied after the allowlist) | — |
| Default approval | — (see §6) | `default_tools_approval_mode = auto\|prompt\|writes\|approve` | permission rules |
| Per-tool approval | — | `[mcp_servers.n.tools.<tool>] approval_mode` | permission rules by tool name |
| Per-tool output budget | 20 KB model-side truncation, fixed; not configurable | `output_token_limit` per tool | — |
| Tool visibility | `exposure` + `toolExposure` | — | — |
| Startup wait | fixed 10 s on the first prompt | `startup_timeout_sec` (10) + `mcp_optional_startup_grace_ms` (1000) | — |

The `required` flag has no Pi analogue: in Pi, a server that never connects is reported once at startup and its tools simply never appear. Codex can make that a hard startup failure instead.

---

## 5. Interpolation and secrets — verified Pi semantics

Read from `dist/core/resolve-config-value.js` and `dist/extensions/mcp/runtime.js`, not just the docs.

| Location in the entry | Pi behaviour |
|---|---|
| `env` values | `${NAME}`, `$NAME` (bare form works), and `!command` |
| `headers` values | same three forms |
| `oauth.clientSecret` | same three forms |
| `command` | **only** `~/` home expansion |
| `args` | **only** `~/` home expansion |
| `cwd` | relative → session dir, plus `~/` |
| `url` | none |

Grammar details:

| Syntax | Pi | Claude Code |
|---|---|---|
| `${VAR}` | ✓ | ✓ |
| `${VAR:-default}` | ✗ — the braces content fails the name check, so it stays **literal text** | ✓ |
| `$VAR` (no braces) | ✓ | not documented |
| `$$`, `$!` | escape to a literal `$` / `!` | — |
| `!command` | ✓ whole-value shell command, output trimmed, **cached for the process** | via `headersHelper` (JSON map) |
| Missing `${VAR}` | **throws**: `Failed to resolve MCP server "x" header "Authorization" from environment variable: TOKEN` → the server does not connect | warns in `claude mcp list` / `/mcp` and loads the server with `${VAR}` unexpanded |

The throw-on-missing behaviour is the one to internalize: **Pi fails the connection**, it does not warn and continue. A `${VAR:-default}` copied straight from a Claude Code config is not a no-op in Pi — it silently becomes literal text, and a URL containing it will usually fail the http/https parse check with `url must be an http or https URL`.

---

## 6. Three different policy philosophies

This is where the harnesses are genuinely not comparable, and where a pack author has to pick sides.

```
Codex  — DECLARATIVE APPROVAL IN THE CONFIG FILE
  [mcp_servers.github]
  default_tools_approval_mode = "writes"          # auto | prompt | writes | approve
  [mcp_servers.github.tools.delete_repo]
  approval_mode = "prompt"
  [mcp_servers.github.tools.search_code]
  approval_mode = "approve" ; output_token_limit = 30000
        └─► policy travels with the config, no code

Claude Code — PERMISSION SYSTEM, NAME-BASED
  project .mcp.json servers prompt for approval on first use
  settings.json: enabledMcpjsonServers / disabledMcpjsonServers (deny wins)
  fine-grained rules keyed on mcp__<server>__<tool>
        └─► policy lives in a separate rules system

Pi — SERVER ANNOTATIONS + CODE
  the server declares readOnlyHint / destructiveHint / idempotentHint / openWorldHint
  an extension reads them on tool_call and decides:
      hints?.destructiveHint === true  ->  confirm
  or set visibility declaratively instead:
      "toolExposure": { "delete_*": "hidden", "get_*": "codemode" }
        └─► policy is code, but the *facts* come from the server
```

Pi's `toolExposure` is often mistaken for Codex's `enabled_tools`. They are not the same axis:

| | `enabled_tools` / `disabled_tools` (Codex) | `toolExposure` (Pi) |
|---|---|---|
| Removes the tool entirely? | yes | only with `hidden` |
| Keeps it out of the model's context? | yes, implicitly | yes, by default (`codemode`) |
| Keeps it callable from a script? | n/a | yes, unless `hidden` |
| Per-tool *permission* | yes (`approval_mode`) | no — that needs a `tool_call` hook |

So the Codex equivalent of a Pi pack is not `toolExposure` alone; it is `exposure`-style thinking plus an approval hook.

---

## 7. Concepts with no equivalent anywhere else

| Pi concept | What it does | Codex | Claude Code |
|---|---|---|---|
| `exposure` (5 modes) | Controls whether tools are declared to the model, listed to codemode, loadable by `tool_search`, or unreachable | — | — |
| `codemode` | One tool running model-written JS in QuickJS that calls other tools; nested results never enter context | — | — |
| `tool_search` | BM25-loads un-declared tools on demand | — | "Tool Search" loads MCP schemas lazily (similar goal, different mechanism: schema loading, not script access) |
| `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` | First-class MCP resources as tools, exposure taken from the widest contributing server | — | — |
| `mcp__<server>` namespace | Groups tools under the server's `instructions` in the codemode description | — | — |
| `pi.registerMcpServer()` | Session-scoped server registration from an extension | — | `type: "sdk"` in-process, SDK hosts only |
| `autoEnableCodemode` | Activates `codemode` when a script-only server connects | — | — |

Default-exposure consequence: in Codex and Claude Code a connected server's tools are in the model's context. In Pi they are **not**, unless you ask. A pack that ships a server and expects the model to call it directly must set `"exposure": "direct"` (or add `"+codemode"` to `defaultTools` and accept that the model writes scripts).

---

## 8. Migration recipes

### 8.1 Claude Code `.mcp.json` → Pi

Usually a file copy, with three edits:

```jsonc
// claude .mcp.json                       // ~/.pi/agent/mcp.json  or  .pi/mcp.json
{
  "mcpServers": {
    "docs": {
      "type": "http",                    // ── 1. drop "type" (optional in Pi, but harmless)
      "url": "${API_BASE:-https://x}/mcp", // ── 2. ${VAR:-default} is NOT supported → inline it
      "headers": { "Authorization": "Bearer ${MCP_API_KEY}" },  // ── 3. ok as-is
      "alwaysLoad": true                 // ── 4. unknown key: ignored, remove it
    },
    "sse-thing": { "type": "sse", "url": "https://x/sse" }  // ── 5. REJECTED → use the
    //                                                          streamable HTTP URL instead
  }
}
```

Also: `"type": "ws"` entries have no Pi transport; rename the server if it contains characters outside `[A-Za-z0-9_-]`; and expect a **hard connection failure** (not a warning) for any `${VAR}` that is unset in the Pi process environment.

`enabledMcpjsonServers` / `disabledMcpjsonServers` have no equivalent — use `enabled: false` per server.

### 8.2 Codex `config.toml` → Pi

Mechanical field mapping:

| Codex `[mcp_servers.X]` | Pi `mcpServers.X` | Note |
|---|---|---|
| `command`, `args`, `cwd` | `command`, `args`, `cwd` | same |
| `env` (map) | `env` | same |
| `env_vars` (names) | `env = { "K": "${K}" }` | no pass-through form |
| `url` | `url` | same |
| `bearer_token_env_var = "T"` | `headers = { "Authorization": "Bearer ${T}" }` | or `pi mcp add --bearer-token-env-var T` |
| `http_headers` (map) | `headers` | same |
| `env_http_headers` (map) | inline `${VAR}` per header | no name-only form |
| `http_headers_helper = "cmd"` | `"!cmd"` per header value | must print the whole value, cached per process |
| `startup_timeout_sec` | — | fixed 10 s first-prompt wait |
| `tool_timeout_sec` | `timeout` | same default (60) |
| `enabled` | `enabled` | same |
| `required` | — | no equivalent |
| `enabled_tools` / `disabled_tools` | `toolExposure` with `direct`/`hidden` | different axis, see §6 |
| `default_tools_approval_mode` | — | needs a `tool_call` hook |
| `tools.<t>.approval_mode` | — | needs a `tool_call` hook |
| `tools.<t>.output_token_limit` | — | fixed 20 KB model-side |
| `auth = "chatgpt"` | — | no equivalent |
| `[mcp_servers.X.oauth] client_id` | `oauth.clientId` | |
| `callback_url` / `callback_port` | `oauth.callbackUrl` / `oauth.callbackPort` | Pi is simpler: no callback-ID suffixes, no `iss` validation |
| `mcp_oauth_callback_url` / `mcp_oauth_callback_port` (global) | per-server only | |

Worked example:

```toml
# ~/.codex/config.toml
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_from_keychain" }
env_vars = ["GITHUB_TOKEN"]
startup_timeout_sec = 20
tool_timeout_sec = 90
enabled = true
enabled_tools = ["search_code"]
default_tools_approval_mode = "writes"
```

```json
// ~/.pi/agent/mcp.json  — everything above except the approval policy
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "timeout": 90,
      "enabled": true,
      "toolExposure": { "search_code": "direct" }
    }
  }
}
```

Note what is lost: the 20 s startup grace (Pi waits a fixed 10 s and then the tools simply arrive later), the `writes` approval mode (needs a `tool_call` hook), and `enabled_tools` as a *filter* (`toolExposure` here keeps the other tools reachable from codemode scripts — add `"*": "hidden"` if you want a true allowlist).

---

## 9. Deviation gotchas, ranked

1. **Pi's default is "invisible to the model."** Migrating a Codex/Claude config verbatim usually produces a server that connects and appears to do nothing. Symptom: `/mcp` shows the tools, the model never calls them. Fix: `"exposure": "direct"`, or enable `codemode` and let it script.
2. **`${VAR:-default}` silently becomes literal text in Pi.** Claude Code configs using it will not behave as written, and a `url` containing one usually fails the URL parse check.
3. **An unset `${VAR}` fails the connection in Pi** (`Failed to resolve … from environment variable: X`) rather than warning and loading unexpanded. A config that works under Claude Code can be unloadable under Pi purely because of shell environment differences between the two processes.
4. **Pi does not interpolate `${VAR}` in `command` or `args`** — only `~/`. A `"command": "${NPM_HOME}/bin/server"` works in Claude Code and silently runs a literal path in Pi.
5. **`type: "sse"` is rejected outright**; no WebSocket, no in-process `sdk`.
6. **An entry with both `command` and `url` silently becomes HTTP.** After a partial hand-edit, check which one you meant.
7. **`!command` results are cached for the process lifetime.** Short-lived credentials go stale; Codex refreshes helpers on 401/403.
8. **No `required` equivalent.** A dead server is a one-line report, not a startup failure.
9. **No declarative approval.** Codex's `approval_mode` has to be reimplemented as a `tool_call` hook keyed on the server's annotations.
10. **Unknown keys are accepted and ignored.** Copying Codex's `bearer_token_env_var` or Claude Code's `alwaysLoad` into a Pi entry produces no error and no effect — the validator only inspects the keys it knows.
11. **No `env_vars` pass-through and no credential scrubbing.** Porting a Codex `env_vars` entry, or relying on Claude Code's habit of stripping ambient credentials from project-scope servers, both need rework.
12. **Extension-registered servers are invisible to the shell CLI.** `pi mcp list` does not load extensions, so pack servers never appear there — only in `/mcp`.
