/** Terminal callbacks for get_subagent_result; no retrieval or delivery policy. */
import type {
  AgentToolResult,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { BoundedLines } from "./bounded-lines.js";
import type { Theme } from "./display.js";
import type { GetResultDetails } from "./get-result-renderer.js";
import { renderGetResultLines } from "./get-result-renderer.js";
import { GLYPHS } from "./glyphs.js";

/** Only the call arguments this renderer reads; structurally satisfied by the runtime. */
export interface GetResultParamsView {
  readonly agent_id: string;
  readonly wait?: boolean;
  readonly verbose?: boolean;
  readonly timeout?: number;
}

export function renderGetResultCall(
  args: GetResultParamsView,
  theme: Theme,
): Component {
  const notes = [waitNote(args), args.verbose === true ? "verbose" : ""]
    .filter(Boolean)
    .join(", ");
  return new Text(
    `${GLYPHS.toolCall} ` +
      theme.fg("toolTitle", theme.bold("Get Agent Result")) +
      "  " +
      theme.fg("muted", args.agent_id) +
      (notes ? " " + theme.fg("muted", `(${notes})`) : ""),
    0,
    0,
  );
}

export function renderGetResultResult(
  result: AgentToolResult<GetResultDetails | undefined>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme,
): Component {
  const reportText =
    result.content[0]?.type === "text" ? result.content[0].text : "";
  if (!result.details) return new Text(reportText, 0, 0);
  return new BoundedLines(
    renderGetResultLines(result.details, reportText, expanded, theme),
  );
}

/** The call row's wait note: the bound when the wait has one. */
function waitNote(args: GetResultParamsView): string {
  if (args.wait !== true) return "";
  return args.timeout === undefined
    ? "waiting"
    : `waiting \u2264${args.timeout}s`;
}
