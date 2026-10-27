---
status: accepted
date: 2026-10-27
---

# 0014 — Automatic model routing is role-aware

[Issue #10](https://github.com/louiss0/pi-packages/issues/10) replaces the uniform
one-tier-down automatic model rule in [ADR 0007](0007-the-childs-model-is-one-tier-down.md).
Review should not be guaranteed a weaker model than the work it audits, and a
lookup should not cost the same as an audit. Families also express different
relationships: graduated capability sizes are not planner/worker classes.

## Decision

Every profile declares one group. Size families are GPT, Claude, and Qwen;
planner/worker families are Gemini, MiniMax, GLM, MiMo, and DeepSeek. Kimi is
removed from supported automatic routing. Every size-group tier declares S, M,
or L; every planner/worker tier declares planner or worker. These are validated
profile data, not runtime classifiers over model names.

| Role | Size target | Planner/worker target |
| --- | --- | --- |
| worker | One size below parent, clamped at S | worker |
| researcher | S | worker |
| debug | M | worker |
| reviewer | Equal: parent's own size and rung | planner |
| explore | S | worker |

Other identifiers use worker behavior. The table ships as fixed policy, not an
operator-configurable role mapping. Size assignments are Qwen max/plus/flash =
L/M/S, Claude opus/sonnet/haiku = L/M/S, and GPT sol/astra = L,
pro/luna/terra = M, mini/nano = S. Snapshots inherit their tier's size.

Resolve a target to the top matching rung in the parent's version, except Equal
starts at the parent's own rung. A missing target in that version may be reached
only through approved profile links. Walk downward from the target: preferred
concrete identities, cheaper same-version rungs, then approved cross-version
links, skipping models the session cannot run. A fallback cannot exceed the
target's size/class: a link exposing a planner for review must not promote a
worker target to planner. No runnable target or fallback
retains the parent's model; an unplaceable family remains an explicit-model
error. Reasons name the role, target, and chosen model, including retention.

Flash-named tiers are worker class, with flash-lite a separate rung; pro and
non-flash flagship tiers are planner class. MiniMax's M3.1-flash, not Gemini
3.1-flash, is the new worker rung below its planner flagship. Older MiniMax
versions link to 3.1 flash. Flash-only Gemini 3.x versions link to 2.5 pro for
review; Qwen 3.7 links to 3.6 flash for S. GLM has a glued-version naming
strategy and explicitly labeled flagship/flash tiers. DeepSeek has no worker
class: review targets pro and every other role retains the parent.

## What stays unchanged

This supersedes **only the uniform automatic-routing rule** of ADR 0007.
Request model, then definition model, then automatic routing remains the
precedence at the existing model-selection seam, now supplied with the resolved
agent identifier. Explicit `provider/modelId` choices resolve exactly or fail,
even for unsupported families; pins never silently reroute. Profiles stay data,
are replaced whole, and never infer version compatibility. Session access, not
price or provider guessing, decides which candidates can run.

Reasoning selection is independent and untouched: this decision changes which
model runs, not how hard it thinks. The separate reasoning-level decisions
remain unchanged.

## Consequences

Existing profile replacements need a group and per-tier size or class labels;
missing or malformed labels are reported on read. The rest of their shape and
replacement semantics stay intact. The installed SDK catalogue remains a
representative source, not a vendor-availability promise. A generated role-aware
agent × family matrix exercises the real router to keep evidence aligned with
this policy. The rejected alternative — one uniform downgrade for every role
and family — remains recorded in ADR 0007 rather than erased from history.
