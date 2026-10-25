/**
 * subagents-harness.ts — The behavior-test harness for the Subagents seam (story 112).
 *
 * Wires the real chain both caller doors use — LaunchPreparer, Subagents,
 * SubagentManager, SubagentsServiceAdapter — with the two substitutions the
 * Testing Decisions section of ARCHITECTURE-SPEC names: definition I/O (a
 * pausable scope loader over a real registry) and child execution (the
 * controllable ChildSession factory). A test drives `service.launch/run/
 * resume/abort/steer` and asserts on by-value records, observer facts, and the
 * prepared launches the child adapter actually received — never on manager
 * internals.
 *
 * The harness begins one parent session ("session-1") so launches are
 * accepted; `beginSession`/`beginSessionEnd`/`endSession` drive the manager's
 * lifetime the way Pi's session events drive it in production.
 */

import type { LoadedScopes } from "#src/agents/loader";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import { AgentRegistry } from "#src/agents/registry";
import type { ModelInfo } from "#src/agents/resolver";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { RunKind } from "#src/lifecycle/subagent-run";
import {
  SubagentManager,
  type SubagentManagerObserver,
} from "#src/lifecycle/subagent-manager";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import type { SubagentsService } from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { Subagents, type SubagentsRuntime } from "#src/service/subagents";
import type { CompactionInfo } from "#src/types";
import {
  createControllableChildFactory,
  type ControllableChildFactory,
  type ControllableChildFactoryOptions,
} from "#test/helpers/controllable-child-session";
import { makeModel } from "#test/helpers/make-model";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/** A run transition the manager announced, with the facts observable at that moment. */
export interface RecordedRunTransition {
  readonly id: string;
  readonly kind: RunKind;
  readonly status: SubagentStatus;
  /** Whether the run's outcome was claimed when the transition fired (story 89). */
  readonly claimed: boolean;
}

/** What the harness's manager observer recorded, in order. */
export interface HarnessObserverLog {
  readonly created: readonly string[];
  readonly runStarted: readonly RecordedRunTransition[];
  readonly runFinished: readonly RecordedRunTransition[];
  readonly compacted: readonly CompactionInfo[];
}

export interface SubagentsHarnessOptions {
  /**
   * The definition layers the registry reads. A closure over a mutable
   * variable lets a test edit definitions between requests and prove which
   * launches observe the edit.
   */
  readonly scopes?: () => LoadedScopes;
  /** Initial concurrency cap; `setConcurrency` changes it live. */
  readonly concurrency?: number;
  /** Parent model facts; defaults to a retained claude-sonnet parent. */
  readonly modelInfo?: () => ModelInfo;
  /** The operator's mid-run-update setting, live-read at run start. */
  readonly midRunUpdates?: boolean;
  /** Options for the controllable child factory (e.g. settleOnAbort). */
  readonly children?: ControllableChildFactoryOptions;
  /** Additional lifecycle observer used by integration tests (for persistence/notifications). */
  readonly observer?: SubagentManagerObserver;
}

export interface SubagentsHarness {
  /** The public caller interface the tests drive. */
  readonly service: SubagentsService;
  /** The session-scoped seam behind it, for presentation-adapter reads. */
  readonly subagents: Subagents;
  readonly manager: SubagentManager;
  /** The controllable child executions: pause, settle, fail, steer, cancel. */
  readonly children: ControllableChildFactory;
  /** The manager's lifecycle announcements, recorded as they fired. */
  readonly observer: HarnessObserverLog;
  /** Hold every preparation's definition load until resumed (story 15 capture). */
  pauseDefinitionLoad(): void;
  resumeDefinitionLoad(): void;
  /** Change the live concurrency cap; later admissions observe it. */
  setConcurrency(limit: number): void;
  /** Simulate the parent's session context appearing/vanishing. */
  setParentSessionActive(active: boolean): void;
  beginSession(sessionId: string): Promise<void>;
  beginSessionEnd(): void;
  endSession(): Promise<void>;
  dispose(): Promise<void>;
}

/** No definition files: the catalog is the five shipped specialists. */
const EMPTY_SCOPES: LoadedScopes = {
  global: { definitions: [], errors: [] },
  project: { definitions: [], errors: [] },
};

/** The parent model facts a launch resolves against unless a test says otherwise. */
function defaultModelInfo(): ModelInfo {
  return {
    parentModel: makeModel({ id: "claude-sonnet", name: "Claude Sonnet" }),
    modelRegistry: {
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    },
    ladders: {
      profiles: new Map(),
      strategies: strategiesByFamily(SHIPPED_STRATEGIES),
    },
  };
}

