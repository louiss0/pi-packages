---
status: accepted
date: 2026-10-22
---

# 0009 — One child at a time may change the workspace

Two children that may write the same file compete for it. The runtime lets
**one child that may change files run at a time** in a workspace; children
that only read run alongside it.

## Context

The specification asks for serialization "within a shared workspace", and it
is explicit about what the rule is *not*: it is not a sandbox, it does not
coordinate the parent's own edits, and it does not give a reader a
consistent snapshot while a writer works. It is a scheduling rule between
this runtime's children.

Two questions had to be answered before the code could be written.

**What decides whether a child may change files?** Not its role. A worker
whose definition was narrowed to reading changes nothing, and a reviewer
handed a shell changes everything — so the classification follows the child's
*effective* tools, the ones it will really have after its definition's
override.

**What about a tool the runtime has never heard of?** A tool name is data, so
the runtime could ask the session what a tool does — but that is a promise
about the future, and the cost of believing it wrongly is a corrupted
workspace. So the classification is one-sided: only the tools this package
knows to be read-only (the local readers and the web search) count as
read-only, and everything else — a shell, an editor, an extension's own tool —
takes the exclusive slot.

A third question was about *when* the rule applies. The concurrency limit
governs background runs, and a foreground run deliberately bypasses it: it
blocks the parent anyway. The workspace slot is not the same kind of rule. A
foreground child that may change files competes for the same files as a
background one, so it waits for the slot too — but not for a limiter slot.

## Decision

- **The classification follows the effective tools.** The child's tools are
  resolved the same way the session will resolve them — the definition's
  selection against the parent's active tools as they were when the request
  was made — so the runtime and the child never disagree about what the child
  can do.
- **Only known readers are read-only.** `read`, `grep`, `find`, `ls`,
  `web_search`, and `web_fetch` change nothing. Every other name, known or
  not, may change files.
- **One child at a time, per workspace.** The slot is held for the run, not
  for the request: a child waiting for it is queued, and an aborted child
  waiting for it never runs and never holds it.
- **The slot is per workspace, not per parent.** Two parents working in the
  same directory have children reaching for the same files, so they share one
  slot. The gate hands the slot straight to the next waiter, so no moment
  exists in which two children hold it.
- **A resume takes the same slot.** A resumed child reuses its session, and
  with it its tools, so the answer is the one its spawn gave.

## Consequences

- A file-changing child waits for the workspace even when the concurrency
  limit has room; a read-only child never waits.
- A foreground launch can now wait for a background child to finish before it
  starts. That is the rule working, not a queue: the parent is blocked on the
  result either way.
- The rule says nothing about the parent's own edits, another process in the
  same directory, or what a reader sees mid-write. It is a promise about this
  runtime's children only.
- An extension that ships a read-only tool under a name this package does not
  know takes the exclusive slot until the name is added to the known readers.
