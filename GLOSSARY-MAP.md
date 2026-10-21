# Domain glossary map

This workspace uses package-scoped domain contexts.
Read only the contexts relevant to the task; read all affected
contexts for cross-package work.

## Existing sources

### Agent-resource authoring — `pi-agent-resource`

Read the [Agent Resources glossary](pi-agent-resource/GLOSSARY.md)
for the established vocabulary: agent definition, subagent runtime,
agent manager, and runtime profile. Agent-resource authoring produces
definitions for subagent runtimes; it does not execute those agents.

### Subagent execution — `pi-tiered-subagents`

Read the [Subagent execution glossary](pi-tiered-subagents/GLOSSARY.md)
for the package's own vocabulary: agent definition, definition file,
identifier, layer, tool selection, shipped specialist, and parent snapshot.

Consult the inherited
[decision records](pi-tiered-subagents/docs/decisions/)
when changing source-derived behaviour, and this package's own
[decision records](pi-tiered-subagents/docs/adr/) for the decisions this
derivative made.

The [specification](pi-tiered-subagents/docs/SPEC.md) records agreed
requirements, not a glossary or evidence of completed implementation;
[the status report](pi-tiered-subagents/docs/status.md) records what is
implemented.

## Extending the map

Add links to package glossaries as terminology is established.
Keep each definition authoritative in one place; link existing sources
rather than duplicating them.

Use package-local ADRs for package decisions and root ADRs for
cross-package decisions. Missing documents do not block exploration.
