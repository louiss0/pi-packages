---
status: accepted
date: 2026-10-27
---

# 0015 — Keep automatic routing version-local and retained effort one rung down

Automatic model routing stays within the captured parent's **exact family and
version**. Unknown families retain the parent instead of requiring an explicit
model. Automatic reasoning on a retained model takes the next supported
non-off rung below known parent effort, not a preferred fixed medium or low.
These latest maintainer decisions supersede the conflicting portions of issue
#10 and the earlier routing/reasoning decisions, not their role-aware policy.

## Context

Declared cross-version links avoided guessing compatibility but still allowed
a role target to leave the release the parent selected. Keeping such links as
an optional feature would preserve the same ambiguity in schema, shipped data,
and runtime. The chosen boundary is stricter: an absent or exhausted target in
that version is a reason to retain the parent, not to search other releases.
An unknown family should have the same safe outcome, without price ranking or
family guessing and without making explicit pins a prerequisite for delegation.

On a retained reasoning model, the old medium/low preference could skip several
supported rungs. For `[low, high, max]`, a parent at `max` should yield `high`,
not `low`. The model's supported non-off array, rather than a fixed favorite
level or arithmetic over a universal array, defines the next rung.

## Decision

- Preserve the five-role mapping, custom-identifier worker behavior, groups,
  size/class labels, and Equal's anchor at the parent's own rung from
  [ADR 0014](0014-role-aware-model-routing.md).
- Resolve the role target in the exact parent family/version. Try preferred
  concrete identities, then eligible cheaper rungs in that version. If there
  is no runnable target or cheaper rung, retain the parent and explain why.
  Unknown families also retain the parent; do not guess a family or provider.
- Remove version fallback links from the profile schema, shipped data, and
  runtime. Legacy `fallbacks` fields are ignored by the ordinary unknown-field
  rule, not validated, migrated, or used to cross versions. Whole-family
  replacement and validation of recognized group/size/class fields remain.
- When the model is retained and parent effort is known, automatic reasoning
  takes the highest supported non-off level strictly below it in that model's
  array. Skip gaps; where no lower rung exists use the model's
  floor. On a retained model already at its floor, effort stays. Do not prefer
  fixed medium or low over the next supported rung.
- Without parent effort, keep medium, then low, then lowest supported non-off.
  Request pins still beat definition pins, which beat automatic selection.
  Model pins resolve exactly or fail; explicit reasoning uses the existing
  Pi-compatible clamping and explicit-off policy. Non-reasoning models remain
  usable and report reasoning as *not applicable*.

## Scope and ownership

This supersedes **only** the version-link and unknown-family-error portions of
ADR 0007/ADR 0014 and the old retained-model effort preference of
[ADR 0008](0008-the-reasoning-level-follows-the-model.md). It does not supersede
ADR 0014's role-aware mapping or labels, change exact-pin resolution, introduce
new family/version catalogues, or create a new launch authority. Earlier ADRs
remain historical records rather than being rewritten as if version links had
never existed.

`SizeRoutingTarget` and `PlannerWorkerRoutingTarget` are separate TypeScript
classes behind a small shared interface. Each owns label matching, starting
rung, and fallback rank; the router owns the common exact-version walk and
availability checks. Existing routing/resolution behavior seams are sufficient;
no new class-internal tests are required.

## Consequences

Profiles can no longer route a missing worker/planner/size to another release.
For example, MiniMax M3 cannot reach M3.1-flash, flash-only Gemini versions
cannot reach another version's planner, and Qwen cannot borrow another
version's S tier. Representative in-version examples, such as a listed GPT
5.6 Sol to GPT 5.6 Terra route, describe profile relationships, not vendor
availability promises. Retention reasons and actual effort remain visible in
launch decisions; accepted work is never rerouted after preparation.
