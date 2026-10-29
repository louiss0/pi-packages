/**
 * Test-only driver for the real preparation, acceptance, and execution chain.
 * No production module imports this helper and it is not included in the package.
 */
import { defined } from "#src/optional";
import type {
  ResumeCallOptions,
  ResumeOutcome,
} from "#src/lifecycle/subagent-manager";
import type { RunOutcome } from "#src/lifecycle/subagent-run";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { Subagents, SubagentsManager } from "#src/service/subagents";
import type { Subagent } from "#src/types";
import type {
  LaunchOptions,
  LaunchRejected,
  LaunchResult,
  ResumeOptions,
  ResumeResult,
  RunResult,
  SubagentRecord,
  SubagentsDriver,
} from "#test/helpers/subagents-driver-types";

interface DriverManager extends SubagentsManager {
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

export class SubagentsTestDriver implements SubagentsDriver {
  constructor(
    private readonly manager: DriverManager,
    private readonly subagents: Subagents,
  ) {}

  private prepare(type: string, prompt: string, options?: LaunchOptions) {
    return this.subagents.prepareLaunch(
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
  }

  async launch(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<LaunchResult> {
    const prepared = await this.prepare(type, prompt, options);
    if (prepared.kind === "rejected") return prepared;
    if (options?.signal?.aborted) return refused("cancelled");
    const outcome = this.subagents.spawn(prepared.value, {
      kind: "explicit",
      isBackground: true,
    });
    return outcome.kind === "rejected"
      ? refused(outcome.reason)
      : { kind: "accepted", id: outcome.value };
  }

  async run(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<RunResult> {
    const prepared = await this.prepare(type, prompt, options);
    if (prepared.kind === "rejected") return prepared;
    if (options?.signal?.aborted) return refused("cancelled");
    const outcome = await this.subagents.spawnAndWaitWithOutcome(
      prepared.value,
      defined({ signal: options?.signal }),
    );
    return outcome.kind === "rejected"
      ? refused(outcome.reason)
      : {
          kind: "settled",
          record: snapshot(outcome.value.record, outcome.value.run),
        };
  }

  getRecord(id: string): SubagentRecord | undefined {
    const record = this.manager.getRecord(id);
    return record ? snapshot(record) : undefined;
  }

  listAgents(): SubagentRecord[] {
    return this.manager.listAgents().map((record) => snapshot(record));
  }

  abort(id: string): boolean {
    return this.manager.abort(id);
  }

  async steer(id: string, message: string): Promise<boolean> {
    const record = this.manager.getRecord(id);
    return record ? (await record.steer(message)).kind !== "rejected" : false;
  }

  async resume(
    id: string,
    prompt: string,
    options?: ResumeOptions,
  ): Promise<ResumeResult> {
    const outcome = await this.manager.resume(id, prompt, {
      background: true,
      ...defined({
        claimOutcome: options?.claimOutcome,
        signal: options?.signal,
      }),
    });
    return outcome.kind === "refused"
      ? outcome
      : { kind: "resumed", record: snapshot(outcome.record) };
  }

  waitForAll(): Promise<void> {
    return this.manager.waitForAll();
  }

  hasRunning(): boolean {
    return this.manager.hasRunning();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    return this.manager.registerWorkspaceProvider(provider);
  }
}

function refused(reason: LaunchRejected["reason"]): LaunchRejected {
  return { kind: "rejected", reason, message: `Launch rejected: ${reason}` };
}

/** Copy facts used by assertions without introducing a production snapshot API. */
function snapshot(
  record: Subagent,
  run: RunOutcome = record.latestRun,
): SubagentRecord {
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    status: run.status,
    isBackground: run.inBackground,
    toolUses: record.toolUses,
    startedAt: run.startedAt,
    lifetimeUsage: { ...record.lifetimeUsage },
    compactionCount: record.compactionCount,
    ...defined({
      result: run.result,
      pendingQuestion: run.pendingQuestion,
      error: run.error,
      completedAt: run.completedAt,
      turnBudget: run.turnBudget ? { ...run.turnBudget } : undefined,
      outputFile: record.outputFile,
      resumeRefusal:
        run === record.latestRun ? record.resumeRefusal : undefined,
      model: record.modelIdentity ? { ...record.modelIdentity } : undefined,
      thinking: record.thinkingLevel
        ? { level: record.thinkingLevel }
        : undefined,
      modelSelection: record.modelSelection
        ? {
            source: record.modelSelection.source,
            reason: record.modelSelection.reason,
          }
        : undefined,
      thinkingDecision: record.thinkingDecision
        ? {
            applicable: record.thinkingDecision.applicable,
            source: record.thinkingDecision.source,
            clamped: record.thinkingDecision.clamped,
            reason: record.thinkingDecision.reason,
          }
        : undefined,
    }),
  };
}
