---
status: accepted
date: 2026-10-22
---

# 0008 — The reasoning level follows the model

A child's reasoning level is chosen **after** its model, because what a model
can do is a property of the model.

## Context

The specification fixes the order: the request's thinking, then the agent
definition's, then an automatic choice. It also fixes the automatic choice:
**medium**, then **low**, then the lowest supported non-off level — and never
"off" on a model that reasons.

Two things had to be settled before that could be implemented.

**What does a model support?** Not a display name, and not a series-wide
assumption. Pi already reports it: `getSupportedThinkingLevels(model)` reads
the model's own `reasoning` flag and its `thinkingLevelMap`, where a `null`
entry means "this level is not supported". A model that does not reason reports
`["off"]` and nothing else.

**What does "clamped" mean?** The specification asks for Pi-compatible
ordering, no numerical midpoint, and no silent fall to "off" on a reasoning
model. Pi's own `clampThinkingLevel` does exactly that: it walks up the level
order from the request, then down, and only reaches "off" when nothing else is
supported. Reusing it means the runtime cannot disagree with Pi about what a
level means.

The harder rule is the retained-parent one. When no lower model was available,
the child keeps the parent's model — and then the temptation is to give it the
*default* level, which may be *more* effort than the parent was running at. A
cost-saving fallback that raises the cost is not a saving.

## Decision

- The request's level, then the definition's, then the automatic choice.
- The automatic choice is medium, then low, then the lowest supported non-off
  level. It never turns reasoning off on a model that has it.
- A level the model does not support is clamped with Pi's own
  `clampThinkingLevel`, and the clamp is reported in the launch note.
- A model that does not reason is not a failure: the level is discarded and
  reported as *not applicable*, and the launch goes ahead.
- When the parent's model is kept, the effort never rises: medium or low are
  taken only when they are *below* the effort the parent was running at;
  otherwise a supported level below it; otherwise the parent's own effort
  stands.

## Consequences

- The parent session's effort is captured with the request, so a queued child
  knows what the parent was running at when the child was asked for.
- A request for a level the model cannot express no longer fails the launch;
  it is clamped, and the caller is told what it got.
- The reasoning level is reported the way the model is: the actual level, or
  the fact that it does not apply.
