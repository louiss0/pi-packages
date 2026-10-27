import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { AgentStatus, TurnBudget } from "./view-types.js";
import { formatMs, formatTokens, formatTurnBudget } from "./display.js";
import { GLYPHS } from "./glyphs.js";
import { wrappedUpAtTurnLimit } from "./outcome-presentation.js";

/** The completion facts this renderer reads; structurally supplied by the runtime. */
export type NotificationDetails = Readonly<{
  description: string;
  status: AgentStatus;
  toolUses: number;
  totalTokens: number;
  durationMs: number;
  outputFile?: string;
  resultPreview: string;
  turnBudget?: TurnBudget;
}>;

/** A still-running child's message, independent of runtime notification delivery. */
export type UpdateDetails = Readonly<{
  description: string;
  message: string;
}>;

/** What a workspace teardown left behind, not a new outcome. */
export type WorkspaceNoticeDetails = Readonly<{
  description: string;
  notice: string;
}>;

/** Resolved status→presentation product: icon glyph/style and status label. */
export type StatusPresentation = Readonly<{
  iconGlyph: string;
  iconStyle: ThemeColor;
  statusText: string;
}>;

/** Decide the icon and status label for a notification's status, once. */
export function resolveStatusPresentation(
  outcome: Pick<NotificationDetails, "status" | "turnBudget">,
): StatusPresentation {
  if (
    outcome.status === "error" ||
    outcome.status === "aborted" ||
    outcome.status === "stopped"
  )
    return {
      iconGlyph: GLYPHS.failure,
      iconStyle: "error",
      statusText: outcome.status,
    };
  const statusText = wrappedUpAtTurnLimit(outcome)
    ? "completed (wrapped up)"
    : "completed";
  return { iconGlyph: GLYPHS.success, iconStyle: "success", statusText };
}

/** Fields `buildStatsParts` reads from a `NotificationDetails`. */
type StatsSource = Pick<
  NotificationDetails,
  "turnBudget" | "toolUses" | "totalTokens" | "durationMs"
>;

/** Assemble the stats-line parts (turns, tool uses, tokens, duration), omitting zero fields. */
export function buildStatsParts(d: StatsSource): string[] {
  const parts: string[] = [];
  if (d.turnBudget) parts.push(formatTurnBudget(d.turnBudget));
  if (d.toolUses > 0)
    parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
  if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
  if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
  return parts;
}

/**
 * Content lines for the result preview: the whole result (capped at 30 lines)
 * when expanded, or just the first line (capped at 80 columns) when collapsed.
 */
export function buildPreviewLines(
  resultPreview: string,
  expanded: boolean,
): string[] {
  if (expanded) return resultPreview.split("\n").slice(0, 30);
  return [resultPreview.split("\n")[0]?.slice(0, 80) ?? ""];
}
