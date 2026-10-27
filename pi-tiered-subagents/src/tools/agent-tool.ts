import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defined } from "#src/optional";
import type { AgentRegistry } from "#src/agents/registry";
import type { TurnSettings } from "#src/agents/resolver";
import type {
  ResumeCallOptions,
  ResumeRefusalReason,
  ResumeStart,
} from "#src/lifecycle/subagent-manager";
import type { Subagents } from "#src/service/subagents";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderStatusNote,
} from "#src/observation/outcome-delivery";
import {
  renderBackgroundLaunch,
  spawnBackground,
} from "#src/tools/background-spawner";
import { runForeground } from "#src/tools/foreground-runner";
import { buildDetails, textResult } from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import {
  type SubagentToolOutput,
  withStructured,
} from "#src/tools/structured-output";
import type { SpawnPresentation } from "#src/tools/spawn-config";
import type { Subagent } from "#src/types";
import type { AgentDetails } from "#src/ui/display";

// ---- Deps interfaces ----

/** Narrow manager slice retained for the Agent tool's resume presentation. */
export interface AgentToolManager {
  startResume: (
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ) => ResumeStart;
  getRecord: (id: string) => Subagent | undefined;
}

/** Narrow settings accessor — only the fields the Agent tool reads. */
export type AgentToolSettings = TurnSettings & {
  readonly maxConcurrent: number;
};

// ---- Class ----

export class AgentTool {
  constructor(
    private readonly manager: AgentToolManager,
    private readonly subagents: Subagents,
    private readonly settings: AgentToolSettings,
    private readonly registry: AgentRegistry,
  ) {}

