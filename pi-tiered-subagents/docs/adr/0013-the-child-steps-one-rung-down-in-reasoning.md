---
status: accepted
date: 2026-10-26
supersedes: 0008 — for the case where the child runs on its own model
---

# 0013 — The child steps one rung down in reasoning

A child's default reasoning level is the **highest level its own model supports
that is strictly below the parent's effort** — not a fixed medium.

## Context

[0008](0008-the-reasoning-level-follows-the-model.md) implemented the automatic
acceptance: medium, then low, then the lowest supported non-off level. It read
the parent's effort only in one case — when the parent's *model* was retained —
because there the obvious default could silently raise the effort.

That left a gap in every other case. A child routed onto a lower model took the
fixed default regardless of the parent:

```
parent: low          child: medium        ← the child reasons harder
parent: minimal      child: medium
parent: max          child: medium        ← no relationship to the parent
```

The first two are the wrong direction. A delegation that was meant to be
cheaper, narrower work costs more reasoning than the turn that asked for it.

The second fact is that Pi reports supported levels **per model, as a
gapped array**: `["low", "high", "max"]` for 55 models in the shipped
catalogue, `["medium", "xhigh"]` for one, `["off", "high"]` for 58,
`["max"]` alone for two. "One step down" therefore cannot be arithmetic on a
fixed index; the next rung is defined by the *child model's* array.

## Decision

- The precedence is unchanged: the request's level, then the definition's,
  then the automatic choice.
- The automatic choice, when the parent's effort is known, is
  **one rung down in the child's own array**: the highest level that model
  supports which is strictly below the parent's. Gaps are skipped, so
  `max → high → low` on `["low", "high", "max"]`.
- Where the model has no rung below, the child lands on that model's floor. If
  the floor is the parent's own effort, the launch note says the effort stands.
  If the model's floor is *above* the parent's effort, the launch note says the
  model has no lower rung — the one case where "lower" cannot be honoured, and
  it is reported rather than hidden.
- With no parent effort to step down from — a standalone or programmatic launch
  — the automatic choice stays **medium, then low, then the lowest supported
  non-off level**. There is nothing to be lower than.
- An explicit request or definition level still wins outright, and a level the
  model cannot express is still clamped with Pi's own `clampThinkingLevel`.
  A model that does not reason is still valid and reports *not applicable*.
- The derivation lives in [`src/thinking/levels.ts`](../../src/thinking/levels.ts)
  as two pure functions: `levelBelow` (strict) and `stepDown` (with the floor
  policy). `resolveThinking` remains the only place a launch's level is decided.

## Consequences

- **This partially supersedes SPEC story 68** and the corresponding line in
  `ARCHITECTURE-SPEC.md` ("preserve the default medium/low/lowest-supported
  non-off order") for the case where a parent effort is known. The no-parent
  case keeps the specified order, and the retained-parent rule of 0008 is
  untouched. The deviation is recorded in [status.md](../status.md) with the
  other deliberate departures.
- The reasoning level is no longer independent of the parent, so a queued
  launch's decision now depends on the captured `parentThinkingLevel`. It
  already travelled with the request; the decision simply reads it in one more
  case.
- `[off, high]`-shaped models are a real limit: a child on one of those runs at
  `high` whatever the parent was doing. The matrix in
  [model-matrix.md](../model-matrix.md) and the reasoning tests state this
  rather than implying a step that cannot happen.
- "One rung" is measured in the child's array, so a parent on one model family
  and a child on another is not a like-for-like comparison of families' rungs.
  The contract is about effort relative to the parent, not equivalence between
  vendors.
- Verified by `test/thinking/reasoning-levels.test.ts` (catalogue shapes,
  derivation, and launch-level behavior) and the existing
  `test/thinking/resolve.test.ts`, with the full suite green.

## Alternatives considered

- **Drop to the lowest level below the parent.** Cheaper, but it discards the
  relationship a "tiered" runtime is supposed to have, and turns every
  delegation into a maximum step down.
- **An opt-in setting with the old default.** Keeps compatibility, but leaves
  the wrong-direction case (`parent low → child medium`) as the default
  behavior, which is the case worth fixing.
- **Derive the rung from the parent's family instead of the child's model.**
  The parent's array says nothing about what the child can run; the child's
  model is the only authority.
