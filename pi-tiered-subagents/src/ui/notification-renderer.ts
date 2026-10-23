import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { AgentStatus, TurnBudget } from "./view-types.js";
import { formatMs, formatTokens, formatTurnBudget } from "./display.js";
import { GLYPHS } from "./glyphs.js";
import { wrappedUpAtTurnLimit } from "./outcome-presentation.js";

/** The completion facts this renderer reads; structurally supplied by the runtime. */
export interface NotificationDetails {
  readonly description: string;
  readonly status: AgentStatus;
  readonly toolUses: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly outputFile?: string;
  readonly resultPreview: string;
  readonly turnBudget?: TurnBudget;
}

/** A still-running child's message, independent of runtime notification delivery. */
export interface UpdateDetails {
  readonly description: string;
  readonly message: string;
}

/** What a workspace teardown left behind, not a new outcome. */
export interface WorkspaceNoticeDetails {
  readonly description: string;
  readonly notice: string;
}

/** Narrow theme interface — only the methods the renderer actually calls. */
interface RendererTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
}

/** Narrow message interface — only the fields the renderer reads. */
interface RendererMessage {
  readonly details?: NotificationDetails;
}

/** Narrow message interface for the update renderer. */
interface UpdateMessage {
  readonly details?: UpdateDetails;
}

/** Narrow message interface for the workspace-notice renderer. */
interface WorkspaceNoticeMessage {
  readonly details?: WorkspaceNoticeDetails;
}

/** Narrow render options — only the fields the renderer reads. */
interface RenderOptions {
  readonly expanded: boolean;
}

// ---- Pure helpers (exported for unit testing) ----

/** Resolved status→presentation product: icon glyph/style and status label. */
export interface StatusPresentation {
  readonly iconGlyph: string;
  readonly iconStyle: ThemeColor;
  readonly statusText: string;
}

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

/**
 * Create the notification renderer callback for `pi.registerMessageRenderer`.
 * Returns a factory so the renderer is independently testable without the Pi SDK.
 */
export function createNotificationRenderer() {
  return (
    message: RendererMessage,
    { expanded }: RenderOptions,
    theme: RendererTheme,
  ): Component | undefined => {
    const d = message.details;
    if (!d) return undefined;

    const { iconGlyph, iconStyle, statusText } = resolveStatusPresentation(d);

    // Line 1: icon + agent description + status
    let line = `${theme.fg(iconStyle, iconGlyph)} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

    // Line 2: stats
    const parts = buildStatsParts(d);
    if (parts.length) {
      line +=
        "\n  " +
        parts
          .map((p) => theme.fg("dim", p))
          .join(" " + theme.fg("dim", "·") + " ");
    }

    // Line 3: result preview (collapsed) or full (expanded)
    const previewLines = buildPreviewLines(d.resultPreview, expanded);
    if (expanded) {
      for (const l of previewLines) line += "\n" + theme.fg("dim", `  ${l}`);
    } else {
      line +=
        "\n  " + theme.fg("dim", `${GLYPHS.subLine}  ${previewLines[0] ?? ""}`);
    }

    // Line 4: output file link (if present)
    if (d.outputFile) {
      line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
    }

    return new Text(line, 0, 0);
  };
}

/**
 * Create the mid-run update renderer for `pi.registerMessageRenderer`.
 *
 * Separate from the completion renderer because the agent has not finished:
 * `resolveStatusPresentation` speaks only terminal statuses, so reusing it
 * would draw a still-running child as completed.
 */
export function createUpdateRenderer() {
  return (
    message: UpdateMessage,
    { expanded }: RenderOptions,
    theme: RendererTheme,
  ): Component | undefined => {
    const d = message.details;
    if (!d) return undefined;

    let line = `${theme.fg("accent", GLYPHS.agentsActive)} ${theme.bold(d.description)} ${theme.fg("dim", "update")}`;
    for (const l of buildPreviewLines(d.message, expanded)) {
      line +=
        "\n  " +
        theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
    }
    return new Text(line, 0, 0);
  };
}

/**
 * Create the workspace-notice renderer for `pi.registerMessageRenderer`.
 *
 * Separate from the completion renderer because the agent's outcome was
 * reported long ago and has not changed: this reports only what a teardown did
 * with the child's work, so it carries no status, stats, or result preview.
 */
export function createWorkspaceNoticeRenderer() {
  return (
    message: WorkspaceNoticeMessage,
    { expanded }: RenderOptions,
    theme: RendererTheme,
  ): Component | undefined => {
    const d = message.details;
    if (!d) return undefined;

    let line = `${theme.fg("warning", GLYPHS.success)} ${theme.bold(d.description)} ${theme.fg("dim", "workspace")}`;
    for (const l of buildPreviewLines(d.notice.trim(), expanded)) {
      line +=
        "\n  " +
        theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
    }
    return new Text(line, 0, 0);
  };
}
