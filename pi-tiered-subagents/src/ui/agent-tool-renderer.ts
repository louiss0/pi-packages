/** Terminal callbacks for the subagent tool. The runtime owns tool registration. */
import type {
  AgentToolResult,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { AgentDetails, Theme } from "./display.js";
import { GLYPHS } from "./glyphs.js";
import { renderAgentResult } from "./result-renderer.js";

/** Resolve labels through a caller-supplied view, never a runtime registry import. */
export function createAgentToolRenderer(
  resolveDisplayName: (type: string) => string,
) {
  return {
    renderCall(args: Record<string, unknown>, theme: Theme): Component {
      const displayName = args.subagent_type
        ? resolveDisplayName(args.subagent_type as string)
        : "Subagent";
      const desc = (args.description as string | undefined) ?? "";
      return new Text(
        `${GLYPHS.toolCall} ` +
          theme.fg("toolTitle", theme.bold(displayName)) +
          (desc ? "  " + theme.fg("muted", desc) : ""),
        0,
        0,
      );
    },

    renderResult(
      result: AgentToolResult<AgentDetails | undefined>,
      { expanded, isPartial }: ToolRenderResultOptions,
      theme: Theme,
    ): Component {
      const resultText =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      if (!result.details) return new Text(resultText, 0, 0);
      return new Text(
        renderAgentResult(
          result.details,
          resultText,
          expanded,
          isPartial,
          theme,
        ),
        0,
        0,
      );
    },
  };
}
