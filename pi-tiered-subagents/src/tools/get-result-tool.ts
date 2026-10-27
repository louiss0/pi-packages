import { defined } from "#src/optional";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import type { RunOutcome } from "#src/lifecycle/subagent-run";
import {
  type GetResultDetails,
  PREVIEW_CHARS,
} from "#src/ui/get-result-renderer";
import {
  type AgentReport,
  formatAgentReport,
} from "#src/tools/get-result-report";
import { formatLifetimeTokens, textResult } from "#src/tools/helpers";
import {
  type GetResultToolOutput,
  withStructured,
} from "#src/tools/structured-output";
import type { Subagent } from "#src/types";
import {
  describeActivity,
  formatDuration,
  formatMs,
  getDisplayName,
  modelLabel,
} from "#src/ui/display";

// ---- Deps interfaces ----

export interface GetResultToolManager {
  getRecord(id: string): Subagent | undefined;
}

/** The arguments a get_subagent_result call carries. */
export type GetResultParams = {
  agent_id: string;
  wait?: boolean;
  verbose?: boolean;
  /** Seconds; bounds only a `wait: true` call. Absent = wait until the agent settles. */
  timeout?: number;
};

/** What collecting the outcome produced: the run this call reports, and how its wait ended. */
type CollectedOutcome = {
  /** The run whose outcome this call reports: the one it waited on, or the latest. */
  run: RunOutcome;
  /** The bound, in seconds, of a wait that ended at it with the agent still running. */
  waitExpiredAfter?: number;
};

/** setTimeout's ceiling, the same one Pi's bash tool enforces. */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

// ---- Class ----

export class GetResultTool {
  constructor(
    private readonly manager: GetResultToolManager,
    private readonly registry: AgentDefinitionLookup,
  ) {}

  async execute(
    _toolCallId: string,
    params: GetResultParams,
    signal: AbortSignal,
    _onUpdate: unknown,
    _ctx: unknown,
  ) {
    validateTimeout(params.timeout);
    const record = this.manager.getRecord(params.agent_id);
    if (!record) {
      return withStructured(
        textResult<GetResultDetails>(
          `Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`,
        ),
        { found: false, agentId: params.agent_id },
      );
    }

    const collected = await this.collectOutcome(record, params, signal);

    const verbose = params.verbose === true;
    return withStructured(
      textResult<GetResultDetails>(
        formatAgentReport(this.buildReport(record, verbose, collected)),
        this.buildGetResultDetails(record, collected.run, verbose),
      ),
      this.buildStructuredOutput(record, collected, verbose),
    );
  }

  /**
   * The report's machine-readable twin: the same facts the text renders, as
   * values a programmatic caller reads instead of parsing the report's lines.
   */
  private buildStructuredOutput(
    record: Subagent,
    collected: CollectedOutcome,
    verbose: boolean,
  ): GetResultToolOutput {
    const outcome = collected.run;
    return {
      found: true,
      agentId: record.id,
      status: outcome.status,
      displayName: getDisplayName(record.type, this.registry),
      description: record.description,
      toolUses: record.toolUses,
      compactionCount: record.compactionCount,
      durationMs: (outcome.completedAt ?? Date.now()) - outcome.startedAt,
      resumable: record.resumeRefusal === undefined,
      ...defined({
        model: modelLabel(record.modelIdentity),
        result: outcome.result,
        error: outcome.error,
        contextPercent: record.getContextPercent() ?? undefined,
        resumeRefusal: record.resumeRefusal,
        pendingQuestion: outcome.pendingQuestion,
        stoppedWhileQueued: outcome.stoppedWhileQueued || undefined,
        resumedWhileWaiting: outcome.replaced || undefined,
        waitExpiredAfter: collected.waitExpiredAfter,
        transcriptPath: record.outputFile,
        conversation: verbose ? record.getConversation() : undefined,
      }),
    };
  }

  /**
   * Settle this call's delivery obligation: wait when asked, then mark the
   * outcome collected or release the claim. Reports the run this call holds
   * (the one it waited on, even if a resume replaced it), and whether the wait
   * ended at its bound.
   *
   * A bound only swaps the signal the wait ends on, so a wait that reaches it
   * takes the same path as an interrupted one: the claim is released and the
   * agent keeps running.
   */
  private async collectOutcome(
    record: Subagent,
    params: GetResultParams,
    signal: AbortSignal,
  ): Promise<CollectedOutcome> {
    // Wait for completion if requested. The record owns the decision of whether
    // it is still awaitable — a queued agent counts, because scheduleVia()
    // captures its limiter promise at spawn. A parent interrupt ends the wait
    // without cancelling the agent, leaving the outcome uncollected below.
    //
    // Pull-delivery edge: the parent is collecting the settled outcome here, so
    // mark it consumed. A wait whose run has not settled was abandoned, so it
    // releases the claim it made and lets the nudge announce. The handle drops
    // only this call's claim, so a concurrent carrier's (such as a resume that
    // started as the run settled) is never cleared by this call.
    //
    // A resume that replaced the waited run after it settled leaves this call
    // the only carrier of what that run ended with: its nudge was suppressed by
    // this call's claim. The call holds that run, so it reports and consumes
    // that run's outcome; the resumed run's own delivery is untouched.
    if (params.wait === true) {
      // Capture and claim the observed run as one synchronous operation. The
      // record may point at a resumed run by the time this await continues, but
      // this carrier's claim stays with the run it began observing.
      const observedRun = record.latestRun;
      const claim = observedRun.claim();
      const bound =
        params.timeout === undefined
          ? undefined
          : new WaitBound(signal, params.timeout);
      try {
        const run = await record.waitUntilSettled(bound?.signal ?? signal);
        if (!run.isActive()) {
          run.markConsumed();
          return { run };
        }
        claim.release();
        return bound?.expired
          ? defined({ run, waitExpiredAfter: params.timeout })
          : { run };
      } finally {
        bound?.dispose();
      }
    }
    const run = record.latestRun;
    if (!run.isActive()) run.markConsumed();
    return { run };
  }

