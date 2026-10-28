# pi-tiered-subagents

A family-aware subagent runtime for [pi](https://github.com/earendil-works/pi-coding-agent):
scoped specialists, layered agent definitions, and inspectable model selection.

> **Status: stabilization complete; release approval is a separate decision.**
> The package passes 2,466 tests (one skipped) against Pi 1.3.0, plus packed
> install, declared Node floor, and live stdio MCP checks. It is loaded from
> TypeScript source, with no build step, so Pi compiles the extension itself.
> The implementation includes authoritative launch preparation, explicit session
> ownership and cleanup, extracted presentation, typed tool outputs, and offline
> SDK checks; the reviewed SDK and lifecycle gaps were reproduced, fixed, and
> re-verified. See [docs/stabilization.md](docs/stabilization.md) for the evidence
> and known limitations, and [docs/status.md](docs/status.md) for history.

## Install

```bash
pi install npm:@code-fixer-23/pi-tiered-subagents
```

The package is a **replacement runtime**, not a second orchestrator: enabling it
alongside another subagent runtime in the same session is not supported.

## What it does today

The runtime is a credited derivative of
[`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
v25.0.1, which is itself a friendly fork of
[`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents). It provides:

- **Spawning** — a `subagent` tool that starts a child agent in the background by
  default, with an explicit foreground mode.
- **Workspace scheduling** — one child at a time may change the files in a
  workspace. The rule follows the child's effective tools, not its role: a
  child that only reads runs alongside the one that writes, and a shell or an
  unknown tool counts as a writer.
- **Result retrieval** — `get_subagent_result` polls or awaits a child's status
  and result.
- **Steering** — `steer_subagent` sends a message to a running child.
- **Resume** — a settled agent can be resumed with a new prompt, continuing its
  session.
- **A published service** — other extensions can spawn and observe agents through
  the typed API:

  ```ts
  const { getSubagentsService } = await import("@code-fixer-23/pi-tiered-subagents");
  const svc = getSubagentsService();
  const result = await svc?.launch("Explore", "Check for stale TODOs");
  if (result?.kind === "accepted") console.log(result.id);
  else if (result) console.warn(result.reason, result.message);
  ```

  The launch surface is a deliberate breaking replacement for a synchronous
  `spawn(): string`: `launch()` accepts into background handoff,
  `run()` prepares, accepts, and awaits one foreground run to its settled
  record, and expected failures resolve as `{ kind: "rejected", reason, message }`
  rather than throwing. A `launch` signal cancels preparation only and detaches
  after acceptance; a `run` signal stops the queued or running work it owns.

  The service is published on `globalThis` under this package's own symbol key,
  `Symbol.for("@code-fixer-23/pi-tiered-subagents:service")`.

- **Shared settings** — the settings live in the shared store
  (`@juanibiapina/pi-extension-settings`), in the operator's file and the
  project's file, so one place holds the settings of every extension that
  uses it. The inherited generic loader is still exported for other packages:

  ```ts
  import { loadLayeredSettings } from "@code-fixer-23/pi-tiered-subagents/settings";
  ```

  It is no longer this package's own backend; see
  [docs/status.md](docs/status.md).

- **A live widget** and a `/subagents:sessions` transcript viewer, mounted on Pi's
  own components. All terminal presentation lives in the internal `src/ui/`
  module, including settings, tool-result, and notification renderers. It is
  part of this project, not a separate package or extension to enable.

## Commands

| Command | Purpose |
| --- | --- |
| `/subagents:settings` | Concurrency, turn limits, retention, interrupt policy |
| `/subagents:sessions` | Browse a subagent's transcript (read-only) |

## Models

A model is named exactly, as `provider/modelId`:

```json
{ "model": "anthropic/claude-sonnet-5" }
```

A name that the session cannot run fails the launch; it never falls back to
another model.

Automatic routing uses the resolved agent identifier and the family profile's
required `group`:

| Agent | Size group (`gpt`, `claude`, `qwen`) | Planner/worker group (`gemini`, `minimax`, `glm`, `mimo`, `deepseek`) |
| --- | --- | --- |
| `worker` (general-purpose work) | One size below the parent, clamped at S | worker |
| `researcher` | S | worker |
| `debug` | M | worker |
| `reviewer` | Equal: the parent's own size | planner |
| `explore` | S | worker |

Custom identifiers use worker behavior; this does not add a sixth shipped role.
The mapping is shipped policy, not operator-configurable settings.

Size assignments are Qwen max = L, plus = M, flash = S; Claude opus = L,
sonnet = M, haiku = S; GPT sol and astra = L, pro/terra = M, luna/mini/nano = S.
Dated snapshots use the size of the tier they belong to.

Automatic model routing stays within the parent's exact family and version.
A size or class target starts at the top matching rung in that version; Equal
starts at the parent's own rung, not the top of its size. Try concrete IDs in
preference order, then eligible cheaper rungs in the same version, skipping
anything the session cannot run. No version fallback links are supported or
inferred. If no role target or cheaper rung is runnable, keep the parent's
model and report why. An unknown family also retains the parent, without
price-based or name-based guessing. A reviewer retaining its own rung by Equal
is a designed choice, not an exhaustion fallback. The launch reason names the
role and target as well as the chosen model, including retained outcomes.

Flash-named tiers, including the separate flash-lite rung, are worker class;
pro/non-flash flagship tiers are planner class. These are profile labels, not
runtime name-based classification. MiniMax M3.1-flash is the worker rung
below its planner flagship, available only to routing within version 3.1.
This is **MiniMax 3.1 flash, not Gemini 3.1 flash**. Older MiniMax versions
cannot reach it; flash-only Gemini versions cannot reach a different version's
planner, and Qwen cannot reach another version's S tier. Missing targets retain
the parent. DeepSeek has planner but no worker class: reviewer targets pro,
and the other roles retain the parent.

GLM uses a glued-version naming strategy (version adjoining the prefix,
variants following it) and a planner/worker profile. Kimi is no longer a
supported automatic-routing family: an unpinned Kimi parent is retained.
The shipped catalogue is representative of the installed SDK, not a promise of
vendor availability. Profiles enumerate candidates; session access decides
which can run. Model routing changes neither exact-pin resolution nor reasoning
selection.

The ladders are data. An operator can replace a family whole in the runtime's
settings file, under `familyProfiles`:

```json
{
  "familyProfiles": {
    "gpt": {
      "group": "size",
      "tiers": [
        { "tier": "sol", "size": "L" },
        { "tier": "terra", "size": "M" },
        { "tier": "luna", "size": "S" }
      ]
    },
    "minimax": {
      "group": "planner-worker",
      "tiers": [
        { "tier": "", "class": "planner" },
        { "tier": "flash", "class": "worker" }
      ]
    }
  }
}
```

A replacement must declare `group: "size"` or `group: "planner-worker"`.
Every tier in a size profile requires `size: "S" | "M" | "L"`; every tier in a
planner/worker profile requires `class: "planner" | "worker"`. Tiers are
version-independent: the router reads the parent's version, targets a rung, and
constructs the exact model ID with the family's naming structure. Tier names are
trimmed, and the empty name remains the family's unnamed default line. Unknown
profile fields are rejected with path-aware diagnostics; the one exception is an
obsolete tier-level `fallbacks` field, which is accepted and discarded. Profiles
no longer declare `versions` or concrete `models`; those fields are rejected.
Whole-family replacement semantics stay the same.

Only declared data is read: a field the schema does not name is rejected, never
evaluated. A replacement profile with an unsupported naming structure is
refused; an unknown parent family instead retains the parent model.

## Reasoning

A child's reasoning level is chosen after its model, from what the model
actually supports:

When parent effort is known, automatic reasoning takes the next supported
non-off rung below it in the chosen model's level array (the highest supported
level strictly below the parent). Gaps are skipped; at the floor, effort stays.
This includes retained models: on `[low, high, max]`, `max` becomes `high`,
not `low`. There is no fixed medium/low preference with known parent effort.
With no parent effort, the default remains medium, then low, then the lowest
supported non-off level. Request reasoning, then definition reasoning, still
wins, with Pi-compatible clamping; non-reasoning models report *not applicable*.

