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
the representative parent listed beneath the grid with all profile candidates
available. The complete parent-by-role matrix follows in section 4. A request
or definition model pin bypasses this grid.

<!-- model-matrix:grid:start -->
| Agent | gpt | claude | gemini | glm | minimax | qwen | deepseek | mimo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `explore` | **retain** | `anthropic/claude-haiku-5-5` | **retain** | `zai/glm-5.3-flash` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** | `xiaomi/mimo-v2.6-flash` |
| `worker` | **retain** | `anthropic/claude-sonnet-5-5` | **retain** | `zai/glm-5.3-flash` | `minimax/MiniMax-M3.1-flash` | `qwen-token-plan/qwen3.7-plus` | **retain** | `xiaomi/mimo-v2.6-flash` |
| `reviewer` | `openai/gpt-6.1-sol` | `anthropic/claude-opus-5-5` | `google/gemini-4-argon` | `zai/glm-5.3` | `minimax/MiniMax-M3.1` | `qwen-token-plan/qwen3.7-max` | `deepseek/deepseek-v4-pro` | `xiaomi/mimo-v2.6-pro-ultraspeed` |
| `debug` | **retain** | `anthropic/claude-sonnet-5-5` | **retain** | `zai/glm-5.3-flash` | `minimax/MiniMax-M3.1-flash` | `qwen-token-plan/qwen3.7-plus` | **retain** | `xiaomi/mimo-v2.6-flash` |
| `researcher` | **retain** | `anthropic/claude-haiku-5-5` | **retain** | `zai/glm-5.3-flash` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** | `xiaomi/mimo-v2.6-flash` |

| Family | Representative parent (all candidates available) |
| --- | --- |
| gpt | `openai/gpt-6.1-sol` |
| claude | `anthropic/claude-opus-5-5` |
| gemini | `google/gemini-4-argon` |
| glm | `zai/glm-5.3` |
| minimax | `minimax/MiniMax-M3.1` |
| qwen | `qwen-token-plan/qwen3.7-max` |
| deepseek | `deepseek/deepseek-v4-pro` |
| mimo | `xiaomi/mimo-v2.6-pro-ultraspeed` |
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

The version, rung, and size/class columns come from the profile. The selected
identities and retain outcomes come only from the router.

