/**
 * service-adapter.ts — Adapter that wraps SubagentManager to satisfy SubagentsService.
 *
 * Handles model resolution at the API boundary, record serialization
 * (stripping non-serializable fields), and session gating.
 */

import { defined } from "#src/optional";
import type { AgentDefinition } from "#src/agents/definition";
import { defaultDefinition } from "#src/agents/definition";
import type { BackgroundRequest } from "#src/agents/invocation";
import {
  parseThinkingLevel,
  thinkingLevelError,
} from "#src/config/thinking-level";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type {
  AgentSpawnConfig,
  ResumeCallOptions,
  ResumeOutcome,
} from "#src/lifecycle/subagent-manager";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { RoutingLadders } from "#src/models/router";
import { resolveSpawn, type TurnSettings } from "#src/agents/resolver";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";
import type { LaunchOutcome, SessionOwner } from "#src/lifecycle/session-owner";
import type {
  ResumeOptions,
  ResumeResult,
  SpawnOptions,
  SubagentRecord,
  SubagentsService,
} from "#src/service/service";
import type { SessionContext, Subagent, ThinkingLevel } from "#src/types";

/** Narrow manager interface — avoids coupling to the concrete class. */
export interface SubagentManagerLike {
  spawn(
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    options: AgentSpawnConfig,
  ): LaunchOutcome<string>;
  getRecord(id: string): Subagent | undefined;
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
  /**
   * The token a launch under the current session must carry, or undefined when
   * no session is active or one is in the process of ending. The doors stamp
   * this onto every launch, so a session that has been replaced is refused at
   * acceptance rather than accepted into the wrong parent.
   */
  currentOwner(): SessionOwner | undefined;
}

/**
 * Narrow runtime interface consumed by the service adapter.
 * `SubagentRuntime` satisfies this structurally; tests use plain stubs.
 */
export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
  buildSnapshot(inheritContext: boolean): ParentSnapshot;
  /** Parent session identity, so an SDK-spawned child nests under its parent. */
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

/** Adapter that wraps SubagentManager to satisfy SubagentsService. */
export class SubagentsServiceAdapter implements SubagentsService {
  constructor(
    private readonly manager: SubagentManagerLike,
    private readonly runtime: ServiceRuntimeLike,
    /**
     * The routing ladders, for the automatic model selection.
     */
    private readonly ladders: RoutingLadders,
    /**
     * The definition of the agent a spawn names, when one exists.
     *
     * The service door honours the same defaults the tool door does: a
     * definition that starts from the parent's conversation gets it unless the
     * caller says otherwise, and a definition that names a model wins over
     * the automatic routing.
     */
    private readonly resolveDefinition?: (
      type: string,
    ) => AgentDefinition | undefined,
    /**
     * The operator's turn-budget defaults, so the service door resolves launches
     * exactly as the tool door does. Read when the launch is prepared, so a
     * later default change reaches only the next launch.
     */
    private readonly settings: TurnSettings = {
      defaultMaxTurns: undefined,
      wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
    },
  ) {}

  spawn(type: string, prompt: string, options?: SpawnOptions): string {
    if (!this.runtime.currentCtx) {
      throw new Error(
        "No active session — cannot spawn agents outside a session.",
      );
    }
    // Read from the manager rather than from this runtime, because the manager
    // is the only thing that can say whether the session this launch belongs
    // to is still the one accepting work. A request stamped with a stale token
    // is refused at acceptance, not accepted into the session that replaced the
    // one that asked for it.
    const owner = this.manager.currentOwner();
    if (!owner) {
      throw new Error(
        "No active session — cannot spawn agents outside a session.",
      );
    }

    // The one resolver answers both doors: the caller's own answers, then the
    // definition's, then the automatic routing.
    const resolution = resolveSpawn(
      defined({
        definition:
          this.resolveDefinition?.(type) ?? defaultDefinition(type, "shipped"),
        prompt,
        requestedModel: options?.model,
        requestedThinking: this.resolveThinkingLevel(options?.thinkingLevel),
        requestedMaxTurns: options?.maxTurns,
        inheritContext: options?.inheritContext,
        runInBackground:
          options?.foreground === undefined ? undefined : !options.foreground,
        description: options?.description,
        modelInfo: defined({
          parentModel: this.runtime.currentCtx.model,
          modelRegistry: this.runtime.currentCtx.modelRegistry,
          parentThinkingLevel: this.runtime.currentCtx.thinkingLevel,
          ladders: this.ladders,
        }),
        settings: this.settings,
      }),
    );
    if ("error" in resolution) {
      throw new Error(resolution.error);
    }
    const { execution } = resolution;

    const snapshot = this.runtime.buildSnapshot(execution.inheritContext);
    const { parentSessionFile, parentSessionId } =
      this.runtime.getSessionInfo();
    // A caller that names `foreground` has committed; one that omits it has
    // not, so the agent's own frontmatter decides and background is the
    // SDK-door default.
    const background: BackgroundRequest =
      options?.foreground === undefined
        ? { kind: "default", isBackground: true }
        : { kind: "explicit", isBackground: !options.foreground };
    const outcome: LaunchOutcome<string> = this.manager.spawn(
      snapshot,
      type,
      prompt,
      defined({
        description: execution.description,
        modelSelection: execution.modelSelection,
        thinkingDecision: execution.thinkingDecision,
        turnPolicy: execution.turnPolicy,
        inheritContext: execution.inheritContext,
        // No toolCallId — an SDK spawn has no originating tool call, and
        // Subagent.toolCallId reporting undefined there is the truth.
        parentSession: { parentSessionFile, parentSessionId },
        background,
        model: execution.model,
        thinkingLevel: execution.thinking,
        owner,
      }),
    );
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

  /**
   * Narrow an optional thinking-level override, rejecting one the SDK does not know.
   *
   * `SpawnOptions` widens the field to `string` for the public surface, and Pi clamps an
   * unrecognized level down to `off` rather than reporting it — so a typo would silently
   * disable thinking in the child. Throwing matches the adapter's other input failures.
   */
  private resolveThinkingLevel(
    input: string | undefined,
  ): ThinkingLevel | undefined {
    if (input == null) return undefined;
    const level = parseThinkingLevel(input);
    if (level === undefined) throw new Error(thinkingLevelError(input));
    return level;
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
