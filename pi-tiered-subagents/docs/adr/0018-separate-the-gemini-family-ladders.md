---
status: accepted
date: 2026-11-15
superseded_by: 0020 for Pro and Flash support
---

# 0018 — Separate the Gemini family ladders

## Context

Gemini chemical, Pro, and Flash tiers shared one ladder even though they are
separate model lines. That allowed routing to substitute across lines and put
Flash Lite at S. The maintainer wants independent families, Krypton as the new
chemical XL tier, Hydrogen as chemical S, and no Flash tier labeled S.

## Decision

Ship three mutually exclusive size families with the existing version-independent
profile architecture:

| Family | Ordered tiers |
| --- | --- |
| `gemini` | Krypton XL → Carbon L → Argon M → Hydrogen S |
| `gemini-pro` | Pro Preview L → Pro M |
| `gemini-flash` | Flash L → Flash Lite M |

All three use Gemini's existing version-first ID grammar, but tier-aware
`belongs` predicates give each model ID exactly one owner. Pro and Flash reserve
their respective first tier segment; the chemical family accepts other tiers
and bare Gemini IDs. Bare IDs have no known rung and are retained.

Routing remains exact-version and exact-ID. It never crosses these family
boundaries; an exhausted ladder retains the parent. Existing `familyProfiles`
settings can replace each family whole under its own key.

## Consequences

- Krypton Workers target Carbon, Pro Preview Workers target Pro, and Flash
  Workers target Flash Lite when those exact same-version IDs are runnable.
- Explore and Researcher cannot route Pro or Flash parents to S because those
  families deliberately have no S rung; they retain the parent.
- The generated model matrix and routing tests cover all ten shipped families,
  disjoint ownership, family retention, and same-version routing.
