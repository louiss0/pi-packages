import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defined } from "#src/optional";
import type {
  PreparedSubagentsLaunch,
  Subagents,
} from "#src/service/subagents";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderRunUpdates,
  renderStatusNote,
  renderWorkspaceNotice,
} from "#src/observation/outcome-delivery";
import {
  buildDetails,
  formatLifetimeTokens,
  renderSpawnNotes,
  textResult,
} from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";
import {
  type SubagentToolOutput,
  withStructured,
} from "#src/tools/structured-output";
import type { Subagent } from "#src/types";
import { type AgentDetails, formatMs } from "#src/ui/display";

/** Narrow manager interface for the foreground runner. */
export type ForegroundManagerDeps = Pick<Subagents, "spawnAndWait">;

/** All values the foreground runner needs beyond the resolved config. */
export interface ForegroundParams {
  config: ResolvedSpawnConfig;
  launch: PreparedSubagentsLaunch;
}

/**
 * The operator-facing sentence for a launch refused before a child was created.
 *
 * Exhaustive over the four reasons, so one added later fails to compile here
 * rather than falling through to an answer that says nothing. Mirrors the
 * background door's wording: the two differ in how they deliver a result, not
 * in what they can refuse.
 */
function launchRefusedMessage(
  reason:
    | "no-active-session"
    | "session-ended"
    | "unknown-agent"
    | "disabled-agent",
  displayName: string,
): string {
  switch (reason) {
    case "no-active-session":
      return "No active session — cannot launch agents outside a session.";
    case "session-ended":
      return "Session ended before the launch was accepted.";
    case "unknown-agent":
      return `Unknown agent type "${displayName}".`;
    case "disabled-agent":
      return `Agent "${displayName}" is disabled.`;
  }
}

/**
 * Run an agent synchronously in the foreground, streaming spinner updates.
 * Owns: the progress stream's lifetime around the run, and result formatting.
 */
export async function runForeground(
  manager: ForegroundManagerDeps,
  params: ForegroundParams,
  signal: AbortSignal | undefined,
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
) {
  const { identity, presentation } = params.config;
  let recordRef: Subagent | undefined;
  const stopStream = startProgressStream({
    detailBase: presentation.detailBase,
    onUpdate,
    getRecord: () => recordRef,
  });

  let record: Subagent;
  try {
    const outcome = await manager.spawnAndWait(
      params.launch,
      defined({
        signal,
        observer: {
          onSessionCreated: (agent: Subagent) => {
            recordRef = agent;
          },
        },
      }),
    );
    // Refused before a child existed: the session this launch belonged to is
    // gone. Reported in the door's words, and the stream stops either way.
    if (outcome.kind === "rejected") {
      return withStructured(
        {
          ...textResult(
            launchRefusedMessage(outcome.reason, identity.displayName),
          ),
          isError: true,
        },
        {
          outcome: "rejected",
          reason: outcome.reason,
          agentType: identity.subagentType,
        },
      );
    }
    record = outcome.value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A wait that throws is a defect in this runtime, not the child's answer:
    // flagged as an error so it is not mistaken for a run outcome.
    return withStructured(
      { ...textResult(message), isError: true },
      { outcome: "failed", error: message, agentType: identity.subagentType },
    );
  } finally {
    stopStream();
  }

  // Foreground-return delivery edge: the result is handed back in this tool
  // result, so the outcome is collected. Mark it consumed.
  record.markConsumed();

  const tokenText = formatLifetimeTokens(record);
  const details = buildDetails(presentation.detailBase, record, {
    tokens: tokenText,
  });

  const noteText = renderSpawnNotes(params.config.notes);

  if (record.status === "error") {
    // A failed run has no result text, so this return is the only carrier that
    // can say where its workspace saved the work — or what the child flagged
    // before the failure, which is the one place those findings survive.
    // The transcript pointer rides here for the same reason: with no result to
    // read, it is the parent's only route to what the child did before it died.
    // The success branch omits it deliberately — that return carries the result.
    // The ask-back affordance is not composed here: a failed run answers no
    // question, so this is the addenda tail minus the one that cannot apply.
    const transcriptLine = record.outputFile
      ? `\nFull transcript available at: ${record.outputFile}`
      : "";
    // An accepted child whose execution failed: a settled run outcome, not a
    // defect — the error stays a structured value, the result is not isError.
    const failureOutput: SubagentToolOutput = {
      outcome: "completed",
      agentId: record.id,
      agentType: identity.subagentType,
      background: false,
      status: record.status,
      ...defined({
        error: record.error,
        outputFile: record.outputFile,
      }),
    };
    return withStructured(
      textResult(
        `${noteText}Agent failed: ${record.error}\nAgent ID: ${record.id}${transcriptLine}` +
          renderRunUpdates(record.runUpdates) +
          renderWorkspaceNotice(record.workspaceNotice),
        details,
      ),
      failureOutput,
    );
  }

  const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
  const statsParts = [`${record.toolUses} tool uses`];
  if (tokenText) statsParts.push(tokenText);
  const output: SubagentToolOutput = {
    outcome: "completed",
    agentId: record.id,
    agentType: identity.subagentType,
    background: false,
    status: record.status,
    toolUses: record.toolUses,
    durationMs,
    ...defined({ result: record.result, outputFile: record.outputFile }),
  };
  return withStructured(
    textResult(
      `${noteText}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${renderStatusNote(record)}.\n` +
        `Agent ID: ${record.id}\n\n` +
        renderOutcomeBody(record) +
        renderOutcomeAddenda(record),
      details,
    ),
    output,
  );
}
