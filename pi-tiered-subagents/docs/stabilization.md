# SDK integration stabilization

## Scope and decision

The maintainer approved test-first stabilization against the installed Pi 1.3.0
SDK. Keep the current architecture and dependency baseline initially. Do not
publish, upgrade the SDK, or undertake a broad rewrite as part of this plan.

An SDK integration mismatch is a difference between the behavior this extension
assumes and the behavior the installed SDK actually provides. This is not a
claim that the SDK itself is defective. The project glossary remains
[GLOSSARY.md](../GLOSSARY.md); this document records work and evidence, not new
domain terminology.

**Safety rule:** fail closed when a requested capability configuration cannot be
enforced faithfully. Reject it with a clear explanation rather than silently
granting broader permissions. Do not disable MCP or codemode wholesale when a
supported configuration can be enforced.

## Approved test boundaries

| Boundary | Observable guarantee |
| --- | --- |
| Production child construction and real SDK tool invocation | Allowed tools work and forbidden tools cannot execute, including nested codemode calls and after registry refresh. |
| Real SDK session switching and public delegation API | A vetoed switch leaves delegation, results, and resumable children usable. |
| Parent service discovery during child extension loading/disposal | Children cannot replace or delete the parent's published service. |
| Public launch/run/cancellation/shutdown | Queued cancellation settles without unrelated capacity being released; late-created resources are cleaned up. |

## Execution method

Work one vertical slice at a time:

1. Reproduce one reviewed failure at an approved boundary.
2. Run the regression through Nx and record the failing behavior.
3. Make the smallest coherent production fix.
4. Run the same regression and relevant neighboring tests.
5. Record the actual evidence, limitations, and remaining work.

A source-traced concern is not a newly reproduced defect. A mocked collaborator
or synthetic event sequence does not establish compatibility with actual SDK
behavior. Inspecting active tool names is not proof that forbidden calls are
unreachable. No credentials or network model requests are required for the
initial offline capability checks.

## Work queue

These are investigation and regression targets, not claims of completed fixes.

1. **Capability enforcement:** exact child permissions through the production
   SDK adapter, including wildcard interpretation and nested MCP access.
2. **Vetoed switching:** follow the SDK's actual cancellation event sequence;
   preserve the existing owner and its queryable/resumable children.
3. **Service publication ownership:** exercise child extension initialization
   and disposal without corrupting the parent's discoverable service.
4. **Cancellation and resource lifetime:** queued run cancellation, shutdown
   during child construction/provisioning, and exactly-once late cleanup.
5. **Remaining review concerns:** invalid/duplicate definition rejection,
   cancellation during loading and at acceptance, run-associated foreground
   outcomes, copied routing inputs, and honest tool rejection signaling.
6. **Release checks:** packed installation outside this workspace, public
   exports, declared minimum Node runtime, and complete workspace verification.

## First slice: concrete child capability enforcement

Implemented and verified:

- Child construction supplies persistent SDK exclusions for the MCP namespace
  when no concrete server tool was selected, and excludes unlisted MCP resource
  tools. Explicitly selected server tools remain usable.
- Supported MCP patterns still expand against captured names. Remaining SDK
  wildcard or leading `+`/`-` selection syntax rejects before acceptance with
  the existing `configuration` reason; child construction also guards this
  boundary defensively.
- Real SDK direct and QuickJS nested calls exercise allowed ordinary/server-MCP
  tools and forbidden MCP/resource tools before and after registry refresh.
  Forbidden fixture execution counters must remain untouched.

Red evidence: an unlisted MCP fixture executed through codemode before the fix;
unsafe selections also constructed children, and public launches using `*`,
`+codemode`, or `-write` were accepted. The corresponding regressions now pass.

Verification after the fix:

- Focused Nx tests: five files, 76 tests passed.
- Full uncached Nx package test target: 124 files, 2,433 tests passed, one skipped.
- Nx typecheck passed with the existing third-party diagnostics exclusions;
  lint, formatting, metadata, and `git diff --check` passed.
- An independent source review found no blocking issue in this slice.

Scope limitations: external model responses are substituted to keep the SDK
checks offline, while SDK dispatch, extension binding, registry refresh, and
QuickJS execute for real. MCP fixtures are extension registrations, not a live
MCP transport. A positive resource-only server integration remains unverified:
the reserved resource names load the real builtin MCP extension, making a
synthetic same-name fixture unsuitable for that positive test. No SDK upgrade,
lifecycle repair, packed-install check, or release approval is implied.

## Second slice: vetoed SDK session switching