<!-- model-matrix:full:start -->
### gpt — size

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-6.1-sol` | 6.1 / sol (L) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-6.1-sol` | 6.1 / sol (L) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-6.1-sol` | 6.1 / sol (L) | `reviewer` | `openai/gpt-6.1-sol` | **retain** | **retain** |
| `openai/gpt-6.1-sol` | 6.1 / sol (L) | `debug` | **retain** | **retain** | **retain** |
| `openai/gpt-6.1-sol` | 6.1 / sol (L) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-6-astra` | 6 / astra (L) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-6-astra` | 6 / astra (L) | `worker` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-astra` | 6 / astra (L) | `reviewer` | `openai/gpt-6-astra` | **retain** | **retain** |
| `openai/gpt-6-astra` | 6 / astra (L) | `debug` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-astra` | 6 / astra (L) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-6-sol` | 6 / sol (L) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-6-sol` | 6 / sol (L) | `worker` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-sol` | 6 / sol (L) | `reviewer` | `openai/gpt-6-sol` | **retain** | **retain** |
| `openai/gpt-6-sol` | 6 / sol (L) | `debug` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-sol` | 6 / sol (L) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-6-luna` | 6 / luna (M) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-6-luna` | 6 / luna (M) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-6-luna` | 6 / luna (M) | `reviewer` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-luna` | 6 / luna (M) | `debug` | `openai/gpt-6-luna` | **retain** | **retain** |
| `openai/gpt-6-luna` | 6 / luna (M) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-sol` | 5.6 / sol (L) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-sol` | 5.6 / sol (L) | `worker` | `openai/gpt-5.6-terra` | **retain** | **retain** |
| `openai/gpt-5.6-sol` | 5.6 / sol (L) | `reviewer` | `openai/gpt-5.6-sol` | **retain** | **retain** |
| `openai/gpt-5.6-sol` | 5.6 / sol (L) | `debug` | `openai/gpt-5.6-terra` | **retain** | **retain** |
| `openai/gpt-5.6-sol` | 5.6 / sol (L) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-terra` | 5.6 / terra (M) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-terra` | 5.6 / terra (M) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-terra` | 5.6 / terra (M) | `reviewer` | `openai/gpt-5.6-terra` | **retain** | **retain** |
| `openai/gpt-5.6-terra` | 5.6 / terra (M) | `debug` | `openai/gpt-5.6-terra` | **retain** | **retain** |
| `openai/gpt-5.6-terra` | 5.6 / terra (M) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-luna` | 5.6 / luna (M) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-luna` | 5.6 / luna (M) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-5.6-luna` | 5.6 / luna (M) | `reviewer` | `openai/gpt-5.6-luna` | **retain** | **retain** |
| `openai/gpt-5.6-luna` | 5.6 / luna (M) | `debug` | `openai/gpt-5.6-terra` | **retain** | **retain** |
| `openai/gpt-5.6-luna` | 5.6 / luna (M) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5-pro` | 5.5 / pro (M) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5-pro` | 5.5 / pro (M) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5-pro` | 5.5 / pro (M) | `reviewer` | `openai/gpt-5.5-pro` | **retain** | **retain** |
| `openai/gpt-5.5-pro` | 5.5 / pro (M) | `debug` | `openai/gpt-5.5-pro` | **retain** | **retain** |
| `openai/gpt-5.5-pro` | 5.5 / pro (M) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5` | 5.5 / (default) (M) | `explore` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5` | 5.5 / (default) (M) | `worker` | **retain** | **retain** | **retain** |
| `openai/gpt-5.5` | 5.5 / (default) (M) | `reviewer` | `openai/gpt-5.5` | **retain** | **retain** |
| `openai/gpt-5.5` | 5.5 / (default) (M) | `debug` | `openai/gpt-5.5-pro` | **retain** | **retain** |
| `openai/gpt-5.5` | 5.5 / (default) (M) | `researcher` | **retain** | **retain** | **retain** |
| `openai/gpt-5.4-pro` | 5.4 / pro (M) | `explore` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-pro` | 5.4 / pro (M) | `worker` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-pro` | 5.4 / pro (M) | `reviewer` | `openai/gpt-5.4-pro` | **retain** | **retain** |
| `openai/gpt-5.4-pro` | 5.4 / pro (M) | `debug` | `openai/gpt-5.4-pro` | **retain** | **retain** |
| `openai/gpt-5.4-pro` | 5.4 / pro (M) | `researcher` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4` | 5.4 / (default) (M) | `explore` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4` | 5.4 / (default) (M) | `worker` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4` | 5.4 / (default) (M) | `reviewer` | `openai/gpt-5.4` | **retain** | **retain** |
| `openai/gpt-5.4` | 5.4 / (default) (M) | `debug` | `openai/gpt-5.4-pro` | **retain** | **retain** |
| `openai/gpt-5.4` | 5.4 / (default) (M) | `researcher` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-mini` | 5.4 / mini (S) | `explore` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-mini` | 5.4 / mini (S) | `worker` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-mini` | 5.4 / mini (S) | `reviewer` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-mini` | 5.4 / mini (S) | `debug` | `openai/gpt-5.4-pro` | **retain** | **retain** |
| `openai/gpt-5.4-mini` | 5.4 / mini (S) | `researcher` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-nano` | 5.4 / nano (S) | `explore` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-nano` | 5.4 / nano (S) | `worker` | `openai/gpt-5.4-mini` | **retain** | **retain** |
| `openai/gpt-5.4-nano` | 5.4 / nano (S) | `reviewer` | `openai/gpt-5.4-nano` | **retain** | **retain** |
| `openai/gpt-5.4-nano` | 5.4 / nano (S) | `debug` | `openai/gpt-5.4-pro` | **retain** | **retain** |
| `openai/gpt-5.4-nano` | 5.4 / nano (S) | `researcher` | `openai/gpt-5.4-mini` | **retain** | **retain** |

### claude — size

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `anthropic/claude-opus-5-5` | 5.5 / opus (L) | `explore` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-opus-5-5` | 5.5 / opus (L) | `worker` | `anthropic/claude-sonnet-5-5` | **retain** | **retain** |
| `anthropic/claude-opus-5-5` | 5.5 / opus (L) | `reviewer` | `anthropic/claude-opus-5-5` | **retain** | **retain** |
| `anthropic/claude-opus-5-5` | 5.5 / opus (L) | `debug` | `anthropic/claude-sonnet-5-5` | **retain** | **retain** |
| `anthropic/claude-opus-5-5` | 5.5 / opus (L) | `researcher` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5-5` | 5.5 / sonnet (M) | `explore` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5-5` | 5.5 / sonnet (M) | `worker` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5-5` | 5.5 / sonnet (M) | `reviewer` | `anthropic/claude-sonnet-5-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5-5` | 5.5 / sonnet (M) | `debug` | `anthropic/claude-sonnet-5-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5-5` | 5.5 / sonnet (M) | `researcher` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-haiku-5-5` | 5.5 / haiku (S) | `explore` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-haiku-5-5` | 5.5 / haiku (S) | `worker` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-haiku-5-5` | 5.5 / haiku (S) | `reviewer` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-haiku-5-5` | 5.5 / haiku (S) | `debug` | `anthropic/claude-sonnet-5-5` | **retain** | **retain** |
| `anthropic/claude-haiku-5-5` | 5.5 / haiku (S) | `researcher` | `anthropic/claude-haiku-5-5` | **retain** | **retain** |
| `anthropic/claude-fable-5` | 5 / fable (L) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-fable-5` | 5 / fable (L) | `worker` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-fable-5` | 5 / fable (L) | `reviewer` | `anthropic/claude-fable-5` | **retain** | **retain** |
| `anthropic/claude-fable-5` | 5 / fable (L) | `debug` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-fable-5` | 5 / fable (L) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-5` | 5 / opus (L) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-5` | 5 / opus (L) | `worker` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-opus-5` | 5 / opus (L) | `reviewer` | `anthropic/claude-opus-5` | **retain** | **retain** |
| `anthropic/claude-opus-5` | 5 / opus (L) | `debug` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-opus-5` | 5 / opus (L) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-5` | 5 / sonnet (M) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-5` | 5 / sonnet (M) | `worker` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-5` | 5 / sonnet (M) | `reviewer` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5` | 5 / sonnet (M) | `debug` | `anthropic/claude-sonnet-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-5` | 5 / sonnet (M) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-8` | 4.8 / opus (L) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-8` | 4.8 / opus (L) | `worker` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-8` | 4.8 / opus (L) | `reviewer` | `anthropic/claude-opus-4-8` | **retain** | **retain** |
| `anthropic/claude-opus-4-8` | 4.8 / opus (L) | `debug` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-8` | 4.8 / opus (L) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-7` | 4.7 / opus (L) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-7` | 4.7 / opus (L) | `worker` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-7` | 4.7 / opus (L) | `reviewer` | `anthropic/claude-opus-4-7` | **retain** | **retain** |
| `anthropic/claude-opus-4-7` | 4.7 / opus (L) | `debug` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-7` | 4.7 / opus (L) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-6` | 4.6 / opus (L) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-6` | 4.6 / opus (L) | `worker` | `anthropic/claude-sonnet-4-6` | **retain** | **retain** |
| `anthropic/claude-opus-4-6` | 4.6 / opus (L) | `reviewer` | `anthropic/claude-opus-4-6` | **retain** | **retain** |
| `anthropic/claude-opus-4-6` | 4.6 / opus (L) | `debug` | `anthropic/claude-sonnet-4-6` | **retain** | **retain** |
| `anthropic/claude-opus-4-6` | 4.6 / opus (L) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-4-6` | 4.6 / sonnet (M) | `explore` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-4-6` | 4.6 / sonnet (M) | `worker` | **retain** | **retain** | **retain** |
| `anthropic/claude-sonnet-4-6` | 4.6 / sonnet (M) | `reviewer` | `anthropic/claude-sonnet-4-6` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-6` | 4.6 / sonnet (M) | `debug` | `anthropic/claude-sonnet-4-6` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-6` | 4.6 / sonnet (M) | `researcher` | **retain** | **retain** | **retain** |
| `anthropic/claude-opus-4-5` | 4.5 / opus (L) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5` | 4.5 / opus (L) | `worker` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5` | 4.5 / opus (L) | `reviewer` | `anthropic/claude-opus-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5` | 4.5 / opus (L) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5` | 4.5 / opus (L) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5-20251101` | 4.5 / opus (L) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5-20251101` | 4.5 / opus (L) | `worker` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5-20251101` | 4.5 / opus (L) | `reviewer` | `anthropic/claude-opus-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5-20251101` | 4.5 / opus (L) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-opus-4-5-20251101` | 4.5 / opus (L) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5` | 4.5 / sonnet (M) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5` | 4.5 / sonnet (M) | `worker` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5` | 4.5 / sonnet (M) | `reviewer` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5` | 4.5 / sonnet (M) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5` | 4.5 / sonnet (M) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5-20250929` | 4.5 / sonnet (M) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5-20250929` | 4.5 / sonnet (M) | `worker` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5-20250929` | 4.5 / sonnet (M) | `reviewer` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5-20250929` | 4.5 / sonnet (M) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-sonnet-4-5-20250929` | 4.5 / sonnet (M) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5` | 4.5 / haiku (S) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5` | 4.5 / haiku (S) | `worker` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5` | 4.5 / haiku (S) | `reviewer` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5` | 4.5 / haiku (S) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5` | 4.5 / haiku (S) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5-20251001` | 4.5 / haiku (S) | `explore` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5-20251001` | 4.5 / haiku (S) | `worker` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5-20251001` | 4.5 / haiku (S) | `reviewer` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5-20251001` | 4.5 / haiku (S) | `debug` | `anthropic/claude-sonnet-4-5` | **retain** | **retain** |
| `anthropic/claude-haiku-4-5-20251001` | 4.5 / haiku (S) | `researcher` | `anthropic/claude-haiku-4-5` | **retain** | **retain** |

