---
status: accepted
date: 2026-10-22
---

# 0010 — The settings live in the shared store

This package's settings live in `@juanibiapina/pi-extension-settings`, the
store every extension can share. This package keeps no settings file of its
own.

## Context

The inherited runtime kept its operational settings in
`~/.pi/agent/subagents.json` and `<cwd>/.pi/subagents.json`, and the family
profiles needed a place of their own — which, for a while, was a second
loader with its own paths. Two stores for one extension is one too many, and
an operator with several extensions has to look in several places.

The specification names the shared store as the single backend. Before the
code could be written, three things had to be answered.

**What does the shared store hold?** Strings. One file per scope — the
operator's `<agentDir>/settings-extensions.json` and the project's
`<cwd>/.pi/settings-extensions.json` — keyed by extension name and then by
setting id. Every value is text, so the settings that carry structure (the
family profiles, the excluded packages, the prompt-inheritance map) are
serialized as JSON in one place, the adapter, and nowhere else.

**How are the layers merged?** The store's own convenience reads the project
and falls back to the operator's file, per setting. That is right for the
operational settings and wrong for the family profiles: a project replaces one
family and leaves the operator's others alone. So both scopes are read
separately and the profiles are merged per family.

**What about the project's trust?** The project's scope is only read when Pi
has granted the project trust. The trust decision is a session fact, so the
settings are read again when the session starts.

The store is also an *extension*: it offers a `/extension-settings` menu, and
an extension publishes its settings to that menu by emitting an event at load
time. The event reaches a registry the shared extension keeps, so the shared
extension has to be loaded first. The store's own file access does not depend
on that: the settings are read and written either way, and only the menu that
edits them is missing.

## Decision

- **The shared store is the only backend.** The settings module reads and
  writes through a small adapter over the store; it keeps no path of its own.
- **The adapter is the only place that serializes.** Everything above it
  speaks in the package's own vocabulary.
- **The scopes are read separately.** The operational settings merge per
  setting; the family profiles merge per family.
- **A save writes the project's own layer.** The operator's families are not
  copied into the project's file, where they would outlive a later change to
  the operator's own settings.
- **The settings are published to the shared menu.** The definitions name the
  values a menu can offer; the family profiles are data, not a menu entry.

## Consequences

- The settings moved: `subagents.json` is no longer read, and the shared
  store's file is where they live now. The old file is not migrated
  automatically — a hand-edited file stays where it is.
- A value that is not text is not a value: the store holds strings, so a
  number is read as its text and a malformed value is dropped.
- An empty list and an empty object say what an absent setting says, so they
  are dropped rather than carried.
- The store owns its file's error handling: a malformed file is ignored
  quietly, where the inherited loader warned about it.
- The inherited generic loader (`loadLayeredSettings`) is still exported for
  other packages that read their own files; it is no longer this package's
  backend.
