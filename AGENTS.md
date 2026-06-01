<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## Workspace package policy

- Stay on `main` in this repository unless the user explicitly asks otherwise
- New Pi packages should be scaffolded with the local generators instead of by hand:
  - `pnpm nx g @code-fixer-23/pi-generators:package <name> --no-interactive`
  - `pnpm nx g @code-fixer-23/pi-generators:extension <name> --no-interactive`
- Both generators are built on `@code-fixer-23/create-pi-package`
- Generated packages always include `extensions` and may add `prompts` and `skills`
- Use `project:package` for packages that other workspace packages may depend on
- Use `project:extension` for standalone Pi extension packages that must not depend on other extension packages
- Extension packages must include the `pi-package` keyword in `package.json`
- Do not add package-level `scripts`; define runnable work through Nx targets in `project.json`C
- do not add package-level devDependencies for shared Pi runtime packages when they already exist at the workspace root
- avoid leaking external class types with private fields across package boundaries in exported APIs
- for workspace packages, prefer root-managed versions and type surfaces based on local/public abstractions instead of concrete foreign class types
