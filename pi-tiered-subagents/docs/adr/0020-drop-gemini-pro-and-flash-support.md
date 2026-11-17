---
status: accepted
date: 2026-11-15
supersedes: 0018 for Pro and Flash support
---

# 0020 — Drop Gemini Pro and Flash support

## Context

ADR 0018 introduced independent chemical, Pro, and Flash family ladders. The
maintainer has since decided not to support Gemini Pro or Flash for automatic
routing at all. Separate ladders would preserve routing behavior that is no
longer wanted.

## Decision

Remove the `gemini-pro` and `gemini-flash` profiles and strategies. Ship only
the chemical `gemini` ladder: Krypton XL → Carbon L → Argon M → Hydrogen S.

The chemical strategy deliberately does not claim IDs whose first tier segment
is `pro` or `flash`. Pro, Pro Preview, Flash, and Flash Lite parents therefore
have an unknown family and are retained for every role, even when other exact
same-version Pro, Flash, or chemical candidates are runnable. Bare Gemini IDs
remain supported IDs with an unknown tier and are also retained.

Explicit exact model pins remain available for any registered model, including
Pro and Flash; this decision removes automatic-routing support, not the ability
to select those models deliberately.

## Consequences

- The package returns to eight shipped routing families.
- No Flash tier has an S or other size label because Flash has no shipped
  Gemini profile.
- The generated model matrix contains only the chemical Gemini ladder.
- Tests assert that unsupported Pro and Flash IDs are unclaimed and retained
  rather than routed to chemical models or to one another.
