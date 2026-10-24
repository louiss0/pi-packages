# Terminal presentation module

This is an internal module of **pi-tiered-subagents**, not a separate workspace
package or independently enabled Pi extension. `index.ts` exposes the main
presentation consumers. The extension root owns Pi registrations and wires them.

## Boundary

- Widget, transcript viewer, settings views, tool-call/result renderers,
  notification renderers, and terminal helpers live here.
- `view-types.ts` and `session-navigation.ts` own the small structural views and
  transcript-reader contracts. No live manager or child session crosses them.
- `../presentation/` projects runtime records and persisted entries into those
  contracts. Widget snapshots copy their nested maps/usage/budget/model values.
- A live transcript reader supplies current messages, streaming state, a
  subscription, model metadata, and tool definitions for Pi's own components;
  it never exposes the child session itself. Persisted file reads are injected
  asynchronously by the root.
- Settings menus call focused settings actions; they do not know storage details.
- Model-facing text, execution decisions, notification timing, delivery claims,
  and persistence policy remain outside the presentation module.

The UI module must not import execution implementation or `ExtensionAPI`.
Conversely, modules outside `src/ui/` must not import `pi-tui`. ESLint and
`test/presentation-boundary.test.ts` enforce these dependency rules.

`test/ui-registration.test.ts` loads the actual runtime source entry with Pi's
public SDK loader and exercises the registered commands and renderers without
a second enabled extension or model request. Existing composition-root tests
cover widget activation and teardown.

Presentation behavior is characterized in `test/ui/` and renderer suites in
`test/tools/`; projection behavior is covered in the widget/transcript adapter
tests. Those tests use UI-owned views/actions rather than constructing a runtime
manager merely to render output. Lifecycle and real SDK checks remain separate.
