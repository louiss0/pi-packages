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
| Tests | `test/` — 123 test files, including recovered upstream v25.0.1 characterization and local contract coverage |
| Typecheck | `pnpm nx run pi-tiered-subagents:typecheck` — clean, under `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| Test suite | `pnpm nx run pi-tiered-subagents:test` — 2,424 passed, one skipped |

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
| Layered definitions: shipped → global → project | 28, 36, 37 | Done. The project layer is read like the global one; see *Trust is Pi's, not this package's* below. |
| Omission inherits, explicit replaces, null clears, empty stays empty | 29–32 | Done. |
| The body is the standing instructions | 33–34 | Done. |
| Unknown and disabled agents are rejected, never redirected | 36 | Done at both doors. |
| A duplicate identifier is reported to the operator | 27 | Done. The parent is told once per problem, with the two files it has to choose between. |
| Tool inheritance from the parent's active tools | 38–43 | Done. The parent's active tools are captured with the request, so a queued child runs with the selection the request was made under. |
| Fresh conversation except for `debug` | 44 | Done, at both doors: the service door honours the definition's preference when the caller names none. |
| Parent-only orchestration instructions excluded from children | 47 | Done. The parent's session-resolved layers — its tool surface, its rules, its skills catalogue, its cwd footer — and the harness's own base identity and documentation pointer are cut from the child's inherited identity, so the child inherits neither the parent's tools, per-session guidance, nor the harness's role. The operator's and the project's own words stay, and the package's own base stands in the gap; the parent's orchestration instructions therefore never reach a child through the adopted identity. See [adr/0011](adr/0011-the-harness-own-text-is-not-inherited.md) and [adr/0005](../decisions/0005-subagent-record-admission-policy.md). |
| Request-time capture of the parent's tools | 48 | Done. |
| Background by default, foreground on request | 49 | Done. |

### Trust is Pi's, not this package's

The extension used to ask Pi whether the project was trusted, and a project it
had not blessed contributed nothing — definitions, the project settings layer,
and the profiles inside it. That was this package's second trust gate, and it
was both redundant and wrong: the operator decides which projects Pi loads
extensions into, so a project that got this extension loaded has already been
blessed, and an untrusted project cannot get the extension loaded in the first
place.

The check, its inputs, and its rejection path are gone. The project layer is
read on its own terms, exactly as the global layer is. Nothing about the
project's configuration becomes reachable that Pi had not already decided was
reachable.

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

The profiles live in the runtime's settings file, which the settings module
owns: it merges the global and project layers per family, reads the project
layer only when the project is trusted, and round-trips the profiles so a
`/subagents:settings` edit does not erase them. The model domain reads the
data and validates it; it never touches a file of its own.

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

## The reasoning selection

`src/thinking/resolve.ts` decides the level a child reasons at, once its model
is known.

| Rule | Stories | State |
| --- | --- | --- |
| Automatic defaults: medium, then low, then the lowest supported non-off | 68 | Done. The supported levels come from Pi's own report about the model, not from its name. |
| The retained-parent fallback never raises the effort | 69 | Done. Medium or low are taken only when they are below the effort the parent was running at; otherwise a supported level below it; otherwise the parent's effort stands. |
| The request's level wins over the definition's | 70 | Done. |
| An unsupported level is clamped, never rejected | 71 | Done. The clamp is Pi's own, so the runtime cannot disagree with Pi about a level, and it never lands on "off" for a reasoning model. |
| A model that does not reason is still usable | 72 | Done. |
| The level is discarded for a model that does not reason | 73 | Done. The launch reports *not applicable* rather than a level that was never applied. |
| The choice is reported | 74 (thinking half) | Done. A clamp and a not-applicable level both appear in the launch note. |
| An explicit "off" is refused on a model that reasons | 71 | Done. The lowest level the model supports takes its place, and the launch says so. |

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

## The shared settings backend

`src/shared-settings.ts` is the only place this package talks to
`@juanibiapina/pi-extension-settings`; the settings module above it speaks in
the package's own vocabulary.

| Rule | Stories | State |
| --- | --- | --- |
| The shared store holds the operational settings and the family profiles | 75 | Done. The settings live in the store's two files — the operator's and the project's — under this package's name. This package keeps no settings file of its own. |
| A project overrides one family without discarding the others | 76 | Done. The two files are read on their own, and the profiles merge per family. |
| A named profile is replaced as a whole | 77 | Done. A family in the project's file replaces that family's profile entirely; nothing is merged into it. |
| A profile is added with the shipped schema | 78 | Done. A profile is data: the same schema the shipped profiles use, validated by the model domain. |
| Profiles are data, never code | 79 | Done. The schema names what a profile may contain; a value it does not name is ignored, never evaluated. |

The store holds strings, so the adapter is the one place that serializes: the
family profiles, the excluded packages, and the prompt-inheritance map are
JSON in a single setting. The store's own project scope falls back to the
operator's file, so the adapter reads each file on its own: the operational
settings merge per setting, the project's over the operator's, and the family
profiles merge per family, so a project replaces one family and leaves the
operator's others alone.

A save writes the project's own layer. The operator's data — the families, the
excluded packages, the inheritance rules — stays in the operator's file, where
a later change to it still reaches the project; a value the project's file
does not declare is not written at all, so the operator's value stays in
force. The project's file is only read when Pi has granted the project trust,
and an unread project's file is left alone rather than written empty.

The store is also an extension, offering a `/extension-settings` menu. This
package publishes its settings to that menu when it loads; the shared
extension has to be loaded first for the menu to know them. Without it the
settings are still read and written — only the menu is missing.

The settings *moved*: `subagents.json` is no longer read. A hand-edited file
stays where it is; nothing is migrated automatically.

Recorded in [adr/0010](adr/0010-the-settings-live-in-the-shared-store.md).

## The workspace scheduling

`src/scheduling/` decides what a child may change; the manager admits the
child according to that decision.

| Rule | Stories | State |
| --- | --- | --- |
| One child at a time may change the workspace | 52 | Done. A child that may change files holds the workspace's exclusive slot for its run; children that only read run alongside it. The slot belongs to the working directory the request was made in, so two parents in one directory share it. |
| The classification follows the tools, not the role | 53 | Done. The child's effective tools — the definition's selection against the parent's active tools as they were when the request was made — decide, so an override cannot slip past the rule. The names travel with the child, so the runtime and the child cannot disagree. |
| A shell and an unknown tool count as writers | 54 | Done. Only the tools this package knows to be read-only (the local readers and the web search) are read-only; everything else takes the slot. |

The rule is a scheduling promise between this runtime's children, not a
sandbox: it does not coordinate the parent's own edits, another process in the
same directory, or what a reader sees while a writer works. A foreground
child takes the same slot a background one does, and waits for it. The slot is
taken when the child is about to run, so a child waiting for a concurrency slot
holds none. A child aborted while waiting never runs and never holds the slot,
and a resume takes the same slot, because a resumed child reuses the tools it
was spawned with.

A child that works in a prepared directory of its own — a worktree from a
workspace provider — is classified by the tools it has, but shares the slot of
the directory the request was made in: the prepared directory is not known
when the request is made.

Recorded in [adr/0009](adr/0009-one-child-at-a-time-may-change-the-workspace.md).

## The turn policy

`src/lifecycle/turn-limits.ts` decides how many turns a child gets, once, before
any session exists.

The request, the definition, and the operator's settings are reconciled into one
value at launch and never re-decided. That value is a closed union rather than a
number with a sentinel:

| Variant | What it means |
| --- | --- |
| `{ kind: "limited", maxTurns, wrapUpTurns }` | A ceiling and the wrap-up allowance that goes with it. |
| `{ kind: "unlimited" }` | A deliberate unlimited request — distinct from a request that said nothing. |

Three things follow from making it a union rather than a number. A deliberately
unlimited request cannot be accidentally limited further downstream, because
there is no downstream step that reads a number. The wrap-up allowance is
carried with the ceiling instead of being looked up again at the session, so a
child that waits in the queue still enforces the policy it was accepted under. And
the default budget is applied once, at launch: changing the operator's setting
later affects the next launch, not a child that is already accepted.

A resumed child keeps the policy its launch captured, and gets a fresh turn
counter under it.

## One concurrency cap for every run

The concurrency limit is one admission rule for every initial and resumed run.
The public `bypassQueue` exemption is gone: a foreground child used to be able
to run past the cap, which meant the cap said nothing reliable about how many
children ran at once — and a foreground run is exactly the one a user is waiting
on, so it was the run most likely to be miscounted.

Removing it is a breaking change to the public service surface, and it is the
honest reading of the setting: the operator sets a cap, and every child respects
it.

## The type system as a seam

`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on across `src/`
and `test/`. Neither was satisfied by widening, by a non-null assertion, or by
relaxing a type: an indexed read that can miss now handles the miss, and a
producer that meant to leave a field out has to leave it out rather than write
`undefined` into it.

