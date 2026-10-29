/** Test-only contracts for driving the internal preparer/manager chain. */
import type { ResumeRefusal, SubagentStatus } from "#src/lifecycle/subagent";
import type { ResumeRefusalReason } from "#src/lifecycle/subagent-manager";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { LifetimeUsage } from "#src/lifecycle/usage";
import type { ModelSelection } from "#src/models/selection";
import type { ThinkingDecision } from "#src/thinking/resolve";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { SubagentsPreparationOutcome } from "#src/service/subagents";

/** Detached observations keep assertions stable across later child activity. */
export type SubagentRecord = {
  id: string;
  type: string;
  description: string;
  status: SubagentStatus;
  isBackground: boolean;
  result?: string;
  pendingQuestion?: string;
  error?: string;
  toolUses: number;
  turnBudget?: TurnBudget;
  startedAt: number;
  completedAt?: number;
  lifetimeUsage: LifetimeUsage;
  compactionCount: number;
  outputFile?: string;
  model?: { readonly provider: string; readonly id: string };
  thinking?: { readonly level?: string };
  modelSelection?: Pick<ModelSelection, "source" | "reason">;
  thinkingDecision?: Pick<
    ThinkingDecision,
    "applicable" | "source" | "clamped" | "reason"
  >;
  resumeRefusal?: ResumeRefusal;
};

export type ResumeOptions = {
  claimOutcome?: boolean;
  signal?: AbortSignal;
};

export type ResumeResult =
  | { kind: "resumed"; record: SubagentRecord }
  | { kind: "refused"; reason: ResumeRefusalReason };

export type LaunchOptions = {
  description?: string;
  model?: string;
  maxTurns?: number;
  thinkingLevel?: string;
  inheritContext?: boolean;
  signal?: AbortSignal;
};

export type LaunchRejected = Extract<
  SubagentsPreparationOutcome,
  { kind: "rejected" }
>;
export type LaunchResult =
  | { readonly kind: "accepted"; readonly id: string }
  | LaunchRejected;
export type RunResult =
  | { readonly kind: "settled"; readonly record: SubagentRecord }
  | LaunchRejected;

/** Convenience driver, not an exported package API or a production adapter. */
export interface SubagentsDriver {
  launch(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<LaunchResult>;
  run(
    type: string,
    prompt: string,
    options?: LaunchOptions,
  ): Promise<RunResult>;
  getRecord(id: string): SubagentRecord | undefined;
  listAgents(): SubagentRecord[];
  abort(id: string): boolean;
  steer(id: string, message: string): Promise<boolean>;
  resume(
    id: string,
    prompt: string,
    options?: ResumeOptions,
  ): Promise<ResumeResult>;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
}
