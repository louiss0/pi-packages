/**
 * progress-stream.ts — The inline progress a foreground run streams to its tool call.
 *
 * A foreground run blocks the parent's tool call, so its `onUpdate` carries
 * model-facing progress text and a fresh presentation snapshot. Terminal
 * renderers alone turn the snapshot's frame index into an animated glyph.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defined } from "#src/optional";
import { formatLifetimeTokens } from "#src/tools/helpers";
import type { SpawnPresentation } from "#src/tools/spawn-config";
import type { Subagent } from "#src/types";
import {
  type AgentDetails,
  describeActivity,
  modelLabel,
} from "#src/ui/display";
import { nextSpinnerFrame } from "#src/ui/glyphs";

/** The record fields one update renders. */
export type StreamedRecord = Pick<
  Subagent,
  | "toolUses"
  | "model"
  | "modelIdentity"
  | "lifetimeUsage"
  | "turnBudget"
  | "activeTools"
  | "responseText"
>;

export type ProgressStreamParams = {
  /** The call's presentation, which every update carries under its live fields. */
  detailBase: SpawnPresentation["detailBase"];
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined;
  /** The record to render; undefined until the run's session exists. */
  getRecord: () => StreamedRecord | undefined;
};

/** Progress update cadence; the terminal renderer owns the animation frames. */
const PROGRESS_INTERVAL_MS = 80;

/**
 * Stream one update now and one per progress tick, until the returned stop is
 * called. Stopping is idempotent, so a caller can stop from a `finally`.
 */
export function startProgressStream(params: ProgressStreamParams): () => void {
  const { detailBase, onUpdate, getRecord } = params;
  const startedAt = Date.now();
  let spinnerFrame = 0;

  const streamUpdate = () => {
    const record = getRecord();
    const toolUses = record?.toolUses ?? 0;
    const details: AgentDetails = {
      ...detailBase,
      toolUses,
      tokens: record ? formatLifetimeTokens(record) : "",
      durationMs: Date.now() - startedAt,
      status: "running",
      activity: describeActivity(
        record?.activeTools ?? new Map(),
        record?.responseText ?? "",
      ),
      spinnerFrame,
      ...defined({
        modelName:
          modelLabel(record?.modelIdentity ?? record?.model) ??
          detailBase.modelName,
        turnBudget: record?.turnBudget,
      }),
    };
    onUpdate?.({
      content: [{ type: "text", text: `${toolUses} tool uses...` }],
      details,
    });
  };

  const interval = setInterval(() => {
    spinnerFrame = nextSpinnerFrame(spinnerFrame);
    streamUpdate();
  }, PROGRESS_INTERVAL_MS);
  streamUpdate();

  return () => clearInterval(interval);
}
