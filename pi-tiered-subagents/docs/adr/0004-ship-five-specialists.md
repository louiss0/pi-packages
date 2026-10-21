---
status: accepted
date: 2026-10-22
---

# 0004 — Ship five specialists, not upstream's role set

The package ships `explore`, `worker`, `reviewer`, `debug`, and `researcher`.
Upstream's `general-purpose`, `Explore`, and `Plan` are gone.

## Context

Upstream shipped a general-purpose agent plus two read-only specialists, each
with a hard-coded model and a long prompt. The specification names five roles
with a distinct capability boundary each, and says the set is deliberately
focused rather than an unexamined copy of upstream's.

The two designs disagree about the most important thing in the package: what a
child may do. Upstream's `Explore` had a fixed model and a read-only tool list
written into its prompt text ("STRICTLY PROHIBITED from..."), while the
specification makes the tool list the *enforcement* and the instructions the
explanation.

## Decision

Ship five definitions, each with an exact tool list and standing instructions:

| Role | Tools | Conversation | Runs in |
| --- | --- | --- | --- |
| `explore` | read, grep, find, ls | fresh | background |
| `worker` | inherits the parent's | fresh | background |
| `reviewer` | read, grep, find | fresh | background |
| `debug` | inherits the parent's | **inherited** | background |
| `researcher` | read, grep, find, ls, web_search | fresh | background |

The identifiers are lowercase; the display names are separate, so a parent
sees "Explore" while the record carries "explore".

## Consequences

- An agent definition is a *capability boundary* first: the tool list decides
  what a child can do, and the instructions explain how it works.
- `worker` and `debug` inherit the parent's tools, so they work with whatever
  the session has rather than a hard-coded list.
- `debug` starts from the parent's conversation, because a diagnosis needs the
  symptoms already discussed; every other role starts fresh, because a
  delegated task is better served by a focused context.
- The researcher's `web_search` is an ordinary tool-list entry. It does not
  install anything and does not require a search provider to be present: a
  specialist that lists a tool the session does not have simply does not have
  it.
