# pi-agent-resource

A PI package that installs an extension for creating, editing, deleting, and listing:

- Global agents in `~/.pi/agent/agents/<name>.md`
- Project agents in `.pi/agents/<name>.md` through `resource:local-agent`
- Skills in `~/.pi/agent/skills/<name>/SKILL.md`
- Local skills in `.pi/skills/<name>/SKILL.md` through `resource:local-skill`
- Global prompts in `~/.pi/agent/prompts/*.md`
- Project prompts in `.pi/prompts/*.md` or grouped prompt directories

## What it does

The extension provides an interactive wizard that keeps prompting for the information it needs until the resource is ready.

It supports:

- creating agents
- creating Agent Skills spec compliant skills
- creating ungrouped prompts
- creating grouped prompts with `_index.md` and subcommands
- editing existing resources
- deleting existing resources
- listing current resources

## Installed extension

The package exposes the extension from `@extensions/resource-studio/index.ts`.

## Commands

- `/resource-studio`
- `manage_project_resources` custom tool

## Scope flags

The extension uses a registered pi flag for the external skill editor.
Project-local resources now use dedicated commands instead of scope flags.

- `external-skill-editor` → use the external editor for skill edits
- `resource:local-agent` → create, edit, or delete project agents in `.pi/agents`
- `resource:local-skill` → create, edit, or delete project skills in `.pi/skills`

When a local resource command is used, the command shows a notice before it creates,
edits, or deletes the local resource.

## Prompt behavior

When creating a prompt, the wizard asks whether the prompt should be:

- `ungrouped` → `.pi/prompts/<name>.md`
- `grouped` → `.pi/prompts/<group>/_index.md` with one or more subcommands

Grouped prompts follow the `_index.md` + `type: group` layout used by grouped PI prompt sets.

## Development mode

The repository uses a local `.env` file for development mode.

```env
PI_RESOURCE_DEV=1
```

When that variable is set, the extension shows its development notice and uses the in-memory filesystem.

## Tests

```bash
npm test
```