export async function createSubagentsHarness(
  options: SubagentsHarnessOptions = {},
): Promise<SubagentsHarness> {
  const registry = new AgentRegistry(options.scopes ?? (() => EMPTY_SCOPES));

  // Definition I/O control: a preparation awaiting the gate is how a test
  // changes the world mid-flight and proves the launch kept its capture.
  let loadGate: Promise<void> | undefined;
  let releaseLoad: (() => void) | undefined;

  let concurrency = options.concurrency ?? 4;
  const limiter = new ConcurrencyLimiter(() => concurrency);
  const children = createControllableChildFactory(options.children);

  const created: string[] = [];
  const runStarted: RecordedRunTransition[] = [];
  const runFinished: RecordedRunTransition[] = [];
  const compacted: CompactionInfo[] = [];
  const record =
    (
      log: RecordedRunTransition[],
    ): SubagentManagerObserver["onSubagentRunStarted"] =>
    (agent, kind) => {
      log.push({
        id: agent.id,
        kind,
        status: agent.status,
        claimed: agent.claimed,
      });
    };
  const recordingObserver: SubagentManagerObserver = {
    onSubagentCreated: (agent) => {
      created.push(agent.id);
    },
    onSubagentRunStarted: record(runStarted),
    onSubagentRunFinished: record(runFinished),
    onSubagentCompacted: (_agent, info) => {
      compacted.push(info);
    },
  };
  const observer: SubagentManagerObserver = {
    onSubagentCreated: (agent) => {
      recordingObserver.onSubagentCreated(agent);
      options.observer?.onSubagentCreated(agent);
    },
    onSubagentRunStarted: (agent, kind) => {
      recordingObserver.onSubagentRunStarted(agent, kind);
      options.observer?.onSubagentRunStarted(agent, kind);
    },
    onSubagentRunFinished: (agent, kind) => {
      recordingObserver.onSubagentRunFinished(agent, kind);
      options.observer?.onSubagentRunFinished(agent, kind);
    },
    onSubagentCompacted: (agent, info) => {
      recordingObserver.onSubagentCompacted(agent, info);
      options.observer?.onSubagentCompacted(agent, info);
    },
  };

  const manager = new SubagentManager({
    createSubagentSession: children.createSubagentSession,
    limiter,
    baseCwd: STUB_SNAPSHOT.cwd,
    registry,
    getRunConfig: () => ({ midRunUpdates: options.midRunUpdates ?? true }),
    observer,
  });

  let parentSessionActive = true;
  const runtime: SubagentsRuntime = {
    get currentCtx() {
      return parentSessionActive ? {} : undefined;
    },
    captureLaunchInputs: () => ({
      snapshot: STUB_SNAPSHOT,
      parentContext: "parent conversation",
      parentSession: {
        parentSessionFile: "/sessions/parent.jsonl",
        parentSessionId: "session-1",
      },
    }),
  };

  const preparer = new LaunchPreparer({
    loadScopes: async () => {
      while (loadGate) await loadGate;
      registry.reload();
      return registry.currentScopes();
    },
    modelInfo: options.modelInfo ?? defaultModelInfo,
    turnSettings: () => ({
      defaultMaxTurns: undefined,
      wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
    }),
    childShaping: () => ({
      midRunUpdates: options.midRunUpdates ?? true,
      excludedExtensionPackages: [],
      promptInheritance: {},
    }),
  });

  const subagents = new Subagents(manager, runtime, preparer);
  await manager.beginOwner("session-1");

  return {
    service: new SubagentsServiceAdapter(manager, subagents),
    subagents,
    manager,
    children,
    observer: { created, runStarted, runFinished, compacted },
    pauseDefinitionLoad(): void {
      if (loadGate) return;
      const gate = Promise.withResolvers<void>();
      loadGate = gate.promise;
      releaseLoad = gate.resolve;
    },
    resumeDefinitionLoad(): void {
      releaseLoad?.();
      loadGate = undefined;
      releaseLoad = undefined;
    },
    setConcurrency(limit: number): void {
      concurrency = limit;
      limiter.recheck();
    },
    setParentSessionActive(active: boolean): void {
      parentSessionActive = active;
    },
    beginSession: (sessionId) => manager.beginOwner(sessionId),
    beginSessionEnd: () => manager.beginOwnerEnd(),
    endSession: () => manager.endOwner(),
    dispose: () => manager.dispose(),
  };
}