That distinction is not decoration. The specification's layering vocabulary
depends on it — absent means inherit, a value means replace, `null` means clear,
and an empty list means empty — and a codebase that cannot tell those apart in
the type system will eventually confuse them at runtime. `src/optional.ts` holds
the vocabulary so that distinction is written once:

| Helper | For |
| --- | --- |
| `defined(fields)` | A producer assembling a strict shape. Filters the undecided entries out, and keeps the keys that cannot be undefined required. |
| `Patch<T>` | An override bag, where "said nothing" and "said: no value" are the same instruction. |
| `merge(defaults, patch)` | A fixture whose target admits an explicit undefined, so a test can *clear* a defaulted field rather than override it. |

The read-view interfaces — a widget row, a tool result's details, a report —
take the opposite position and accept an explicit `undefined` on their optional
fields. For those, "the getter returned nothing" and "the field is not there" are
the same fact, and making the type say otherwise would be inventing a
distinction the runtime does not make.

### Modern APIs and verification seams

External definition files now cross one total validation seam. Malformed YAML,
non-mapping frontmatter, and invalid recognized values diagnose the file or
field without aborting unrelated definitions or silently treating invalid input
as absence. Authoritative tool and service launches use the asynchronous,
signal-aware definition loader; the synchronous registry loader remains a
legacy listing/internal compatibility path and has not been expanded into the
new launch architecture.

