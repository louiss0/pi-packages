# pi-prompt-form

![prompt form](https://raw.githubusercontent.com/louiss0/pi-packages/main/pi-prompt-form/assets/Big-PI-Prompt-Form.jpg)

![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-prompt-form)
![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-prompt-form)
![license](https://img.shields.io/github/license/louiss0/pi-packages)
![CI](https://img.shields.io/github/actions/workflow/status/louiss0/pi-packages/ci.yml?branch=main)

`pi-prompt-form` adds structured prompt input to PI. When a prompt-backed slash command declares an `argument-hint`, the package intercepts the user input, reads the prompt definition, and opens a terminal form so the user can fill required and optional values before the prompt executes. This helps prompt authors turn loosely typed slash commands into guided workflows, reduces missing arguments, and keeps prompt usage aligned with the prompt contract already declared in PI prompt files.

This package ships as a PI extension package and integrates with PI through the input event pipeline. It coordinates prompt lookup, prompt parsing, inline validation with Valibot, and command rewriting so the final prompt invocation still flows through PI as a normal slash command.

## pi-prompt-form 

This package contains a single extension in `extensions/index.ts`. Its job is to sit in front of prompt execution and convert `argument-hint` metadata into an interactive form when a prompt needs structured input.

### Features

#### Prompt-aware input interception

The workflow starts when the user submits input. The extension responds to PI's `input` event, checks whether the text begins with `/`, and resolves the slash command against PI's registered prompt commands with `getCommands()`. Once the command is confirmed to be prompt-backed, it reads the prompt file from `sourceInfo.path`, extracts the frontmatter and body with its own internal prompt parser, and decides whether the prompt should continue normally or switch into guided form entry.

This event chain matters because the extension does not replace PI's prompt system. Instead, it coordinates with the existing prompt lifecycle early enough to improve input quality before prompt expansion happens.

#### Form generation from `argument-hint`

When a prompt declares an `argument-hint`, the extension converts each declared argument into a form field using `@code-fixer-23/pi-form-components`. Required `<name>` arguments become required text inputs, optional `[name]` arguments become optional text inputs, and previously typed values are reused as defaults so users can refine partially typed commands instead of starting over.

This enables prompt authors to keep using standard PI prompt metadata while giving users a clearer input experience for prompts that act more like structured commands.

#### Validation and submission flow

After the form opens, Valibot validates the submitted values before the command is allowed to continue. Required fields must contain text, optional fields may stay blank, and validation errors are shown inside the form so the user can correct them immediately. When the form succeeds, the extension rebuilds the original slash command with whitespace-separated arguments and returns a transformed input result back into PI's normal execution flow.

That means the package improves prompt entry without introducing a separate execution system. The agent still receives a regular prompt command, but the user gets a safer and more guided path to produce it.

#### Extra trailing input for `$ARGUMENTS` and `$@`

Some prompts accept more than the declared argument list. When the parsed prompt body includes `$ARGUMENTS` or `$@`, the extension continues the workflow after structured field collection by asking whether the user wants to provide more information. If the user confirms, it opens one additional text input and appends that value as raw trailing text after the structured arguments.

This keeps prompt authors free to combine guided inputs with open-ended trailing context. Structured values can be collected through the form, while prompts that support broader freeform input can still accept it in the same turn.

#### Whitespace-delimited argument handling

Before showing a form, the extension splits the original slash command on whitespace. Quote and delimiter characters are preserved as ordinary argument content; they are not paired, interpreted, or used to reject input. Submitted form values are written back using the same whitespace-only convention.

## Development

Useful verification commands for this package:

```bash
pnpm nx typecheck pi-prompt-form
pnpm nx test pi-prompt-form
pnpm nx lint pi-prompt-form
```

The package uses its own internal prompt parser for prompt metadata and placeholder parsing, `@code-fixer-23/pi-form-components` for the terminal form UI, and Valibot for form validation.