### gemini — planner-worker

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-4-argon` | 4 / argon (planner) | `explore` | **retain** | **retain** | **retain** |
| `google/gemini-4-argon` | 4 / argon (planner) | `worker` | **retain** | **retain** | **retain** |
| `google/gemini-4-argon` | 4 / argon (planner) | `reviewer` | `google/gemini-4-argon` | **retain** | **retain** |
| `google/gemini-4-argon` | 4 / argon (planner) | `debug` | **retain** | **retain** | **retain** |
| `google/gemini-4-argon` | 4 / argon (planner) | `researcher` | **retain** | **retain** | **retain** |
| `google/gemini-3.8-flash` | 3.8 / flash (worker) | `explore` | `google/gemini-3.8-flash` | **retain** | **retain** |
| `google/gemini-3.8-flash` | 3.8 / flash (worker) | `worker` | `google/gemini-3.8-flash` | **retain** | **retain** |
| `google/gemini-3.8-flash` | 3.8 / flash (worker) | `reviewer` | **retain** | **retain** | **retain** |
| `google/gemini-3.8-flash` | 3.8 / flash (worker) | `debug` | `google/gemini-3.8-flash` | **retain** | **retain** |
| `google/gemini-3.8-flash` | 3.8 / flash (worker) | `researcher` | `google/gemini-3.8-flash` | **retain** | **retain** |
| `google/gemini-3.7-flash` | 3.7 / flash (worker) | `explore` | `google/gemini-3.7-flash` | **retain** | **retain** |
| `google/gemini-3.7-flash` | 3.7 / flash (worker) | `worker` | `google/gemini-3.7-flash` | **retain** | **retain** |
| `google/gemini-3.7-flash` | 3.7 / flash (worker) | `reviewer` | **retain** | **retain** | **retain** |
| `google/gemini-3.7-flash` | 3.7 / flash (worker) | `debug` | `google/gemini-3.7-flash` | **retain** | **retain** |
| `google/gemini-3.7-flash` | 3.7 / flash (worker) | `researcher` | `google/gemini-3.7-flash` | **retain** | **retain** |
| `google/gemini-3.6-flash` | 3.6 / flash (worker) | `explore` | `google/gemini-3.6-flash` | **retain** | **retain** |
| `google/gemini-3.6-flash` | 3.6 / flash (worker) | `worker` | `google/gemini-3.6-flash` | **retain** | **retain** |
| `google/gemini-3.6-flash` | 3.6 / flash (worker) | `reviewer` | **retain** | **retain** | **retain** |
| `google/gemini-3.6-flash` | 3.6 / flash (worker) | `debug` | `google/gemini-3.6-flash` | **retain** | **retain** |
| `google/gemini-3.6-flash` | 3.6 / flash (worker) | `researcher` | `google/gemini-3.6-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash` | 3.5 / flash (worker) | `explore` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash` | 3.5 / flash (worker) | `worker` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash` | 3.5 / flash (worker) | `reviewer` | **retain** | **retain** | **retain** |
| `google/gemini-3.5-flash` | 3.5 / flash (worker) | `debug` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash` | 3.5 / flash (worker) | `researcher` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash-lite` | 3.5 / flash-lite (worker) | `explore` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash-lite` | 3.5 / flash-lite (worker) | `worker` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash-lite` | 3.5 / flash-lite (worker) | `reviewer` | **retain** | **retain** | **retain** |
| `google/gemini-3.5-flash-lite` | 3.5 / flash-lite (worker) | `debug` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.5-flash-lite` | 3.5 / flash-lite (worker) | `researcher` | `google/gemini-3.5-flash` | **retain** | **retain** |
| `google/gemini-3.1-pro-preview` | 3.1 / pro-preview (planner) | `explore` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-pro-preview` | 3.1 / pro-preview (planner) | `worker` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-pro-preview` | 3.1 / pro-preview (planner) | `reviewer` | `google/gemini-3.1-pro-preview` | **retain** | **retain** |
| `google/gemini-3.1-pro-preview` | 3.1 / pro-preview (planner) | `debug` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-pro-preview` | 3.1 / pro-preview (planner) | `researcher` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-flash-lite` | 3.1 / flash-lite (worker) | `explore` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-flash-lite` | 3.1 / flash-lite (worker) | `worker` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-flash-lite` | 3.1 / flash-lite (worker) | `reviewer` | `google/gemini-3.1-pro-preview` | **retain** | **retain** |
| `google/gemini-3.1-flash-lite` | 3.1 / flash-lite (worker) | `debug` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-3.1-flash-lite` | 3.1 / flash-lite (worker) | `researcher` | `google/gemini-3.1-flash-lite` | **retain** | **retain** |
| `google/gemini-2.5-pro` | 2.5 / pro (planner) | `explore` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-pro` | 2.5 / pro (planner) | `worker` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-pro` | 2.5 / pro (planner) | `reviewer` | `google/gemini-2.5-pro` | **retain** | **retain** |
| `google/gemini-2.5-pro` | 2.5 / pro (planner) | `debug` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-pro` | 2.5 / pro (planner) | `researcher` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash` | 2.5 / flash (worker) | `explore` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash` | 2.5 / flash (worker) | `worker` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash` | 2.5 / flash (worker) | `reviewer` | `google/gemini-2.5-pro` | **retain** | **retain** |
| `google/gemini-2.5-flash` | 2.5 / flash (worker) | `debug` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash` | 2.5 / flash (worker) | `researcher` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash-lite` | 2.5 / flash-lite (worker) | `explore` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash-lite` | 2.5 / flash-lite (worker) | `worker` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash-lite` | 2.5 / flash-lite (worker) | `reviewer` | `google/gemini-2.5-pro` | **retain** | **retain** |
| `google/gemini-2.5-flash-lite` | 2.5 / flash-lite (worker) | `debug` | `google/gemini-2.5-flash` | **retain** | **retain** |
| `google/gemini-2.5-flash-lite` | 2.5 / flash-lite (worker) | `researcher` | `google/gemini-2.5-flash` | **retain** | **retain** |

### glm — planner-worker

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `zai/glm-5.3` | 5.3 / (default) (planner) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3` | 5.3 / (default) (planner) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3` | 5.3 / (default) (planner) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `zai/glm-5.3` | 5.3 / (default) (planner) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3` | 5.3 / (default) (planner) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3` | 5.3 / (default) (planner) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3` | 5.3 / (default) (planner) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3` | 5.3 / (default) (planner) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `opencode/glm-5.3` | 5.3 / (default) (planner) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3` | 5.3 / (default) (planner) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3` | 5.3 / (default) (planner) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3` | 5.3 / (default) (planner) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3` | 5.3 / (default) (planner) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `radius/glm-5.3` | 5.3 / (default) (planner) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3` | 5.3 / (default) (planner) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3-flash` | 5.3 / flash (worker) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3-flash` | 5.3 / flash (worker) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3-flash` | 5.3 / flash (worker) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `zai/glm-5.3-flash` | 5.3 / flash (worker) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `zai/glm-5.3-flash` | 5.3 / flash (worker) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3-flash` | 5.3 / flash (worker) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3-flash` | 5.3 / flash (worker) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3-flash` | 5.3 / flash (worker) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `opencode/glm-5.3-flash` | 5.3 / flash (worker) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `opencode/glm-5.3-flash` | 5.3 / flash (worker) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3-flash` | 5.3 / flash (worker) | `explore` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3-flash` | 5.3 / flash (worker) | `worker` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3-flash` | 5.3 / flash (worker) | `reviewer` | `zai/glm-5.3` | **retain** | **retain** |
| `radius/glm-5.3-flash` | 5.3 / flash (worker) | `debug` | `zai/glm-5.3-flash` | **retain** | **retain** |
| `radius/glm-5.3-flash` | 5.3 / flash (worker) | `researcher` | `zai/glm-5.3-flash` | **retain** | **retain** |

### minimax — planner-worker

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `minimax/MiniMax-M3.1` | 3.1 / (default) (planner) | `explore` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1` | 3.1 / (default) (planner) | `worker` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1` | 3.1 / (default) (planner) | `reviewer` | `minimax/MiniMax-M3.1` | **retain** | **retain** |
| `minimax/MiniMax-M3.1` | 3.1 / (default) (planner) | `debug` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1` | 3.1 / (default) (planner) | `researcher` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1-flash` | 3.1 / flash (worker) | `explore` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1-flash` | 3.1 / flash (worker) | `worker` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1-flash` | 3.1 / flash (worker) | `reviewer` | `minimax/MiniMax-M3.1` | **retain** | **retain** |
| `minimax/MiniMax-M3.1-flash` | 3.1 / flash (worker) | `debug` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3.1-flash` | 3.1 / flash (worker) | `researcher` | `minimax/MiniMax-M3.1-flash` | **retain** | **retain** |
| `minimax/MiniMax-M3` | 3 / (default) (planner) | `explore` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M3` | 3 / (default) (planner) | `worker` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M3` | 3 / (default) (planner) | `reviewer` | `minimax/MiniMax-M3` | **retain** | **retain** |
| `minimax/MiniMax-M3` | 3 / (default) (planner) | `debug` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M3` | 3 / (default) (planner) | `researcher` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7-highspeed` | 2.7 / highspeed (planner) | `explore` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7-highspeed` | 2.7 / highspeed (planner) | `worker` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7-highspeed` | 2.7 / highspeed (planner) | `reviewer` | `minimax/MiniMax-M2.7-highspeed` | **retain** | **retain** |
| `minimax/MiniMax-M2.7-highspeed` | 2.7 / highspeed (planner) | `debug` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7-highspeed` | 2.7 / highspeed (planner) | `researcher` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7` | 2.7 / (default) (planner) | `explore` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7` | 2.7 / (default) (planner) | `worker` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7` | 2.7 / (default) (planner) | `reviewer` | `minimax/MiniMax-M2.7-highspeed` | **retain** | **retain** |
| `minimax/MiniMax-M2.7` | 2.7 / (default) (planner) | `debug` | **retain** | **retain** | **retain** |
| `minimax/MiniMax-M2.7` | 2.7 / (default) (planner) | `researcher` | **retain** | **retain** | **retain** |