Explicit resource management was adopted only after a real Pi-loader probe.
The installed jiti pipeline, TypeScript configuration, and Vitest transform all
load and dispose `using` / `await using` scopes correctly. `promptForAnswer`
uses that syntax for its genuinely lexical subscriptions and listeners;
session-lifetime teardown remains explicit and awaited. `ESNext.Disposable` is
a type library only — the supported Node runtime supplies the symbols.

The three model-facing tools declare TypeBox `outputSchema`s and return matching
`structuredContent`; terminal `content` and UI `details` remain separate. Real
offline SDK coverage loads the extension, inspects active registered tools,
executes accepted and expected-rejected results, and exercises codemode without
credentials or network access. The SDK adapter reads public model fields rather
than concrete implementation details.

`ChildSession` is now a package-owned contract, with a controllable test adapter
that can pause creation, settle, fail, steer, cancel, and dispose deterministically.
High-value launch, run, resume, cancellation, claiming, and turn-budget tests
cross the public `Subagents` interface. UI tests consume owned views/actions,
and architecture tests enforce dependency direction instead of concrete class
shape. Verification runs through the package's Nx targets.

### The typecheck script

`scripts/typecheck.mjs` runs `tsc` and then reads what it says. `tsc`
type-checks everything in the program, and the program includes whatever an
import reaches: `@juanibiapina/pi-extension-settings` ships raw `.ts` sources
with no `.d.ts`, so twelve diagnostics inside it are compiled as part of ours and
`skipLibCheck` — declaration files only — does not reach them.

The script partitions the diagnostics. One naming a file in this package fails
the build; one naming a file under `node_modules` is reported and counted, so a
dependency that grows new ones is visible here rather than silently absorbed.
`tsconfig.json` keeps `skipLibCheck` and does not name the dependency — the split
lives in the script, where it can be read.

## Inherited behaviour, now characterized

The recovered suite pins the behaviour this derivative must preserve:

| Area | Where it is pinned |
| --- | --- |
| Agent registry, defaults, custom agent files | `test/config/agent-types.test.ts`, `test/config/custom-agents.test.ts` |
| Invocation merge, field locks, background mode | `test/config/invocation-config.test.ts`, `test/config/background-mode.test.ts` |
| Thinking-level validation at the door | `test/config/thinking-level.test.ts` |
| Model resolution and spawn configuration | `test/models/selection.test.ts`, `test/models/router.test.ts`, `test/agents/launch-seams.test.ts`, `test/tools/spawn-config.test.ts` |
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
8. **The reasoning level is chosen after the model, from what the model
   supports.** Upstream took the caller's level or the parent's, and never
   looked at the model. The level now follows the model: Pi's own report of
   what the model supports decides, an unsupported request is clamped the way
   Pi clamps it, and a model that does not reason gets no level at all. See
   [adr/0008](adr/0008-the-reasoning-level-follows-the-model.md).
9. **The harness's own text is not inherited.** A child used to adopt the
   parent's identity byte for byte, and that identity began with Pi's base
   claim — an assistant with a shell and an editor, helping a user. A child
   is a specialist with its own tool list, so Pi's base identity, its tool
   surface, and its documentation pointer now stay with the parent session,
   and the operator's own prompt is what a child adopts. See
   [adr/0011](adr/0011-the-harness-own-text-is-not-inherited.md).
10. **This extension has no trust gate of its own.** Project definitions and
    the project settings layer used to be skipped unless the extension asked
    Pi and Pi said yes. That gate is gone — see *Trust is Pi's, not this
    package's* above. ARCHITECTURE-SPEC stories 36–37.
11. **A foreground child is subject to the concurrency cap.** The public
    `bypassQueue` exemption is removed, so one cap governs every initial and
    resumed run. ARCHITECTURE-SPEC story 68.
12. **The turn budget is one closed policy, resolved once.** `maxTurns` and
    the wrap-up allowance are reconciled at launch into a `limited` /
    `unlimited` union that no later step re-reads. ARCHITECTURE-SPEC stories
    51–55.
13. **Both strict optional-property flags are on.** Nothing was widened or
    asserted to make them pass; `src/optional.ts` holds the vocabulary that
    makes omission expressible. See *The type system as a seam* above.
    ARCHITECTURE-SPEC stories 104–105.

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

This table lists what the specification asked for and where each item stands.
The rows marked *Done* point at the section above that describes them; the
rest is what the specification still asks for and this package has not yet
delivered. Each item names the user stories it covers.

| Area | Stories | Notes |
| --- | --- | --- |
| Family profiles, automatic routing, exact explicit model selection | 55–67 | Done — see the model selection above. |
| Reasoning defaults, clamping, not-applicable reporting | 68–74 | Done — see the reasoning selection above. |
| Capability-based workspace scheduling | 52–54 | Done — see the workspace scheduling above. |
| Shared settings backend (`@juanibiapina/pi-extension-settings`) | 75–79 | Done — see the shared settings backend above. The inherited generic loader (`loadLayeredSettings`) is still exported for other packages, but it is no longer this package's backend. |
| One configuration resolver for both launch doors | 80–82 | Done — the whole launch, the definition merge through the model and reasoning level, is resolved by one resolver (`src/agents/resolver.ts`), so the two doors cannot drift apart on a launch. The rest of a launch — the tool selection and the context assembly that follows a resolved launch — is still per door. |
| The routing reason in the service door's record | 74 | Done — the record now carries the resolved model decision (source and reason) and the reasoning decision (applicability, source, clamping, and reason), for spawns from either door. |
| A narrower cut of the inherited identity | 47 | Done. Pi's base identity, its tool surface, and its documentation pointer are not inherited; the operator's own prompt is, and the package's own base stands in the gap. See [adr/0011](adr/0011-the-harness-own-text-is-not-inherited.md). |
| A bundled public `.d.ts` | — | Settled as *not adopted*: the source-ship model keeps the public surface served from TypeScript source (`exports["."].default` → `./src/service/service.ts`) and ships no build step at all — declarations are not emitted, and Pi compiles the TypeScript rather than a declarations bundle being built. Bundling was set aside. Another package can import the surface by name once a consumer needs it. |

