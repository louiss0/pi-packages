# @code-fixer-23/pi-form-components

`@code-fixer-23/pi-form-components` is a TypeScript library of reusable interactive components for building form-driven workflows inside Pi extensions. Extension authors commonly need text inputs, selection pickers, multi-item checkboxes, confirmation prompts, and structured submission logic—this package provides all of those as composable TUI components that integrate directly with Pi's rendering and keybinding system.

The package solves the problem of rebuilding form infrastructure from scratch in every extension. Instead of reimplementing focus cycling, validation state, inline error display, lazy list loading, or external editor integration yourself, you declare the fields you need, supply a `parse` function that validates the collected values, and hand everything to `Form`. The result is a consistent, keyboard-first input experience that returns either a validated object or a cancel signal to your extension handler. Because every field implements the same `FormComponent` interface, you can mix built-in and custom fields within the same form without changing the submission or validation logic.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-form-components)](https://www.npmjs.com/package/@code-fixer-23/pi-form-components)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

## Installation

```sh
pnpm add @code-fixer-23/pi-form-components
```

This package requires the following peer dependencies from the Pi runtime:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

## Components

```ts
import {
  ConfirmationBox,
  createExternalEditorFactory,
  Form,
  LabelledInput,
  MultiSelect,
  Picker,
  validateType,
} from "@code-fixer-23/pi-form-components";
```

### Form

`Form` coordinates multi-step data entry across a set of fields. When the form becomes focused, it activates the first field and begins routing keystrokes to it. The user moves forward with `Enter` or `Tab`, backward with `Shift`+`Tab` or the up arrow, and can cancel at any time with `Esc`. The form renders a centered title above the fields and an optional footer below them, giving the screen a consistent, navigable structure.

Illustration:

```text
              Create Package

› name
my-plugin

  [x] Publish immediately?

Enter next/submit • Tab switch field • Esc cancel
```

Submission runs a validation cycle. When the user submits from the last field, `parse` receives the field values collected by name. If `parse` returns errors, the form remains open and displays each error message beneath its owning field. As the user continues editing, the form revalidates on every keystroke and removes resolved errors immediately. Once `parse` returns `undefined`, the form calls `done` with the validated object. If the user cancels with `Esc`, `done` receives `null` instead.

Arguments:

- `object:options` configures the full form flow
  - `string:title` renders a centered heading
  - `FormField[]:fields` defines the ordered interactive fields
  - `function:parse` validates collected values and returns per-field error arrays, or `undefined` when valid
  - `string:footer` adds inline guidance below the form (optional)
  - `number:spacing` controls blank lines between sections (default: `2`)
- `FormTui:tui` requests rerenders as focus, filtering, and validation change
- `function:done` receives submitted values or `null` on cancel

Example:

```ts
const form = new Form(
  {
    title: "Create Package",
    fields: [
      new LabelledInput("name", theme),
      new ConfirmationBox("publishNow", theme, "Publish immediately?"),
    ],
    parse(values) {
      if (values.name === "") {
        return { name: ["Name is required"] };
      }
      return undefined;
    },
    footer: "Enter next/submit • Tab switch field • Esc cancel",
  },
  tui,
  (values) => {
    if (values === null) return;
    // continue with validated form values
  },
);
```

### LabelledInput

`LabelledInput` renders a labeled text cursor, accepts typed input, and keeps validation messages directly beneath the field. The label prefix changes to `› ` when the field has focus, making the active field immediately visible in a multi-field form. This is the default field type for collecting short string values such as names, paths, or descriptions.

Arguments:

- `string:name` becomes both the rendered label and the submitted object key
- `FormTheme:theme` colors the active label prefix and validation output
- `string:initialValue` pre-populates the input (optional, default: `""`)

Illustration:

```text
› packageName
pi-form-components
Name must be lowercase
```

Example:

```ts
const packageName = new LabelledInput("packageName", theme);
packageName.setFocused(true);
packageName.setError(["Name must be lowercase"]);
```

### ConfirmationBox

`ConfirmationBox` renders a checkbox-style row that the user toggles with `Space`. It contributes a boolean value to the submitted object and is appropriate for yes/no checkpoints such as enabling optional steps or confirming a potentially destructive action.

The component exposes both `toggle()` and `confirm()`. `toggle()` flips the value on and off in response to `Space`. `confirm()` sets the value to `true` permanently and cannot be reversed—useful in flows where acceptance should be a one-time action rather than a toggleable state.

Arguments:

- `string:name` becomes the submitted key and field identity
- `FormTheme:theme` colors the checkbox and validation output
- `string:message` renders the confirmation prompt beside the checkbox

Illustration:

```text
> [x] Include starter prompts?
```

Example:

```ts
const includePrompts = new ConfirmationBox(
  "includePrompts",
  theme,
  "Include starter prompts?",
);
```

### MultiSelect

`MultiSelect` lets the user pick any number of items from a list before submitting. Each item is rendered with a choice indicator that reflects its current selection state. The user navigates with the arrow keys and toggles individual items with `Space`. When the user presses `Enter`, `done` is called with the selected values in the order they were toggled. `Esc` cancels the session.

The visual style of the choice indicator is controlled by `itemChoiceStyle`:

| Style | Unselected | Selected |
|-------|-----------|----------|
| `checkbox` (default) | `[ ]` | `[x]` |
| `radio` | `( )` | `(*)` |
| `dot` | `○` | `●` |
| `diamond` | `◇` | `◆` |

Arguments:

- `string:name` becomes the field label and the key in the submitted object
- `object:config` configures the item list and appearance
  - `SelectItem[]:items` defines selectable entries with `value`, `label`, and optional `description`
  - `string:title` renders an optional heading (defaults to `name`)
  - `number:spacing` adds vertical space above the list (default: `1`)
  - `ItemChoiceStyle:itemChoiceStyle` sets the indicator style (default: `"checkbox"`)
  - `object:styles` customizes per-role theme colors for the title and item rows
- `TUI:tui` requests rerenders on navigation and toggle
- `Theme:theme` applies Pi theme colors
- `function:done` receives an array of selected values, or `null` on cancel

When `MultiSelect` is used as a field inside a `Form`, its `value` getter returns the selected values as a comma-separated string so the submission object stays flat. When used standalone, the `done` callback receives the typed array directly.

Illustration:

```text
› toppings
What toppings do you want?

[x] Cheese
[ ] Pepperoni
[x] Mushrooms     Earthy
```

Example:

```ts
const toppings = new MultiSelect(
  "toppings",
  {
    title: "What toppings do you want?",
    itemChoiceStyle: "checkbox",
    items: [
      { value: "cheese", label: "Cheese" },
      { value: "pepperoni", label: "Pepperoni" },
      { value: "mushrooms", label: "Mushrooms", description: "Earthy" },
    ],
  },
  tui,
  theme,
  (values) => {
    if (values === null) return;
    // values: string[]
  },
);
```

### Picker

`Picker` is a searchable single-selection workflow for large command or option lists. It opens with a bordered list and a filter line. As the user types, the picker narrows results across the entire item set—not only what is currently visible. Navigation stays keyboard-driven throughout: arrow keys move the highlight, typing filters in real time, `Enter` finalizes the selection, and `Esc` cancels.

To avoid rendering a large list up front, `Picker` loads items in a lazy window. The initial view shows `itemLimit` items. As the user scrolls toward the bottom, the window expands by `lazyLoadStep` until the full set is visible. Typing a filter bypasses the lazy window and searches all items immediately.

Arguments:

- `string:name` becomes the picker field identity and label
- `object:config` defines picker behavior
  - `string[]:items` provides the full set of selectable values
  - `number:itemLimit` sets the initial visible list size
  - `string:title` renders the picker heading (defaults to `name`)
  - `string:helpText` overrides the footer guidance line
  - `number:lazyLoadStep` controls how many items load when the window expands (default: `itemLimit`)
  - `object:styles` customizes title, border, help text, and per-role item colors
- `PickerTheme:theme` applies Pi theme colors
- `FormTui:tui` requests rerenders after filtering and selection changes
- `function:done` receives the selected string value, or `null` on cancel

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
  "commands",
  {
    title: "Commands",
    items: ["form.create", "form.validate", "form.preview"],
    itemLimit: 5,
  },
  theme,
  tui,
  (value) => {
    if (value === null) return;
    // continue with the chosen command
  },
);
```

### createExternalEditorFactory

`createExternalEditorFactory` opens a file in an external editor such as VS Code or Helix from within a Pi extension. It returns a component factory that `ctx.ui.custom` accepts. When the factory runs, Pi suspends its own UI, opens the specified file in the configured editor, and displays a popup so the user knows the agent is waiting for the editor to close.

The edit session starts the moment the file opens. The factory reads the file's content before the editor launches and reads it again after the editor exits. `done` is called with `{ before, after, changed }` so the extension can decide whether to act on the result. If the editor command is invalid, spawning fails, or an I/O error occurs, `done` receives an `ExternalEditorError` instead.

To handle editors that return immediately without blocking (such as VS Code without `--wait`), the factory inspects the editor's `--help` output for a wait flag (`--wait` or `-w`) and appends it automatically when found and not already present in the command string.

Arguments:

- `string:editorCommand` the editor binary and any extra flags (e.g. `"code --reuse-window"`, `"hx"`)
- `string:filePath` the absolute path to the file to edit

Returns a component factory compatible with `ctx.ui.custom`.

Illustration:

```text
  Editing file: /path/to/config.md
  Editor: code
  Close the editor to return to Pi.
