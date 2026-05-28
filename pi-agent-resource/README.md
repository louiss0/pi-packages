# @code-fixer-23/pi-agent-resource

`@code-fixer-23/pi-agent-resource` installs Pi extensions for managing agents, prompts, and skills through interactive TUI workflows, local-or-global storage targets, and validation rules that keep generated resources consistent.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-agent-resource)](https://www.npmjs.com/package/@code-fixer-23/pi-agent-resource)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-agent-resource)](https://www.npmjs.com/package/@code-fixer-23/pi-agent-resource)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

![Agent Resource](./assets/Big-Agent-Resource.png)

## Agent Manager Extension

### Commands

#### `resource:agent <create|edit|delete>`

Manages global agent markdown files in `~/.pi/agent/agents`.

- `create` opens a form for `name`, `description`, `tools`, and `model`, then writes a new agent file.
- `edit` lets you pick an existing global agent and rewrites the selected markdown file with your edits.
- `delete` lets you pick an existing global agent and removes it.

#### `resource:local-agent <create|edit|delete>`

Manages project-local agent markdown files in `.pi/agents` under the current working directory.

- `create` writes a new local agent file into the current project's `.pi/agents` directory.
- `edit` edits a local agent from the current project.
- `delete` removes a local agent from the current project.

### Features

- Local agent commands announce the resolved local directory before they create, edit, or delete files so you can see exactly which project path is being targeted.
- Agent validation keeps names lowercase, requires a sufficiently detailed description, enforces a lowercase comma-separated tool list, and restricts models to lowercase alphanumeric `:` and `-` characters.

## Prompt Manager Extension

### Commands

#### `resource:prompts <create|edit|delete>`

Manages global prompt files in `~/.pi/agent/prompts`.

- `create` collects prompt frontmatter in a form, then opens a template editor overlay before the prompt file is written.
- `edit` lets you pick an existing global prompt and reopens it in Pi's editor.
- `delete` removes the selected global prompt.

#### `resource:local-prompt <create|edit|delete>`

Manages project-local prompt files in `.pi/prompts` under the current working directory.

- `create` writes a new local prompt after the form and template editor are completed.
- `edit` edits a local prompt from the current project.
- `delete` removes a local prompt from the current project.

### Features

- `argument-hint` validation accepts only `<>` and `[]` token syntax, which keeps prompt argument hints structured for required and optional parameters.
- Prompt creation is a two-step workflow: first the frontmatter form is validated, then a dedicated editor overlay captures the markdown template body.
- Prompt selection and deletion understand both plain prompt files and grouped prompt directories by targeting `_index.md` for directory-backed prompts and removing the whole directory when needed.
- Local prompt commands announce the resolved local prompt directory before mutating files in the current project.

## Skill Manager Extension

### Commands

#### `resource:skill <create|edit|delete>`

Manages global skills in `~/.pi/agent/skills/<name>/SKILL.md`.

- `create` gathers required skill metadata first, optionally opens a second form for `license`, `compatibility`, and `allowedTools`, then creates the skill directory and `SKILL.md` file.
- `edit` lets you pick an existing global skill and edits it either in Pi or in your configured external editor.
- `delete` removes the selected global skill directory.

#### `resource:local-skill <create|edit|delete>`

Manages project-local skills in `.pi/skills/<name>/SKILL.md` under the current working directory.

- `create` writes a new local skill into the current project.
- `edit` edits a local skill from the current project.
- `delete` removes a local skill directory from the current project.

### Features

- `--external-skill-editor` switches `edit` to your external editor and is rejected for `create` and `delete`, so the flag only affects the workflow it was designed for.
- Skill edit mode can also be driven by `.pi-resource.toml` with a `[skill]` section containing `editor = "external"`.
- Skill edits trigger a reload after the file changes are saved so Pi can immediately pick up the updated skill contents.
- Local skill commands announce the resolved local skill directory before they modify project files.
- Optional skill metadata validates path-like license values and comma-separated `allowedTools` entries before the skill is written.

## Development

Run tasks through Nx from the workspace root:

```sh
pnpm nx run pi-agent-resource:lint
pnpm nx run pi-agent-resource:typecheck
pnpm nx run pi-agent-resource:test
pnpm nx run pi-agent-resource:metadata
```