Unsupported explicit levels are clamped, never silently to off on a reasoning
model. The prohibition on explicit off for a reasoning model is unchanged.

[ADR 0015](docs/adr/0015-version-local-routing-and-retained-effort.md) records
the version boundary, unknown-family retention, and retained-model effort.
The five-role mapping from ADR 0014 is unchanged.

The launch note reports what was decided, so a caller that asked for one thing
and got another can see it.

## Agent definitions

Shipped specialists: `explore`, `worker`, `reviewer`, `debug`, and
`researcher`. Each has an exact tool list; `worker` and `debug` inherit the
parent's active tools instead, and `debug` starts from the parent's
conversation.

Operator and project definitions are Markdown files with frontmatter, whose
body is the agent's standing instructions. They are discovered in the global
agent directory (`~/.pi/agent/agents/*.md`) and in a project
(`.pi/agents/*.md`). Pi owns project trust and extension loading; this runtime
adds no second trust gate to definition or settings reads.

```markdown
---
display_name: Reviewer
description: Independent assessment of a scoped change
tools: read, grep, find
model: anthropic/claude-sonnet-5
thinking: medium
---

Assess the change against the stated requirements. Report findings, do not
claim checks you did not run.
```

A file refines the layer below it field by field: a setting it does not
mention is inherited, an explicit value replaces, `null` clears an inherited
model or thinking choice, and `tools: []` means no tools at all.
`tools: inherit` takes the parent's active tools.