  async execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    _ctx: ExtensionContext,
  ) {
    // ---- Resume existing agent ----
    // Resume dispatches before any new-launch preparation: continuing an
    // existing child must not load definitions or resolve a model for an
    // unrelated new launch (ARCHITECTURE-SPEC story 72).
    if (params.resume) {
      const id = params.resume as string;
      const detailBase = this.resumeDetailBase(id, params);
      // Only the caller's explicit flag: an agent file's run_in_background
      // default describes how that type spawns, not how a resume is collected.
      if (params.run_in_background === true) {
        return this.resumeInBackground(id, params.prompt as string, detailBase);
      }
      return this.resumeExisting(
        id,
        params.prompt as string,
        signal,
        onUpdate,
        detailBase,
      );
    }

    const prepared = await this.subagents.prepareLaunch(
      {
        type: params.subagent_type as string,
        prompt: params.prompt as string,
        ...defined({
          description: params.description as string | undefined,
          model: params.model as string | undefined,
          thinking: params.thinking as string | undefined,
          maxTurns: params.max_turns as number | undefined,
          inheritContext: params.inherit_context as boolean | undefined,
          runInBackground: params.run_in_background as boolean | undefined,
        }),
      },
      toolCallId,
      signal,
    );
    if (prepared.kind === "rejected") {
      return withStructured(
        { ...textResult(prepared.message), isError: true },
        {
          outcome: "rejected",
          reason: prepared.reason,
        },
      );
    }
    // Preparation can yield to definition I/O. Match the programmatic door's
    // acceptance boundary: cancellation that arrives after preparation but
    // before manager acceptance must reject without creating a child.
    if (signal?.aborted) {
      return withStructured(
        { ...textResult("Launch cancelled before acceptance."), isError: true },
        { outcome: "rejected", reason: "cancelled" },
      );
    }
    const launch = prepared.value;
    const { config } = launch;

    // ---- Background execution ----
    if (config.execution.runInBackground) {
      return spawnBackground(this.subagents, {
        config,
        launch,
        settings: this.settings,
      });
    }

    // ---- Foreground execution — stream progress via onUpdate ----
    return runForeground(this.subagents, { config, launch }, signal, onUpdate);
  }

  /**
   * The presentation a resume reports under, without preparing a launch.
   *
   * The caller's own `subagent_type` names the display, as it did when a
   * resume still prepared a launch it never used; the record's type is the
   * fallback for a caller that names none.
   */
  private resumeDetailBase(
    id: string,
    params: Record<string, unknown>,
  ): SpawnPresentation["detailBase"] {
    const recordType = this.manager.getRecord(id)?.type;
    const type =
      (params.subagent_type as string | undefined) ?? recordType ?? id;
    const definition = this.registry.find(type);
    const prompt = params.prompt as string;
    return {
      displayName: definition?.displayName ?? type,
      description:
        (params.description as string | undefined) ?? prompt.slice(0, 80),
      subagentType: type,
    };
  }

  /**
   * Continue an existing agent's session with a new prompt, returning its
   * resumed outcome directly to the parent. The resumed run is in the
   * foreground, so it streams its progress inline as a foreground spawn does.
   */
  private async resumeExisting(
    id: string,
    prompt: string,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    // The manager owns whether a resume happens; this door owns only how the
    // answer is worded. Resuming commits this call to delivering the outcome,
    // so it claims it — nothing else announces what is already being returned.
    const start = this.manager.startResume(id, prompt, {
      background: false,
      signal: signal ?? new AbortController().signal,
      claimOutcome: true,
    });
    if (start.kind === "refused") {
      return withStructured(
        {
          ...textResult(resumeRefusalMessage(start.reason, id)),
          isError: true,
        },
        {
          outcome: "rejected",
          reason: start.reason,
          agentId: id,
        },
      );
    }
    const record = start.record;
    const stopStream = startProgressStream({
      detailBase,
      onUpdate,
      getRecord: () => record,
    });
    try {
      await record.promise;
    } finally {
      stopStream();
    }
    // Resume-return delivery edge: the resumed outcome is returned directly.
    record.markConsumed();
    const output: SubagentToolOutput = {
      outcome: "completed",
      agentId: record.id,
      agentType: record.type,
      background: false,
      resumed: true,
      status: record.status,
      toolUses: record.toolUses,
      ...defined({ result: record.result, error: record.error }),
    };
    return withStructured(
      textResult(
        `Agent ID: ${record.id}${renderStatusNote(record)}\n\n` +
          renderOutcomeBody(record) +
          renderOutcomeAddenda(record),
        buildDetails(detailBase, record),
      ),
      output,
    );
  }

  /**
   * Start an existing agent's resume and return at once; the completion notice
   * delivers its outcome. Nothing claims the outcome and no tool-call signal is
   * wired, as for a background spawn, and like one it may wait for a
   * concurrency slot, which the launch message reports.
   */
  private resumeInBackground(
    id: string,
    prompt: string,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    const start = this.manager.startResume(id, prompt, { background: true });
    if (start.kind === "refused") {
      return withStructured(
        {
          ...textResult(resumeRefusalMessage(start.reason, id)),
          isError: true,
        },
        {
          outcome: "rejected",
          reason: start.reason,
          agentId: id,
        },
      );
    }
    const queued = start.record.status === "queued";
    const output: SubagentToolOutput = {
      outcome: "accepted",
      agentId: start.record.id,
      agentType: detailBase.subagentType,
      background: true,
      resumed: true,
      queued,
      ...defined({ outputFile: start.record.outputFile }),
    };
    return withStructured(
      renderBackgroundLaunch(
        defined({
          headline: queued
            ? "Agent resume queued in background."
            : "Agent resumed in background.",
          id: start.record.id,
          displayName: detailBase.displayName,
          description: detailBase.description,
          detailBase,
          outputFile: start.record.outputFile,
          queuePosition: queued
            ? { maxConcurrent: this.settings.maxConcurrent }
            : undefined,
        }),
      ),
      output,
    );
  }
}

/**
 * The operator-facing sentence for each reason a resume is refused.
 *
 * Exhaustive over `ResumeRefusalReason`, so a reason added later fails to
 * compile here rather than falling through to an attempted resume.
 */
function resumeRefusalMessage(
  refusal: ResumeRefusalReason,
  id: string,
): string {
  switch (refusal) {
    case "unknown-agent":
      return `Agent not found: "${id}". Records are cleared at session start/switch, so it may be from a previous session.`;
    case "stale-session":
      return (
        `Agent "${id}" belongs to a session that is no longer active. Its work was cancelled when that ` +
        "session was replaced, so it cannot be resumed from this one."
      );
    case "still-running":
      return (
        `Agent "${id}" is still running; wait for it to finish before resuming. ` +
        "Use steer_subagent to send it a message while it runs."
      );
    case "resume-queued":
      return (
        `Agent "${id}" already has a resume waiting for a concurrency slot; wait for that run ` +
        "to finish before resuming it again (get_subagent_result with wait: true returns when it does)."
      );
    case "session-released":
      return `Agent "${id}" had its session released after its retention window; resume is unavailable, but its result is still retrievable via get_subagent_result.`;
    case "no-session":
      return `Agent "${id}" has no active session to resume.`;
    case "workspace-disposed":
      return (
        `Agent "${id}" ran in an isolated workspace that no longer ` +
        "exists; resume is unavailable because the agent would re-enter a directory that " +
        "has been removed. Spawn a new agent instead — the agent's result records where " +
        "any work was saved."
      );
  }
}