### qwen — size

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `qwen-token-plan/qwen3.7-max` | 3.7 / max (L) | `explore` | **retain** | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-max` | 3.7 / max (L) | `worker` | `qwen-token-plan/qwen3.7-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-max` | 3.7 / max (L) | `reviewer` | `qwen-token-plan/qwen3.7-max` | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-max` | 3.7 / max (L) | `debug` | `qwen-token-plan/qwen3.7-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-max` | 3.7 / max (L) | `researcher` | **retain** | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-plus` | 3.7 / plus (M) | `explore` | **retain** | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-plus` | 3.7 / plus (M) | `worker` | **retain** | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-plus` | 3.7 / plus (M) | `reviewer` | `qwen-token-plan/qwen3.7-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-plus` | 3.7 / plus (M) | `debug` | `qwen-token-plan/qwen3.7-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.7-plus` | 3.7 / plus (M) | `researcher` | **retain** | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-plus` | 3.6 / plus (M) | `explore` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-plus` | 3.6 / plus (M) | `worker` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-plus` | 3.6 / plus (M) | `reviewer` | `qwen-token-plan/qwen3.6-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-plus` | 3.6 / plus (M) | `debug` | `qwen-token-plan/qwen3.6-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-plus` | 3.6 / plus (M) | `researcher` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-flash` | 3.6 / flash (S) | `explore` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-flash` | 3.6 / flash (S) | `worker` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-flash` | 3.6 / flash (S) | `reviewer` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-flash` | 3.6 / flash (S) | `debug` | `qwen-token-plan/qwen3.6-plus` | **retain** | **retain** |
| `qwen-token-plan/qwen3.6-flash` | 3.6 / flash (S) | `researcher` | `qwen-token-plan/qwen3.6-flash` | **retain** | **retain** |

