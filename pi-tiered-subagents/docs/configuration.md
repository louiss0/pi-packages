# Configuring Pi Tiered Subagents

Pi Tiered Subagents chooses a child's model using **the specialist's role and
its parent's model family**. The built-in ladders cover common families; you
can customize those ladders or bypass them with a model of your own.

**No configuration is required.** Start with the shipped specialists, then add
only the overrides you need. This guide describes this package's current
configuration, not the historical upstream `subagents.json` format.

## Choose the right configuration surface

| You want to… | Configure… |
| --- | --- |
| Let the runtime choose a model for the task | Nothing: request a shipped specialist without a model pin |
| Use a particular model for one task | `model` in the `subagent` request |
| Always use your preferred model for one specialist | `model` in `.pi/agents/<name>.md` or your global agent file |
| Change the tiers used by automatic family routing | `familyProfiles` in the shared settings store |
| Change concurrency, turn limits, or retention | `/subagents:settings` or the shared settings file |

- [How automatic selection works](#how-automatic-selection-works)
- [Pick your own model](#pick-your-own-model)
- [Customize a specialist](#customize-a-specialist)
- [Settings files and precedence](#settings-files-and-precedence)
- [Customize family ladders](#customize-family-ladders)
- [Reasoning levels](#reasoning-levels)
- [Runtime settings reference](#runtime-settings-reference)
- [Troubleshooting](#troubleshooting)

## How automatic selection works

Model selection follows this precedence:

1. An exact model in the request.
2. An exact model in the effective agent definition.
3. Automatic routing from the parent's model, using the resolved agent identifier
   and its family's profile.

Automatic routing combines two inputs, rather than treating role and family as
unrelated modes:

- **The role says what kind of model is wanted.** Exploration targets a small
  model; review targets the parent's size or a planner model.
- **The family says how to find that target.** Size families use S/M/L/XL labels;
  planner/worker families use task-class labels on an ordered ladder.

### Role targets

| Specialist identifier | Size-family target | Planner/worker-family target |
| --- | --- | --- |
| `worker` | One size below the parent, with S as the floor | worker |
| `explore` | S | worker |
| `researcher` | S | worker |
| `debug` | M | worker |
| `reviewer` | Equal: start at the parent's own rung | planner |

This mapping is shipped policy, not a configurable role-to-model map. A custom
identifier such as `auditor` uses **worker routing**, even if its description says
"reviewer". To use reviewer routing, override `reviewer.md`; to give `auditor` a
specific model, pin it in its definition.

A target is not always a downgrade: Debug targets M even from an S parent, and
review on a planner/worker family targets a planner even from a worker parent.
Equal starts at the parent's particular rung, not the first rung with its size.
The size ladder is XL → L → M → S, with S as the floor: an XL parent's
Worker targets L, while its Reviewer starts at the parent's own XL rung.

### Built-in families

| Family key | Group | Shipped tier relationships |
| --- | --- | --- |
| `gpt` | `size` | Astra = XL → Sol = L → Terra, Pro, unnamed default = M → Luna, Mini, Nano = S |
| `claude` | `size` | Fable = XL → Opus = L → Sonnet = M → Haiku = S |
| `qwen` | `size` | Max = L → Plus = M → Flash = S |
| `gemini` | `planner-worker` | Argon, Pro Preview, Pro = planner → Flash, Flash Lite = worker |
| `minimax` | `planner-worker` | Highspeed, unnamed default = planner → Flash = worker |
| `glm` | `planner-worker` | Unnamed default = planner → Flash = worker |
| `mimo` | `planner-worker` | Pro Ultraspeed, Pro, unnamed default = planner → Flash = worker |
| `deepseek` | `planner-worker` | Pro = planner; no worker rung |

These are routing relationships, **not a vendor release list or an availability
promise**. The authoritative data is in
[`src/models/profiles.ts`](../src/models/profiles.ts). Kimi is not currently an
automatic-routing family; an unpinned Kimi parent is retained. A user-selected
exact model does not need to belong to a supported automatic-routing family.

### Same family, same version, runnable models only

The router extracts the parent's version and tier, selects the role's target,
and constructs exact candidate IDs using that family's naming strategy.
It tries the target and eligible lower rungs in profile order. It never searches
another version or guesses equivalent models by price.

For example, **if those exact IDs are runnable**:

- `claude-fable-7` + `worker` targets L: `claude-opus-7`.
- The same Fable parent + `reviewer` starts at its own XL rung.
- `gpt-7-astra` + `worker` targets L: `gpt-7-sol`.
- `claude-opus-4-5` + `worker` targets M: `claude-sonnet-4-5`.
- The same parent + `explore` targets S: `claude-haiku-4-5`.
- The same parent + `reviewer` starts at its own Opus rung.
- `gemini-2.5-pro` + `worker` targets `gemini-2.5-flash`, then
  `gemini-2.5-flash-lite` if necessary.
- A DeepSeek parent with no worker rung is retained for non-review roles.

A dated parent can supply its tier and version, but automatic candidates are
still the exact IDs constructed by the strategy. A dated or specialized variant
is not a fuzzy substitute for an unavailable constructed ID.

For each candidate ID, provider selection is deterministic:

1. Prefer the parent's provider if it can run that exact ID.
2. Otherwise, use a unique runnable provider for that ID.
3. If multiple other providers match, skip that ambiguous rung.

If no eligible rung wins, the runtime retains the captured parent model and
reports why. Unknown families, unextractable versions, and unknown parent tiers
also retain the parent. Planner targets may fall back to worker rungs; worker
targets do not fall back upward to planners.

## Pick your own model

You are not limited to the built-in families. An explicit model bypasses family
routing and must use **`provider/modelId`**, as registered in your Pi session.
The model ID can itself contain slashes. Provider matching is case-insensitive;
the model ID is exact. A fuzzy name such as `sonnet` is not supported.

Example model-facing tool call:

```text
subagent({
  subagent_type: "worker",
  description: "Update parser tests",
  prompt: "Add coverage for empty input in the parser tests.",
  model: "anthropic/claude-sonnet-4-5"
})
```

Replace the example with a model your session can actually run. Credentials,
provider registration, and session restrictions remain Pi's responsibility:
putting an ID in this configuration does not install or authenticate a provider.

An unavailable or misspelled explicit model **fails the launch**. It does not
silently switch models, providers, or return to automatic routing. A request pin
wins over a definition pin, but does not change that file for future calls.

## Customize a specialist

Definitions are Markdown files with YAML frontmatter. The filename, lowercased,
is the specialist identifier.

| Priority | Location |
| --- | --- |
| Highest | `<cwd>/.pi/agents/<name>.md` |
| Next | `<agentDir>/agents/<name>.md` |
| Lowest | Shipped definition, if that identifier exists |

The default agent directory is `~/.pi/agent`; `PI_CODING_AGENT_DIR` relocates it.
Project paths are relative to the parent session's working directory.

To pin every review in this project, create `.pi/agents/reviewer.md`:

```markdown
---
model: anthropic/claude-sonnet-4-5
thinking: high
---
```

This small override preserves the shipped Reviewer's instructions, tools, and
other defaults. To return a globally pinned Reviewer to automatic selection in
one project, use:

```markdown
---
model: null
thinking: null
---
```

Removing a project key alone does not clear a global value; `null` explicitly
clears an inherited optional choice.

### Definition fields

| Frontmatter field | Meaning |
| --- | --- |
| `display_name` | Human-readable label; does not change routing identity |
| `description` | Short description used in the specialist catalogue |
| `model` | Exact `provider/modelId`; unset means automatic routing |
| `thinking` | Explicit reasoning level; unset means automatic reasoning |
| `tools` | Complete allowlist, `inherit`, `none`, or `[]` |
| `max_turns` | Turn ceiling; `0` means unlimited, positive limits have a minimum of 2 |
| `inherit_context` | Whether to inherit the parent's conversation |
| `run_in_background` | Default execution mode |
| `enabled` | `false` prevents this specialist from being requested |

Overrides merge **field by field**, not by concatenating lists. An omitted field
keeps the lower layer. An empty Markdown body keeps the inherited instructions;
a nonempty body replaces them. `tools: []` means no capability tools, not inherit.
`tools: inherit` takes the parent's active tools at request time.

### Tool selection

Explicit `tools` entries can name built-in or installed extension tools; naming
one does not install it. The runtime strips `subagent`, `get_subagent_result`, and
`steer_subagent` from child capabilities, so children cannot delegate recursively.
Communication tools such as `ask_parent` are handled separately.

A new custom specialist defaults to inherited tools, fresh conversation, and
background execution. Treat tool overrides as a permission decision: broadening
a read-only specialist's tools changes what it can do. Scheduling follows the
effective tools, not the specialist's name; shell/editor/unknown tools count as
potential writers. This is not a filesystem sandbox.

## Settings files and precedence

Operational settings and family profiles use the shared store provided by
`@juanibiapina/pi-extension-settings`:

| Scope | File |
| --- | --- |
| Global | `<agentDir>/settings-extensions.json` |
| Project | `<cwd>/.pi/settings-extensions.json` |

Both files are optional. Project settings override global settings; absent values
use the shipped defaults. The package writes **only the project file** when you
save through `/subagents:settings`. Keep other extensions' entries when editing
this shared file.

**Every stored value is a string**, including numbers, booleans, and JSON data.
The extension key is `pi-tiered-subagents`, without the npm scope.

A complete example of the on-disk shape:

```json
{
  "pi-tiered-subagents": {
    "maxConcurrent": "4",
    "defaultMaxTurns": "30",
    "abortAllOnInterrupt": "true",
    "familyProfiles": "{\"claude\":{\"group\":\"size\",\"tiers\":[{\"tier\":\"opus\",\"size\":\"L\"},{\"tier\":\"sonnet\",\"size\":\"M\"},{\"tier\":\"haiku\",\"size\":\"S\"}]}}"
  }
}
```

Do not paste the decoded object below directly as `familyProfiles` in this file:
serialize it to JSON text first. Plain objects, numeric values, and booleans are
not the shared store's value format. After hand-editing settings, start a new Pi
session to ensure they are loaded. A resumed child continues its captured
configuration; it does not reselect its model from changed settings.

## Customize family ladders

Use `familyProfiles` when you want automatic selection to keep working but want
to change a family's tier order or labels. To always use one arbitrary model,
use a definition pin instead.

Here is a **decoded settings object** for readability, not the on-disk wrapper:

```json
{
  "familyProfiles": {
    "claude": {
      "group": "size",
      "tiers": [
        { "tier": "opus", "size": "L" },
        { "tier": "sonnet", "size": "M" },
        { "tier": "haiku", "size": "S" }
      ]
    },
    "minimax": {
      "group": "planner-worker",
      "tiers": [
        { "tier": "", "role": "planner" },
        { "tier": "flash", "role": "worker" }
      ]
    }
  }
}
```

Rules:

- A named family is replaced **whole**, not merged tier by tier. Shipped profiles
  provide defaults; global replacements override them; project replacements
  override the global family. Other families remain intact.
- Declare `group: "size"` with a `size` on every tier, or
  `group: "planner-worker"` with a `role` on every tier. The operational size
  ladder is S → M → L → XL; roles are `planner` and `worker`.
- Put tiers in descending capability/preference order. Fallback walks forward
  through the array, subject to the target's size/class restrictions.
- Tier names must be unique lowercase names after trimming. `""` denotes the
  unnamed default line where that family's naming strategy supports it.
- Profiles contain **no releases, provider priorities, or concrete model IDs**.
  The naming strategy extracts a version from the parent and constructs an exact
  candidate ID at that same version.
- You can customize only families whose naming structure the runtime supports.
  An arbitrary new family key does not teach the router to parse its model IDs.
- Invalid profiles are reported and not applied; unrelated families still load.
  Unknown fields are rejected with paths such as `tiers[1].size`.

Removing a project family replacement exposes the global one again, or the
shipped profile when no global replacement exists. Remove the global replacement
as well to restore shipped behavior everywhere.

**Migration from earlier formats:** replace `versions` and per-tier `models`
arrays with one version-independent `tiers` array. Those old fields are rejected.
Obsolete tier-level `fallbacks` is accepted but discarded; it cannot enable
cross-version routing. The historical `subagents.json` file is not this
package's runtime settings backend.

## Reasoning levels

The model is chosen first. Its supported reasoning levels then determine effort:

1. Request `thinking` wins.
2. Otherwise, definition `thinking` wins.
3. Otherwise, use the next supported non-off level below the parent's effort.

Gaps are skipped: with supported levels `[low, high, max]`, parent `max` becomes
`high`, not `low`. At the floor, effort stays at the supported non-off floor.
This step-down also applies when the **model itself was retained**.

With no parent effort, automatic selection prefers medium, then low, then the
lowest supported non-off level. Explicit levels are clamped to what the model
supports. A non-reasoning model reports *not applicable*. Explicit `off` is not
allowed for a reasoning model.

Thinking choices are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`,
subject to those model-specific rules. In model-facing calls the field is
`thinking`; service callers use `thinkingLevel` instead.

## Runtime settings reference

Use `/subagents:settings` for the ordinary runtime controls. These do not change
the role policy or pin models.

| Setting | Default | Meaning / accepted on-disk range |
| --- | --- | --- |
| `maxConcurrent` | `4` | 1–1024 concurrent children; workspace writer scheduling still applies |
| `defaultMaxTurns` | `0` | Unlimited at 0; positive ceilings normalize to at least 2; maximum 10,000 |
| `wrapUpTurns` | `2` | Warn with this many turns remaining; 1–1000 |
| `consumedSessionRetentionMinutes` | `10` | Retain a collected child's session; 1–20,160 minutes |
| `unconsumedSessionRetentionMinutes` | `720` | Safety retention for an uncollected child's session; 1–20,160 minutes |
| `abortAllOnInterrupt` | `true` | ESC stops background/queued children too; foreground work aborts on ESC either way |
| `midRunUpdates` | `true` | Give background children `notify_parent`; disabling it does not disable ask-back |

Turn ceilings resolve request `max_turns` → definition `max_turns` →
`defaultMaxTurns`. A request or definition value of 0 explicitly selects
unlimited execution. `graceTurns` is retired; use `wrapUpTurns`.

The following structured settings are hand-edited, JSON-encoded strings rather
than settings-menu controls:

| Setting | Default | Meaning |
| --- | --- | --- |
| `familyProfiles` | Shipped profiles | Automatic-routing family replacements |
| `excludedExtensionPackages` | `[]` | Exact configured package source strings whose extensions children must not load; skills, prompts, and themes stay available |
| `promptInheritance` | `{}` | Provider-to-strategy map: `full` by default, optionally `portable` |

Project `excludedExtensionPackages` replaces the global list. Project
`promptInheritance` replaces the global map as a whole. Only `familyProfiles`
merges by family key, with whole-family replacement. An empty
`promptInheritance` map (or one with no valid entries) is treated as absent, so
`"{}"` does not clear global portable rules. To restore a globally portable
provider to full inheritance, explicitly set it to `full` in the project map,
for example the decoded value `{"claude-bridge":"full"}`. Menu saves preserve
the project's own structured settings rather than copying global structured
settings into the project.

Use `portable` only for a provider that re-homes prompts into another harness
with its own base prompt. For example, the decoded value
`{"claude-bridge":"portable"}` affects children whose **resolved model provider**
is `claude-bridge`, not every child of a particular role. Ordinary providers
should keep the default `full` behavior.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| The child kept the parent's model | Inspect the launch reason: unknown family/tier/version, absent role target, unavailable same-version IDs, or provider ambiguity can cause retention. Reviewer Equal may intentionally keep its rung. |
| My model choice was ignored | A request pin wins over a definition pin. Check project overrides and the resolved identifier. Changing a display name does not change routing policy. |
| My custom reviewer steps down like a Worker | Custom identifiers use worker policy; override `reviewer.md` or pin the custom specialist's model. |
| A configured model fails | Verify the full exact `provider/modelId` and session access. Explicit choices never silently reroute. |
| My profile does not load | Check the string-valued store wrapper, then diagnostics for `group`, required labels, unknown fields, duplicate tiers, and unsupported naming structures. |
| A smaller model exists but was skipped | It must have the exact same-version constructed ID and meet target/provider rules. A different version or dated alias is not a substitute. |
| Removing a project setting did not restore defaults | A global override may still apply. Clear an inherited model/thinking pin with `null` in the project definition. |
| A changed setting did not affect a resumed child | Resume keeps the captured configuration; launch a new child for new model selection. |

For implementation details, see [model selection](../src/models/selection.ts),
[role policy](../src/models/role-policy.ts), [routing](../src/models/router.ts),
[profile validation](../src/models/user-profiles.ts), and
[shared settings persistence](../src/shared-settings.ts).
