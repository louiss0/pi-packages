# Test suite

These tests were recovered from
[`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
v25.0.1 (MIT, © Chris Lasher) and adapted for this derivative. The upstream
notice is preserved in [`../LICENSE.upstream`](../LICENSE.upstream).

They are **characterization** tests: they pin the inherited runtime's behaviour
so the specified changes can be made against a known baseline. Where the
approved specification changes behaviour, the change is developed against the
baseline: a specified change may revise a baseline assertion (the unknown-type
fallback the specification forbids is one), and a new behaviour gets a new
test. See [`../docs/status.md`](../docs/status.md).

## Layout

- `test/helpers/` — shared doubles: fake sessions, TUI stubs, model factories,
  workspace and manager stubs.
- `test/config/`, `test/session/`, `test/tools/`, `test/lifecycle/`,
  `test/observation/`, `test/service/`, `test/ui/`, `test/handlers/` — one
  directory per domain of the runtime.

## Running

```bash
pnpm nx run pi-tiered-subagents:test
```

Single file:

```bash
pnpm --filter @code-fixer-23/pi-tiered-subagents exec vitest run --config vitest.config.ts test/config/agent-types.test.ts
```

## Adaptations made to the upstream suite

1. `#src/index` (upstream's extension entry) is `#extension` here, because this
   package keeps the entry in `extensions/index.ts`.
2. Two path assertions now build their expectations with `node:path` instead of
   hard-coded POSIX strings, so the suite runs on Windows too.
3. The transcript-pane tests read the bound key from Pi's keybinding manager
   rather than hard-coding Pi 1.0.0's defaults, and the terminal double
   implements the `setProgramStatus` method Pi 1.3.0 added.
