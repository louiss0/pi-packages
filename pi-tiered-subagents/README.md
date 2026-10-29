# Pi Tiered Subagents

Pi Tiered Subagents gives [Pi](https://github.com/earendil-works/pi-coding-agent) focused child agents for exploration, implementation, review, debugging, and research. It helps the parent agent delegate scoped work without blocking the conversation, chooses models according to each specialist's role and the parent's model family, and coordinates access to a shared workspace. A single Pi extension supplies agent-facing tools, progress notifications, and a transcript viewer—so users can delegate work, follow its progress, and continue a child's conversation without exposing the runtime as a cross-extension service.

[![npm version](https://img.shields.io/npm/v/@code-fixer-23/pi-tiered-subagents)](https://www.npmjs.com/package/@code-fixer-23/pi-tiered-subagents)
[![npm downloads](https://img.shields.io/npm/dm/@code-fixer-23/pi-tiered-subagents)](https://www.npmjs.com/package/@code-fixer-23/pi-tiered-subagents)
[![License: MIT](https://img.shields.io/npm/l/@code-fixer-23/pi-tiered-subagents)](LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

![Pi Tiered Subagents](https://raw.githubusercontent.com/louiss0/pi-packages/main/pi-tiered-subagents/assets/Pi-Tiered%20Subagents%20Display.png)

## Install

Requires Node.js **22.19.0 or later** and Pi with the package's declared peer dependencies available.

```bash
pi install npm:@code-fixer-23/pi-tiered-subagents
```

This package is a **replacement subagent runtime**, not a second orchestrator. Do not enable it alongside another subagent runtime in the same session. Pi loads its TypeScript source directly; there is no separate build step.

No configuration is required to use the shipped specialists. For example, ask Pi:

> Have Explore trace how configuration is loaded, then have Worker implement the scoped change. Give Reviewer the requirements and diff for an independent review.

Background work returns an agent ID so the parent can continue. Completion is announced automatically unless the outcome has already been collected; the parent can retrieve details, steer work in progress, or resume a settled child for follow-up.

## Pi Tiered Subagents

The package ships one extension, loaded through `extensions/index.ts`. Its five specialist definitions are part of the runtime—not separate extensions or installable skills.

| Specialist | When to use it | Default capabilities and context |
| --- | --- | --- |
| `explore` | Find files and trace existing behavior | Read-only file tools; fresh conversation; no shell |
| `worker` | Implement and validate a scoped change | Inherits the parent's active capability tools; fresh conversation |
| `reviewer` | Independently assess a supplied change | Read-only tools; fresh conversation; needs the requirements and diff or readable diff artifact |
| `debug` | Reproduce a failure and recommend a repair | Inherits active capability tools and the parent's conversation; instructed not to implement the production repair |
| `researcher` | Investigate external facts | Read-only file tools plus `web_search`, when available; fresh conversation |

All five start in the background by default. Tool availability still depends on the host session: naming an extension tool does not install it. Child capabilities exclude the three subagent-management tools, so children cannot recursively delegate.

### Commands

#### `/subagents:settings`

Opens an interactive menu for runtime controls. It takes no command arguments; choose the setting in the menu, then enter a value or toggle it.

| Choice | Workflow impact |
| --- | --- |
| Max concurrency | Controls how many children can execute at once; default **4**. Workspace writer scheduling still applies. |
| Default max turns | Sets the fallback work budget; **0** means unlimited. Positive ceilings normalize to at least two turns. Request and definition limits take precedence. |
| Wrap-up turns | Warns a child as it approaches its ceiling so it can finish and report; default **2**. |
| Consumed-session retention | Keeps a collected child's session available for follow-up; default **10 minutes**. |
| Unconsumed-session retention | Caps how long an uncollected child's session is retained; default **720 minutes**. |
| Abort all subagents on ESC | When enabled, interrupting the parent also stops queued and background children; enabled by default. Foreground work is interrupted either way. |
| Mid-run updates | Allows background children to send material updates through `notify_parent`; enabled by default. Disabling it does not disable ask-back. |

Menu changes are saved to the project's shared settings file, not the global file. Family routing profiles and other structured settings are configured in the [configuration guide](docs/configuration.md), rather than through this menu.

#### `/subagents:sessions`

Opens a picker of subagent sessions, then a **read-only transcript viewer**. It takes no command arguments and does not switch the parent into the child's session. Live transcripts follow new output; retained transcript files can be opened as snapshots.

The viewer shows the agent, task, model, and reasoning level. It uses a regular custom component in normal terminal mode and an overlay in fullscreen mode. If no sessions are available, or a transcript cannot be read, Pi displays a notification instead.

### Tools

These tools are called by the parent agent. Required and optional arguments below use `type:name` notation.

#### `subagent`

Launches a specialist for scoped work, or resumes an existing child for a follow-up. Use it when work benefits from a separate conversation, restricted capabilities, or independent assessment.

| Argument | Required | Behavior |
| --- | --- | --- |
| `string:prompt` | Yes | Task instructions, or the follow-up message when resuming. |
| `string:description` | Yes | Short task label, typically 3–5 words, shown in the UI. |
| `string:subagent_type` | Yes | Shipped or custom agent identifier. Unknown and disabled identifiers are rejected, not replaced. |
| `string:model` | No | Exact `provider/modelId` for a new launch; overrides the definition and automatic routing. Unavailable pins fail rather than silently rerouting. |
| `string:thinking` | No | Reasoning request: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, subject to model support and the reasoning rules below. |
| `number:max_turns` | No | Positive turn ceiling for a new launch; otherwise the definition or runtime default applies. The tool schema requires at least 1, and execution normalizes positive ceilings to at least 2. |
| `boolean:run_in_background` | No | `true` returns after acceptance; `false` awaits the outcome. New launches inherit the definition's default when omitted. Resumes default to foreground unless explicitly set to `true`. |
| `string:resume` | No | Existing agent ID whose conversation should continue. Uses the captured session configuration rather than preparing a new model or capability set. |
| `boolean:inherit_context` | No | For a new launch, overrides whether the child receives the parent's conversation. Otherwise the definition decides. |

For example, a model-facing call can delegate exploration without waiting:

```text
subagent({
  subagent_type: "explore",
  description: "Trace configuration loading",
  prompt: "Find the configuration entry points and explain precedence. Report file paths.",
  run_in_background: true
})
```

Background acceptance does not mean execution has started: the child may queue for a concurrency slot or workspace access. Foreground calls return the settled outcome directly and suppress a duplicate completion announcement. Resume can be refused when the child is still running, its retained session is gone, or it belongs to a different parent-session owner.

#### `get_subagent_result`

Checks a child's progress or collects its outcome. Use it when the parent needs a result before deciding what to do next, or needs more detail than a completion notification provides.

| Argument | Required | Behavior |
| --- | --- | --- |
| `string:agent_id` | Yes | ID returned by a launch. |
| `boolean:wait` | No | Wait for completion instead of immediately reporting progress; defaults to `false`. |
| `boolean:verbose` | No | Include the full conversation rather than only the report; defaults to `false`. |
| `number:timeout` | No | Maximum wait in **seconds**, when waiting. Omit to wait without a timeout. Expiry returns current progress and does not stop the child. |

Reports include status, available results or errors, and execution details. A child's pending question can be returned with its outcome so the parent can answer through a resume.

#### `steer_subagent`

Redirects a running child without discarding its conversation. Use it to narrow scope, supply new evidence, or correct an assumption while work continues.

- Required: `string:agent_id` — the running child.
- Required: `string:message` — guidance to inject after its current tool execution.

Steering can be buffered while the child session initializes. It is not a way to restart settled work; use `subagent` with `resume` for that.

#### Communication from child to parent

Children receive `ask_parent` with required `string:question` when they need a decision or missing input. The child records the question and ends its turn; the normal outcome delivery carries it back. The parent then resumes that child with the answer. This is a handoff, not a blocking interactive user dialog.

Background children can also receive `notify_parent` with required `string:message` when `midRunUpdates` is enabled. It sends a one-way material update and lets the child continue immediately; the parent can respond by steering. Messages are capped at 2,000 characters, with truncation disclosed to the child.

### Shortcuts

The extension registers no global keyboard shortcuts. The transcript viewer provides these local controls:

| Keys | Interaction |
| --- | --- |
| <kbd>Esc</kbd> or <kbd>q</kbd> | Close the viewer and return to the parent conversation. |
| <kbd>↑</kbd> / <kbd>k</kbd>, <kbd>↓</kbd> / <kbd>j</kbd> | Scroll one line up or down to inspect nearby transcript content. |
| <kbd>Shift</kbd> + <kbd>↑</kbd>, <kbd>Shift</kbd> + <kbd>↓</kbd> | Page through earlier or later output. Pi's configured alternate-screen page-up/down bindings also work. |

Pi's configured alternate-screen top/bottom bindings jump to the beginning or end; the viewer footer displays the actual bindings. Mouse-wheel scrolling is also supported. Paging up or jumping to the top pauses live following, even when the content fits; returning to the bottom normally resumes following.

Outside the viewer, Pi's ordinary <kbd>Esc</kbd> interruption follows the interrupt policy described under `/subagents:settings`.

### Features

#### Workspace scheduling and execution budgets

Only one child with potentially writing capabilities can operate in a workspace at a time. Read-only children can run alongside that writer. Scheduling follows the **effective tools**, not the role name: shells, editors, and unknown tools count as potential writers. This coordinates child access; it is not a filesystem sandbox or a lock on the parent agent's own edits.

Concurrency admission applies to foreground and background work. Near a configured turn ceiling, the runtime warns the child to wrap up, then stops the run at the limit. Retained sessions allow later follow-up without rebuilding the child's conversation; retention expiry can make a child non-resumable.

#### Role-aware model and reasoning selection

A request model pin wins over a definition pin; otherwise the runtime routes from the parent's model using the resolved specialist identifier.

| Specialist | Size families: GPT, Claude, Qwen | Planner/worker families: Gemini, MiniMax, GLM, MiMo, DeepSeek |
| --- | --- | --- |
| `worker` | One size below the parent, clamped at S | Worker |
| `explore`, `researcher` | S | Worker |
| `debug` | M | Worker |
| `reviewer` | Start at the parent's own rung | Planner |

Custom identifiers use worker routing. Changing a display label does not change this policy. Routing is not always a downgrade: debugging can target M from an S parent, and reviewing can target a planner from a worker parent.

Automatic candidates stay within the parent's **family and version**. The router tries eligible rungs in preference order, preferring the parent's provider, then a unique runnable alternative provider. It skips unavailable or provider-ambiguous candidates. If none qualify—or the family, tier, or version is unknown—it retains the parent model and explains why. It never guesses by price or crosses versions. Exact user pins bypass this routing and never silently fall back.

Reasoning is selected after the model. Request `thinking` wins over definition `thinking`; otherwise the child takes the next supported non-off level below the parent's effort, staying at the floor when necessary. With no known parent effort, it prefers medium, then low, then the lowest supported non-off level. Explicit levels are clamped to model support; explicit `off` is not allowed on a reasoning model. Non-reasoning models report reasoning as not applicable.

Launch reports expose the selected model, reasoning, and reasons for retention or clamping. See the [configuration guide](docs/configuration.md) for family profiles, exact pins, and troubleshooting.

#### Context and extension inheritance

Conversation inheritance is separate from the child's specialist instructions and project context. Debug inherits the parent conversation by default; the other shipped specialists start fresh. Child sessions resolve project context for their working directory and rebuild tool-surface instructions for their own capabilities.

Structured settings can exclude configured packages' **extensions** from children while keeping their other resources available. Provider-scoped `promptInheritance` can select `portable` inheritance for providers that re-home prompts into another harness; ordinary providers should keep `full`. These controls are explained in the [configuration guide](docs/configuration.md#runtime-settings-reference).

#### Progress, results, and parent-session ownership

As children work, the live widget and notifications make delegated activity visible without requiring repeated polling. Mid-run updates and completion nudges are coordinated with the parent's execution: `agent_start` holds notifications during a parent run, and `agent_settled` releases eligible notifications after that run settles. Outcomes already delivered through foreground execution or collected by a consumer do not produce duplicate completion nudges.

At `session_start`, the extension loads configuration and definitions and attaches the UI to the parent session. Launches belong to that session owner; a tentative session switch does not cancel its children. Shutdown stops queued and active work and disposes child resources so results cannot leak into another parent session.

## Custom agents and settings

Definitions are Markdown files in `<agentDir>/agents/*.md` (normally `~/.pi/agent/agents/`) or `<cwd>/.pi/agents/*.md`. `PI_CODING_AGENT_DIR` relocates the global agent directory. The lowercased filename is the identifier; project definitions refine global definitions, which refine shipped defaults **field by field**.

For example, `.pi/agents/reviewer.md` can change only a reviewer's reasoning while keeping its shipped instructions and tools:

```markdown
---
thinking: high
---
```

A nonempty Markdown body replaces inherited standing instructions. Omitted fields inherit, `null` clears inherited model or thinking choices, `tools: inherit` uses the parent's active capability tools, and `tools: []` grants no capability tools. Broadening a specialist's tools changes its permissions and workspace scheduling; definitions are not merely labels.

Runtime settings use `@juanibiapina/pi-extension-settings`:

- Global: `<agentDir>/settings-extensions.json`.
- Project: `<cwd>/.pi/settings-extensions.json`.
- Extension key: `pi-tiered-subagents`.

Stored values are **strings**, including booleans, numbers, and JSON-encoded structured settings. Project values override global values, and menu saves write only project settings. The optional shared settings UI must load before this extension to receive its settings registration; this package's own settings command and storage do not require that UI.

See [Configuration](docs/configuration.md) for all definition fields, copyable on-disk examples, precedence, and migration notes. The historical upstream `subagents.json` format is not this runtime's settings backend.

## Developer boundaries

The runtime is private to the loaded extension. The package has no root runtime API export, no `getSubagentsService()` accessor, and no globally published service. There is no supported cross-extension runtime handle for launching, aborting, resuming, or provisioning workspaces. Delegation goes through the registered Pi tools described above.

**Migration:** remove imports of the old package-root service API and any dependency on its global symbol. Lifecycle events remain available as notifications, not as a replacement runtime-control API. The independent `loadLayeredSettings` utility remains exported at `@code-fixer-23/pi-tiered-subagents/settings`; it does not expose runtime state and is not this runtime's own settings backend.

### Observing delegated work

Lifecycle notifications remain on `pi.events` under their existing channel names. There is no exported `SUBAGENT_EVENTS` catalogue. These notifications do not grant access to the runtime; use tool results to collect outcomes, and inspect status and errors before interpreting termination as success.

**Initial execution:** background acceptance emits `subagents:created` before concurrency admission. When the initial run starts, `subagents:started` signals that execution is beginning. During work, `subagents:compacted` reports successful context compaction, `subagents:steered` reports successful tool steering, and `subagents:update` carries child progress messages. The initial run ends with `subagents:completed` or `subagents:failed`; observers should inspect the terminal status rather than assume every non-failure event means successful completion.

**Follow-up execution:** a retained child emits `subagents:resuming` when its resumed run starts and `subagents:resumed` when that run ends. The latter also covers resumed errors, so check its status and error. This separates continued work from the initial run while preserving the child's identity. Terminal outcomes are persisted and considered for notification; foreground tool execution and result collection suppress duplicate completion nudges.

### Preparing and binding child sessions

For integrations that need to coordinate child resources, the lower-level lifecycle starts with `subagents:child:spawning`, then emits `subagents:child:session-created` immediately before extension binding. A consumer that must register something before binding must handle `session-created` **synchronously**. After child `session_start` handlers finish, `subagents:child:bound` signals readiness before the first turn; failed binding skips this event.

After prompt execution resolves, `subagents:child:completed` marks the end of that execution path, and `subagents:child:disposed` accompanies final cleanup. Do not use this lower-level completion signal as a substitute for the tool's run outcome: it describes session execution, not an independent guarantee of task success.

## Development

Run tasks from the monorepo root:

```bash
pnpm nx run pi-tiered-subagents:typecheck
pnpm nx run pi-tiered-subagents:test
pnpm nx run pi-tiered-subagents:lint
pnpm nx run pi-tiered-subagents:check         # Formatting check
pnpm nx run pi-tiered-subagents:metadata      # Package metadata validation
pnpm nx run pi-tiered-subagents:release-check # Packaging/install checks
```

The entry point composes the implementation in `src/`; terminal presentation lives in the internal `src/ui/` module, not a separate extension. Tests cover launch preparation, scheduling, session ownership, model selection, result delivery, and UI boundaries. See [stabilization evidence and known limitations](docs/stabilization.md) rather than treating a historical test count as a current guarantee.

## Further reading

- [Configuration guide](docs/configuration.md): models, specialist overrides, settings, and troubleshooting.
- [Runtime status](docs/status.md): implementation history and remaining constraints.
- [Product specification](docs/SPEC.md) and [approved architecture specification](docs/ARCHITECTURE-SPEC.md).
- [Local decision records](docs/adr/).
- [Illustrated source guide](docs/how-it-works.html): open in a browser.

## License and attribution

Licensed under [MIT](LICENSE), with the upstream copyright notice consolidated into the same license file. This runtime derives from [@gotgenes/pi-subagents](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) v25.0.1 by Chris Lasher, itself a friendly fork of [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents). The `inherit` tool-selection convention was informed by [Nico Bailon's pi-subagents](https://github.com/nicobailon/pi-subagents); this package inherits the parent's active tools while excluding subagent-management tools.

The [upstream comparison](docs/comparison-with-upstream.md), [architecture snapshots](docs/architecture/architecture.md), and [inherited decision records](docs/decisions/) preserve reference material and provenance. Their source links and configuration descriptions may reflect the original layout; use this README, the configuration guide, and current source for this derivative's behavior.
