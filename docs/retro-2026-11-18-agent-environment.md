# Retrospective: agent environment — 2026-11-18

Scope: current session (`01a1efd4-7c59-7708-a0cb-5fd5b5e6744b`),
`pi-tiered-subagents` Hy/free routing work.

## Candidates, ordered by severity

### 1. High — Nx verification is parallel-unsafe, and the rule is buried

Evidence: four `pnpm nx run` targets were launched concurrently; the test run
timed out at 180s and typecheck hit an Nx plugin-worker crash (`Plugin Worker
... exited unexpectedly`). Rerunning them sequentially passed. Root
`AGENTS.md` only says “prefer Nx”; the daemon-disabled requirement is buried in
`docs/SPEC.md:330` and `docs/ARCHITECTURE-SPEC.md:761`.

Fix: add one always-loaded pointer in `AGENTS.md`: run Nx verification targets
sequentially with `NX_DAEMON=false`; never fan out multiple `nx run` processes
at once.

### 2. High — Review subagents need an explicit “diff only” bound

Evidence: the spec-review subagent decided to run the full test suite, hit a
240s timeout, stayed stuck for roughly 12 minutes, and needed a steer before
reporting.

Fix: add to the `code-review` skill prompt: review the supplied diff only; do
not run full test suites or builds; use short, targeted tests only when a
specific assertion is doubtful.

### 3. Medium — Routing rules are duplicated across too many docs

Evidence: one reserved-word rule required edits to `SPEC.md`,
`ARCHITECTURE-SPEC.md`, `status.md`, `configuration.md`, and
`model-matrix.md`; the standards reviewer caught drift in the first pass.

Fix: make `pi-tiered-subagents/docs/configuration.md` the single source for
family/tier rules and replace the restated paragraphs in SPEC/status with
pointers. This follows the `writing-for-agents` single-source-of-truth
guidance.

### 4. Medium — CI exists, but there is no pre-commit guardrail

Evidence: `.github/workflows/ci.yml` runs `nx affected -t check` and
`lint test build typecheck metadata`, but there is no `.husky`, lint-staged, or
lefthook config. Formatting was caught only when `check` was explicitly run.

Fix: add a lightweight pre-commit hook for format/lint on changed files. Leave
the slow test/typecheck jobs to CI.

### 5. Low — Stale Nx MCP pointer in root `AGENTS.md`

Evidence: `AGENTS.md` says Nx MCP tools are available; a tool search in this
session found no Nx MCP tools.

Fix: remove or condition that line so it does not spend attention on an
unavailable capability.
