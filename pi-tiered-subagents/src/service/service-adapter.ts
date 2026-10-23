/**
 * service-adapter.ts — Adapter that wraps SubagentManager to satisfy SubagentsService.
 *
 * Handles model resolution at the API boundary, record serialization
 * (stripping non-serializable fields), and session gating.
 */

import { defined } from "#src/optional";
import type {
  LaunchOptions,
  LaunchRejected,
  LaunchResult,
  RunResult,
} from "#src/service/service";
import type {
  ResumeCallOptions,
  ResumeOutcome,
} from "#src/lifecycle/subagent-manager";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { Subagents, SubagentsManager } from "#src/service/subagents";
import type {
  ResumeOptions,
  ResumeResult,
  SubagentRecord,
  SubagentsService,
} from "#src/service/service";
import type { Subagent } from "#src/types";

/** Narrow manager interface — avoids coupling to the concrete class. */
export interface SubagentManagerLike extends SubagentsManager {
  listAgents(): Subagent[];
  abort(id: string): boolean;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
  resume(
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ): Promise<ResumeOutcome>;
}
/** Adapter that wraps SubagentManager to satisfy SubagentsService. */
export class SubagentsServiceAdapter implements SubagentsService {
  constructor(
    private readonly manager: SubagentManagerLike,
    private readonly subagents: Subagents,
  ) {}

