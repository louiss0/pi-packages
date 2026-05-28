# pi-packages

Nx workspace for Pi packages published under `@code-fixer-23`.

## Projects

- `pi-form-components` — shared package dependency layer
- `pi-bash-tooljack-nu` — Pi extension package
- `pi-agent-resource` — Pi extension package
- `tools/pi-generators` — local Nx generators for new packages

## Package policy

This workspace uses two architectural tags:

- `project:package` — packages other workspace projects may depend on
- `project:extension` — standalone Pi extension packages that may only depend on package-layer projects

And one lifecycle tag set:

- `status:supported`
- `status:deprecated`

Current rule enforcement lives in `eslint.config.mjs` and `tools/validate-package-metadata.mjs`.

### Metadata rules

- extension packages must include the `pi-package` keyword
- package-level `scripts` are not allowed
- runnable tasks belong in `project.json`

## Generate a new package

Use the local generators instead of scaffolding by hand.

### Extension package

```sh
pnpm nx g @code-fixer-23/pi-generators:extension my-package --no-interactive
```

### Shared package

```sh
pnpm nx g @code-fixer-23/pi-generators:package my-package --no-interactive
```

### Add prompts or skills too

Both generators always include `extensions` and can also add `prompts` or `skills`.

```sh
pnpm nx g @code-fixer-23/pi-generators:extension my-package \
  --projectFolders prompts skills \
  --runner vitest \
  --no-interactive
```

The generators are built on `@code-fixer-23/create-pi-package` and then normalize the output for this workspace.

## Common commands

```sh
pnpm nx show projects
pnpm nx affected -t lint,typecheck,test,metadata
pnpm nx graph
pnpm nx release --dry-run
```

## Notes

- this repository stays on `main` unless the user asks otherwise
- `pnpm-workspace.yaml` lists package folders explicitly, so generators update it for you
- `tsconfig.json` references are also updated by the generators
- When adding an image or video link use `https://raw.githubusercontent.com/louiss0/pi-packages/main/<package-name>/assets/<image-or-video>`
