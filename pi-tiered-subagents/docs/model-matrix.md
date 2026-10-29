# Agent and model selection matrix

Which specialist runs, and which model it runs on, are **two separate decisions**.
All 5 × 8 agent/family combinations are valid, but automatic model selection is
**role-aware**, not uniform: the agent identifier determines a target within
the parent's exact family **and version**. Explicit model pins still win over automatic routing.

Sources: [`src/agents/registry.ts`](../src/agents/registry.ts),
[`src/agents/definition.ts`](../src/agents/definition.ts),
[`src/models/selection.ts`](../src/models/selection.ts),
[`src/models/router.ts`](../src/models/router.ts),
[`src/models/profiles.ts`](../src/models/profiles.ts),
[`src/models/strategy.ts`](../src/models/strategy.ts). Evidence:
[`test/models/routing-matrix.test.ts`](../test/models/routing-matrix.test.ts).

## 1. The two axes

```text
request ──► agent selection ──► definition (layered by name)
                  │                       │
                  │                       └─► default tools, context, turns
                  │
                  └─► model selection ──► exact request model
                                          exact definition model
                                          automatic role-aware same-version family ladder
```

A family is a **model grouping** (GPT, Claude, Gemini, …). A role is a **task
contract** (Explore, Worker, Reviewer, Debug, Researcher). Nothing in the agent
registry consults a model family. Model selection passes the resolved agent's
identifier to the router. An agent definition may also pin a model, which wins
over automatic routing for every family.

## 2. Agent selection: by identifier, layered

`registry.select(id)` normalizes the identifier (trimmed and lowercased — no
other aliasing), then reads the three layers in order —
**shipped → global → project** — with the most specific layer winning per
field. Absent means inherit, an explicit value replaces, `null` clears an
inherited optional setting, and an empty list stays empty. Lists are never
concatenated.

| Outcome | Result |
| --- | --- |
| Known identifier | The merged definition is used |
| Unknown identifier | Rejected as `unknown-agent` — never redirected to a shipped role |
| Known but disabled | Rejected as `disabled-agent` — a different failure, same refusal |
| Duplicate identifier | Reported to the operator once, naming both files |

| Agent | Capability tools | Context | Model by default |
| --- | --- | --- | --- |
| `explore` | `read, grep, find, ls` | Fresh | Routed |
| `worker` | Parent's active tools, captured at request time | Fresh | Routed |
| `reviewer` | `read, grep, find` | Fresh | Routed |
| `debug` | Parent's active tools, captured at request time | Inherited | Routed |
| `researcher` | `read, grep, find, ls, web_search` | Fresh | Routed |

None of the five shipped definitions names a model, so all five reach the
router. Custom agents under `.pi/agents/<name>.md` (project) or the global agent
directory are selected the same way and may pin `model:`. A custom identifier
uses worker routing behavior; this is not an alias in the agent registry.

## 3. Agent × family: all combinations are valid

Each cell below is an **actual router outcome**, not a policy label: it uses
the synthetic future-release parent listed beneath the grid with all constructed
ladder candidates available. `example` is a fixture provider, not vendor access.
Version 97.2 is illustrative, not a supported-release catalogue. The complete parent-by-role matrix follows in section 4. A request
or definition model pin bypasses this grid.

<!-- model-matrix:grid:start -->
| Agent | gpt | claude | gemini | glm | minimax | qwen | deepseek | mimo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `explore` | `example/gpt-97.2-luna` | `example/claude-haiku-97-2` | `example/gemini-97.2-flash` | `example/glm-97.2-flash` | `example/MiniMax-M97.2-flash` | `example/qwen97.2-flash` | **retain** | `example/mimo-v97.2-flash` |
| `worker` | `example/gpt-97.2-sol` | `example/claude-opus-97-2` | `example/gemini-97.2-flash` | `example/glm-97.2-flash` | `example/MiniMax-M97.2-flash` | `example/qwen97.2-plus` | **retain** | `example/mimo-v97.2-flash` |
| `reviewer` | `example/gpt-97.2-astra` | `example/claude-fable-97-2` | `example/gemini-97.2-argon` | `example/glm-97.2` | `example/MiniMax-M97.2-highspeed` | `example/qwen97.2-max` | `example/deepseek-v97.2-pro` | `example/mimo-v97.2-pro-ultraspeed` |
| `debug` | `example/gpt-97.2-terra` | `example/claude-sonnet-97-2` | `example/gemini-97.2-flash` | `example/glm-97.2-flash` | `example/MiniMax-M97.2-flash` | `example/qwen97.2-plus` | **retain** | `example/mimo-v97.2-flash` |
| `researcher` | `example/gpt-97.2-luna` | `example/claude-haiku-97-2` | `example/gemini-97.2-flash` | `example/glm-97.2-flash` | `example/MiniMax-M97.2-flash` | `example/qwen97.2-flash` | **retain** | `example/mimo-v97.2-flash` |