```

Example:

```ts
const result = await ctx.ui.custom(
  createExternalEditorFactory(process.env.EDITOR, "/path/to/config.md"),
);

if (result instanceof Error) {
  ctx.ui.notify(result.message, "error");
  return;
}

if (result.changed) {
  // apply the updated content
  console.log(result.after);
}
```

## Building a custom field

Any class that implements `FormComponent` can participate in a `Form` session alongside the built-in fields. The interface requires a `name` and `value` accessor plus three lifecycle methods:

```ts
export interface FormComponent extends Component {
  readonly name: string;
  readonly value: string | number | boolean;
  setFocused(focused: boolean): void;
  setError(messages: string[]): void;
  clearError(): void;
  handleInput(data: string): void;
}
```

`Form` calls `setFocused` when moving between fields so the active field can highlight itself. It calls `setError` and `clearError` during submission and live revalidation. Keystrokes that are not navigation keys are dispatched to the active field via `handleInput`. The `name` accessor identifies the field in the validated object; `value` is what gets included in the submission.

Example of a minimal custom field:

```ts
import { Container, Text } from "@earendil-works/pi-tui";
import type { FormComponent } from "@code-fixer-23/pi-form-components";

class RatingField extends Container implements FormComponent {
  readonly name: string;
  #rating = 3;
  #errorText = new Text("");
  #labelText: Text;

