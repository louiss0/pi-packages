---
status: accepted
date: 2026-10-22
---

# 0011 — The harness's own text is not inherited

A child adopts the operator's words, not the harness's. Pi's base identity,
its tool surface, and its documentation pointer stay with the parent session.

## Context

A child used to inherit the parent's identity region byte for byte, and that
region began with what Pi writes when no custom prompt is set: "You are an
expert coding assistant operating inside pi, a coding agent harness. You help
users by reading files, executing commands, editing code, and writing new
files."

That sentence describes the *harness's* role: an assistant helping a user,
with a shell and an editor. A child is none of those things. It is a
specialist with a named tool list — a read-only one has no shell and no
editor — and the inherited claim tells it to do what it cannot do, and to
coordinate, which is the parent's role rather than its own.

The tool surface was already dropped (upstream ADR 0011): Pi renders it from
the parent's own session, so an inherited copy is the parent's tools presented
as the child's. The documentation pointer went with the same reasoning — it
says when to read Pi's own documentation, in a session that is not about Pi.

What remained was the base identity, and it was the loudest of the three: it
is the first thing the child reads, and it is about the harness.

Two things had to be settled before the code could be written.

**How is Pi's own text told from the operator's?** Pi's renderer draws the
line itself. With a custom prompt, a session gets the prompt alone — no
`<tools>`, no `<rules>`, no `<docs>` section. Without one, it gets the base
identity followed by that tool surface. So the presence of Pi's tool surface
is the evidence: where it is, the text above it is Pi's base identity, and
the text of a session without it is the operator's own and stays.

**What is a child left with?** The package's own base — "Do what has been
asked; nothing more, nothing less." — which asserts nothing about the child's
tools, domain, or task. The `<active_agent>` tag names the child, the child's
own prompt states its role, and its tool array states its tools.

## Decision

- **The harness's own text is not inherited.** Pi's base identity, its tool
  surface, and its documentation pointer stay with the parent session.
- **The operator's own words are inherited.** A parent running a custom
  prompt has no tool surface, so nothing of Pi's is found, and the operator's
  prompt is adopted byte for byte.
- **The child's own base stands in the gap.** A child with nothing to adopt
  gets the package's generic base, never the parent's full prompt.
- **The anchors stay positional.** Pi's tool surface is recognised as the
  pair it renders — `<rules>` one blank line below `</tools>`, above every
  later section — so a `<tools>` block the operator wrote, or one quoted in a
  context file, is the operator's and stays.

## Consequences

- The child no longer shares a leading prefix with a parent that runs Pi's
  own prompt, so a host that reuses the parent's cache prefix over the
  system text has less to reuse. A parent running a custom prompt still
  shares it.
- The legacy prompt shape (through 0.85) is not narrowed: its preamble has no
  marker to locate it by, and that shape is no longer rendered by the Pi this
  package supports.
- The `portable` strategy is unchanged and still opt-in: it takes the
  operator-authored capture — the custom prompt and the appended prompt — for
  a provider that re-homes the prompt into another harness. The narrowing
  narrows the default strategy towards it; it does not replace it.
