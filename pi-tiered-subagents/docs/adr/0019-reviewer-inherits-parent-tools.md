---
status: accepted
date: 2026-11-15
supersedes: 0004 for Reviewer's tool selection
---

# 0019 — Reviewer inherits parent tools

## Context

The shipped Reviewer had a fixed `read`, `grep`, and `find` list, while Worker
and Debug already inherited the parent's active tools. The maintainer wants
Reviewer to use the same request-time tool inheritance so reviews can run
relevant commands and checks without changing the parent's tool setup.

## Decision

The shipped Reviewer uses `tools: { kind: "inherit" }`. It receives the parent's
active capability tools captured at invocation. Its standing instructions still
forbid file edits but explicitly permit commands, tests, and other validation;
reports must distinguish checks actually run from inference.

This is a new shipped default, not a role-specific override exception. Global
and project Reviewer definitions may still replace the selection with an
explicit list or no tools. Existing recursion exclusions, MCP expansion rules,
request-time snapshots, and capability-based workspace scheduling remain in
force. Inherited shell, editor, or unknown tools therefore classify Reviewer as
potentially file-changing for scheduling even though its instructions forbid
edits.

## Consequences

- Reviewer can validate a change with the parent's available tooling and can no
  longer claim that commands are inherently unavailable.
- A parent without `grep` or `find` does not add those tools to an inherited
  Reviewer; an explicit Reviewer override retains the old behavior when needed.
- Tool inheritance does not permit recursive delegation and is not a filesystem
  sandbox or removal of the non-editing behavioral contract.
