# pi-session-manager

[![npm version](https://img.shields.io/npm/v/@code-fixer-23/pi-session-manager.svg)](https://www.npmjs.com/package/@code-fixer-23/pi-session-manager)
[![downloads](https://img.shields.io/npm/dm/@code-fixer-23/pi-session-manager.svg)](https://www.npmjs.com/package/@code-fixer-23/pi-session-manager)
[![license](https://img.shields.io/npm/l/@code-fixer-23/pi-session-manager.svg)](./LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

`pi-session-manager` adds local session cleanup and series management workflows to PI. It helps keep session history organized by pruning stale sessions stored on your machine, naming related sessions consistently, and carrying series context forward between sessions. The package plugs into PI’s extension lifecycle so it can react when a session starts, restore persisted series metadata, and expose commands that coordinate session creation, continuation, and cleanup.

## pi-session-manager

This package ships a single PI extension in `extensions/index.ts`, supported by a small test suite and a helper script for scaffolding additional extension entry points.

### Behavior overview

The extension centers on two workflows:

1. **Session cleanup** — it can remove inactive local sessions automatically on startup or manually through commands.
2. **Session series management** — it records related sessions under a shared series name, preserves that context across session restarts, and lets you continue or extend a series later.

On session start, the extension first restores any persisted series data from the temp directory so PI can resume the correct session name and custom entry. When the session starts normally or after a reload, it also loads the package config, checks the cleanup rules, and removes stale local sessions if they exceed the configured age limit.

If you want a session gone, delete it through the package commands instead of editing the config by hand. The config is an internal coordination file, not a user-edit surface.

> Warning: do not edit `pi-session-manager.config.json` directly. If you need to remove a series, use `session:series delete` and let the package update its own state.

### Commands

#### `session:clean:inactive`
Deletes local sessions that have been inactive longer than the configured day limit. This command uses the package config stored in the agent directory, so the cleanup window matches the same rule used during startup cleanup. Use this when you want PI to resume with a clean local session set without manually touching files.

#### `session:clean:older-than <duration>`
Deletes local sessions older than a specific duration. The argument accepts either full units like `5days`, `2weeks`, `12hours` or shorthand forms like `5d`, `2w`, `12h`. This is useful when you want to remove sessions using an ad hoc retention threshold instead of the saved day limit.

#### `session:delete-last <count>`
Deletes the most recent N local sessions. The argument is an integer from 1 to 10, which makes it a quick recovery tool for removing only the newest session files when you want to clean up by hand.

#### `session:series <action>`
Coordinates the session-series lifecycle. The available actions are:

- `create` — create a new series and a first session inside it, then persist the resulting session metadata so PI can restore the series context later.
- `new` — add a new session to an existing series and keep the series record updated.
- `continue` — inspect the currently active session entry, recover its series, and start the next session in that same chain.
- `delete` — remove a series and all local session files whose names start with that series prefix. This is the safest way to remove a series; avoid editing the config file directly.

### Features

#### Startup lifecycle coordination
The extension listens to PI session startup and reload events to restore persisted session-series data before the rest of the session flow continues. That lets PI reopen the correct session name and custom entry even after a new process starts.

#### Persistent session-series state
When a series session is created, the extension writes a small temp file in the OS temp directory. On the next session start, it consumes that file, applies the stored session name and entry, and then removes the temp file so the state only applies once.

#### Configured cleanup rules
The package stores its config in the PI agent directory as `pi-session-manager.config.json`. That config controls the automatic inactivity cleanup threshold and remembers the series/title structure per working directory.

Treat this file as internal state. Do not edit it manually unless you are debugging the package itself. If you need to remove a series, use `session:series delete` instead of changing the config file.

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