| Family | Representative parent (all candidates available) |
| --- | --- |
| gpt | `example/gpt-97.2-astra` |
| claude | `example/claude-fable-97-2` |
| gemini | `example/gemini-97.2-argon` |
| glm | `example/glm-97.2` |
| minimax | `example/MiniMax-M97.2-highspeed` |
| qwen | `example/qwen97.2-max` |
| deepseek | `example/deepseek-v97.2-pro` |
| mimo | `example/mimo-v97.2-pro-ultraspeed` |
<!-- model-matrix:grid:end -->

Two additional per-agent differences are not about families: `worker` and
`debug` inherit the parent's active tools, and `debug` inherits the parent's
conversation. Pinning `model: anthropic/claude-sonnet-5` in, say,
`.pi/agents/explore.md` changes the **whole row** for that agent — the pin
applies on every family, not as a family-specific setting.

## 4. Full routing matrix

For **every concrete model** the shipped profiles name as a parent and every
shipped role, these tables call the real `routeModel(parent, context, agentId)`
with `SHIPPED_PROFILES` and `SHIPPED_STRATEGIES`. They do not implement a second
routing policy. Availability is an explicit input:

- **All available**: every candidate in every shipped profile is runnable.
- **Other versions only**: every candidate in the parent's version is removed
  (including the parent, its role target, and sibling candidates); all other
  candidates remain runnable. Every outcome must retain the parent: automatic
  routing never crosses a version or family boundary.
- **None available**: no candidate is runnable, exercising parent retention.
- **retain**: the routing outcome keeps the exact parent identity. A routed
  identity equal to the parent is printed explicitly instead; intentional
  reviewer equality is not mislabeled as a failed walk.

The version, rung, and size/role columns come from the profile. The selected
identities and retain outcomes come only from the router.

