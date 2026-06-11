# @code-fixer-23/pi-agent-resource

`@code-fixer-23/pi-agent-resource` adds interactive Pi resource-management workflows for agents, prompts, skills, and reusable packs. It solves the repetitive parts of creating and maintaining Pi assets by combining validated forms, editor overlays, local-vs-global path resolution, and pack-aware loading into ready-to-use extensions. In practice, the package plugs into Pi's command system and resource discovery lifecycle so users can create or reorganize resources without manually building frontmatter, folder structures, or pack search paths.

[![npm version](https://img.shields.io/npm/v/%40code-fixer-23%2Fpi-agent-resource)](https://www.npmjs.com/package/@code-fixer-23/pi-agent-resource)
[![npm downloads](https://img.shields.io/npm/dm/%40code-fixer-23%2Fpi-agent-resource)](https://www.npmjs.com/package/@code-fixer-23/pi-agent-resource)
[![license](https://img.shields.io/github/license/louiss0/pi-packages)](https://github.com/louiss0/pi-packages/blob/main/LICENSE)
[![CI](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/louiss0/pi-packages/actions/workflows/ci.yml)

![Agent Resource](./assets/Big-Agent-Resource.png)

## Package structure

This package currently ships four Pi extensions:

- `agent-manager`
- `prompt-manager`
- `skill-manager`
- `pack`

It also includes package artwork in `assets/`, but it does not currently ship standalone prompts, skills, or themes of its own.

## Agent Manager

The agent manager handles markdown agent definitions in either your global Pi home or the current project's `.pi/agents` directory. It is aimed at the workflow where you want to scaffold a valid agent quickly, inspect an existing one, or remove outdated agent definitions without leaving Pi.

### Commands

#### `resource:agent <create|edit|delete>`

Manages global agents in `~/.pi/agent/agents`.

- `create` opens a validated form for `name`, `description`, `tools`, and `model`, then writes a new markdown file with normalized frontmatter.
- `edit` lets you select an existing global agent and reopen its raw markdown in Pi's editor so you can make direct changes.
- `delete` lists existing global agents and removes the selected file.

#### `resource:local-agent <create|edit|delete>`

Runs the same workflows against the current project's `.pi/agents` directory.

- `create` is useful when the agent should travel with a repository instead of living in your global Pi home.
- `edit` targets the project-local copy, which helps when a repo needs its own agent behavior.
- `delete` removes the local file and leaves global agents untouched.

### Features

Agent creation is validation-first. The form enforces lowercase-oriented naming, requires a meaningful description, checks comma-separated tool lists, and keeps model values in a restricted lowercase format before anything is written. Local commands also announce the resolved project path before they mutate files, which makes it clear which workspace Pi is about to change.

## Prompt Manager

The prompt manager is built for prompt authoring workflows that need both structured frontmatter and freeform markdown content. It coordinates the prompt form and the editor overlay so prompt metadata and prompt body are created in the same flow.

### Commands

#### `resource:prompts <create|edit|delete>`

Manages global prompts in `~/.pi/agent/prompts`.

- `create` starts with a frontmatter form for fields like `name`, `description`, and `argument-hint`, then opens a dedicated editor overlay for the markdown template body before the prompt is saved.
- `edit` reopens an existing prompt in Pi's editor so the full file can be revised.
- `delete` removes the selected prompt from the global prompt store.

#### `resource:local-prompt <create|edit|delete>`

Runs the same prompt workflows against `.pi/prompts` in the current project.

- `create` is useful for repo-specific prompt packs or project conventions.
- `edit` keeps prompt maintenance local to the workspace.
- `delete` removes only the local prompt resource.

### Features

Prompt creation is a two-stage authoring workflow. First, Pi validates the frontmatter fields, including `argument-hint` syntax. Once that metadata passes, the workflow continues into the editor overlay where the actual markdown template is written. Deletion also understands grouped prompts: when a prompt is backed by a directory, the manager targets `_index.md` for selection and removes the whole grouped prompt directory when deleting.

## Skill Manager

The skill manager is designed for the more structured skill lifecycle, where a skill lives in its own folder and often needs either rich in-Pi editing or a handoff to an external editor. It supports both global and project-local skills while preserving Pi's `skills/<name>/SKILL.md` layout.

### Commands

#### `resource:skill <create|edit|delete>`

Manages global skills in `~/.pi/agent/skills/<name>/SKILL.md`.

- `create` begins with a required metadata form, then optionally collects `license`, `compatibility`, and `allowedTools` before creating the skill directory and `SKILL.md` file.
- `edit` lets you choose a skill and then updates it either inside Pi or through your external editor configuration.
- `delete` removes the entire selected skill directory, not just the markdown file, which keeps the skill layout clean.

#### `resource:local-skill <create|edit|delete>`

Runs the same skill lifecycle against `.pi/skills/<name>/SKILL.md` in the current project.

- `create` makes repository-scoped skills that can ship with the project.
- `edit` targets the local skill tree rather than the global one.
- `delete` removes the local skill directory from the repository.

### Features

Skill creation is intentionally staged. The first form collects the required identity fields, then a confirmation step decides whether the workflow should continue into the optional metadata form. That makes the fast path short while still supporting richer skill metadata when you need it.

Skill editing also supports two different editing styles. By default, Pi can open the skill in its own overlay workflow. If you prefer your shell editor, the workflow can switch to an external process and then trigger a Pi reload so the updated skill becomes available immediately.

### Flags

#### `--external-skill-editor`

`--external-skill-editor` changes the `edit` workflow to launch your configured external editor instead of Pi's internal editor UI. It is intended specifically for editing, so it keeps create and delete flows focused on their own jobs rather than overloading a single flag with unrelated behavior.

### Features

The edit workflow can also be steered by a project-level `.pi-resource.toml` file. When the skill lifecycle starts, the extension first checks for an explicit flag override. If none is provided, it reads `[skill]` configuration from `.pi-resource.toml`, decides whether editing should stay inside Pi or hand off to the external editor, and then finalizes the workflow with a Pi reload after the file changes are saved.

## Pack

The pack extension coordinates reusable collections of skills and prompts and then teaches Pi how to load them for the current session. It is useful when you want a named bundle of resources that can be created, edited, deleted, moved between scopes, or activated together.

### Commands

#### `resource:pack <create|delete>`

Manages pack containers under `.pi/packs`.

- `create` asks for the pack name, lets you choose whether the pack should contain prompts, skills, or both, and then creates the underlying folder structure.
- During `create`, you can either prefill the selected resources through the same prompt and skill forms used elsewhere in the package or generate starter example files when you just want the structure in place first.
- `delete` supports multi-selection so you can remove several packs in one run.

#### `resource:pack:skill <create|edit|delete|move-local|move-local-to-pack|move-global|move-global-to-pack>`

Manages skills inside packs and moves them between pack, local, and global locations.

- `create` adds a new skill to a chosen pack using the same staged required-plus-optional metadata flow as the skill manager.
- `edit` opens an existing packed skill in the external editor, which is useful when pack contents are being maintained as files.
- `delete` removes a skill from the selected pack.
- `move-local` moves a skill out of a pack into the current project's local skill area.
- `move-local-to-pack` imports a local skill into a chosen pack.
- `move-global` moves a skill out of a pack into the global skill store.
- `move-global-to-pack` imports a global skill into a chosen pack.

#### `resource:pack:prompt <create|edit|delete|move-local|move-local-to-pack|move-global|move-global-to-pack>`

Runs the same style of pack management for prompts.

- `create` adds a prompt to a selected pack through the frontmatter form and template editor workflow.
- `edit` opens a packed prompt in the external editor.
- `delete` removes a prompt from the chosen pack.
- `move-local` moves a packed prompt into the current project's local prompt directory.
- `move-local-to-pack` imports a local prompt into a pack.
- `move-global` moves a packed prompt into the global prompt store.
- `move-global-to-pack` imports a global prompt into a pack.

#### `resource:pack:session:new [packs]`

Starts a new Pi session with one or more packs loaded.

- When you pass `packs`, the argument can contain names separated by spaces or commas.
- When you omit the argument, Pi opens a multi-select picker so you can choose packs interactively before the new session starts.

#### `resource:pack:session:reload [packs]`

Reloads the current Pi session with a new pack selection.

- Passing names updates the loaded pack list immediately.
- Omitting the argument opens the same interactive multi-select workflow used by `session:new`.

### Flags

#### `--resource:load-pack <string>`

`--resource:load-pack` preloads one or more packs during Pi startup. The value can contain pack names separated by spaces or commas, which makes it useful for bootstrapping a repeatable session profile from the command line.

### Features

Pack loading is coordinated through Pi's resource discovery lifecycle rather than through a one-off file scan. On startup, the extension first checks `--resource:load-pack` and turns that flag into the active pack list. Later, when Pi runs the `resources_discover` workflow, the extension responds by contributing prompt and skill search paths for each selected pack. Session commands reuse the same pack list behavior: they collect names, update the active selection, and then either start a new session or reload the current one so Pi resolves resources from the chosen packs.

## Development

Run tasks through Nx from the workspace root:

```sh
pnpm nx run pi-agent-resource:lint
pnpm nx run pi-agent-resource:typecheck
pnpm nx run pi-agent-resource:test
pnpm nx run pi-agent-resource:metadata
```