### From ARCHITECTURE-SPEC.md

`ARCHITECTURE-SPEC.md` supersedes `SPEC.md` where the two disagree. It also
records the maintainer's story-92 clarification that UI remains an internal
module. Delivery is incremental, as recorded below. The story numbers are
ARCHITECTURE-SPEC's own.

| Area | Stories | State |
| --- | --- | --- |
| Extension-owned trust gating removed | 36, 37 | Done — see *Trust is Pi's, not this package's*. |
| Public queue-bypass exemption removed | 68 | Done — see *One concurrency cap for every run*. |
| Turn budget resolved once into a closed policy | 51–55 | Done — see *The turn policy*. |
| `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled | 104, 105 | Done — see *The type system as a seam*. |
| One authoritative preparation authority for both doors | 10–23 | Done — see *One preparation authority*. Selection, thinking validation, turn-default capture, child-shaping capture, model identity, the final reasoning decision, active tools, and registered tool names all feed one session-scoped preparation/acceptance seam. Preparation is asynchronous with a per-request immutable definition catalog, and every parent input is captured before the first await (single `captureLaunchInputs()` — snapshot + conversation + session identity). Both doors carry the same exact expanded capability allowlist; accepted and queued launches hold no SDK model object or registry. Launch signals cancel preparation and detach at acceptance; run signals keep ownership of the accepted work. Session-ended-during-preparation is refused with `"session-ended"` before acceptance (story 85). |
| Deliberate breaking launch API | 60–66, 76 | Done — the inherited synchronous `spawn(): string` and the ambiguous `foreground` option are removed. `SubagentsService.launch()` resolves discriminated accepted/rejected results without waiting for a slot or SDK session; `run()` shares preparation and settles with a claimed by-value record. Expected failures are values; defects still reject. |
| Launch/run signal ownership | 77–78, 80 | Done — `launch` cancels preparation before acceptance and detaches after it (later cancellation is `abort(id)`); `run` cancels preparation and stops the queued or running child it owns. |
| Model, reasoning, and capability decisions captured as owned values | 38–50 | Done — parent/child models are owned `{provider,id}` identities; reasoning is resolved through the SDK adapter (`src/agents/sdk-adapter.ts`) that localizes SDK availability/reasoning details (story 41) with tested contracts (`adapter` interface, `SupportedLevels`, `Clamp`, `CanReason`, `Identity`). Active tools and registered parent tool names are copied with the request; scheduling and child creation use the same allowlist. Child creation fails explicitly if unavailable (story 42). Remaining: formal SDK adapter test surface (story 41 complete — covered by `test/agents/sdk-adapter.test.ts`). |
| Child-shaping settings captured; operational settings live | 56, 57 | Done — see *One preparation authority*. Mid-run updates, the exclusion list, and prompt inheritance are captured and copied at preparation; concurrency, retention, and interrupt policy stay live. |
| Async programmatic launch, explicit run, shared resume | 60–66 | Done — `launch()` (accepts into background) and `run()` (prepares and settles with a claimed by-value record); the inherited synchronous `spawn()` and `foreground` option removed (stories 60–66, 76). |
| Cancellation, delivery, and lifetime | 77–91 | Done — see *Session ownership*. Launch/run/wait signals retain distinct ownership; confirmed replacement closes acceptance, suppresses delivery, cancels, awaits bounded and idempotent child cleanup, then installs the next owner. Fast foreground completion cannot outrun its claim; waits retain the run they began observing; stopped records remain persisted/queryable; old-session nudges are suppressed without changing the notification protocol. |
| Terminal presentation isolated in an internal UI module | 92 | Done under the maintainer's clarified requirement: `src/ui/` remains inside this project, not a separate workspace/npm package. It now owns tool-call/result rendering as well as widgets, transcript/settings views, notifications, and presentation helpers. Runtime adapters supply structural views/readers; no execution module imports `pi-tui`. |
| Runtime-owned UI loading and registration | 93 | Done. The runtime entry alone loads the internal UI module and registers its message/tool renderers and settings/transcript commands. `test/ui-registration.test.ts` loads the real source entry with Pi's public loader, exercises those registrations through its runner, and requires no second extension or model request. Existing composition-root widget tests cover activation and teardown. |
| Presentation contracts and independence | 94 | Done — UI dependency guard (`pi-tiered-subagents/ui-boundary` ESLint rule + `test/ui-dependency-rule.test.ts`) enforces that `src/ui/` imports only owned contracts (`#src/ui/*`, `src/optional`) and rejects any target outside presentation (execution modules, `extensions/`, SDK runtime APIs). Existing architecture checks (`presentation-boundary.test.ts`) cover dependency direction, and the new rule catches relative/alias/absolute/dynamic imports with TypeScript path resolution. The narrow UI-owned view/action contracts (`view-types.ts`: `ModelIdentity`, `AgentDefinitionView`, `AgentDefinitionLookup`, `TurnBudget`, `WidgetAgent`, `WidgetSource`, `AgentStatus`) are testable independently without a live manager or SDK child. No separate workspace package or independent extension needed. |
| Widget, transcript viewer, and settings views preserved | 96 | Done — 240 UI tests confirm view integrity after extraction. |
| Tool-result and notification renderers consolidated | 97 | Done — all renderers (`agent-tool-renderer`, `get-result-tool-renderer`, `notification-renderer`) live in `src/ui/`; runtime registration and tool definitions live in `src/tools/` and `src/observation/`. |
| Transcript reading behind focused adapter | 98 | Done — `transcript-adapter.ts` exposes `TranscriptSource` (`getMessages`, `subscribe`, `getToolDefinition`), never a live child session. |
| UI consumers do not affect execution | 99 | Done — presentation modules only consume UI-owned contracts (`display.ts`, `view-types.ts`); they call narrow settings actions and never influence execution decisions. |
| Model-facing text / terminal rendering separate | 100 | Done — `outcome-delivery.ts` provides pure model-facing text formatting; `src/ui/` handles terminal rendering. No execution dependency on UI module. |
| Further TypeScript and API modernization | 101–117 | Done — discriminated unions, literal-preserving tables, copied readonly values, strict indexed/optional semantics, total external-data validation, asynchronous launch I/O, ownership-correct cancellation, loader-verified lexical disposal, typed structured tool outputs, public SDK adapters, `Subagents`-seam tests, a controllable `ChildSession`, real offline SDK checks, owned UI contracts, behavioral architecture checks, and Nx-target verification are in place. |
| Independent ownership and migration cleanup | — | Not started. |

