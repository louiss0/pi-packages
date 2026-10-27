/**
 * Terminal presentation module. Pi registration remains at the extension root;
 * execution data reaches these consumers through views and focused actions.
 *
 * The tool-registration callbacks live at the extension root, so the UI module
 * owns the components they build: `Text` for one pre-themed block and
 * `BoundedLines` for lines that spend one row each. Keeping these here means
 * no file outside `src/ui` imports the TUI package directly.
 */
export { AgentWidget } from "./agent-widget.js";
export { BoundedLines } from "./bounded-lines.js";
export { Text } from "@earendil-works/pi-tui";
export type {
  Component,
  OverlayOptions,
  TuiMode,
} from "@earendil-works/pi-tui";
