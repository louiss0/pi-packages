---
status: accepted
date: 2026-10-25
---

# 0012 — Own the implementation locally and retire the migration checkout

This workspace is the maintained implementation of
`@code-fixer-23/pi-tiered-subagents`. The temporary checkout used to import the
upstream source is migration scaffolding, not a development dependency; its
provenance remains documented after the checkout is gone.

## Context

The implementation began as a credited derivative of
`@gotgenes/pi-subagents` v25.0.1, itself a friendly fork of
`@tintinweb/pi-subagents`. Keeping a temporary source checkout beside the
maintained package made it unclear which tree owned new work and allowed tests
or documentation to depend accidentally on migration scaffolding. Discarding
attribution along with that checkout would instead erase the project's origin
and licence obligations.

The architecture and modernization work also changed behavior deliberately.
Those changes need to remain distinguishable from compatibility adaptations
and independently reproduced defects rather than being described as one
undifferentiated repair effort.

## Decision

- Maintain and verify the implementation only in this workspace. The locally
  owned architecture specification, glossary, and `docs/adr/` decisions are
  authoritative; copied `docs/architecture/` and `docs/decisions/` material is
  historical provenance.
- Retire only the identified `%TEMP%/gotgenes-pi-subagents` checkout after
  rechecking its path, origin, expected HEAD, and absence of local work, and
  after confirming that verification does not reference it. Do not alter any
  remote repository, unrelated checkout, sibling package, or migrated source.
- Preserve public credit to the immediate source, version, author, upstream
  lineage, and applicable MIT notices independently of the local checkout.
- Keep intentional product/architecture changes separate from SDK compatibility
  adaptations and reproduced bug fixes in current documentation and review.
  Modernization stays targeted at correctness and maintenance benefits rather
  than becoming another broad rewrite.

## Consequences

The verified temporary clone was removed on 2026-10-25. Its origin was
`https://github.com/gotgenes/pi-packages.git`, its HEAD was
`cd353d754517f35a1c284930a3647fa521e0c3f1` (the `pi-subagents-v25.0.1` tag),
and its working tree, untracked-file set, and stash were empty. The remote was
not changed. Source, tests, and configuration had no dependency on its path;
verification after removal establishes independence from it.

The README and licence files remain part of the maintained package. Future
changes are reviewed against this repository's specifications and decisions,
not against the presence of a second local implementation.