The tentative `session_before_switch` handler no longer closes launch acceptance
or clears retained children. Pi 1.3.0 returns from a veto without a restorative
start event. Confirmed replacements continue to use `session_shutdown` for owned
cleanup and the replacement's `session_start` for initialization; the manager's
explicit owner-transition APIs remain unchanged.

Red evidence: with the old handler, a real `AgentSessionRuntime.newSession()`
veto left the public service's next launch rejected instead of accepted. The
regression loads the package and a veto extension through the real SDK loader;
it does not synthesize a recovery event. It now checks the same published
service, an unchanged terminal record seeded before the veto, and a successful
post-veto acceptance.

Verification:

- Focused lifecycle/ownership/SDK checks: three files, 24 tests passed before the
  final retained-terminal-record assertion was strengthened.
- Full uncached package suite after the final assertion change: 125 files,
  2,433 tests passed, one skipped. The final SDK regression also passed alone.
- Nx typecheck passed with the existing third-party exclusions. Package lint,
  formatting, metadata, and diff whitespace checks passed.
- Independent Luna source review found no production blocker in the minimal
  hook change and requested the strengthened retained-record assertion.

Limitations: the fixture establishes real SDK loading, veto sequencing, launch
acceptance, and terminal-record retention. Its offline child produces an error
outcome; it does not prove successful child execution/resume. Real successful
resume, active-child preservation, and confirmed replacement through this SDK
fixture remain integration-test follow-ups. Existing lower-level ownership
checks are not substitutes for those end-to-end cases. No service-publication,
queued-cancellation, or late-construction defect is claimed fixed here.

## Evidence baseline

Before stabilization, the package passed 123 test files: 2,424 tests passed and
one case-sensitive filename test was skipped on Windows. Its lint, formatting,
metadata, and typecheck targets passed. The typecheck wrapper explicitly
excludes 12 diagnostics from the third-party settings package. Workspace Nx
verification passed the applicable test/typecheck/lint/check/metadata targets
across eight projects.

That baseline does not establish the boundary guarantees above. Prior completion
statements in [status.md](status.md) describe implementation history and must
not be read as release approval while these regressions remain unresolved.

## Third slice: service-publication ownership

Implemented against the installed Pi 1.3.0 SDK without changing ordinary
last-publisher-wins publication semantics.

Red evidence: production `createSubagentSession` with this package's source
extension in the real SDK loader's `additionalExtensionPaths` replaced a
previously published parent service before any model prompt. Accessor-only
checks were supplemental, not the SDK compatibility evidence.

The SDK applies `extensionsOverride` after executing factories. The attempted
post-load filter was discarded: it cannot prevent publication or resource
allocation and could orphan cleanup. No global save/restore workaround remains.

Implementation:

- An explicit `AsyncLocalStorage` child-discovery scope is shared across host
  and SDK source-loader module copies using a package-specific symbol.
- The child loader's `reload` runs inside that scope for its entire lifetime,
  including later SDK reloads. This package's factory returns immediately in
  that scope, before constructing or publishing a runtime. Other extensions
  continue loading normally; no package, MCP, or capability filter was added.
- Legitimate parents publish on `session_start`, not factory discovery.
- Root cleanup supplies its exact service identity to
  `unpublishSubagentsService(owner?)`. Stale cleanup cannot delete a newer
  publisher. The no-argument form remains compatible, and ordinary publication
  still replaces the current service.

Verification:

- Real SDK integration checks preserve parent identity through child factory
  loading, startup, SDK reload, and disposal. An unrelated inherited extension's
  factory and lifecycle handlers run as positive controls. Existing direct and
  nested capability/MCP tests remain green.
- A real source-loaded parent publishes only on startup; its shutdown preserves
  a newer publisher. Scope tests cover overlapping child work, independent
  caller isolation, and restoration after rejected loading.
- Expanded focused checks passed: 33 tests and one Windows skip before the
  reload/scope checks were added. Final targeted reload/scope/UI-rule run passed
  all 12 tests.
- Final uncached full package suite: **126 files passed; 2,439 tests passed,
  one skipped**. An earlier complete run had a UI dependency-rule test timeout;
  it passed focused and the full rerun passed without changing the timeout.
- Final Nx typecheck, lint, and formatting check passed. Typecheck retains the
  existing exclusion of 12 third-party settings diagnostics per configuration.

Limitations: the parent identity in the child regression is a published
sentinel; legitimate parent source loading is verified separately. There are
no network model calls in the publication tests. This is a cooperative
package-owned loading scope, not a sandbox or a general multi-parent service
registry. No packed-install, release, or queue/cancellation guarantee is implied.