### deepseek — planner-worker

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `deepseek/deepseek-v4-pro` | 4 / pro (planner) | `explore` | **retain** | **retain** | **retain** |
| `deepseek/deepseek-v4-pro` | 4 / pro (planner) | `worker` | **retain** | **retain** | **retain** |
| `deepseek/deepseek-v4-pro` | 4 / pro (planner) | `reviewer` | `deepseek/deepseek-v4-pro` | **retain** | **retain** |
| `deepseek/deepseek-v4-pro` | 4 / pro (planner) | `debug` | **retain** | **retain** | **retain** |
| `deepseek/deepseek-v4-pro` | 4 / pro (planner) | `researcher` | **retain** | **retain** | **retain** |

### mimo — planner-worker

| Parent model | Version / rung (size or class) | Agent | All available | Other versions only | None available |
| --- | --- | --- | --- | --- | --- |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 2.6 / pro-ultraspeed (planner) | `explore` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 2.6 / pro-ultraspeed (planner) | `worker` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 2.6 / pro-ultraspeed (planner) | `reviewer` | `xiaomi/mimo-v2.6-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 2.6 / pro-ultraspeed (planner) | `debug` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 2.6 / pro-ultraspeed (planner) | `researcher` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro` | 2.6 / pro (planner) | `explore` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro` | 2.6 / pro (planner) | `worker` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro` | 2.6 / pro (planner) | `reviewer` | `xiaomi/mimo-v2.6-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro` | 2.6 / pro (planner) | `debug` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-pro` | 2.6 / pro (planner) | `researcher` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-flash` | 2.6 / flash (worker) | `explore` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-flash` | 2.6 / flash (worker) | `worker` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-flash` | 2.6 / flash (worker) | `reviewer` | `xiaomi/mimo-v2.6-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-flash` | 2.6 / flash (worker) | `debug` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.6-flash` | 2.6 / flash (worker) | `researcher` | `xiaomi/mimo-v2.6-flash` | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro-ultraspeed` | 2.5 / pro-ultraspeed (planner) | `explore` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro-ultraspeed` | 2.5 / pro-ultraspeed (planner) | `worker` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro-ultraspeed` | 2.5 / pro-ultraspeed (planner) | `reviewer` | `xiaomi/mimo-v2.5-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro-ultraspeed` | 2.5 / pro-ultraspeed (planner) | `debug` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro-ultraspeed` | 2.5 / pro-ultraspeed (planner) | `researcher` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro` | 2.5 / pro (planner) | `explore` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro` | 2.5 / pro (planner) | `worker` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro` | 2.5 / pro (planner) | `reviewer` | `xiaomi/mimo-v2.5-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro` | 2.5 / pro (planner) | `debug` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5-pro` | 2.5 / pro (planner) | `researcher` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5` | 2.5 / (default) (planner) | `explore` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5` | 2.5 / (default) (planner) | `worker` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5` | 2.5 / (default) (planner) | `reviewer` | `xiaomi/mimo-v2.5-pro-ultraspeed` | **retain** | **retain** |
| `xiaomi/mimo-v2.5` | 2.5 / (default) (planner) | `debug` | **retain** | **retain** | **retain** |
| `xiaomi/mimo-v2.5` | 2.5 / (default) (planner) | `researcher` | **retain** | **retain** | **retain** |
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
price or a model-name substring. The top rung of the target size/class is the
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
  For example, GPT 6.1 has no M rung, so its worker retains the parent.
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