<!-- model-matrix:full:start -->
### gpt — size

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/gpt-97.2-astra` | 97.2 / astra (XL) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-astra` | 97.2 / astra (XL) | `worker` | `example/gpt-97.2-sol` | **retain** | **retain** |
| `example/gpt-97.2-astra` | 97.2 / astra (XL) | `reviewer` | `example/gpt-97.2-astra` | **retain** | **retain** |
| `example/gpt-97.2-astra` | 97.2 / astra (XL) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-astra` | 97.2 / astra (XL) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-sol` | 97.2 / sol (L) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-sol` | 97.2 / sol (L) | `worker` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-sol` | 97.2 / sol (L) | `reviewer` | `example/gpt-97.2-sol` | **retain** | **retain** |
| `example/gpt-97.2-sol` | 97.2 / sol (L) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-sol` | 97.2 / sol (L) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-terra` | 97.2 / terra (M) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-terra` | 97.2 / terra (M) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-terra` | 97.2 / terra (M) | `reviewer` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-terra` | 97.2 / terra (M) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-terra` | 97.2 / terra (M) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-pro` | 97.2 / pro (M) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-pro` | 97.2 / pro (M) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-pro` | 97.2 / pro (M) | `reviewer` | `example/gpt-97.2-pro` | **retain** | **retain** |
| `example/gpt-97.2-pro` | 97.2 / pro (M) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-pro` | 97.2 / pro (M) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2` | 97.2 / (default) (M) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2` | 97.2 / (default) (M) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2` | 97.2 / (default) (M) | `reviewer` | `example/gpt-97.2` | **retain** | **retain** |
| `example/gpt-97.2` | 97.2 / (default) (M) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2` | 97.2 / (default) (M) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-luna` | 97.2 / luna (S) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-luna` | 97.2 / luna (S) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-luna` | 97.2 / luna (S) | `reviewer` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-luna` | 97.2 / luna (S) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-luna` | 97.2 / luna (S) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-mini` | 97.2 / mini (S) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-mini` | 97.2 / mini (S) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-mini` | 97.2 / mini (S) | `reviewer` | `example/gpt-97.2-mini` | **retain** | **retain** |
| `example/gpt-97.2-mini` | 97.2 / mini (S) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-mini` | 97.2 / mini (S) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-nano` | 97.2 / nano (S) | `explore` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-nano` | 97.2 / nano (S) | `worker` | `example/gpt-97.2-luna` | **retain** | **retain** |
| `example/gpt-97.2-nano` | 97.2 / nano (S) | `reviewer` | `example/gpt-97.2-nano` | **retain** | **retain** |
| `example/gpt-97.2-nano` | 97.2 / nano (S) | `debug` | `example/gpt-97.2-terra` | **retain** | **retain** |
| `example/gpt-97.2-nano` | 97.2 / nano (S) | `researcher` | `example/gpt-97.2-luna` | **retain** | **retain** |

### claude — size

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/claude-fable-97-2` | 97.2 / fable (XL) | `explore` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-fable-97-2` | 97.2 / fable (XL) | `worker` | `example/claude-opus-97-2` | **retain** | **retain** |
| `example/claude-fable-97-2` | 97.2 / fable (XL) | `reviewer` | `example/claude-fable-97-2` | **retain** | **retain** |
| `example/claude-fable-97-2` | 97.2 / fable (XL) | `debug` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-fable-97-2` | 97.2 / fable (XL) | `researcher` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-opus-97-2` | 97.2 / opus (L) | `explore` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-opus-97-2` | 97.2 / opus (L) | `worker` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-opus-97-2` | 97.2 / opus (L) | `reviewer` | `example/claude-opus-97-2` | **retain** | **retain** |
| `example/claude-opus-97-2` | 97.2 / opus (L) | `debug` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-opus-97-2` | 97.2 / opus (L) | `researcher` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-sonnet-97-2` | 97.2 / sonnet (M) | `explore` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-sonnet-97-2` | 97.2 / sonnet (M) | `worker` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-sonnet-97-2` | 97.2 / sonnet (M) | `reviewer` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-sonnet-97-2` | 97.2 / sonnet (M) | `debug` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-sonnet-97-2` | 97.2 / sonnet (M) | `researcher` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-haiku-97-2` | 97.2 / haiku (S) | `explore` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-haiku-97-2` | 97.2 / haiku (S) | `worker` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-haiku-97-2` | 97.2 / haiku (S) | `reviewer` | `example/claude-haiku-97-2` | **retain** | **retain** |
| `example/claude-haiku-97-2` | 97.2 / haiku (S) | `debug` | `example/claude-sonnet-97-2` | **retain** | **retain** |
| `example/claude-haiku-97-2` | 97.2 / haiku (S) | `researcher` | `example/claude-haiku-97-2` | **retain** | **retain** |

