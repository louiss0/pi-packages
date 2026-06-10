# @code-fixer-23/pi-form-components

`@code-fixer-23/pi-form-components` is a small TypeScript library for building interactive Pi TUI forms inside Pi extensions and shared package code. It gives extension authors a reusable form workflow instead of rebuilding focus handling, validation, checkbox state, picker navigation, and inline error rendering for every prompt-like screen. In practice, it fits between your extension logic and Pi's TUI runtime: you supply fields, parsing rules, and completion behavior, and the package coordinates how the agent collects input, guides the user through the form, and returns either validated values or a cancel signal.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

## Installation

```sh
pnpm add @code-fixer-23/pi-form-components
```

This package is designed to work with Pi libraries and expects these peers in the host project:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

## @code-fixer-23/pi-form-components

The package exports a single library entrypoint that extension code can use to assemble input-driven TUI workflows.

```ts
import {
  ConfirmationBox,
  Form,
  LabelledInput,
  Picker,
  validateType,
} from "@code-fixer-23/pi-form-components";
```

### Form workflow

`Form` is the coordinator for multi-step data entry. A form session starts by rendering a centered title and the ordered field list you provide. Once the form receives focus, it activates the first field and keeps the selected field in sync as the user moves through the screen.

Illustration:

```text
              Create Package

› name
my-plugin

  [x] Publish immediately?

Enter next/submit • Tab switch field • Esc cancel
```

During entry, regular keystrokes are delegated to the active field, while navigation keys move through the workflow: <kbd>Enter</kbd> advances to the next field or submits on the last field, <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> cycle between fields, arrow keys move selection, and <kbd>Esc</kbd> cancels the entire session. This makes the form useful for extension flows where the agent needs a predictable, keyboard-first input step.

Submission is validation-driven. When the user reaches the end and submits, `parse` receives the collected object keyed by field name. If `parse` returns errors, the form keeps the workflow open, attaches each message to its owning field, and revalidates while the user edits. When validation passes, the form finalizes by calling `done` with the collected values. If the user cancels, `done` receives `null` instead.

```ts
new Form(
  {
    title: "Create Prompt",
    fields,
    parse,
    footer: "Enter next/submit • Tab switch field • Esc cancel",
    spacing: 1,
  },
  tui,
  done,
);
```

Arguments:

- `object:options` configures the full form flow
  - `string:title` renders a centered heading
  - `FormField[]:fields` defines the ordered interactive fields
  - `function:parse` validates the collected values and returns field errors
  - `string:footer` adds inline guidance below the form
  - `number:spacing` controls the blank lines between sections
- `TUI:tui` requests rerenders as focus, filtering, and validation change
- `function:done` receives submitted values or `null` on cancel

Example:

```ts
const form = new Form(
  {
    title: "Create Package",
    fields: [
      new LabelledInput("name", theme),
      new ConfirmationBox(theme, "Publish immediately?", "publishNow"),
    ],
    parse(values) {
      if (values.name === "") {
        return { name: "Name is required" };
      }

      return undefined;
    },
    footer: "Enter next/submit • Tab switch field • Esc cancel",
  },
  tui,
  (values) => {
    if (values === null) {
      return;
    }

    // continue with validated form values
  },
);
```

### LabelledInput

`LabelledInput` is the default text-entry field for forms. It shows a field label, accepts typed input, and keeps validation messages directly under the field so users can correct issues without losing context. It works well for short names, paths, descriptions, or any other single-value text entry step in an extension flow.

Arguments:

- `string:name` becomes both the rendered label and the submitted object key
- `Theme:theme` colors the selected label prefix and validation output

Illustration:

```text
› packageName
pi-form-components
Name must be lowercase
```

Example:

```ts
const packageName = new LabelledInput("packageName", theme);
packageName.setSelected(true);
packageName.setError("Name must be lowercase");
```

### ConfirmationBox

`ConfirmationBox` handles yes/no checkpoints inside the same form workflow. It renders a checkbox-style row, toggles with <kbd>Space</kbd>, and contributes a boolean value to the submitted object. This is useful when an agent needs explicit confirmation before enabling optional steps or applying a potentially destructive action.