## Fourth slice, part one: queued foreground cancellation

Red reproduced through the public service with the real preparation, record,
manager, and concurrency limiter; only child execution is controllable. A held
child A occupies the single slot. Cancelling queued foreground B did not settle
its `run()` call while A remained held.

`Subagent.scheduleVia` now listens for the caller's cancellation while queued,
stops that record, and settles its caller-facing promise. Admission removes the
queued listener and transfers cancellation handling to the running record. The
scheduler's promise remains separate: cancelling B neither releases A's slot nor
starts B's child. B's stopped thunk becomes a no-op when eventually admitted.

The regression proves B settles as stopped, A remains un-aborted, C remains
queued until A finishes, and only A and C construct children.

Verification: focused regression plus record/limiter tests passed (228 tests).
Final uncached full package suite passed: **127 files, 2,440 tests passed, one
skipped**. Nx typecheck and lint passed, with the existing third-party typecheck
diagnostic exclusions unchanged. Touched TypeScript files were formatted.

This does not claim a general queued-resume or manager-abort repair. Shutdown
during construction/provisioning and exactly-once late cleanup remain next.

## Fourth slice, part two: resources returned after owner shutdown

Two regressions reproduced red at the public service/owner-lifetime boundary:

- A child factory paused until after owner shutdown returned a child whose
  disposal count stayed zero.
- A workspace provider paused until after shutdown returned a workspace whose
  disposal callback was never called.

The record now remembers that session disposal was requested even when no child
exists yet. After workspace preparation it disposes a late workspace and returns
without constructing a child. After child creation it disposes a late child and
returns without attaching it, announcing session creation, or starting a turn.
The existing bounded owner shutdown remains bounded; it does not wait forever
for a provider or factory that has not returned.

The regressions release each gate after shutdown completes and verify cleanup,
no late execution/construction, and no second cleanup after manager disposal.
They use the real service/preparer/manager/record chain with controlled child and
workspace collaborators; they are not claims of new SDK integration coverage.

Verification: focused shutdown/record/workspace tests passed (239 tests). Final
uncached full package suite passed: **128 files, 2,442 tests passed, one skipped**.
Nx typecheck and lint passed, retaining existing third-party exclusions. Touched
TypeScript files were formatted. A collaborator that never returns cannot have
its not-yet-produced resource disposed; cleanup is performed when it arrives.

## Fifth slice, part one: requested invalid definitions do not fall back

Red reproduced through public `launch()` using the real parser, catalog,
preparer, manager, and service chain: an invalid recognized field, malformed
YAML, or duplicate normalized identifier for shipped `explore` each accepted a
launch instead of refusing the requested configuration.

The loader now carries optional structured identifier-specific diagnostics in
`LoadedScope.invalidDefinitions`, including through filesystem loading and
registry snapshots. Preparation rejects a requested identifier with those
problems using the existing `configuration` reason and source-path diagnostics.
It does not parse human-readable error strings or reject unrelated definitions.
Existing parser patch/diagnostic behavior remains available to diagnostics and
registry consumers; caller preparation is the fail-closed acceptance boundary.
A third duplicate can no longer reintroduce an identifier already marked as a
duplicate in that scope.

The public regression verifies rejection before record/child construction and
successful launch of an unrelated shipped role for each failure case. Child
execution is controlled; no new SDK/model integration claim is made.

Validation: final focused loader/validation/registry/preparation/service run
passed **66 tests across five files**. Nx typecheck and lint passed, retaining
the existing third-party typecheck exclusions. Two full-suite attempts reached
the 180-second bound; the second reported a UI dependency-rule timeout before
the command bound. Full-suite green is therefore **not verified for this slice**.
Scope-wide read failures and other planned review concerns remain separate work.

## Fifth slice, part two: scope enumeration failures

A real filesystem regression reproduced red: placing a file at the agents
scope directory path makes directory enumeration fail, but the async loader
silently returned an empty scope and public `launch()` accepted a shipped agent.

Both loader variants now retain a structured `scopeError` and a human-readable
path diagnostic on non-missing enumeration failure. Preparation rejects with
`configuration` when either scope could not be enumerated: its unknown contents
cannot safely be treated as absent overrides. A genuinely missing optional
scope still produces an empty catalog layer and permits shipped-agent launches.
Cancellation propagation remains unchanged.

