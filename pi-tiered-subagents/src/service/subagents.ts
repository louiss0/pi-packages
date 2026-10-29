/**
 * subagents.ts — Internal session-scoped operations for the subagent tool.
 *
 * This is the composition seam between a request, the single LaunchPreparer,
 * the active parent snapshot, and manager acceptance. Door adapters supply
 * their own vocabulary and delivery choice; they do not select definitions,
 * capture parent slices, or assemble manager options independently.
 */

import type {
  ChildShapingSettings,
  LaunchPreparer,
  LaunchRequest,
  PreparedLaunch,
} from "#src/agents/launch-preparer";
import { resolveChildToolNames } from "#src/agents/definition";
import type { BackgroundRequest } from "#src/agents/invocation";
import type {
  AgentSpawnConfig,
  ForegroundRunOutcome,
} from "#src/lifecycle/subagent-manager";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type {
  Subagent,
  SubagentLifecycleObserver,
} from "#src/lifecycle/subagent";
import {
  type LaunchOutcome,
  ownerCanAccept,
  type SessionOwner,
} from "#src/lifecycle/session-owner";
import { debugNote } from "#src/debug";
import { defined } from "#src/optional";
import {
  concreteToolNamesError,
  expandMcpToolPatterns,
} from "#src/session/mcp-tool-patterns";
import type { ParentSessionInfo } from "#src/types";

/**
 * Parent capture operations needed at the acceptance boundary.
 *
 * Exactly one capture operation exists (story 16): a caller takes every
 * parent slice together, so no door can read inconsistent state.
 */
export interface SubagentsRuntime {
  readonly currentCtx: unknown | undefined;
  captureLaunchInputs(): {
    readonly snapshot: ParentSnapshot;
    readonly parentContext: string | undefined;
    readonly parentSession: {
      readonly parentSessionFile: string;
      readonly parentSessionId: string;
    };
  };
}

/** Manager operations the caller-facing launch seam is allowed to perform. */
export interface SubagentsManager {
  currentOwner(): SessionOwner | undefined;
  spawn(
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    options: AgentSpawnConfig,
  ): LaunchOutcome<string>;
  spawnAndWait(
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ): Promise<LaunchOutcome<Subagent>>;
  spawnAndWaitWithOutcome?: (
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ) => Promise<LaunchOutcome<ForegroundRunOutcome>>;
  getRecord(id: string): Subagent | undefined;
}

/** One captured request, ready to be accepted or rejected by the manager. */
export type PreparedSubagentsLaunch = Readonly<{
  owner: SessionOwner;
  config: PreparedLaunch["config"];
  childShaping: ChildShapingSettings;
  /** Exact capability allowlist captured and expanded before acceptance. */
  toolNames: ReadonlyArray<string>;
  snapshot: ParentSnapshot;
  parentSession: ParentSessionInfo;
}>;

export type SubagentsPreparationOutcome =
  | { readonly kind: "prepared"; readonly value: PreparedSubagentsLaunch }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "no-active-session"
        | "session-ended"
        | "unknown-agent"
        | "disabled-agent"
        | "invalid-thinking"
        | "configuration"
        | "cancelled";
      readonly message: string;
    };

export type ForegroundLaunchOptions = Readonly<{
  signal?: AbortSignal;
  observer?: SubagentLifecycleObserver;
}>;

export class Subagents {
  constructor(
    private readonly manager: SubagentsManager,
    private readonly runtime: SubagentsRuntime,
    private readonly preparer: LaunchPreparer,
  ) {}

  /**
   * Capture ownership before preparation, then capture the parent values the
   * Capture ownership and every parent input before the first await, then
   * let the preparation authority resolve the request. Nothing is re-read
   * from the live session after the await: the owner, snapshot values, and
   * session identity are invocation-time facts, and the manager re-validates
   * ownership atomically at acceptance, with no intervening asynchronous gap.
   */
  async prepareLaunch(
    request: LaunchRequest,
    toolCallId?: string,
    signal?: AbortSignal,
  ): Promise<SubagentsPreparationOutcome> {
    const owner = this.manager.currentOwner();
    if (!owner || !this.runtime.currentCtx) {
      return {
        kind: "rejected",
        reason: "no-active-session",
        message: "No active session — cannot launch agents outside a session.",
      };
    }

    // The one capture operation (story 16): every parent slice the launch
    // needs is taken here, before preparation can yield.
    const inputs = this.runtime.captureLaunchInputs();

    const prepared = await this.preparer.prepare(request, signal);
    if (prepared.kind === "rejected") return prepared;

    // The request was made under `owner`. If that session has since ended or
    // been replaced, the preparation's answer belongs to a session that is
    // gone: refuse before any acceptance work, and let the manager's own
    // atomic re-check stand as the last word at the commit (story 85).
    if (!ownerCanAccept(owner, this.manager.currentOwner())) {
      return {
        kind: "rejected",
        reason: "session-ended",
        message: "Session ended before the launch was accepted.",
      };
    }

    const { config } = prepared.value;
    // The conversation was captured with the request; only its attachment
    // waits on the resolved definition.
    const snapshot =
      config.execution.inheritContext && inputs.parentContext
        ? { ...inputs.snapshot, parentContext: inputs.parentContext }
        : inputs.snapshot;
    const declaredTools = resolveChildToolNames(
      config.identity.definition.tools,
      snapshot.activeToolNames,
    );
    const { toolNames, unmatchedPatterns } = expandMcpToolPatterns(
      declaredTools,
      snapshot.registeredToolNames,
    );
    const toolError = concreteToolNamesError(toolNames);
    if (toolError) {
      return { kind: "rejected", reason: "configuration", message: toolError };
    }
    for (const pattern of unmatchedPatterns) {
      debugNote(
        `agent ${config.identity.subagentType}: tools pattern ${pattern} matched no tool the parent had when the request was made`,
      );
    }
    const parentSession: ParentSessionInfo = {
      parentSessionFile: inputs.parentSession.parentSessionFile,
      parentSessionId: inputs.parentSession.parentSessionId,
      ...defined({ toolCallId }),
    };

    return {
      kind: "prepared",
      value: {
        owner,
        config,
        childShaping: prepared.value.childShaping,
        toolNames,
        snapshot,
        parentSession,
      },
    };
  }