### gemini — planner-worker

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/gemini-97.2-argon` | 97.2 / argon (planner) | `explore` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-argon` | 97.2 / argon (planner) | `worker` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-argon` | 97.2 / argon (planner) | `reviewer` | `example/gemini-97.2-argon` | **retain** | **retain** |
| `example/gemini-97.2-argon` | 97.2 / argon (planner) | `debug` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-argon` | 97.2 / argon (planner) | `researcher` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro-preview` | 97.2 / pro-preview (planner) | `explore` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro-preview` | 97.2 / pro-preview (planner) | `worker` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro-preview` | 97.2 / pro-preview (planner) | `reviewer` | `example/gemini-97.2-argon` | **retain** | **retain** |
| `example/gemini-97.2-pro-preview` | 97.2 / pro-preview (planner) | `debug` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro-preview` | 97.2 / pro-preview (planner) | `researcher` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro` | 97.2 / pro (planner) | `explore` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro` | 97.2 / pro (planner) | `worker` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro` | 97.2 / pro (planner) | `reviewer` | `example/gemini-97.2-argon` | **retain** | **retain** |
| `example/gemini-97.2-pro` | 97.2 / pro (planner) | `debug` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-pro` | 97.2 / pro (planner) | `researcher` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash` | 97.2 / flash (worker) | `explore` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash` | 97.2 / flash (worker) | `worker` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash` | 97.2 / flash (worker) | `reviewer` | `example/gemini-97.2-argon` | **retain** | **retain** |
| `example/gemini-97.2-flash` | 97.2 / flash (worker) | `debug` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash` | 97.2 / flash (worker) | `researcher` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash-lite` | 97.2 / flash-lite (worker) | `explore` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash-lite` | 97.2 / flash-lite (worker) | `worker` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash-lite` | 97.2 / flash-lite (worker) | `reviewer` | `example/gemini-97.2-argon` | **retain** | **retain** |
| `example/gemini-97.2-flash-lite` | 97.2 / flash-lite (worker) | `debug` | `example/gemini-97.2-flash` | **retain** | **retain** |
| `example/gemini-97.2-flash-lite` | 97.2 / flash-lite (worker) | `researcher` | `example/gemini-97.2-flash` | **retain** | **retain** |

### glm — planner-worker

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/glm-97.2` | 97.2 / (default) (planner) | `explore` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2` | 97.2 / (default) (planner) | `worker` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2` | 97.2 / (default) (planner) | `reviewer` | `example/glm-97.2` | **retain** | **retain** |
| `example/glm-97.2` | 97.2 / (default) (planner) | `debug` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2` | 97.2 / (default) (planner) | `researcher` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2-flash` | 97.2 / flash (worker) | `explore` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2-flash` | 97.2 / flash (worker) | `worker` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2-flash` | 97.2 / flash (worker) | `reviewer` | `example/glm-97.2` | **retain** | **retain** |
| `example/glm-97.2-flash` | 97.2 / flash (worker) | `debug` | `example/glm-97.2-flash` | **retain** | **retain** |
| `example/glm-97.2-flash` | 97.2 / flash (worker) | `researcher` | `example/glm-97.2-flash` | **retain** | **retain** |

### minimax — planner-worker

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/MiniMax-M97.2-highspeed` | 97.2 / highspeed (planner) | `explore` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-highspeed` | 97.2 / highspeed (planner) | `worker` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-highspeed` | 97.2 / highspeed (planner) | `reviewer` | `example/MiniMax-M97.2-highspeed` | **retain** | **retain** |
| `example/MiniMax-M97.2-highspeed` | 97.2 / highspeed (planner) | `debug` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-highspeed` | 97.2 / highspeed (planner) | `researcher` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2` | 97.2 / (default) (planner) | `explore` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2` | 97.2 / (default) (planner) | `worker` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2` | 97.2 / (default) (planner) | `reviewer` | `example/MiniMax-M97.2-highspeed` | **retain** | **retain** |
| `example/MiniMax-M97.2` | 97.2 / (default) (planner) | `debug` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2` | 97.2 / (default) (planner) | `researcher` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-flash` | 97.2 / flash (worker) | `explore` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-flash` | 97.2 / flash (worker) | `worker` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-flash` | 97.2 / flash (worker) | `reviewer` | `example/MiniMax-M97.2-highspeed` | **retain** | **retain** |
| `example/MiniMax-M97.2-flash` | 97.2 / flash (worker) | `debug` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |
| `example/MiniMax-M97.2-flash` | 97.2 / flash (worker) | `researcher` | `example/MiniMax-M97.2-flash` | **retain** | **retain** |

### qwen — size

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/qwen97.2-max` | 97.2 / max (L) | `explore` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-max` | 97.2 / max (L) | `worker` | `example/qwen97.2-plus` | **retain** | **retain** |
| `example/qwen97.2-max` | 97.2 / max (L) | `reviewer` | `example/qwen97.2-max` | **retain** | **retain** |
| `example/qwen97.2-max` | 97.2 / max (L) | `debug` | `example/qwen97.2-plus` | **retain** | **retain** |
| `example/qwen97.2-max` | 97.2 / max (L) | `researcher` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-plus` | 97.2 / plus (M) | `explore` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-plus` | 97.2 / plus (M) | `worker` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-plus` | 97.2 / plus (M) | `reviewer` | `example/qwen97.2-plus` | **retain** | **retain** |
| `example/qwen97.2-plus` | 97.2 / plus (M) | `debug` | `example/qwen97.2-plus` | **retain** | **retain** |
| `example/qwen97.2-plus` | 97.2 / plus (M) | `researcher` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-flash` | 97.2 / flash (S) | `explore` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-flash` | 97.2 / flash (S) | `worker` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-flash` | 97.2 / flash (S) | `reviewer` | `example/qwen97.2-flash` | **retain** | **retain** |
| `example/qwen97.2-flash` | 97.2 / flash (S) | `debug` | `example/qwen97.2-plus` | **retain** | **retain** |
| `example/qwen97.2-flash` | 97.2 / flash (S) | `researcher` | `example/qwen97.2-flash` | **retain** | **retain** |

### deepseek — planner-worker

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/deepseek-v97.2-pro` | 97.2 / pro (planner) | `explore` | **retain** | **retain** | **retain** |
| `example/deepseek-v97.2-pro` | 97.2 / pro (planner) | `worker` | **retain** | **retain** | **retain** |
| `example/deepseek-v97.2-pro` | 97.2 / pro (planner) | `reviewer` | `example/deepseek-v97.2-pro` | **retain** | **retain** |
| `example/deepseek-v97.2-pro` | 97.2 / pro (planner) | `debug` | **retain** | **retain** | **retain** |
| `example/deepseek-v97.2-pro` | 97.2 / pro (planner) | `researcher` | **retain** | **retain** | **retain** |