Verification: real filesystem enumeration plus public-service refusal and a
missing-directory positive control passed, alongside the prior definition
checks: **68 tests across six files**. Final uncached full package suite passed:
**130 files, 2,447 tests passed, one skipped**. This also closes the previous
slice's incomplete full-suite verification. Nx typecheck and lint passed with
existing third-party exclusions unchanged. Touched files were formatted.
The deterministic filesystem error is a non-directory scope, not an OS-specific
permission-denial fixture; individual file-read failures remain a follow-up.

## Fifth slice, part three: individual definition-file read failures

Red reproduced for both filesystem loaders using a directory named
`explore.md`: enumeration succeeds but reading that entry as a file fails.
Previously the loader only reported a string diagnostic and public `launch()`
still accepted the shipped `explore` definition.

Both loaders now retain unreadable entries in the existing structured
identifier-specific diagnostics. Preparation rejects that identifier with
`configuration` and the source path instead of exposing a lower-layer role.
Other identifiers remain usable. Missing-directory and cancellation behavior
are unchanged; the fixture uses a deterministic read error rather than
platform-dependent permission manipulation.

Verification: public refusal before record/child construction and unrelated
agent acceptance passed for sync and async loaders. Focused definition checks
passed **70 tests across six files**. Full uncached package suite passed:
**130 files, 2,449 tests passed, one skipped**. Nx typecheck and lint passed,
retaining existing third-party diagnostic exclusions. Touched files formatted.

## Fifth slice, part four: cancellation while definition loading rejects

Red reproduced through both public caller doors: when a paused definition
loader rejects after caller abort, `launch()` and `run()` threw instead of
returning the promised typed `cancelled` refusal.

Preparation now catches the definition-load rejection and translates it only
when the caller's signal is aborted. Non-cancellation loader failures still
propagate unchanged; cancellation does not create a partial catalog or accept a
record. Tests use controlled definition I/O in the real service/preparer chain,
not a new filesystem timing or SDK integration claim.

Verification: public launch/run cancellation and a non-cancellation failure
control passed alongside preparation, loader-cancellation, and queued-run
checks: **30 tests across four files**. Final uncached package suite passed:
**131 files, 2,452 tests passed, one skipped**. Nx `format`, typecheck, and lint
passed; existing third-party typecheck diagnostic exclusions remain unchanged.

## Fifth slice, part five: caller cancellation at public acceptance

Red reproduced at the public service adapter handoff after real preparation
completes: aborting before the adapter resumes let `launch()` return accepted
and let `run()` create a stopped record rather than reject without acceptance.
Tests gate the preparation result handoff only; the preparer, manager, and
record chain otherwise run unchanged.

Both public adapters now check the caller signal after the preparation await
and immediately before synchronous manager acceptance. They return the existing
`cancelled` refusal without creating a record or child. The signal is still
not passed into accepted background work: a positive control aborts after
background acceptance, verifies its child remains running, then completes it.

Verification: focused public acceptance/preparation/queue cancellation and
service-adapter checks passed **55 tests across four files**. Full uncached
package suite passed: **132 files, 2,455 tests passed, one skipped**. Nx `format`,
typecheck, and lint passed with existing third-party diagnostic exclusions.
This slice covers programmatic `launch()`/`run()`; it does not claim a new
model-facing tool handoff or SDK cancellation integration guarantee.

## Sixth slice: model-facing tool door and run association

Two defects were found by the remaining review, each reproduced through the
public seam before its fix:

- The model-facing `AgentTool` awaited preparation and then accepted even when
  the tool call's signal had been aborted meanwhile, so a cancelled call could
  create a record. It now returns the same `cancelled` refusal the programmatic
  door returns, with `isError: true` on the tool result.
- `SubagentManager.spawnAndWait` awaited one run's promise but returned the live
  record, so a resume started synchronously by a completion observer made
  `service.run()` serialize the newer run instead of the run it waited for.
  Foreground completion now carries the exact run the wait observed, and the
  service snapshot is built from that run.

Refusals from the tool door (launch, resume, steer) now report `isError: true`
instead of looking like successful results, so the model sees a failed call
while structured details still carry the reason. Preparation also copies the
model registry view and the routing ladders it captured, so resolution cannot
observe later session edits through a shared reference.

Verification: focused service/tool/composition checks passed; full uncached
package suite passed **132 files, 2,464 tests passed, one skipped**. Nx
`format`, typecheck, lint, formatting check, and metadata passed.

## Seventh slice: queued resumes and aborts

Red reproduced through the public service: a resume waiting for a slot did not
settle when its caller's signal fired or when `abort(id)` was called, while
another child held the only slot.

