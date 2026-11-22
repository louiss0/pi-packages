---
status: accepted
date: 2026-11-22
supersedes: the exact-version boundary of 0015 for automatic routing
---

# 0021 — Walk automatic routing down the version ladder before retaining

When the parent's version offers no runnable role target or cheaper rung,
automatic routing keeps walking **down the version ladder in semver order**
until a model runs or the versions run out: the last dotted segment is the
minor and the rest is the major chain. Minors count down to `.0` inside the
parent's major; each previous major then restarts the minor at the parent's
own value and counts down again, down to version 1. If nothing in any lower
version is runnable, the parent is retained as before.

## Context

ADR 0015 made automatic routing version-local: an exhausted same-version
ladder always retained the parent. The maintainer replaced that boundary
with an explicit semver-like rule: the version can fall until a major is
found — `6.2` may reach `6.1` and `6.0`, `75` may reach `74` — consolidated
into one numbering scheme rather than a single-step exception or declared
version links.

The walk stays data-only: profiles remain version-independent ladders, no
release catalogue is introduced, and "lower" is defined arithmetically on
the parsed version, which every shipped strategy already produces.

## Decision

- `fallbackVersions(version)` yields every version below the parent, in
  order. For `major.minor` versions: `major.(minor-1)` … `major.0`, then
  each previous major with the minor restarted at the parent's own value —
  `5.2`, `5.1`, `5.0`, `4.2`, … for a `6.2` parent — down to version 1. A
  single-segment version has no minor, so `75` yields `74`, `73`, … A
  version that is not all digits and dots yields nothing.
- The fallback repeats the **entire** downward walk — same role target,
  same candidate tiers in profile order, same exact-ID construction,
  provider preference, and ambiguity rules — at each lower version, in
  order, stopping at the first runnable rung.
- Only downward versions are ever produced: a higher version is unreachable.
- Family boundaries are unchanged: every candidate ID is constructed through
  the same family strategy, so a GPT parent can never land on a Claude model.
- Explicit request/definition model pins still resolve exactly and bypass
  routing entirely; this decision affects only automatic routing.
- The routed result reports the version actually used
  (`gpt 5.1 tier terra`) and the reason notes the version it fell back
  from, so the launch note never implies the child runs the parent's release.

## Scope and ownership

This partially supersedes ADR 0015's "no version fallback" boundary and the
matching clauses in ADR 0016. It does not restore declared version links,
add release catalogues, change role targets or tier labels, or alter
explicit-pin resolution. Earlier ADRs remain historical records.

`fallbackVersions` and `decrementChain` live in `src/models/router.ts`
beside the walk they feed; strategies still own id parsing and construction,
profiles still own the ladders, and `pickRunnableTier` is unchanged — it
runs once per version in reach.

## Consequences

A parent whose release lacks every runnable rung can now delegate to the
closest lower version the session can run, across major boundaries, instead
of always retaining. The walk is bounded by version 1 and by session
availability, not by a step count; retention remains the default whenever
no lower version can run the role's target. Restarting previous majors at
the parent's own minor is a deterministic choice, not a claim that those
minors exist — unavailability simply skips them.