### mimo — planner-worker

| Parent model | Version / rung (size or role) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `example/mimo-v97.2-pro-ultraspeed` | 97.2 / pro-ultraspeed (planner) | `explore` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro-ultraspeed` | 97.2 / pro-ultraspeed (planner) | `worker` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro-ultraspeed` | 97.2 / pro-ultraspeed (planner) | `reviewer` | `example/mimo-v97.2-pro-ultraspeed` | **retain** | **retain** |
| `example/mimo-v97.2-pro-ultraspeed` | 97.2 / pro-ultraspeed (planner) | `debug` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro-ultraspeed` | 97.2 / pro-ultraspeed (planner) | `researcher` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro` | 97.2 / pro (planner) | `explore` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro` | 97.2 / pro (planner) | `worker` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro` | 97.2 / pro (planner) | `reviewer` | `example/mimo-v97.2-pro-ultraspeed` | **retain** | **retain** |
| `example/mimo-v97.2-pro` | 97.2 / pro (planner) | `debug` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-pro` | 97.2 / pro (planner) | `researcher` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2` | 97.2 / (default) (planner) | `explore` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2` | 97.2 / (default) (planner) | `worker` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2` | 97.2 / (default) (planner) | `reviewer` | `example/mimo-v97.2-pro-ultraspeed` | **retain** | **retain** |
| `example/mimo-v97.2` | 97.2 / (default) (planner) | `debug` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2` | 97.2 / (default) (planner) | `researcher` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-flash` | 97.2 / flash (worker) | `explore` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-flash` | 97.2 / flash (worker) | `worker` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-flash` | 97.2 / flash (worker) | `reviewer` | `example/mimo-v97.2-pro-ultraspeed` | **retain** | **retain** |
| `example/mimo-v97.2-flash` | 97.2 / flash (worker) | `debug` | `example/mimo-v97.2-flash` | **retain** | **retain** |
| `example/mimo-v97.2-flash` | 97.2 / flash (worker) | `researcher` | `example/mimo-v97.2-flash` | **retain** | **retain** |
<!-- model-matrix:full:end -->

## 5. The rules, in order

```text
selectAgent(id):
  merge shipped[id] ← global[id] ← project[id]
  unknown   → reject "unknown-agent"
  disabled  → reject "disabled-agent"

selectModel(request, definition, parent):
  request.model          → resolve exactly, or fail
  definition.model       → resolve exactly, or fail
  otherwise              → route(parent, context, definition.id)

route(parent, context, agentId = "worker"):
  parent has no model          → retain
  no strategy claims the id    → retain parent
  profile/version/tier missing → retain parent
  resolve the role's target using the family's group and labels
  starting at that target:
    try the target rung, then cheaper same-version rungs in profile order
    choose the first candidate the session can run
  nothing runnable             → retain parent
```

### Role targets

| Agent | Size group: gpt, claude, qwen | Planner/worker group: gemini, minimax, glm, mimo, deepseek |
| --- | --- | --- |
| `worker` | One size below parent, clamped at S | worker class |
| `researcher` | S | worker class |
| `debug` | M | worker class |
| `reviewer` | Parent's own size/rung | planner class |
| `explore` | S | worker class |
| Custom identifier | Same as worker | Same as worker |

