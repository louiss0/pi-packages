---
status: accepted
date: 2026-10-22
---

# 0002 — Do not carry the tier experiment into the import

The scaffold's working tree carried an unfinished `src/tier/**` experiment:
glob and regex ladder matching over model ids, with a price-ranked fallback
for families the ladder did not name. It did not compile, and it is not the
design the specification approved.

## Context

The specification names that experiment as starting material, not as a
finished implementation: the scaffold shipped "incomplete experimental
tier-routing changes", and its further notes say not to resume such a patch
blindly. The approved design replaces the experiment's two load-bearing
ideas — price-ranked fallback and user-supplied matchers — with family
strategies over declared profile data, and forbids both.

Porting the experiment would have meant carrying a second model-selection
mechanism into the tree, in a shape the specification has already rejected,
alongside the mechanism that will replace it.

## Decision

Do not carry the experiment into the import. The runtime keeps upstream's model
resolution until the specified routing is implemented, and the family-profile
domain is written from the specification rather than from the experiment.

## Consequences

- The tree has one model-selection mechanism today, and it is upstream's.
- The rejected design is recorded in `docs/status.md` and in the change table
  of `docs/how-it-works.html`, so a reader does not mistake its absence for an
  oversight.
- Nothing in the experiment is a starting point for the specified work.