  /**
   * Accept a prepared background-capable launch without waiting for a slot.
   *
   * No signal is taken here: acceptance hands ownership to the manager, so a
   * short-lived caller cannot take accepted background work down with it
   * (ARCHITECTURE-SPEC story 78). Cancelling after acceptance is
   * `abort(id)`.
   */
  spawn(
    launch: PreparedSubagentsLaunch,
    background: BackgroundRequest,
  ): LaunchOutcome<string> {
    const { identity, execution } = launch.config;
    const options: AgentSpawnConfig = {
      description: execution.description,
      definition: identity.definition,
      modelSelection: execution.modelSelection,
      thinkingDecision: execution.thinkingDecision,
      turnPolicy: execution.turnPolicy,
      inheritContext: execution.inheritContext,
      parentSession: launch.parentSession,
      background,
      owner: launch.owner,
      childShaping: launch.childShaping,
      toolNames: launch.toolNames,
      ...defined({
        modelIdentity: execution.modelIdentity,
        thinkingLevel: execution.thinking,
      }),
    };
    return this.manager.spawn(
      launch.snapshot,
      identity.rawType,
      execution.prompt,
      options,
    );
  }

  /** Accept and await one foreground run through the same prepared plan. */
  spawnAndWait(
    launch: PreparedSubagentsLaunch,
    options: ForegroundLaunchOptions = {},
  ): Promise<LaunchOutcome<Subagent>> {
    const { identity, execution } = launch.config;
    const managerOptions: Omit<AgentSpawnConfig, "background"> = {
      description: execution.description,
      definition: identity.definition,
      modelSelection: execution.modelSelection,
      thinkingDecision: execution.thinkingDecision,
      turnPolicy: execution.turnPolicy,
      inheritContext: execution.inheritContext,
      parentSession: launch.parentSession,
      owner: launch.owner,
      childShaping: launch.childShaping,
      toolNames: launch.toolNames,
      ...defined({
        modelIdentity: execution.modelIdentity,
        thinkingLevel: execution.thinking,
        signal: options.signal,
        observer: options.observer,
      }),
    };
    return this.manager.spawnAndWait(
      launch.snapshot,
      identity.rawType,
      execution.prompt,
      managerOptions,
    );
  }

  /** Await a foreground run while preserving the run associated with the wait. */
  spawnAndWaitWithOutcome(
    launch: PreparedSubagentsLaunch,
    options: ForegroundLaunchOptions = {},
  ): Promise<LaunchOutcome<ForegroundRunOutcome>> {
    const { identity, execution } = launch.config;
    const managerOptions: Omit<AgentSpawnConfig, "background"> = {
      description: execution.description,
      definition: identity.definition,
      modelSelection: execution.modelSelection,
      thinkingDecision: execution.thinkingDecision,
      turnPolicy: execution.turnPolicy,
      inheritContext: execution.inheritContext,
      parentSession: launch.parentSession,
      owner: launch.owner,
      childShaping: launch.childShaping,
      toolNames: launch.toolNames,
      ...defined({
        modelIdentity: execution.modelIdentity,
        thinkingLevel: execution.thinking,
        signal: options.signal,
        observer: options.observer,
      }),
    };
    if (this.manager.spawnAndWaitWithOutcome)
      return this.manager.spawnAndWaitWithOutcome(
        launch.snapshot,
        identity.rawType,
        execution.prompt,
        managerOptions,
      );
    return this.manager
      .spawnAndWait(
        launch.snapshot,
        identity.rawType,
        execution.prompt,
        managerOptions,
      )
      .then((outcome) =>
        outcome.kind === "rejected"
          ? outcome
          : {
              kind: "accepted" as const,
              value: { record: outcome.value, run: outcome.value.latestRun },
            },
      );
  }

  /** Read the current by-reference record only for presentation adapters. */
  getRecord(id: string): Subagent | undefined {
    return this.manager.getRecord(id);
  }
}
