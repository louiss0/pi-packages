---
status: accepted
date: 2026-10-22
---

# 0003 — Scope the inherited lint rules to this package

The workspace's ESLint configuration relaxes four rules for
`pi-tiered-subagents/**` only: `no-explicit-any`, `no-non-null-assertion`,
`no-control-regex`, and the empty-function rule (arrow functions, functions
and methods).

## Context

The recovered runtime was written against a different lint baseline: the Pi
SDK types are `Model<any>`-shaped, Pi's `Component` interface has an
`invalidate()` method that is empty by contract, and the suite's doubles are
empty on purpose. Upstream relaxed the same rules for its own tree.

The workspace's own rules are correct for the code the workspace writes, and
the specification is explicit that the runtime must be *explained and
characterized before it is restructured*. Rewriting eleven thousand lines to
satisfy rules the specification will replace anyway would bury the
restructuring in mechanical churn.

## Decision

Relax the rules for this package only, and keep the rest of the workspace on
the workspace's rules. The relaxation is recorded here so it is not mistaken
for a workspace-wide precedent.

## Consequences

- New code in this package is written under the same relaxation until the
  inherited code it replaces is gone. Re-enabling the rules is part of that
  work, not a separate cleanup.
- A leading underscore marks a parameter the interface requires but the
  implementation does not use; the unused-vars rule is configured to honour
  that convention.