  constructor(name: string) {
    super();
    this.name = name;
    this.#labelText = new Text(name);
    this.addChild(this.#labelText);
    this.addChild(this.#errorText);
  }

  get value() { return this.#rating; }

  setFocused(focused: boolean) {
    this.#labelText.setText(focused ? `› ${this.name}` : `  ${this.name}`);
  }

  setError(messages: string[]) { this.#errorText.setText(messages.join("\n")); }
  clearError() { this.#errorText.setText(""); }

  handleInput(data: string) {
    const digit = parseInt(data);
    if (!isNaN(digit) && digit >= 1 && digit <= 5) this.#rating = digit;
  }
}
```

## Usage example

```ts
import { ConfirmationBox, Form, LabelledInput } from "@code-fixer-23/pi-form-components";

const name = new LabelledInput("name", theme);
const confirm = new ConfirmationBox("publishNow", theme, "Publish immediately?");

const form = new Form(
  {
    title: "Create package",
    fields: [name, confirm],
    parse(values) {
      if (values.name === "") {
        return { name: ["Name is required"] };
      }
      return undefined;
    },
    footer: "Enter next/submit • Space toggle • Esc cancel",
  },
  tui,
  (values) => {
    if (values === null) return;
    // continue the extension workflow with validated values
  },
);
```

## Development

Run tasks from the workspace root with Nx:

```sh
pnpm nx run pi-form-components:lint
pnpm nx run pi-form-components:typecheck
pnpm nx run pi-form-components:test
pnpm nx run pi-form-components:metadata
pnpm nx run pi-form-components:build
```

Production build artifacts are emitted into `bundled/pi-form-components`. Static publish files such as `README.md` live in `public/` and are copied into the bundled output during the build. The build also uses `tools/esbuild/package-json-plugin.cjs` to write the publishable `package.json` into that same bundled folder.