A **group** is the family's routing policy shape. A **size** (S, M, L) labels a
size-family tier; a **class** (planner, worker) labels a planner/worker-family
tier. Runtime routing reads those declarations; it does not infer class from
price or a model-name substring. The top rung of the target size/role is the
starting point (reviewer equality uses the parent's own rung). Versions are
never crossed to find a target, even when other versions are runnable.

Consequences worth naming:

- **Role before availability.** Worker is one *size* below, not necessarily one
  tier below. Research and exploration target S; debugging targets M, even
  from an S parent. Review deliberately keeps the parent's size on size
  families and may step up to a planner on planner/worker families.
- **Fallback goes downward from the target.** An unavailable target can lead to
  cheaper rungs in the same version, then retention. A version with no target
  for the role retains the parent, even when another version has that target.
  For example, if no GPT 7 M or S candidate is runnable, its worker retains
  the parent. Abstract rungs are not evidence of released models.
- **Providers are deterministic.** Prefer the parent provider for the exact ID;
  otherwise require a unique matching provider. Multiple alternate providers
  make a tier unusable, so cheaper eligible tiers are tried before retention.
- **Tier matching is specific.** `flash-lite` is its own worker rung, not
  `flash`; dated Claude snapshots use the size of their matched tier.
- **Explicit beats routing, always.** A request or definition model is resolved
  exactly — no ladder walk, no family check, no provider swap.
- **No silent reroute.** A selected identity that later cannot be materialized
  fails as that child's outcome; it does not become a different model.
- **Reasoning follows the model.** The thinking level is chosen after the model
  resolves: request → definition → **one rung down from the parent's effort**
  using the next supported non-off rung; the lowest supported rung stays put.
  Without parent effort, medium steps down to low or the lowest supported
  non-off rung. This also applies when automatic model routing retains the
  parent. Explicit request or definition reasoning still wins. A non-reasoning
  model is valid and reports “not applicable”. This effort policy is unchanged
  by role-aware model routing.

## 6. What this matrix does not promise

- **The IDs are synthetic examples, not profile data or vendor releases.** A tier
  the session cannot run is skipped, so your effective child may differ from
  the all-available column.
- **Family support does not guarantee a cheaper child.** DeepSeek has no worker
  class, so non-review roles retain the parent. Review uses its planner class.
  MiniMax has an abstract flash worker rung; its exact same-version ID must
  still be runnable.
- **An unknown family retains the parent**, without guessing a replacement. A
  known family whose rung is unknown or whose exact-version candidates are unavailable also retains the parent.
  Kimi has no shipped profile; GLM does.
- **Operators replace profiles whole.** A project `familyProfiles` entry for one
  family replaces that family's version-independent tiers entirely;
  other families are untouched. Legacy `fallbacks` settings are ignored; the
  field is accepted only to discard its obsolete contents. Replacement profiles must declare
  the group and the corresponding size/role labels. A new *naming* family
  still needs code support in `strategy.ts`.
- **Pinning a model in an agent file bypasses this whole table** for that agent.

## 7. Keeping this file honest

The marked grid and full matrix are generated by
[`src/models/matrix.ts`](../src/models/matrix.ts). Regenerate them after changing
profiles, strategies, or routing:

```bash
pnpm nx run pi-tiered-subagents:regenerate-model-matrix
pnpm nx run pi-tiered-subagents:test --args="test/models/routing-matrix.test.ts"
```

The async writer is [`scripts/regenerate-model-matrix.ts`](../scripts/regenerate-model-matrix.ts);
it replaces only the marked regions and preserves the explanatory text.
`test/models/routing-matrix.test.ts` recomputes **every generated region** through
the real router and compares the entire content, including the role-aware grid,
every concrete parent for every shipped role, and both restricted availability
scenarios. Every other-versions-only outcome must retain the parent. Hand edits
anywhere in these regions fail the evidence test. It also verifies the five shipped definitions remain unpinned
and that the grid covers the eight supported families (GLM included, Kimi gone).

This is documentation-drift evidence, **not the sole correctness oracle**:
independent literal examples in the router and selection tests verify the
role rules, exact-pin precedence, and failure behavior without deriving their
expected results from this generator.
