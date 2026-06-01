# pi-prompt-form

`pi-prompt-form` opens a PI form when a prompt slash command declares an `argument-hint`.

It reads the prompt definition, builds a form from the declared arguments, validates required values with Valibot, and transforms the submitted values back into a quoted slash-command invocation.

## Behavior

- only prompt-backed slash commands are intercepted
- prompts without `argument-hint` continue normally
- required `<name>` arguments must be filled
- optional `[name]` arguments may be left blank
- existing typed prompt arguments are used as form defaults

## Development

```bash
pnpm nx typecheck pi-prompt-form
pnpm nx test pi-prompt-form
pnpm nx lint pi-prompt-form
```
