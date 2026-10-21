---
status: accepted
date: 2026-10-22
---

# 0001 — Publish the service under this package's own identity

The inherited runtime published its `SubagentsService` on
`Symbol.for("@gotgenes/pi-subagents:service")`. This derivative publishes it
on `Symbol.for("@code-fixer-23/pi-tiered-subagents:service")` instead.

## Context

The upstream key is a global registry key, not a module-scoped one: two
runtimes loaded in the same session would write the same slot, and the second
to publish would silently replace the first's service. The specification asks
for a replacement runtime, not a second orchestrator, and asks that the
programmatic service be published "under this package's own identity rather
than overwriting the original package's global identity".

Keeping the upstream key would also mean that installing this package beside
the original silently disables the original — a failure nobody would read
about.

## Decision

Publish under this package's own symbol key, and pin the separation in
`test/service/service.test.ts`: the suite asserts that publishing leaves the
upstream key untouched.

## Consequences

- A consumer that wants *this* runtime's service must import
  `@code-fixer-23/pi-tiered-subagents` and read the service from there.
- The event channels (`subagents:started` and friends) keep their inherited
  names; they are namespaced by the session's event bus rather than by the
  global key, and the specification does not change them.
