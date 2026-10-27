---
status: accepted
date: 2026-10-22
---

# 0007 — The child's model is one tier down the parent's

A child that names no model runs on **one tier down its parent's**, in the
family's own ladder. A child that names one — in the request or in the agent
definition — runs on exactly that model, or the launch fails.

> **Partially superseded by [ADR 0014](0014-role-aware-model-routing.md):**
> automatic routing is now role-aware rather than uniformly one tier down.
> Exact explicit resolution, data-only profiles, whole-family replacement,
> approved cross-version links, and retain/error outcomes remain in force.
> The family examples below are historical; GLM replaces Kimi in supported data.

## Context

The alternative is a heuristic: find a model with a similar name, or the
cheapest one available. Both answer a question nobody asked. "sonnet" means
three different models depending on the provider; the cheapest model in the
registry may be a model the parent was never near. A name that resolves to
*something* is not the same as a model that was chosen.

The specification is unambiguous: explicit choices are exact
(`provider/modelId`), automatic routing is a step down a declared ladder, an
unplaceable family is an error, and a family with nothing to offer keeps the
parent's model.

Two questions had to be answered before the code could be written.

**What is a tier?** The families disagree: `gpt-6.1-sol` puts the version
before the tier, `claude-opus-5` puts the line first, `kimi-k2.6` glues a
letter to the version, and `MiniMax-M2.7` capitalizes. So the *structure* of a
name is read by a strategy — one per family — and the *ladder* is data: the
versions a family has, the tiers of each version, the concrete ids of each
tier, and the rungs a tier may cross to.

**When may a version be crossed?** The tiers of two versions are not
comparable by name: one version's cheapest line may be dearer than another's.
So the cross-version links are written on the rung that may cross, explicitly,
rather than inferred. The specification's example — a parent on 6.1 Sol
selecting a listed Luna target from an explicitly approved compatible version
— is exactly such a link.

## Decision

- **Explicit choices are exact.** `provider/modelId`, resolved against the
  session's models, or an error. No shorthand, no provider fallback, and no
  falling back to another model when the named one is unavailable.
- **The ladder is data.** A profile names the versions, the tiers, the
  concrete ids in preference order, and the approved cross-version links.
  Eight families ship with profiles; an operator may replace a family whole.
- **A profile is replaced, never merged.** A profile that names "gpt" is the
  whole gpt profile.
- **Only data is read.** A value the schema does not name is ignored, never
  evaluated: there is no matcher and no parser to run.
- **A family the router cannot place is an error; a family whose ladder has
  nothing left keeps the parent's model.**
- **The choice is reported.** The launch note says which model was chosen and
  why, so a parent that did not name a model learns what its child runs on.

## Consequences

- The runtime's fuzzy model resolution is gone: a typo now fails the launch
  instead of quietly running a different model.
- The shipped ladders are written against the catalogue the installed SDK
  ships, which is a representative registry and not a promise of vendor
  availability. A tier the session cannot run is skipped.
- The profiles are the operator's to correct; a wrong ladder is a data fix,
  not a code change.
- The reasoning level is chosen after the model, and the reasoning defaults
  are still to come.
