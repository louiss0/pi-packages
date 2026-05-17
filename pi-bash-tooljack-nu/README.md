# pi-bash-tooljack-nu

`@code-fixer-23/pi-bash-tooljack-nu` is a Pi extension that keeps Pi's bash-facing workflow but executes commands with Nushell.

This package is for development on the extension itself. It is not user documentation for Pi or Nushell.

## What this project is

Pi exposes a `bash` tool and shell-style command entry points such as `!` and `!!`.
This extension swaps the underlying shell implementation from Bash to Nushell while preserving that familiar interface.

At a high level the extension:

- routes Pi bash tool execution through `nu -c`
- routes shell command entry through Nushell
- streams stdout and stderr back into Pi
- handles cancellation and timeouts for spawned Nushell processes
- truncates oversized tool output and writes the full output to a file
- adds Nushell-aware editor behavior such as command and `$env` autocomplete
- provides a recent Nushell history picker for command reuse

## Project layout

- `src/index.ts` - extension entrypoint, process execution, editor wiring, truncation, and command registration
- `src/command.ts` - Nushell command metadata lookup and autocomplete parsing
- `src/history.ts` - recent history query, filtering, and picker UI
- `src/*.spec.ts` - Vitest coverage for the extension helpers and behaviors

## Prerequisites

Before developing locally, make sure you have:

- Node.js
- pnpm
- Nushell installed and available as `nu`
- Pi available locally if you want to run the extension interactively

## Install

From the workspace root:

```sh
pnpm install
```

## Develop locally

Run the package checks through Nx from the workspace root:

```sh
pnpm nx run pi-bash-tooljack-nu:check
```

You can also run individual tasks:

```sh
pnpm nx run pi-bash-tooljack-nu:typecheck
pnpm nx run pi-bash-tooljack-nu:lint
pnpm nx run pi-bash-tooljack-nu:test
```

If you want to work from the package directory instead:

```sh
cd pi-bash-tooljack-nu
pnpm check
```

## Run the extension in Pi

From the workspace root:

```sh
pi --extensions ./pi-bash-tooljack-nu
```

That loads the extension from this package so you can verify command execution, autocomplete, and history behavior in a real Pi session.

## What to test when making changes

When editing this project, verify the parts affected by your change:

- bash tool execution still runs through Nushell
- command cancellation and timeouts still stop the Nushell process tree
- autocomplete still returns Nushell commands and `$env` suggestions
- closure-aware completions still insert closure scaffolding where needed
- history queries still exclude Pi commands and render recent commands correctly
- large command output is still truncated and persisted correctly

## Notes for contributors

- This package is an Nx library inside the `pi-packages` workspace.
- Prefer running tasks through `pnpm nx run ...` from the workspace root.
- The package entrypoint is declared in `package.json` under `pi.extensions`.
- The extension assumes `nu` is present on `PATH`.

## Release sanity check

Before publishing, run:

```sh
pnpm nx run pi-bash-tooljack-nu:check
pnpm --dir pi-bash-tooljack-nu pack --dry-run
```
