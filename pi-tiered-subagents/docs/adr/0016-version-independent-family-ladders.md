---
status: accepted
date: 2026-10-27
---

# 0016 — Profiles are version-independent family ladders

## Decision

The maintainer explicitly corrected the catalogue-shaped profile architecture:
profiles must not enumerate releases or concrete model IDs. This supersedes the
version → tiers → models shape and conflicting scope in issue #11, as well as
those catalogue assumptions in ADRs 0014/0015. Exact-version isolation, five-role
size/class targets, reasoning, explicit-pin precedence, and session availability
authority remain unchanged.

A profile contains a family, group, and ordered tier ladder with size/class
labels. GPT Luna is S across versions, preserving the operator's correction.
Strategies extract the parent's version and tier and construct an exact candidate
ID for each target or eligible cheaper tier. GPT places version before tier;
Claude places line before its hyphenated version. There is no release catalogue.
Construction never promises availability: only an exact session-runnable ID wins.
Snapshot and specialization qualifiers are not fuzzy alternatives to that ID.

The user explicitly selected deterministic provider selection for each exact ID:
prefer the parent's provider when runnable there; otherwise accept a unique
matching provider. If multiple alternate providers match, the tier is ambiguous
and unusable. Continue cheaper eligible tiers within the same version, retaining
the captured parent when exhausted. This is neither same-provider-only routing
nor a provider priority catalogue, and never depends on registry order.

Unknown family, missing version, unknown parent tier, and exhausted ladders retain
the parent. Equal anchors at the parent's rung; permitted cheaper-tier labels and
role/reasoning policies are unchanged. Explicit pins bypass automatic routing and
still resolve exactly or fail.

## Configuration and ownership

Operators replace a family whole using `group` and `tiers`. Old `versions` and
`models` fields are rejected with structural diagnostics, not silently converted.
Tier fallback fields alone retain their obsolete accept-and-discard behavior.
Validation checks required labels, nonempty ladders, unique tier names, and
construct/parse round-tripping through the supported family naming strategy.

The maintainer also requested one profiles module: `src/models/profiles.ts` owns
schema-derived types, domain validation, and shipped ladders. There is no singular
`profile.ts` module or re-export shim. Routing targets still own label semantics;
the router owns the exact-ID walk and provider disambiguation. Preparation copies
the tier ladder so later settings mutation cannot change accepted decisions.

## Evidence

Tests at the profile and router seams cover unseen releases, GPT/Claude naming,
exact availability, provider preference/uniqueness/ambiguity, same-version cheaper
fallback, unknown/exhausted parents, labels, and whole-family replacement. Matrix
documentation uses explicitly synthetic future releases and the real router,
not a runtime release catalogue or a second selection implementation.
