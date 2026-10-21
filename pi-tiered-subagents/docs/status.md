# Runtime status

What is in this package today, what is inherited, what was changed on purpose,
and what is still owed to the approved specification.

The authoritative requirements are [SPEC.md](SPEC.md). This file records
**verified** state, not plans.

## Baseline

| | |
| --- | --- |
| Source material | [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) v25.0.1 (MIT, © Chris Lasher), itself a friendly fork of [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) |
| Pi runtime | `@earendil-works/pi-coding-agent` 1.3.0, `@earendil-works/pi-tui` 1.3.0 |
| Runtime code | `src/` — the inherited runtime plus the new `src/agents/` domain |
| Extension entry | `extensions/index.ts` — the composition root that Pi loads |
| Tests | `test/` — 94 test files and 17 helpers, recovered from upstream v25.0.1 and adapted |
| Typecheck | `pnpm nx run pi-tiered-subagents:typecheck` — clean |
| Test suite | `pnpm nx run pi-tiered-subagents:test` — 2182 tests, all passing |

The runtime is a **faithful derivative** of upstream today: the lifecycle,
configuration, prompt assembly, observation, and UI behaviour are upstream's,
characterized by upstream's own suite.

## The inherited runtime, explained

[how-it-works.html](how-it-works.html) is the guided tour of the inherited
implementation: what a child session is, how the spawn doors resolve a
request, how the lifecycle, observation, and UI domains fit together, and the
upstream decisions that constrain where the specified work may live. The
architecture record it draws on is upstream's
[architecture.md](architecture/architecture.md) and
[decision records](decisions/), kept as provenance rather than as decisions
adopted for this derivative.

## The agent-definition domain

`src/agents/` is the new domain: the model of a definition, the layering rules,
the shipped specialists, the file loader, and the registry that answers "which
agent is this?".

| Module | What it owns |
| --- | --- |
| `src/agents/definition.ts` | The definition model, the layering vocabulary (not specified / explicit / cleared / empty), the tool selection, and the child's tool list |
| `src/agents/shipped.ts` | The five shipped specialists, with their exact tool lists and standing instructions |
| `src/agents/loader.ts` | Reading a definition file, and reporting a duplicate identifier |
| `src/agents/registry.ts` | The three layers, their merge, and the selection that rejects an unknown or disabled agent |
| `src/agents/invocation.ts` | The precedence between a request and a definition |

The layering vocabulary is small on purpose: a field a layer does not mention
is inherited, an explicit value replaces, `null` clears an inherited optional
setting, and an empty list stays empty. Lists are never concatenated, and a
body is either inherited (empty) or replaced (non-empty).

### What the definitions do now

| Area | Stories | State |
| --- | --- | --- |
| Five scoped specialists | 6–24 | Done. `explore`, `worker`, `reviewer`, `debug`, `researcher`, with the exact tool lists the specification names. |
| Normalized identifiers, display names, duplicate reporting | 25–27 | Done. |
| Layered definitions: shipped → global → trusted project | 28, 37 | Done. A project the operator has not trusted contributes nothing. |
| Omission inherits, explicit replaces, null clears, empty stays empty | 29–32 | Done. |
| The body is the standing instructions | 33–34 | Done. |
| Unknown and disabled agents are rejected, never redirected | 36 | Done at both doors. |
| A duplicate identifier is reported to the operator | 27 | Done. The parent is told once per problem, with the two files it has to choose between. |
| Tool inheritance from the parent's active tools | 38–43 | Done. The parent's active tools are captured with the request, so a queued child runs with the selection the request was made under. |
| Fresh conversation except for `debug` | 44 | Done, at both doors: the service door honours the definition's preference when the caller names none. |
| Parent-only orchestration instructions excluded from children | 47 | Partly. The parent's session-resolved layers — its tool surface, its rules, its skills catalogue, its cwd footer — are cut from the child's inherited identity, so the child inherits neither the parent's tool list nor its per-session guidance. What the child still inherits is the harness's base identity and the operator's own words; the latter is story 45's requirement, not an orchestration leak. Narrowing the cut further is outstanding. |
| Request-time capture of the parent's tools | 48 | Done. |
| Background by default, foreground on request | 49 | Done. |