- **The IDs are representative profile data, not a vendor release list.** A tier
  the session cannot run is skipped, so your effective child may differ from
  the all-available column.
- **Family support does not guarantee a cheaper child.** DeepSeek has no worker
  class, so non-review roles retain the parent. Review uses its planner class.
  MiniMax does have a worker: M3.1 flash (not a Gemini 3.1 flash release).
- **An unknown family retains the parent**, without guessing a replacement. A
  known family whose rung or exact version is missing also retains the parent.
  Kimi has no shipped profile; GLM does.
- **Operators replace profiles whole.** A project `familyProfiles` entry for one
  family replaces that family's versions, tiers, and candidates entirely;
  other families are untouched. Legacy `fallbacks` settings are ignored; the
  schema no longer exposes that field. Replacement profiles must declare
  the group and the corresponding size/class labels. A new *naming* family
  still needs code support in `strategy.ts`.
- **Pinning a model in an agent file bypasses this whole table** for that agent.

## 7. Keeping this file honest

The marked grid and full matrix are generated by
[`src/models/matrix.ts`](../src/models/matrix.ts). Regenerate them after changing
profiles, strategies, or routing:

```bash
pnpm nx run pi-tiered-subagents:regenerate-model-matrix
pnpm nx run pi-tiered-subagents:test -- test/models/routing-matrix.test.ts
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
