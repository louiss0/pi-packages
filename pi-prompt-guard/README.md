# pi-prompt-guard

![pi-prompt-guard](https://raw.githubusercontent.com/louiss0/pi-packages/main/pi-prompt-guard/assets/big-pi-prompt-guard.png)

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-prompt-guard)](https://www.npmjs.com/package/@code-fixer-23/pi-prompt-guard)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-prompt-guard)](https://www.npmjs.com/package/@code-fixer-23/pi-prompt-guard)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/louiss0/pi-packages/ci.yml?branch=main)](https://github.com/louiss0/pi-packages/actions)

`pi-prompt-guard` adds a validation layer in front of PI prompt execution. It intercepts slash-command prompt usage, resolves matching prompt files through PI's command registry, parses the prompt definition with `@code-fixer-23/pi-prompt-parser`, and blocks invalid input before the agent starts. This helps catch malformed prompt templates, missing required arguments, mismatched positional placeholders, and quoting mistakes early, so prompt-driven workflows fail fast with actionable feedback instead of producing confusing agent behavior later in the turn.


This package is meant to run as a PI extension and depends on the PI extension runtime.

## pi-prompt-guard

This package contains a single extension in `extensions/index.ts`. Its job is to guard prompt execution at input time, before PI expands the selected prompt into agent input.

### Features

#### Prompt command validation

When a user types a slash command, the extension checks PI's available commands with `getCommands()` and narrows the result to prompt-backed commands. If the slash command does not resolve to a prompt, the extension stops the request and notifies the user immediately instead of letting an invalid prompt reference continue through the session.

Once a prompt command is found, the extension reads the prompt file from `sourceInfo.path` and validates it in the same order the parser expects:

1. `parseTemplate` extracts the prompt body and `argument-hint` frontmatter.
2. `parseArgumentHint` validates the declared argument contract.
3. `parsePlaceholders` validates the placeholder usage inside the prompt body.

If any stage fails, the extension returns `{ action: "handled" }` and reports the parsing error through `ctx.ui.notify(..., "error")` so the user gets feedback immediately.

#### Argument hints, placeholders, and runtime input

The core contract in this package is the relationship between a prompt's `argument-hint` and the placeholders used in the prompt body.

`argument-hint` defines the command surface the user is expected to type. For example:

```md
---
argument-hint: <project> [version]
---
```

This declares two positions:

- position `1` is required and named `project`
- position `2` is optional and named `version`

Placeholders then decide how those declared positions are consumed inside the prompt body:

- `$1` uses the first declared argument
- `$2` uses the second declared argument
- `{@:2}` uses a slice starting at argument `2`
- `{@:2:4}` uses a bounded slice across declared positions
- `$ARGUMENTS` refers to the declared argument set as a group
- `$@` behaves like a rest-style passthrough for trailing input

That means `argument-hint` is not just documentation. In `pi-prompt-guard`, it is treated as the prompt's public input contract, and placeholders are validated against that contract before the prompt is allowed to run.

At runtime, the extension validates two things together:

- **the prompt definition itself** — whether the placeholders make sense for the declared `argument-hint`
- **the user's invocation** — whether the values typed after the slash command satisfy that declared contract

For fixed positional prompts, this catches mismatches such as a prompt declaring only `<project>` but using `$2` in the body. It also blocks user input that omits required arguments or sends more positional arguments than the prompt supports.

#### Argument handling and quoting guidance

The extension validates both the prompt definition and the arguments the user typed for that prompt.

It checks for:

- missing required arguments declared in `argument-hint`
- too many positional arguments when a prompt only supports fixed positions
- placeholder references such as `$2` or finite slices that exceed the arguments declared by the prompt
- invalid uses of `$ARGUMENTS` when no arguments are declared
- malformed quoted input such as unterminated `'...'` or `"..."`

It also tokenizes prompt input with quote awareness, so users can pass multi-word values like:

```text
/release "my project" 1.0.0
```

When input appears to be split incorrectly, the extension advises users to wrap space-containing arguments in single or double quotes. This makes prompt usage more predictable for prompts that rely on positional values.

#### Fixed arguments vs. `$ARGUMENTS` vs. `$@`

The extension distinguishes between three prompt styles and validates them differently:

- **Fixed positional prompts** use placeholders like `$1`, `$2`, or finite slices. These prompts must stay consistent with the declared `argument-hint`. If the highest referenced placeholder position is greater than the number of declared arguments, the prompt is rejected before execution.
- **`$ARGUMENTS` prompts** are treated as argument-aware prompts that can consume the declared argument set more flexibly, but they still require the prompt to declare arguments explicitly. A prompt that uses `$ARGUMENTS` without any declared arguments is rejected.
- **`$@` prompts** are treated as rest-style prompts that intentionally accept trailing input beyond a fixed argument count. They are not validated as strict positional contracts in the same way fixed placeholders are.

This separation helps prompt authors choose whether a prompt should behave like a strict command interface or a more open-ended passthrough.

#### Session workflow and UI lifecycle

The extension coordinates prompt guarding as part of the PI session lifecycle rather than as isolated callbacks. When a session starts, `session_start` initializes the widget controller and marks the extension as ready. As soon as the user submits input, the `input` handler switches the widget into a guarding state and performs prompt lookup, parsing, and argument validation before PI continues with prompt expansion.

If validation succeeds, PI can continue into its normal prompt expansion and agent startup flow. Right before the agent begins its work, `before_agent_start` updates the widget to reflect that guarding has finished and the request is moving into execution. After the turn completes, `turn_end` restores the ready state so the next prompt invocation starts from a known baseline.

This event chain keeps the UI synchronized with the validation workflow: the user sees when prompt guarding starts, when execution is about to begin, and when the extension is ready for the next command.

#### Extension load signaling

After registration, the extension emits `pi-prompt-guard:loaded`. This allows other extensions or package-level integrations to detect that prompt guarding is available and coordinate around it if needed.

## Development

Useful Nx targets for this package:

```bash
pnpm nx lint pi-prompt-guard
pnpm nx typecheck pi-prompt-guard
pnpm nx test pi-prompt-guard
pnpm nx check pi-prompt-guard
```

The extension depends on `@code-fixer-23/pi-prompt-parser`, so prompt parsing behavior is shared rather than reimplemented locally.