## Terminal presentation module

The maintainer clarified story 92 during implementation: presentation is a
separate **module in this project**, not a separate package. `src/ui/index.ts`
is its presentation entry point, and `src/ui/README.md` describes the boundary.
There is no UI workspace project, npm dependency, or independently enabled
extension.

The tool renderers formerly under `src/tools/` and the inline `Text` construction
in the two tools now live with the widget, transcript viewer, settings views,
and notification renderers. The extension root still owns Pi registration.
Widget projection and persisted/live transcript adaptation live in
`src/presentation/`; the UI consumes narrow structural contracts rather than
an execution manager or child session. Persisted transcript reads use an
injected asynchronous reader.

Presentation tests use those contracts, while runtime-specific background
filtering and live-transcript forwarding remain covered at the adapters.
`test/presentation-boundary.test.ts` checks dependency direction, and ESLint
prohibits `pi-tui` imports outside the UI module and execution imports inside it.
This is structural separation, not a redesign of workflows or delivery policy.

Verified after extraction with daemon-disabled workspace Nx targets:
`pnpm nx run-many -t test typecheck lint check metadata` passed for all eight
projects. The runtime suite passed 106 files (2,314 passed, one skipped). Its
existing typecheck wrapper still reports and excludes the 12 diagnostics in the
third-party settings package; no new exclusions were added. Standards and spec
reviews were completed, with their findings addressed and rechecked.

### Runtime-owned UI registration (story 93)