  /**
   * Prepare and accept a background launch.
   *
   * The caller's signal cancels preparation only; once acceptance returns,
   * the manager owns the child and the signal is detached (story 78).
   */
  async launch(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<LaunchResult> {
    const prepared = await this.subagents.prepareLaunch(
      {
        type,
        prompt,
        ...defined({
          description: options?.description,
          model: options?.model,
          thinking: options?.thinkingLevel,
          maxTurns: options?.maxTurns,
          inheritContext: options?.inheritContext,
        }),
      },
      undefined,
      options?.signal,
    );
    if (prepared.kind === "rejected") {
      return {
        kind: "rejected",
        reason: prepared.reason,
        message: prepared.message,
      };
    }

    // A service launch is committed to background delivery: the ID-returning
    // operation hands off, exactly as the inherited synchronous spawn did.
    const outcome = this.subagents.spawn(prepared.value, {
      kind: "explicit",
      isBackground: true,
    });
    if (outcome.kind === "rejected") {
      return refused(outcome.reason);
    }
    return { kind: "accepted", id: outcome.value };
  }

  /**
   * Prepare, accept, and await one foreground run.
   *
   * The caller's signal cancels preparation before acceptance and, after it,
   * stops the queued or running child this call owns. The resolved outcome is
   * claimed here, so nothing else announces it.
   */
  async run(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<RunResult> {
    const prepared = await this.subagents.prepareLaunch(
      {
        type,
        prompt,
        ...defined({
          description: options?.description,
          model: options?.model,
          thinking: options?.thinkingLevel,
          maxTurns: options?.maxTurns,
          inheritContext: options?.inheritContext,
        }),
      },
      undefined,
      options?.signal,
    );
    if (prepared.kind === "rejected") {
      return {
        kind: "rejected",
        reason: prepared.reason,
        message: prepared.message,
      };
    }

    const outcome = await this.subagents.spawnAndWait(
      prepared.value,
      defined({
        signal: options?.signal,
      }),
    );
    if (outcome.kind === "rejected") {
      return refused(outcome.reason);
    }
    return { kind: "settled", record: toSubagentRecord(outcome.value) };
  }

  getRecord(id: string): SubagentRecord | undefined {
    const record = this.manager.getRecord(id);
    return record ? toSubagentRecord(record) : undefined;
  }

  listAgents(): SubagentRecord[] {
    return this.manager.listAgents().map(toSubagentRecord);
  }

  abort(id: string): boolean {
    return this.manager.abort(id);
  }

  async steer(id: string, message: string): Promise<boolean> {
    const record = this.manager.getRecord(id);
    if (!record) {
      return false;
    }
    const outcome = await record.steer(message);
    return outcome.kind !== "rejected";
  }

  async resume(
    id: string,
    prompt: string,
    options?: ResumeOptions,
  ): Promise<ResumeResult> {
    const outcome = await this.manager.resume(
      id,
      prompt,
      defined({
        // Nothing in the parent's turn waits on a service resume, so it runs in
        // the background, as a service spawn does by default.
        background: true,
        claimOutcome: options?.claimOutcome,
        signal: options?.signal,
      }),
    );
    // A refusal is the same value on both sides; only the resumed arm crosses
    // the by-value boundary the snapshot draws.
    return outcome.kind === "refused"
      ? outcome
      : { kind: "resumed", record: toSubagentRecord(outcome.record) };
  }

  async waitForAll(): Promise<void> {
    return this.manager.waitForAll();
  }

  hasRunning(): boolean {
    return this.manager.hasRunning();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    return this.manager.registerWorkspaceProvider(provider);
  }
}
/** The refusal sentence for a launch the manager turned away at acceptance. */
function refused(reason: LaunchRejected["reason"]): LaunchRejected {
  const message =
    reason === "no-active-session"
      ? "No active session — cannot launch agents outside a session."
      : reason === "session-ended"
        ? "Session ended before the launch was accepted."
        : reason === "unknown-agent"
          ? "The agent type is no longer in the catalog."
          : reason === "disabled-agent"
            ? "The agent type has been disabled."
            : "The launch was cancelled before the launch was accepted.";
  return { kind: "rejected", reason, message };
}

/**
 * Convert an internal Subagent to a serializable SubagentRecord.
 *
 * The allowlist is explicit because the snapshot admits only discrete facts —
 * identity, resolved spawn decisions, cumulative metrics, and pointers to
 * durable artifacts. Live objects, momentary activity, and package-internal
 * bookkeeping stay out; see
 * `docs/decisions/0005-subagent-record-admission-policy.md`.
 */
export function toSubagentRecord(record: Subagent): SubagentRecord {
  const out: SubagentRecord = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    isBackground: record.isBackground,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    // Copy: the agent accumulates into its own object on every message_end, so
    // an aliased snapshot would drift, and a consumer could write into the
    // agent's totals.
    lifetimeUsage: { ...record.lifetimeUsage },
    compactionCount: record.compactionCount,
  };

  if (record.result !== undefined) out.result = record.result;
  if (record.pendingQuestion !== undefined)
    out.pendingQuestion = record.pendingQuestion;
  if (record.error !== undefined) out.error = record.error;
  if (record.completedAt !== undefined) out.completedAt = record.completedAt;
  // Copy, like lifetimeUsage: the snapshot is by value.
  if (record.turnBudget !== undefined)
    out.turnBudget = { ...record.turnBudget };
  if (record.outputFile !== undefined) out.outputFile = record.outputFile;
  if (record.resumeRefusal !== undefined)
    out.resumeRefusal = record.resumeRefusal;

  // The model the child ran on, and the reasoning level it ran at: the facts a
  // consumer needs to know what it actually got.
  if (record.modelIdentity) {
    out.model = { ...record.modelIdentity };
  }
  if (record.thinkingLevel) {
    out.thinking = { level: record.thinkingLevel };
  }

  // The launch's decision facts travel with the record: the model was chosen
  // from somewhere, and why, plus the reasoning decision behind the level.
  // Both are absent until a launch resolved a model.
  if (record.modelSelection) {
    out.modelSelection = {
      source: record.modelSelection.source,
      reason: record.modelSelection.reason,
    };
  }
  if (record.thinkingDecision) {
    out.thinkingDecision = {
      applicable: record.thinkingDecision.applicable,
      source: record.thinkingDecision.source,
      clamped: record.thinkingDecision.clamped,
      reason: record.thinkingDecision.reason,
    };
  }

  return out;
}
