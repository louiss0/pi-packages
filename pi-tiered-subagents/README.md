# pi-tiered-subagents

A family-aware subagent runtime for [pi](https://github.com/earendil-works/pi-coding-agent):
scoped specialists, layered agent definitions, and inspectable model selection.

> **Status: inherited runtime, specified work pending.** The package now builds,
> typechecks, and passes a 2,150-test characterization suite against Pi 1.3.0.
> The five scoped specialists, the layered agent definitions, the inherited tool
> selection, and the rejection of unknown agents are **done**. Family-aware model
> routing, reasoning defaults, capability-based scheduling, and the shared
> settings backend are **not implemented yet**. See
> [docs/status.md](docs/status.md) for the verified state and what is still owed.

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
  svc?.spawn("Explore", "Check for stale TODOs");
  ```

  The service is published on `globalThis` under this package's own symbol key,
  `Symbol.for("@code-fixer-23/pi-tiered-subagents:service")`.

- **Layered settings** — the inherited loader is exported for other packages:

  ```ts
  import { loadLayeredSettings } from "@code-fixer-23/pi-tiered-subagents/settings";
  ```

  The specified settings backend (`@juanibiapina/pi-extension-settings`)
  replaces it; see [docs/status.md](docs/status.md).

- **A live widget** and a `/subagents:sessions` transcript viewer, mounted on Pi's
  own components.

## Commands

| Command | Purpose |
| --- | --- |
| `/subagents:settings` | Concurrency, turn limits, retention, interrupt policy |
| `/subagents:sessions` | Browse a subagent's transcript (read-only) |

## Agent definitions

Shipped specialists: `explore`, `worker`, `reviewer`, `debug`, and
`researcher`. Each has an exact tool list; `worker` and `debug` inherit the
parent's active tools instead, and `debug` starts from the parent's
conversation.

Operator and project definitions are Markdown files with frontmatter, whose
body is the agent's standing instructions. They are discovered in the global
agent directory (`~/.pi/agent/agents/*.md`) and in a project
(`.pi/agents/*.md`); a project's files are read only when Pi has granted the
project trust.

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
pnpm nx run pi-tiered-subagents:build       # type declarations
pnpm nx run pi-tiered-subagents:typecheck
pnpm nx run pi-tiered-subagents:test
pnpm nx run pi-tiered-subagents:check        # formatting
pnpm nx run pi-tiered-subagents:metadata     # package metadata
```

## Documentation

- [Approved specification](docs/SPEC.md), also published as
  [GitHub issue #8](https://github.com/louiss0/pi-packages/issues/8).
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

The following are preserved upstream reference snapshots, not newly accepted
architecture decisions or configuration instructions for this derivative:

- [Configuration reference](docs/configuration.md).
- [Comparison with upstream](docs/comparison-with-upstream.md).
- [Architecture](docs/architecture/architecture.md) and its linked history.
- [Decision records](docs/decisions/).

Relative source/test links in those snapshots refer to the original project
layout. Their original context is the upstream project linked above. Where the
approved specification differs, treat the difference as an intentional
requirement to implement and test, not evidence that the inherited runtime
already behaves that way.

The `inherit` tool-selection convention was informed by
[Nico Bailon's pi-subagents](https://github.com/nicobailon/pi-subagents).
This project's specified semantics are distinct: the parent's active tools,
excluding subagent-management tools.

See [LICENSE](LICENSE) for this package and [LICENSE.upstream](LICENSE.upstream)
for the preserved upstream licence notice.