The wiring shipped with story 92; story 93 adds a real offline SDK contract
check rather than rewriting already-working registration. Loading only
`extensions/index.ts` through Pi's public source loader produces working
completion, update, workspace-notice, tool-call/result, settings, and transcript
registrations. The commands are invoked using Pi's own command contexts;
recorded UI transport methods observe the menus without mocking this project's
UI module or factory. The widget's session activation and teardown are already
pinned by the composition-root suite.

The loader fixture isolates both the SDK discovery directories and the
extension's own cwd/agent-directory settings lookup. It makes no model request,
disables model-catalog network refresh, awaits shutdown, checks runner-reported
errors, invalidates the runtime, and removes its temporary files. A deliberate
omission of completion-renderer registration failed the new suite; restoring
it returned all seven cases to green. This proves registration sensitivity,
not that a pre-existing product defect was repaired.

After story 93, daemon-disabled
`pnpm nx run-many -t test typecheck lint check metadata` passed across all eight
projects. The runtime suite passed 107 files (2,321 passed, one skipped).
Standards review found no documented breaches (one optional test-boilerplate
cleanup suggestion); spec review found no actionable issues. No production
registration code needed to change in this increment.

## Session ownership

A launch is no longer accepted by whoever happens to hold the manager. Every
request carries a `SessionOwner` token — a generation and the session id Pi
shows the operator — and the manager accepts it only while that token names
the live session. The generation is the identity; the id is only the name. A
session that restarts with the same id still gets a fresh generation, so a
token prepared before a restart can never be accepted after it.

Refusal is a value, not an exception. `LaunchOutcome` separates "accepted"
from "rejected", and `LaunchRejection` names why. Both doors — the tool
door (`src/tools/`) and the service door (`src/service/`) — stamp the same
token shape on every launch, and translate the rejection into their own
message.

The switch handshake is three calls, because "switching" is not one moment:

- `beginOwnerEnd` stops accepting new launches and leaves running children
  alone — Pi may still abandon the switch.
- `beginOwner` on the same id restores the session; the existing children
  keep running.
- `beginOwner` on a different id is the switch taking effect; only then are
  the previous session's children cancelled.

Confirmed owner transitions are serialized in lifecycle call order while
acceptance closes synchronously. Cleanup suppresses old notification delivery,
cancels owned runs, awaits every child disposal with sibling fault isolation,
and only then exposes the replacement owner. Repeated or concurrent cleanup
shares one promise. Child shutdown has an enforced time bound; SDK disposal
still runs when a shutdown handler hangs, rejects, or throws.

`endOwner` is shutdown: refuse, then cancel and await disposal. Resume is
refused with `stale-session` for a child a later session did not ask for, even
when the id is known and the child is otherwise resumable. Foreground delivery
claims are established before execution can settle, and result waits retain the
specific run they began observing across a concurrent resume. Stopped outcomes
remain persisted/queryable while old-session nudges stay suppressed.

Characterization and integration tests pin abandoned switches, overlapping
owner transitions, cleanup ordering/idempotence, bounded shutdown, notification
suppression/persistence, fast completion claims, and resume/wait races.

The new `src/lifecycle/session-owner.ts` is the only file the manager,
the lifecycle handlers, and the two doors all import from, so a future
`Subagents` module can take this seam over without rippling through them.

## One preparation authority

A request is prepared once, no matter which door it arrives through.
`src/agents/launch-preparer.ts` is the authority: it refreshes the file
layers, selects the definition, validates the caller's thinking level,
and captures the operator turn defaults and parent model facts with the
request. Selection is honest — an unknown id and a disabled id are
distinct rejections, never a substitute role, so a programmatic typo
can no longer become a synthetic shipped definition.

`src/service/subagents.ts` is the session-scoped seam both doors use:
capture the owner, prepare, capture the parent snapshot and session
identity, then accept into the manager. The tool adapter and the
service adapter translate their own vocabulary into one request and
consume the same prepared value; neither reads the registry, settings,
or model facts on its own.

The selected definition is copied at preparation and travels with the
launch into execution. The manager prefers a door-supplied definition
(internal callers without one keep the manager's own checked path),
and the session assembler builds the child's prompt and tools from the
captured definition rather than reselecting from mutable registry
state. Disabling or editing a definition after a launch is prepared
changes future requests only.

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
