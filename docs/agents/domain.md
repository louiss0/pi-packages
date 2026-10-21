# Domain docs

## Layout

Use multi-context documentation organized by workspace package.
`GLOSSARY-MAP.md` is the root index.

Package vocabulary belongs in `<package>/GLOSSARY.md`.
Package decisions belong in `<package>/docs/adr/`.
Cross-package decisions belong in root `docs/adr/`.

## Before exploring a domain

1. Read `GLOSSARY-MAP.md` and the relevant terminology sources.
2. Read ADRs affecting the topic, including package-local decisions.
3. For cross-package work, consult each relevant context.

Agent-resource authoring terminology is defined in
`pi-agent-resource/GLOSSARY.md`. Consult it for authoring work and
cross-package work involving agent definitions or runtime profiles.
Keep those definitions authoritative there rather than duplicating them.

The copied `pi-tiered-subagents/docs/decisions/` records describe
upstream decisions. Consult them when modifying inherited behaviour;
distinguish them from decisions adopted for this derivative.

When a glossary or ADR directory does not exist, proceed silently.
Create domain documentation lazily through domain-modeling as terms
and decisions are resolved, then update the map.

## Vocabulary and conflicts

Use the relevant glossary's preferred terms and avoid its listed
synonyms. Surface conflicts with applicable ADRs explicitly rather
than silently overriding them.

Treat specifications as requirements, not proof of implemented
behaviour or substitutes for accepted ADRs.
