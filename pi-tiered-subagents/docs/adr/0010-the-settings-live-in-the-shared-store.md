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

**What does the shared store hold?** Strings. One file for the operator —
`<agentDir>/settings-extensions.json` — and one for the project —
`<cwd>/.pi/settings-extensions.json` — keyed by extension name and then by
setting id. Every value is text, so the settings that carry structure (the
family profiles, the excluded packages, the prompt-inheritance map) are
serialized as JSON in one place, the adapter, and nowhere else.

**How are the layers merged?** The store's own convenience reads the project
and falls back to the operator's file, per setting. That answers "what is in
force", but not "what did the project declare for itself" — the answer to the
second question has to be the project's own file, read on its own. So the
adapter reads each file separately: the operator's file through the store's
global scope, the project's file through the store's project scope with the
operator's directory pointed away, so the fallback finds nothing. The
operational settings then merge per setting, the project's over the
operator's, and the family profiles merge per family, so a project replaces
one family and leaves the operator's others alone.

**What about the project's trust?** Pi owns project trust and extension
loading. This package originally added a second check of its own;
ARCHITECTURE-SPEC stories 36–37 superseded that clause. While this extension
runs, it reads the configured project layer like the global one and performs
no trust input, revalidation, or rejection branch of its own.

The store is also an *extension*: it offers a `/extension-settings` menu, and
an extension publishes its settings to that menu by emitting an event at load
time. The event reaches a registry the shared extension keeps, so the shared
extension has to be loaded first. The store's own file access does not depend
on that: the settings are read and written either way, and only the menu that
edits them is missing.

The store's runtime entry point is its TypeScript source, not compiled
JavaScript, so a consumer has to load it with a TypeScript-aware loader.
Pi's own loader is one, and the package's tests run under another: the
import was verified under Pi's loader before this decision was taken.

## Decision

- **The shared store is the only backend.** The settings module reads and
  writes through a small adapter over the store; it keeps no path of its own.
- **The adapter is the only place that serializes.** Everything above it
  speaks in the package's own vocabulary.
- **Each file is read on its own.** The store's project scope falls back to
  the operator's file, so the adapter reads the project's file without that
  fallback. The operational settings merge per setting; the family profiles
  merge per family.
- **The extension adds no trust policy.** Pi's own loading and resource
  behavior remain untouched; this package does not duplicate or revalidate
  them when reading either settings layer.
- **A save writes the project's own layer.** The operator's data — the
  families, the excluded packages, the inheritance rules — is not copied into
  the project's file, where it would outlive a later change to the operator's
  own settings. A value the project's file does not declare is not written at
  all, so the operator's value stays in force.
- **The settings are published to the shared menu.** The definitions name the
  values a menu can offer; the family profiles are data, not a menu entry.

## Consequences

- The settings moved: `subagents.json` is no longer read, and the shared
  store's file is where they live now. The old file is not migrated
  automatically — a hand-edited file stays where it is.
- A value that is not text is not a value: the store holds strings, so a
  number is read as its text and a malformed value is dropped.
- An empty list is a value, not the absence of one: a project that writes
  `[]` clears what the operator declared, and the empty list stays empty.
- The store owns its file's error handling: a malformed file is ignored
  quietly, where the inherited loader warned about it.
- The store keeps what it was given and never removes a key, so a value the
  package no longer writes stays in the file, and a value that is cleared is
  written as an empty one.
- The inherited generic loader (`loadLayeredSettings`) is still exported for
  other packages that read their own files; it is no longer this package's
  backend.
