/**
 * subagents.ts — Session-scoped caller operations shared by the tool and
 * programmatic doors.
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
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type {
  Subagent,
  SubagentLifecycleObserver,
} from "#src/lifecycle/subagent";
import type { LaunchOutcome, SessionOwner } from "#src/lifecycle/session-owner";
import { debugNote } from "#src/debug";
import { defined } from "#src/optional";
import { expandMcpToolPatterns } from "#src/session/mcp-tool-patterns";
import type { ParentSessionInfo } from "#src/types";

/** Parent capture operations needed at the acceptance boundary. */
export interface SubagentsRuntime {
  readonly currentCtx: unknown | undefined;
  buildSnapshot(inheritContext: boolean): ParentSnapshot;
  getSessionInfo(): {
    readonly parentSessionFile: string;
    readonly parentSessionId: string;
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
  getRecord(id: string): Subagent | undefined;
}

/** One captured request, ready to be accepted or rejected by the manager. */
export interface PreparedSubagentsLaunch {
  readonly owner: SessionOwner;
  readonly config: PreparedLaunch["config"];
  readonly childShaping: ChildShapingSettings;
  /** Exact capability allowlist captured and expanded before acceptance. */
  readonly toolNames: readonly string[];
  readonly snapshot: ParentSnapshot;
  readonly parentSession: ParentSessionInfo;
}

export type SubagentsPreparationOutcome =
  | { readonly kind: "prepared"; readonly value: PreparedSubagentsLaunch }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "no-active-session"
        | "unknown-agent"
        | "disabled-agent"
        | "invalid-thinking"
        | "configuration";
      readonly message: string;
    };

export interface ForegroundLaunchOptions {
  readonly signal?: AbortSignal;
  readonly observer?: SubagentLifecycleObserver;
}

export class Subagents {
  constructor(
    private readonly manager: SubagentsManager,
    private readonly runtime: SubagentsRuntime,
    private readonly preparer: LaunchPreparer,
  ) {}

  /**
   * Capture ownership before preparation, then capture the parent values the
   * selected launch needs. This is synchronous, so later async definition
   * loading can move behind this operation without changing invocation facts.
   */
  prepareLaunch(
    request: LaunchRequest,
    toolCallId?: string,
  ): SubagentsPreparationOutcome {
    const owner = this.manager.currentOwner();
    if (!owner || !this.runtime.currentCtx) {
      return {
        kind: "rejected",
        reason: "no-active-session",
        message: "No active session — cannot launch agents outside a session.",
      };
    }

    const prepared = this.preparer.prepare(request);
    if (prepared.kind === "rejected") return prepared;

    const { config } = prepared.value;
    const snapshot = this.runtime.buildSnapshot(
      config.execution.inheritContext,
    );
    const declaredTools = resolveChildToolNames(
      config.identity.definition.tools,
      snapshot.activeToolNames,
    );
    const { toolNames, unmatchedPatterns } = expandMcpToolPatterns(
      declaredTools,
      snapshot.registeredToolNames,
    );
    for (const pattern of unmatchedPatterns) {
      debugNote(
        `agent ${config.identity.subagentType}: tools pattern ${pattern} matched no tool the parent had when the request was made`,
      );
    }
    const { parentSessionFile, parentSessionId } =
      this.runtime.getSessionInfo();
    const parentSession: ParentSessionInfo = {
      parentSessionFile,
      parentSessionId,
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

  /** Accept a prepared background-capable launch without waiting for a slot. */
  spawn(
    launch: PreparedSubagentsLaunch,
    background: BackgroundRequest,
    signal?: AbortSignal,
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
        signal,
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

  /** Read the current by-reference record only for presentation adapters. */
  getRecord(id: string): Subagent | undefined {
    return this.manager.getRecord(id);
  }
}