## The model selection

`src/models/` decides which model a child runs on.

| Module | What it owns |
| --- | --- |
| `src/models/identity.ts` | Naming a model exactly: `provider/modelId`, resolved or failed. |
| `src/models/strategy.ts` | How one family's ids are read: the version and the tier. |
| `src/models/profile.ts` | What a profile says, and how a malformed one is refused. |
| `src/models/profiles.ts` | The ladders this package ships. |
| `src/models/router.ts` | The walk: one tier down, then the approved cross-version links. |
| `src/models/selection.ts` | The precedence: the request, then the definition, then the routing. |
| `src/models/user-profiles.ts` | The operator's profiles, read from the settings layers. |

The shipped ladders are written against the model catalogue the installed SDK
ships — a representative registry, not a promise of vendor availability. A tier
the session cannot run is skipped, and the walk continues.

An operator replaces a family whole, in the same settings file the rest of the
runtime uses:

```json
{
  "familyProfiles": {
    "gpt": {
      "versions": [
        {
          "version": "6.1",
          "tiers": [
            {
              "tier": "sol",
              "models": [{ "provider": "openai", "id": "gpt-6.1-sol" }],
              "fallbacks": [{ "version": "6", "tier": "luna" }]
            }
          ]
        }
      ]
    }
  }
}
```

Only data is read: a value the schema does not name is ignored, never
evaluated. A family with no naming structure is refused — the eight shipped
strategies are the structures this package can read.

### What the model selection does now

| Area | Stories | State |
| --- | --- | --- |
| A tool-call model wins over an agent-file model | 55 | Done. |
| An agent-file model wins over the automatic routing | 56 | Done. |
| Explicit choices are exact `provider/modelId` | 57, 58 | Done. No shorthand, no provider fallback, and an unavailable choice is an error rather than a silent fall back. |
| An explicit choice works without a known family | 59 | Done. |
| Routing follows a declared ladder, not a name fragment or a price | 60, 64 | Done. The ladders are profile data; the shipped profiles cover the eight agreed families. |
| Cross-version links are declared, never inferred | 62 | Done. A link names the version and the tier it may cross to. |
| The walk steps down, past a tier the session cannot run | 63 | Done. |
| Routing asks the session what it can run | 65 | Done. The router never invents a provider, a credential, or an id. |
| An unplaceable family is an error | 66 | Done. |
| A family with nothing to offer keeps the parent's model | 67 | Done. |
| The choice is reported | 74 (model half) | Done. The launch note says which model was chosen and why. |
| The reasoning level is chosen after the model | 68–73 | Outstanding — see the table below. |

### Inherited, and covered by the suite

| Area | Stories | Where it is pinned |
| --- | --- | --- |
| User and project standing instructions kept apart from the conversation | 45 | `test/session/prompts.test.ts` — the child's own project context, and the parent's block cut when the child works elsewhere. |
| Tool guidance derived from the child's own tools | 46 | Pi renders each session's guidance from that session's tools, and the child's tool list is the definition's; `test/agents/child-tools.test.ts` pins the tools a real child session holds. |

### Deliberate departures from upstream's shape

Recorded in [adr/](adr/):

- [0004](adr/0004-ship-five-specialists.md) — five specialists replace
  upstream's `general-purpose`, `Explore`, and `Plan`.
- [0005](adr/0005-one-definition-shape.md) — no `prompt_mode`, no `locked`; a
  definition has one prompt shape and the request always wins.
- [0006](adr/0006-background-by-default.md) — the background is the default
  for both doors.

## Inherited behaviour, now characterized

