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
| Runtime code | `src/` — 73 files, 13.7k lines |
| Extension entry | `extensions/index.ts` — the composition root that Pi loads |
| Tests | `test/` — 88 test files and 17 helpers, recovered from upstream v25.0.1 and adapted |
| Typecheck | `pnpm nx run pi-tiered-subagents:typecheck` — clean |
| Test suite | `pnpm nx run pi-tiered-subagents:test` — 2181 tests, all passing |

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
   declared profile data. The runtime is therefore back to upstream's model
   resolution until the specified design is implemented. See
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

Nothing in this table is implemented yet. Each item names the user stories it
covers.

| Area | Stories | Notes |
| --- | --- | --- |
| Five scoped specialists (`explore`, `worker`, `reviewer`, `debug`, `researcher`) | 6–24 | The registry still ships upstream's `general-purpose`, `Explore`, `Plan`. |
| Layered agent definitions, `inherit` tool selection, unknown/disabled rejection | 25–42, 45–47 | Upstream's registry replaces definitions wholesale and resolves unknown types to `general-purpose`. |
| Family profiles, automatic routing, exact explicit model selection | 55–67 | New domain; the removed `src/tier/**` experiment is not a starting point. |
| Reasoning defaults, clamping, not-applicable reporting | 68–74 | Upstream validates the level at the door and otherwise inherits the parent's. |
| Request-time snapshots, capability-based workspace scheduling | 48, 52–54 | Upstream captures a parent snapshot but schedules on a single concurrency limiter. |
| Shared settings backend (`@juanibiapina/pi-extension-settings`) | 75–79 | The runtime still keeps upstream's own JSON settings loader (`src/settings.ts`, `src/layered-settings.ts`), and still exports that loader as `…/settings`. |
| Shared configuration resolver for both launch doors | 80–82 | The two doors still resolve separately. |
| Resolved model/thinking facts in the launch and result presentation | 74 | Not surfaced yet. |
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
