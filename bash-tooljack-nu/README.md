# bash-tooljack-nu

`@code-fixer-23/bash-tooljack-nu` is a Pi extension that hijacks the `bash` tool and `user_bash` commands, then runs them through Nushell instead.

## Idea

This package exists for one purpose: keep the familiar bash-facing interface in Pi while swapping the shell implementation underneath to Nu.

In practice that means:

- Pi still calls the `bash` tool
- users can still use `!` and `!!`
- Nushell becomes the command runner behind that interface

## Features

- Routes `bash` tool execution through `nu -c`
- Routes `!` and `!!` commands through Nushell
- Streams command output during tool execution
- Supports cancellation for long-running commands
- Adds `$env` autocomplete in the Pi editor

## Development

```sh
pnpm install
pnpm check
pi --extensions .
```

## Package contents

This package publishes a single Pi extension entrypoint:

- `index.ts`

## Publish checklist

```sh
pnpm check
pnpm pack --dry-run
npm publish --access public
```
