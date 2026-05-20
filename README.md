# pi-packages

Nx workspace for Pi packages published under `@code-fixer-23`.

## Projects

- `pi-form-components` — shared bundled dependency layer
- `pi-bash-tooljack-nu` — unbundled Pi extension package
- `pi-agent-resource` — unbundled Pi extension package
- `tools/pi-generators` — local Nx generators for new packages

## Package policy

This workspace uses two architectural tags:

- `project:bundled` — packages other projects may depend on
- `project:unbundled` — standalone Pi packages that may only depend on bundled packages

And one lifecycle tag set:

- `status:supported`
- `status:deprecated`

Current rule enforcement lives in `eslint.config.mjs` and `tools/validate-package-metadata.mjs`.

### Metadata rules

- unbundled packages must include the `pi-package` keyword
- package-level `scripts` are not allowed
- runnable tasks belong in `project.json`

## Generate a new package

Use the local generators instead of scaffolding by hand.

### Unbundled package

```sh
pnpm nx g @code-fixer-23/pi-generators:unbundled-package my-package --no-interactive
```

### Bundled package

```sh
pnpm nx g @code-fixer-23/pi-generators:bundled-package my-package --no-interactive
```

### Add prompts or skills too

Both generators always include `extensions` and can also add `prompts` or `skills`.

```sh
pnpm nx g @code-fixer-23/pi-generators:unbundled-package my-package \
  --projectFolders prompts skills \
  --runner vitest \
  --no-interactive
```

The generators are built on `@code-fixer-23/create-pi-package` and then normalize the output for this workspace.

## Common commands

```sh
pnpm nx show projects
pnpm nx run-many -t lint,typecheck,test,metadata
pnpm nx graph
pnpm nx release --dry-run
```

## Notes

- this repository stays on `main` unless the user asks otherwise
- `pnpm-workspace.yaml` lists package folders explicitly, so generators update it for you
- `tsconfig.json` references are also updated by the generators
