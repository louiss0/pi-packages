---
status: accepted
date: 2026-10-22
---

# 0005 — A definition has one shape: no prompt mode, no locks

A definition carries a body, a tool selection, and a handful of settings. It
does not carry a prompt mode, and it cannot lock a field against its callers.

## Context

Upstream's agent files could name two things this specification does not have:

- `prompt_mode: append | replace` — whether the child's system prompt embedded
  the parent's prompt in an `<agent_instructions>` wrapper or replaced it.
- `locked: model | thinking | ...` — a declaration that a caller may not
  override the named fields.

Both are mechanisms for the same question — "who wins?" — and the
specification answers it once: the request wins, and the definition fills what
the request does not name. A second mechanism would make the answer depend on
which file the reader happened to open, and the specification's own precedence
rules are unconditional ("a tool-call model override wins over an agent-file
model").

The prompt mode goes with them: with no mode to select, the child's prompt has
one shape — the inherited identity, then the project context, then the header,
then the standing instructions in the standard wrapper.

## Decision

Remove `prompt_mode` and `locked`. A definition's body is its standing
instructions; an empty body inherits the instructions of the layer below, and a
nonempty body replaces them.

## Consequences

- The "twin" label, which marked an append-mode child in the widget and the
  transcript heading, is gone: every child adopts the parent's identity
  prefix now, so the label would mark everything.
- Upstream's `<agent_instructions>` wrapper is the only shape. A specialist's
  body is now always wrapped, so it reads as the specialist's instructions
  rather than as the whole prompt.
- The parent's *orchestration* instructions are still excluded, because
  upstream's inherited-identity cut already removes the session-resolved tail
  (ADR 0006, ADR 0008). What a child inherits is the operator's and the
  project's own words, not the parent's coordinator role.
