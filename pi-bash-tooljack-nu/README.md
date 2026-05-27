# @code-fixer-23/pi-bash-tooljack-nu

`@code-fixer-23/pi-bash-tooljack-nu` keeps Pi's bash-oriented workflow but executes it through Nushell, adds command-aware completion, and makes command reuse faster with both history search and Command Hash Search.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-bash-tooljack-nu)](https://www.npmjs.com/package/@code-fixer-23/pi-bash-tooljack-nu)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-bash-tooljack-nu)](https://www.npmjs.com/package/@code-fixer-23/pi-bash-tooljack-nu)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

## Tools

### `bash`

The `bash` tool preserves Pi's familiar shell tool name while executing the command with `nu -c` instead of Bash. Output streams back while the command runs, cancellations are propagated to the Nushell process tree, timeouts are enforced, and oversized output is truncated into a saved `nu-tool-output_<timestamp>.txt` file.

Arguments:

- `string:command` is the Nushell command text to execute in the current working directory
- `number:timeout` optionally aborts the command after the given number of seconds

## Shortcuts

### `Ctrl`+`H`

Opens a recent Nushell history picker, filters out `pi` commands, lets you type to narrow the list in place, and executes the selected history entry directly through Nushell when you press `Enter`. This makes it easy to rerun or adapt previous shell work without retyping it into the editor.

## Features

- `#` starts **Command Hash Search** inside the editor. When you type `#` followed by a command prefix, the extension queries Nushell command metadata and suggests matches by name, category, description, and search terms.
- `#` also improves insertion behavior for closure-taking commands. When a selected command expects a closure or block, the completion inserts ` {|$in| $in }` so the pipeline is ready to edit immediately.
- `$env` powers Nushell-aware environment completion. Typing `$env` or `$env.` suggests the Nushell environment record and matching environment variable names from the current process.
- `session_start` installs a custom editor wrapper so Pi's editor keeps its normal autocomplete flow while gaining Nushell-specific completion behavior.
- `user_bash` replaces Pi's default bash operations with Nushell-backed execution so shell entry points continue to work with the Nushell runtime.
- Large command output is preserved instead of dropped. When output exceeds Pi's byte or line limits, the full text is written to disk and the tool returns a compact pointer to that file.

## Development

Run tasks through Nx from the workspace root:

```sh
pnpm nx run pi-bash-tooljack-nu:typecheck
pnpm nx run pi-bash-tooljack-nu:lint
pnpm nx run pi-bash-tooljack-nu:test
pnpm nx run pi-bash-tooljack-nu:metadata
pnpm nx run pi-bash-tooljack-nu:check
```
