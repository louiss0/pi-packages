# @code-fixer-23/pi-form-components

Shared bundled package for Pi workspace UI pieces.

## Role

`pi-form-components` is tagged:

- `project:bundled`
- `status:supported`
- `scope:shared`

That means other workspace packages may depend on it, and it forms part of the allowed dependency layer for unbundled Pi packages.

## Development

Run tasks through Nx from the workspace root:

```sh
pnpm nx run pi-form-components:lint
pnpm nx run pi-form-components:typecheck
pnpm nx run pi-form-components:test
pnpm nx run pi-form-components:metadata
```

## Notes

- package-level `scripts` are intentionally avoided in this workspace
- metadata policy is enforced by `tools/validate-package-metadata.mjs`
