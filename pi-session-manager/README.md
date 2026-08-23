# pi-session-manager

![Session Manager](https://raw.githubusercontent.com/louiss0/pi-packages/main/pi-session-manager/assets/Pi-Session_Manager-Big.png)


[![npm version](https://img.shields.io/npm/v/@code-fixer-23/pi-session-manager.svg)](https://www.npmjs.com/package/@code-fixer-23/pi-session-manager)
[![downloads](https://img.shields.io/npm/dm/@code-fixer-23/pi-session-manager.svg)](https://www.npmjs.com/package/@code-fixer-23/pi-session-manager)
[![license](https://img.shields.io/npm/l/@code-fixer-23/pi-session-manager.svg)](./LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)


`pi-session-manager` adds local session cleanup and series management workflows to PI. It helps keep session history organized by pruning stale sessions stored on your machine, naming related sessions consistently, and carrying series context forward between sessions. The package plugs into PI's extension lifecycle so it can react when a session starts, restore persisted series metadata, and expose commands that coordinate session creation, continuation, and cleanup.

## pi-session-manager

This package ships a single PI extension in `extensions/index.ts`, supported by a small test suite and a helper script for scaffolding additional extension entry points.

### Behavior overview

The extension centers on two workflows:

1. **Session cleanup** — it can remove inactive local sessions automatically on startup or manually through commands.
2. **Session series management** — it records related sessions under a shared series name, preserves that context across session restarts, and lets you continue or extend a series later.

On session start, the extension first restores any persisted series data from the temp directory so PI can resume the correct session name and custom entry. When the session starts normally or after a reload, it also loads the package config, checks the cleanup rules, and removes stale local sessions if they exceed the configured age limit.

If you want a session gone, delete it through the package commands instead of editing the config by hand. The config is an internal coordination file, not a user-edit surface.

> Warning: do not edit the extension's stored settings directly. If you need to remove a series, use `session-manager:series delete` and let the package update its own state.

### Commands

All commands live under the `session-manager` namespace. Every cleanup command that works on the current project has an `:all` twin that works on **every** session in the sessions area (`~/.pi/agent/sessions/`), no matter which project it belongs to. After any deletion, you are shown the list of deleted sessions grouped and sorted by project name.

#### `session-manager:clean:inactive`
Deletes local sessions that have been inactive longer than the configured day limit. This command reads the day limit from the shared extension settings, so the cleanup window matches the same rule used during startup cleanup. Use this when you want PI to resume with a clean local session set without manually touching files.

#### `session-manager:clean:inactive:all`
The same inactivity rule as `session-manager:clean:inactive`, but applied to every session stored in the sessions area across all projects. This is the tool for pruning outdated sessions from projects you no longer work in.

#### `session-manager:clean:older-than <duration>`
Deletes local sessions older than a specific duration. The argument accepts either full units like `5days`, `2weeks`, `12hours` or shorthand forms like `5d`, `2w`, `12h`. This is useful when you want to remove sessions using an ad hoc retention threshold instead of the saved day limit.

#### `session-manager:clean:older-than:all <duration>`
The same duration rule as `session-manager:clean:older-than`, but applied to all sessions in the sessions area across every project.

#### `session-manager:delete-last <count>`
Deletes the most recent N local sessions. The argument is an integer from 1 to 10, which makes it a quick recovery tool for removing only the newest session files when you want to clean up by hand.

#### `session-manager:delete-last:all <count>`
Deletes the most recent N sessions across every project in the sessions area. Like the local variant, the count is an integer from 1 to 10. A completion hint labels each option as "last N in every project" so it is easy to tell apart from the project-scoped command.

#### `session-manager:series <action>`
Coordinates the session-series lifecycle. The available actions are:

- `create` — create a new series and a first session inside it, then persist the resulting session metadata so PI can restore the series context later.
- `new` — add a new session to an existing series and keep the series record updated.
- `continue` — inspect the currently active session entry, recover its series, and start the next session in that same chain.
- `delete` — remove a series and all local session files whose names start with that series prefix. This is the safest way to remove a series; avoid editing the config file directly.

### Deleted session report
Every manual cleanup command (local and `:all`) finishes by presenting what was removed. Sessions are sorted by project name — derived from the deepest folder segment of each session's working directory — then by modified time inside each project, and rendered as a grouped listing:

```
Removed 3 session(s):
project-a
  Refactor Auth--Create JWT Token
project-b
  Fix Memory Leak--Patch Heap Snapshot
  UI Migration--Move Button Component
```

### Features

#### Startup lifecycle coordination
The extension listens to PI session startup and reload events to restore persisted session-series data before the rest of the session flow continues. That lets PI reopen the correct session name and custom entry even after a new process starts.

#### Persistent session-series state
When a series session is created, the extension writes a small temp file in the OS temp directory. On the next session start, it consumes that file, applies the stored session name and entry, and then removes the temp file so the state only applies once.

#### Configured cleanup rules
Settings are persisted through [@juanibiapina/pi-extension-settings](https://www.npmjs.com/package/@juanibiapina/pi-extension-settings). The `Session Deletion Day Limit` setting controls the automatic inactivity cleanup threshold and can be changed from PI with the `/extension-settings` command (default: 3 days). The series/title structure per working directory is remembered in the same store under the `pi-session-manager` extension name.

Treat these stored values as internal state. Do not edit them manually unless you are debugging the package itself. If you need to remove a series, use `session-manager:series delete` instead of changing the stored settings.

The package is designed to work with local session files only, so it should never be treated as a remote or shared-session cleanup tool.

### Developer notes

- Package metadata lives in `package.json` and identifies this as a PI extension package.
- The implementation is in `extensions/index.ts`.
- Tests live alongside the extension in `extensions/index.test.ts`.
- `scripts/create-extension.ts` is a small helper for scaffolding a new extension file under `extensions/`.

### Assets in this repository

- `extensions/` — extension implementation and tests
- `scripts/` — helper script for creating new extension files
- No `prompts/`, `skills/`, or `themes/` directories are present in this package
