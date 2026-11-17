---
status: accepted
date: 2026-11-15
supersedes: 0013 and the parent-relative reasoning portions of 0008 and 0015
---

# 0017 — Automatic reasoning is the upper median

## Context

Automatic reasoning previously stepped down from the parent's effort. That made
the child default depend on which parent happened to delegate and retained a
separate fallback when parent effort was unknown. The maintainer instead wants
one predictable default derived from the child model's own capabilities.

## Decision

After the request and definition levels, automatic reasoning selects the upper
median of the child model's supported non-off levels in canonical effort order.
`off` is excluded before selection. With an even number of levels, the higher
of the two middle rungs wins; a singleton keeps its only level.

This rule applies whether routing changes or retains the model and whether
parent effort is known. Request and definition precedence, Pi-compatible
clamping, explicit-off handling, and non-reasoning not-applicable reporting are
unchanged. `resolveThinking` no longer accepts parent effort or retained-model
inputs, making parent independence explicit in its interface.

## Consequences

- `[minimal, low, medium, high]` selects `medium`; all six non-off levels select
  `high`; `[low, high, max]` selects `high`.
- Different parents delegating to the same child model receive the same
  automatic thinking level.
- The old step-down helpers are replaced by one median helper. Tests cover odd,
  even, gapped, singleton, non-reasoning, and retained-model behavior.
