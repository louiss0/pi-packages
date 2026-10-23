/**
 * service-adapter.ts — Adapter that wraps SubagentManager to satisfy SubagentsService.
 *
 * Handles model resolution at the API boundary, record serialization
 * (stripping non-serializable fields), and session gating.
 */

import { defined } from "#src/optional";
import type { BackgroundRequest } from "#src/agents/invocation";
import type {
  ResumeCallOptions,
  ResumeOutcome,
} from "#src/lifecycle/subagent-manager";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { Subagents, SubagentsManager } from "#src/service/subagents";
import type {
  ResumeOptions,
  ResumeResult,
  SpawnOptions,
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

  spawn(type: string, prompt: string, options?: SpawnOptions): string {
    const prepared = this.subagents.prepareLaunch({
      type,
      prompt,
      ...defined({
        description: options?.description,
        model: options?.model,
        thinking: options?.thinkingLevel,
        maxTurns: options?.maxTurns,
        inheritContext: options?.inheritContext,
        runInBackground:
          options?.foreground === undefined ? undefined : !options.foreground,
      }),
    });
    if (prepared.kind === "rejected") throw new Error(prepared.message);

    // A caller that names `foreground` has committed; one that omits it has
    // not, so the agent's own frontmatter decides.
    const background: BackgroundRequest =
      options?.foreground === undefined
        ? { kind: "default", isBackground: true }
        : { kind: "explicit", isBackground: !options.foreground };
    const outcome = this.subagents.spawn(prepared.value, background);
    if (outcome.kind === "rejected") {
      throw new Error(`Launch refused: ${outcome.reason}`);
    }
    return outcome.value;
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
  if (record.model) {
    out.model = { provider: record.model.provider, id: record.model.id };
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