The recovered suite pins the behaviour this derivative must preserve:

| Area | Where it is pinned |
| --- | --- |
| Agent registry, defaults, custom agent files | `test/config/agent-types.test.ts`, `test/config/custom-agents.test.ts` |
| Invocation merge, field locks, background mode | `test/config/invocation-config.test.ts`, `test/config/background-mode.test.ts` |
| Thinking-level validation at the door | `test/config/thinking-level.test.ts` |
| Model resolution and spawn configuration | `test/session/model-resolver.test.ts`, `test/tools/spawn-config.test.ts` |
| Spawn doors (tool and service), background/foreground | `test/tools/agent-tool.test.ts`, `test/service/service-adapter.test.ts`, `test/tools/background-spawner.test.ts`, `test/tools/foreground-runner.test.ts` |
| Lifecycle: sessions, runs, state, budgets, resume | `test/lifecycle/*` |
| Concurrency admission | `test/lifecycle/concurrency-limiter.test.ts` |
| Workspace bracket | `test/lifecycle/workspace-bracket.test.ts` |
| Completion notification and outcome delivery | `test/observation/*` |
| Public record shape and by-value isolation | `test/persisted-record.test.ts` |
| Public service API | `test/service/service.test.ts`, `test/service/service-adapter.test.ts` |
| Prompt assembly, provider inheritance, project context | `test/session/prompts.test.ts`, `test/session/provider-inheritance.test.ts`, `test/session/project-context.test.ts` |
| Composition root wiring | `test/composition-root.test.ts`, `test/print-mode.test.ts` |
| UI: widget, session navigator, transcript, settings | `test/ui/*`, `test/widget-renderer.test.ts` |

## Intentional divergences from upstream

1. **Package identity.** The package is `@code-fixer-23/pi-tiered-subagents`.
   The public service is published under this package's own global symbol
   (`Symbol.for("@code-fixer-23/pi-tiered-subagents:service")`), not the
   upstream one, so the two runtimes cannot overwrite each other's service
   when both are loaded in one session. Pinned by
   `test/service/service.test.ts`. See
   [adr/0001](adr/0001-publish-the-service-under-our-own-identity.md).
2. **The experimental tier-routing patch was not carried into the import.**
   The scaffold's working tree carried an unfinished `src/tier/**` experiment
   (glob/pattern ladder matching with a price-ranked fallback). It did not
   compile, and its design is superseded by the specification, which replaces
   price ranking and user-supplied matchers with family strategies over
   declared profile data. The specified design now exists in `src/models/`.
   See
   [adr/0002](adr/0002-do-not-carry-the-tier-experiment-into-the-import.md).
3. **Platform-portable path expectations.** Two upstream tests asserted
   POSIX-only path strings; they now build expectations with `node:path`, so
   the suite passes on Windows as well as Linux. The runtime behaviour is
   unchanged — `node:path` was always the implementation.
4. **Keybinding expectations follow Pi's current defaults.** The transcript
   pane's footer hints and paging tests now read the bound key from Pi's
   keybinding manager rather than hard-coding Pi 1.0.0's defaults.
5. **The inherited lint rules are scoped to this package.** See
   [adr/0003](adr/0003-scope-the-inherited-lint-rules-to-this-package.md).
6. **The role set, the definition shape, and the background default changed.**
   See [adr/0004](adr/0004-ship-five-specialists.md),
   [adr/0005](adr/0005-one-definition-shape.md), and
   [adr/0006](adr/0006-background-by-default.md).
7. **A model is named exactly, and the fuzzy resolver is gone.** Upstream
   resolved a model name by scoring every model in the registry, so a typo
   could run a different model than the one asked for. A model is now named
   `provider/modelId` and resolved exactly or the launch fails, and a child
   that names no model runs one tier down its parent's ladder. See
   [adr/0007](adr/0007-the-childs-model-is-one-tier-down.md).

