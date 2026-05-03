# nu-bash

Pi extension that routes the `bash` tool and `user_bash` commands through Nushell.

## Features

- Runs `bash` tool commands with `nu -c`
- Routes `!` and `!!` commands through Nushell
- Streams output for tool execution
- Supports cancelling long-running commands
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