## Development

```bash
pnpm nx run pi-tiered-subagents:typecheck
pnpm nx run pi-tiered-subagents:test
pnpm nx run pi-tiered-subagents:check        # formatting
pnpm nx run pi-tiered-subagents:metadata     # package metadata
```

## Documentation

- [Original product specification](docs/SPEC.md), also published as
  [GitHub issue #8](https://github.com/louiss0/pi-packages/issues/8).
- [Approved architecture and modernization specification](docs/ARCHITECTURE-SPEC.md),
  published as [GitHub issue #9](https://github.com/louiss0/pi-packages/issues/9),
  with detailed TypeScript/API diagrams and requirements. Implementation is
  incremental; the story-92 clarification keeps UI in this project's own module,
  not a separate package. This follow-up supersedes conflicting portions of the
  original specification.
- [Runtime status](docs/status.md) — what is inherited, what changed, what is owed.
- [Decision records](docs/adr/) — the decisions adopted for this derivative.
- [Illustrated source guide](docs/how-it-works.html) — open it in a browser.
- [Architecture](docs/architecture/architecture.md) and
  [decision records](docs/decisions/) — upstream snapshots, kept for provenance.

## Source attribution and reference documents

The source material and copied reference documentation come from
[@gotgenes/pi-subagents](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
version 25.0.1, by Chris Lasher, under the MIT licence. That project describes
itself as a friendly fork of
[@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents).

The following retain upstream reference snapshots, not newly accepted
architecture decisions or configuration instructions for this derivative
(except the explicitly labeled current model-profile section in configuration):

- [Configuration reference](docs/configuration.md) — current role-aware profile
  guidance followed by the preserved upstream reference.
- [Comparison with upstream](docs/comparison-with-upstream.md).
- [Architecture](docs/architecture/architecture.md) and its linked history.
- [Decision records](docs/decisions/).

Relative source/test links in those snapshots refer to the original project
layout. Their original context is the upstream project linked above. Where the
approved specification differs, the difference is intentional; consult the
current source and [runtime status](docs/status.md), not the snapshots, for
this implementation's behavior.

The `inherit` tool-selection convention was informed by
[Nico Bailon's pi-subagents](https://github.com/nicobailon/pi-subagents).
This project's specified semantics are distinct: the parent's active tools,
excluding subagent-management tools.

See [LICENSE](LICENSE) for this package and [LICENSE.upstream](LICENSE.upstream)
for the preserved upstream licence notice.