## SDK drift found while characterizing (Pi 1.0.0 → 1.3.0)

- `Terminal` gained `setProgramStatus(status)`; the transcript-viewport test's
  terminal double implements it.
- `tui.altScreen.top` / `tui.altScreen.bottom` now default to
  `ctrl+home` / `ctrl+end` (they were `home` / `end`). The transcript pane
  reads the operator's bindings, so it follows Pi automatically — but the
  footer hints no longer fit in an 80-column terminal, and the pane drops them
  there. Pinned by `test/ui/session-navigator.test.ts`.

Of upstream's 2179 tests, 2172 pass unchanged; the other seven needed the
three adaptations above.

### Known consequence of the drift

The transcript pane's footer carries the scroll position and the key hints on
one line. Pi 1.3.0's longer default key names (`Ctrl+Home`/`Ctrl+End` rather
than `Home`/`End`) push the hints past the width of an 80-column terminal, so
the pane drops them there and keeps only the position. The pane follows the
operator's bindings, so an operator who rebinds the keys gets a footer that
fits. Making the hints survive 80 columns is a **presentation** decision the
specification has not settled; it is not a defect in the inherited runtime.

## Outstanding work (owed to SPEC.md)

Nothing in this table is implemented yet — the table lists what the
specification still asks for and this package has not yet delivered. Each item
names the user stories it covers.

| Area | Stories | Notes |
| --- | --- | --- |
| Family profiles, automatic routing, exact explicit model selection | 55–67 | Done — see the model selection above. |
| Reasoning defaults, clamping, not-applicable reporting | 68–74 | The model is chosen first; the reasoning level that follows is still upstream's: the door validates the caller's level and the child otherwise inherits the parent's. |
| Capability-based workspace scheduling | 52–54 | Upstream schedules on a single concurrency limiter, with no exclusive slot for file-changing children. |
| Shared settings backend (`@juanibiapina/pi-extension-settings`) | 75–79 | The runtime still keeps upstream's own JSON settings loader (`src/settings.ts`, `src/layered-settings.ts`), and still exports that loader as `…/settings`. |
| One configuration resolver for both launch doors | 80–82 | Both doors now answer through the same registry and the same precedence, but the resolution itself is still two code paths: the tool door resolves a request, the service door resolves a spawn. |
| Resolved model/thinking facts in the launch and result presentation | 74 | Not surfaced yet. |
| A narrower cut of the inherited identity | 47 | The child's inherited identity still carries the harness's base preamble. Narrowing it is outstanding. |
| A bundled public `.d.ts` | — | The `build` target emits per-file declarations; bundling them (upstream's ADR 0003) is still to do, so another package cannot yet import this one by name. |

## The Pi 1.3.0 upgrade, verified across the workspace

The workspace moved from Pi 0.99.1 to the approved 1.3.0 baseline. Verifying
the whole workspace against it turned up two breakages outside this package,
both fixed here:

- `pi-agent-resource` offered the MCP exposure `codemode-deferred`, which Pi
  1.3.0 removed. The list is now typed against Pi's own `McpExposure`, so an
  exposure Pi drops fails the build instead of producing a config Pi rejects.
- `pi-agent-resource`'s prompt-manager tests asserted the `$EDITOR` fallback
  without clearing `$VISUAL`, which wins over it — they passed on CI and failed
  on any machine with `$VISUAL` set.

`pnpm nx run-many -t check lint test typecheck metadata` is clean for all
eight projects.

## Documentation hygiene

- [SPEC.md](SPEC.md) is the authoritative requirement set.
- [how-it-works.html](how-it-works.html) explains the inherited runtime and
  marks the historical routing proposal as superseded.
- [adr/](adr/) records the decisions adopted for this derivative.
- [architecture/](architecture/) and [decisions/](decisions/) are upstream
  snapshots, kept for provenance. They record upstream's decisions, not this
  derivative's.
