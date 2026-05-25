# @code-fixer-23/pi-form-components

`@code-fixer-23/pi-form-components` provides reusable Pi TUI form building blocks for extension packages, including an options-first `Form` API, labeled text inputs, confirmation checkboxes, and small shared utilities.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

## Components

### `Form`

`Form` coordinates focus, validation, submission, and footer rendering for a group of Pi TUI form fields.

```ts
new Form(
  {
    title: "Create Prompt",
    fields,
    parse,
    footer: "Enter next/submit | Tab switch field | Esc cancel",
    spacing: 1,
  },
  tui,
  done,
);
```

Constructor arguments:

- `object:options` configures the form and is now the first argument
  - `string:title` centers a title above the fields
  - `FormField[]:fields` defines the ordered interactive inputs
  - `Parse<T>:parse` validates the collected values and returns field errors
  - `string:footer` adds optional help text below the fields
  - `number:spacing` controls the blank lines inserted between fields
- `TUI:tui` requests rerenders after focus and validation changes
- `function:done` receives either the parsed values or `null` when the form is cancelled

### `LabelledInput`

`LabelledInput` renders a field label, accepts text input, and displays one or more validation errors directly under the input.

Constructor arguments:

- `string:name` becomes both the visible label and the submitted field key
- `Theme:theme` colors the selected label prefix and error messages

### `ConfirmationBox`

`ConfirmationBox` renders a toggleable checkbox-style field for boolean form values.

Constructor arguments:

- `Theme:theme` colors the checkbox and validation errors
- `string:message` is the prompt shown next to the checkbox
- `string:name` optionally overrides the submitted field key and defaults to `confirm`

### `validateType`

`validateType` is a tiny shared helper that checks a runtime value against a JavaScript `typeof` string.

Arguments:

- `unknown:value` is the value being checked
- `string:typeToValidate` is the expected `typeof` result

## Features

- Validation errors stay attached to their owning fields and are re-evaluated as the user keeps typing after a failed submit.
- Keyboard navigation is built into `Form`: `Enter` advances or submits, `Tab` and `Shift`+`Tab` switch fields, arrow keys move focus, and `Esc` cancels the entire form.
- Focus syncing automatically updates both field focus state and optional selected-state rendering so custom fields can highlight the active row consistently.

## Development

Run tasks through Nx from the workspace root:

```sh
pnpm nx run pi-form-components:lint
pnpm nx run pi-form-components:typecheck
pnpm nx run pi-form-components:test
pnpm nx run pi-form-components:metadata
```