Queued runs now keep a per-run cancellation handle separate from the
scheduler's promise. Stopping a queued run settles exactly that run's waiter and
clears its listener; the scheduler task stays queued and its stopped thunk
no-ops when admitted, so no other child's capacity is released. A signal that
had already fired is deliberately left to the run's own start, preserving the
existing "settles as stopped without entering the turn loop" behaviour.

Verification: public queued initial/resume cancellation by signal and by
`abort(id)`, with a held child proving no capacity release, passed alongside the
record, limiter, and manager suites.

## Eighth slice: real SDK lifecycle follow-ups

The existing veto fixture now drives four real SDK scenarios through the
installed `createAgentSessionRuntime` and the package's source extension:

- a vetoed `newSession()` leaves the published service and launch door usable;
- a child executes, ends its turn with `ask_parent`, and resumes successfully
  with the resumed answer;
- a veto during an active child's run leaves that child running, and it then
  completes normally;
- a confirmed replacement publishes a new service owner, retires the old
  record set, and serves launches.

Only the external model response is substituted by an offline provider
registered through the SDK; loading, binding, veto sequencing, ownership, and
disposal are the real ones. One Windows-only cleanup flake (a temp directory
still held by a session file) was fixed by retrying removal, without loosening
any assertion.

## Ninth slice: release checks

Added `engines.node >=22.19.0`, the exact floor the installed Pi 1.3.0 SDK
declares, and two Nx targets that verify what a user actually installs:

- `release-check` packs the package into a temporary directory outside the
  workspace, installs the tarball with its peers, type-checks a consumer
  importing both public entries, then loads the installed source extension
  through the real Pi resource loader, binding it and asserting that it
  publishes a discoverable service. It runs on Node 24 and on the declared
  floor (Node 22.19.0 via `pnpm dlx node@22.19.0`).
- `mcp-check` runs a real stdio MCP server (a fixture process speaking
  JSON-RPC) and proves a resource-only child lists and reads its resource
  through Pi's built-in MCP extension, while the server tool namespace stays
  unavailable.

The packed package ships TypeScript source, so its `#src/*` imports map to
`./src/*.ts` — required for a NodeNext/bundler consumer to resolve them. That
made the Nx boundary rule resolve `#src` to project files and demand relative
imports; the rule's `allow` list now names `#src/` and `#test/` as
package-private aliases rather than rewriting 899 imports.

Verification: `release-check` passed on Node 24.18.0 and Node 22.19.0;
`mcp-check` passed. Package `test`, `typecheck`, `lint`, `check`, and `metadata`
all passed uncached, and the other seven workspace projects passed their
applicable `test`, `typecheck`, `lint`, `check`, and `metadata` targets.

## Final review pass

A last self-review of the whole uncommitted change set found two hygiene issues,
both fixed and re-verified:

- The definition-validation import had been placed above
  `launch-preparer.ts`'s module comment; it now sits with the other imports.
- The two "resource arrived after shutdown" paths released the run without a
  terminal transition, leaving a disposed record that still read `running`. Both
  now end it through the existing `endBeforeStart` path, so the record reads
  `stopped` and fires one run-finished announcement.

The full-suite run also surfaced load sensitivity rather than a product defect:
under unbounded worker parallelism the two process-spawning suites (real SDK
runtime, MCP client) and the `git`-spawning environment test could time out.
`vitest.config.ts` now caps workers at 2 and sets a 30s default test timeout, so
the suite is reproducible instead of load-dependent. Three consecutive full runs
passed afterwards.

## Evidence summary

| Check | Result |
| --- | --- |
| Package tests (uncached) | 132 files, 2,464 passed, 1 skipped |
| Package typecheck, lint, formatting check, metadata | passed |
| Packed install + public types + Pi loader (Node 24) | passed |
| Packed install on declared floor (Node 22.19.0) | passed |
| Resource-only MCP against a live stdio server | passed |
| Other seven workspace projects | passed |

## Known limitations

- External model responses are substituted in the offline fixtures; no live
  provider call is part of any check.
- The child regression that proves parent service identity uses a published
  sentinel rather than a second real parent runtime; legitimate source-loaded
  parent publication is verified separately.
- Child shutdown stays bounded rather than waiting indefinitely for a factory
  or workspace provider that never returns; a resource that arrives later is
  cleaned up when it does.
- MCP positive coverage runs as a process-level check (`mcp-check`) because
  Pi's built-in MCP extension loads its client through its own module graph,
  which Vitest's transform pipeline does not reproduce.
- The typecheck wrapper still excludes 12 known diagnostics from the
  third-party settings package.
