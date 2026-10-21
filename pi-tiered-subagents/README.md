# pi-tiered-subagents

Documentation baseline for a family-aware Pi subagent runtime. The runtime is
not ready for installation: the scaffold and experimental source are unfinished
and are not included in this documentation-only baseline.

## Current design

- [Approved specification](docs/SPEC.md), also published as
  [GitHub issue #8](https://github.com/louiss0/pi-packages/issues/8).
- [Illustrated source guide and historical proposal](docs/how-it-works.html).
  Open the HTML file in a browser. Its early routing proposals are superseded
  by the specification; the status banner distinguishes them from implemented
  behaviour.

The intended package is an independent derivative, not a compatibility promise
or a finished port. Development begins with understanding the inherited
behaviour, establishing tests, and reproducing bugs before incremental OOP
refactoring and implementation of the agreed changes.

## Source attribution and reference documents

The source material and copied reference documentation come from
[@gotgenes/pi-subagents](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
version 25.0.1, by Chris Lasher, under the MIT licence. That project describes
itself as a friendly fork of
[@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents).

The following are preserved upstream reference snapshots, not newly accepted
architecture decisions or configuration instructions for this derivative:

- [Configuration reference](docs/configuration.md).
- [Comparison with upstream](docs/comparison-with-upstream.md).
- [Architecture](docs/architecture/architecture.md) and its linked history.
- [Decision records](docs/decisions/).

Relative source/test links in those snapshots refer to the original project
layout and may not be present in this documentation-only baseline. Their
original context is the upstream project linked above. Where the approved
specification differs, treat the difference as an intentional requirement to
implement and test, not evidence that the inherited runtime already behaves
that way.

The `inherit` tool-selection convention was informed by
[Nico Bailon's pi-subagents](https://github.com/nicobailon/pi-subagents).
This project's specified semantics are distinct: the parent's active tools,
excluding subagent-management tools.

See [LICENSE](LICENSE) for this package and [LICENSE.upstream](LICENSE.upstream)
for the preserved upstream licence notice.