  /** The report: outcome fields from the collected run, everything else from the live record. */
  private buildReport(
    record: Subagent,
    verbose: boolean,
    collected: CollectedOutcome,
  ): AgentReport {
    const outcome = collected.run;
    return {
      ...defined({
        id: record.id,
        displayName: getDisplayName(record.type, this.registry),
        status: outcome.status,
        toolUses: record.toolUses,
        tokens: formatLifetimeTokens(record),
        contextPercent: record.getContextPercent(),
        compactionCount: record.compactionCount,
        duration: formatDuration(outcome.startedAt, outcome.completedAt),
        description: record.description,
        stoppedWhileQueued: outcome.stoppedWhileQueued,
        resumedWhileWaiting: outcome.replaced,
        runUpdates: outcome.runUpdates,
        result: outcome.result,
        error: outcome.error,
        turnBudget: outcome.turnBudget,
        pendingQuestion: outcome.pendingQuestion,
        workspaceNotice: outcome.workspaceNotice,
        conversation: verbose ? record.getConversation() : undefined,
        // Transcript pointer: lets the parent read the full session from disk,
        // and covers verbose after the live session was released (no conversation).
        transcriptPath: record.outputFile,
        waitExpiredAfter: collected.waitExpiredAfter,
        progress: outcome.status === "running" ? progressOf(record) : undefined,
      }),
      // These two stay required-with-a-value: an absent key would read as
      // "resumable" and "model unknown" by omission, which is exactly the
      // fail-open each field is documented to close.
      resumeRefusal: record.resumeRefusal,
      model: modelLabel(record.modelIdentity),
    };
  }

  /**
   * The compact metadata the TUI renders from.
   *
   * Named in full because `helpers.ts` exports a module-level `buildDetails`
   * producing the structurally different `AgentDetails`.
   */
  private buildGetResultDetails(
    record: Subagent,
    outcome: RunOutcome,
    verbose: boolean,
  ): GetResultDetails {
    return defined({
      agentId: record.id,
      displayName: getDisplayName(record.type, this.registry),
      status: outcome.status,
      description: record.description,
      toolUses: record.toolUses,
      tokens: formatLifetimeTokens(record),
      contextPercent: record.getContextPercent(),
      compactionCount: record.compactionCount,
      duration: formatDuration(outcome.startedAt, outcome.completedAt),
      verbose,
      transcriptPath: record.outputFile,
      preview: buildPreview(outcome.result),
      error: outcome.error,
      turnBudget: outcome.turnBudget,
      modelName: modelLabel(record.modelIdentity),
    });
  }
}

/** Throws on a timeout setTimeout cannot honor, worded as Pi's bash tool words it. */
function validateTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      "Invalid timeout: must be a finite number of seconds greater than 0",
    );
  }
  if (timeout > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`,
    );
  }
}

/**
 * Ends a wait at the parent's interrupt or at a deadline, whichever comes first,
 * and remembers whether the deadline was the one that fired.
 */
class WaitBound {
  private readonly controller = new AbortController();
  private readonly detach = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private _expired = false;

  constructor(parent: AbortSignal, seconds: number) {
    this.timer = setTimeout(() => {
      this._expired = true;
      this.controller.abort();
    }, seconds * 1000);
    if (parent.aborted) this.controller.abort();
    else
      parent.addEventListener(
        "abort",
        () => {
          this.controller.abort();
        },
        { once: true, signal: this.detach.signal },
      );
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Whether the deadline, rather than the parent, ended the wait. */
  get expired(): boolean {
    return this._expired;
  }

  /** Clears the deadline and the parent listener, so neither outlives the call. */
  dispose(): void {
    clearTimeout(this.timer);
    this.detach.abort();
  }
}

/**
 * What a running agent is doing and how long since its last session event: the
 * facts the widget shows the human, so the parent can tell a stalled run from a
 * long one.
 */
function progressOf(record: Subagent): AgentReport["progress"] {
  return {
    activity: describeActivity(record.activeTools, record.responseText),
    turns: record.turnBudget?.used,
    sinceLastProgress: formatMs(Date.now() - record.lastProgressAt),
  };
}

/** The first non-empty line of a result body, clipped to the preview budget. */
function buildPreview(result: string | undefined): string | undefined {
  const line = result
    ?.split("\n")
    .find((candidate) => candidate.trim())
    ?.trim();
  if (!line) return undefined;
  return line.length > PREVIEW_CHARS
    ? line.slice(0, PREVIEW_CHARS - 1) + "\u2026"
    : line;
}
