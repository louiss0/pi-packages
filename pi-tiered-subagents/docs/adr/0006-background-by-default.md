---
status: accepted
date: 2026-10-22
---

# 0006 — Background is the default; a request may ask for the foreground

Every launch runs in the background unless the request says otherwise.

## Context

Upstream's tool door defaulted to the *foreground*: a request that named no
mode ran the child in the parent's turn and returned its result. Only the
programmatic service defaulted to the background.

The specification says the opposite: "background execution by default with an
explicit foreground option, so that the parent can continue useful work", and
"run all five roles in the background by default while retaining explicit
foreground launches".

The two defaults also disagreed with each other, which is its own problem: the
same agent launched through the tool and through the service ran in different
modes.

## Decision

The default is the background, for both doors. A request that names
`run_in_background: false` runs in the foreground; a definition may declare its
own preference, and an explicit request still wins over it.

## Consequences

- A parent that wants a result in the same turn asks for the foreground
  explicitly; a parent that wants to keep working does nothing.
- The "background" tag appears on the record of a default launch, so the mode
  is visible in the widget and in the result.
- A resume is always foreground or background by the door's own commitment:
  the tool's resume path honours an explicit `run_in_background`, and the
  service's resume is background because nothing in the parent's turn waits
  for it.