Arguments:

- `Theme:theme` colors the checkbox and validation output
- `string:message` renders the confirmation prompt beside the checkbox
- `string:name` optionally overrides the submitted key and defaults to `confirm`

Illustration:

```text
> [ ] Include starter prompts?
```

Example:

```ts
const includePrompts = new ConfirmationBox(
  theme,
  "Include starter prompts?",
  "includePrompts",
);
```

### Picker

`Picker` is a standalone selection workflow for long command or option lists. It opens with a titled list, lets the user type to filter entries, keeps selection keyboard-driven, and loads more items as the user reaches the end of the visible window. That behavior makes it useful for extension screens that need searchable command pickers without rendering a huge list up front.

The selection flow starts with a limited visible window, then expands lazily as the user navigates downward. If the user types a filter, the picker searches across the full item set instead of only the loaded slice. Pressing <kbd>Enter</kbd> finalizes the selected value, while cancellation returns `null`.

Arguments:

- `object:config` defines the picker behavior
  - `string[]:items` provides the selectable values
  - `number:itemLimit` sets the visible list size
  - `string:title` renders the picker heading
  - `string:helpText` overrides the footer guidance
  - `number:lazyLoadStep` controls how many more items load at a time
  - `object:styles` customizes title, border, help text, and item colors
- `Theme:theme` applies Pi theme colors
- `TUI:tui` requests rerenders after filtering and selection changes
- `function:done` receives the chosen item or `null` on cancel

Illustration:

```text
┌──────────────────────────────┐
Commands
Filter: form
› form.create            1
  form.validate          2
  form.preview           3
type to filter • ↑↓ navigate • enter execute • esc cancel
└──────────────────────────────┘
```

Example:

```ts
const picker = new Picker(
  {
    title: "Commands",
    items: ["form.create", "form.validate", "form.preview"],
    itemLimit: 5,
  },
  theme,
  tui,
  (value) => {
    if (value === null) {
      return;
    }

    // continue with the chosen command
  },
);
```

### validateType

`validateType` is a small runtime helper for guarding values before they enter a larger form or extension workflow.

Arguments:

- `unknown:value` is the runtime value being checked
- `string:typeToValidate` is the expected JavaScript `typeof` result

Illustration:

```ts
validateType("prompt-name", "string"); // true
validateType(42, "string"); // false
```

Example:

```ts
if (!validateType(value, "string")) {
  throw new Error("Expected a string form value");
}
```

## Usage example

```ts
import { ConfirmationBox, Form, LabelledInput } from "@code-fixer-23/pi-form-components";

const name = new LabelledInput("name", theme);
const confirm = new ConfirmationBox(theme, "Publish immediately?", "publishNow");

const form = new Form(
  {
    title: "Create package",
    fields: [name, confirm],
    parse(values) {
      if (values.name === "") {
        return { name: "Name is required" };
      }

      return undefined;
    },
    footer: "Enter next/submit • Space toggle • Esc cancel",
  },
  tui,
  (values) => {
    if (values === null) {
      return;
    }

    // continue the extension workflow with validated values
  },
);
```

## Features

- Inline validation stays attached to the field that needs correction.
- Focus and selected-state syncing let custom fields highlight the active row consistently.
- Multiline footers give extensions a built-in place for keyboard guidance.
- Boolean and text fields can participate in the same submission object.
- Picker filtering searches the full dataset even when only part of the list is currently visible.

## Development

Run tasks from the workspace root with Nx:

```sh
pnpm nx run pi-form-components:lint
pnpm nx run pi-form-components:typecheck
pnpm nx run pi-form-components:test
pnpm nx run pi-form-components:metadata
pnpm nx run pi-form-components:build
```

Production build artifacts are emitted into `bundled/pi-form-components` with a Vite library build. Static publish files such as `README.md` live in `public/` and are copied into the bundled output. The `prepare-production-package` target writes the publishable `package.json` into that same bundled folder.

```sh
pnpm nx run pi-form-components:prepare-production-package
```
