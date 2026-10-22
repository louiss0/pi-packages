/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Background runs, spawned or resumed, are subject to a configurable concurrency
 * limit (default: 4). Excess runs are scheduled on a ConcurrencyLimiter and
 * auto-started as running ones complete. Foreground runs bypass the limiter
 * (they block the parent anyway).
 */

import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import {
  type BackgroundRequest,
  resolveBackgroundMode,
} from "#src/agents/invocation";
import { resolveChildToolNames } from "#src/agents/definition";
import type { ToolSelection } from "#src/agents/definition";
import type { ModelSelection } from "#src/models/selection";
import type { ThinkingDecision } from "#src/thinking/resolve";
import type { AgentSelection } from "#src/agents/registry";
import { debugLog } from "#src/debug";
import type { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import {
  type ResumeRefusal,
  type ResumeRunOptions,
  type RunScheduler,
  Subagent,
  type SubagentLifecycleObserver,
} from "#src/lifecycle/subagent";
import type { RunKind } from "#src/lifecycle/subagent-run";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { WorkspaceGate, WorkspaceGateRegistry } from "#src/scheduling/gate";
import {
  classifyWorkspaceImpact,
  type WorkspaceImpact,
} from "#src/scheduling/impact";

import type { RunConfig } from "#src/runtime";
import type {
  CompactionInfo,
  ParentSessionInfo,
  SubagentType,
  ThinkingLevel,
} from "#src/types";

/**
 * The agent-registry slice the manager needs to resolve a spawn. Deliberately
 * narrower than the registry itself, whose slice also serves session assembly
 * (ISP).
 */
export interface SpawnTypeResolver {
  /**
   * The definition for an agent type, or the reason there is none.
   *
   * The manager is the choke point every front door shares, so an unknown or
   * disabled agent is rejected here rather than answered with another role.
   */
  select(id: string): AgentSelection;
}

/**
 * Why a resume was refused, across every front door.
 *
 * Widens the record's own vocabulary by the one refusal that is not a fact
 * about a record: an id no record answers to.
 */
export type ResumeRefusalReason = ResumeRefusal | "unknown-agent";

/**
 * What a resume attempt produced: the record whose run was restarted, or the
 * reason nothing was started.
 *
 * A resumed run that *failed* is still `resumed` — the record carries the
 * error. `refused` means the turn loop never ran.
 */
export type ResumeOutcome =
  | { kind: "resumed"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

/**
 * What starting a resume produced: the record now running it (or queued for a
 * concurrency slot, which its status says), or the reason nothing was started.
 *
 * The run itself continues on the record; its `promise` settles when the
 * resumed run reaches a terminal state.
 */
export type ResumeStart =
  | { kind: "started"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

/** Per-call knobs for a resume; both doors pass their own. */
export type ResumeCallOptions = ResumeRunOptions;

/** A spawn's resolved identity and mode — the invariants every front door shares. */
interface ResolvedSpawn {
  type: SubagentType;
  isBackground: boolean;
  /** The tools the child will get — the basis of its workspace impact. */
  tools: ToolSelection;
}

/**
 * What a child may change, and where.
 *
 * The plan a child's admission follows: the slot it takes when it may change
 * files, and the lever that ends its wait.
 */
interface WorkspacePlan {
  /** The slot of the workspace the child works in. */
  readonly gate: WorkspaceGate;
  /** What the child's tools may change. */
  readonly impact: WorkspaceImpact;
  /** The child's id — the slot's holder while the child runs. */
  readonly id: string;
  /** The lever that cancels a wait for the slot. */
  readonly signal: AbortSignal | undefined;
}

/**
 * Session-retention windows (minutes). `SettingsManager` satisfies this
 * structurally; a live getter (`getRetentionPolicy`) lets the sweep read the
 * current values without a construction-time settings dependency.
 */
export interface RetentionPolicy {
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
}

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  consumedSessionRetentionMinutes: 10,
  unconsumedSessionRetentionMinutes: 720,
};

/**
 * Only what the retention rule reads. Narrower than `Subagent` so the rule
 * stays a plain function over four facts, testable without spawning an agent.
 */
export interface RetentionCandidate {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
}

/** When a terminal record's session-release window opened, and how long it runs. */
export interface RetentionWindow {
  referenceAt: number;
  windowMinutes: number;
}

/**
 * Pick the retention window for one terminal record.
 *
 * A collected outcome releases on the short window, measured from the later of
 * completion and collection, so a late read still gets a full resume window; an
 * uncollected one holds until the long safety cap.
 *
 * A record carrying an unanswered question is not collected, whatever
 * `consumed` says: the parent has read the question but has not answered it,
 * and the answer is delivered by resuming the very session the short window
 * would release.
 */
export function resolveRetentionWindow(
  record: RetentionCandidate,
  policy: RetentionPolicy,
): RetentionWindow {
  if (record.consumed && record.pendingQuestion === undefined) {
    return {
      referenceAt: Math.max(record.completedAt ?? 0, record.consumedAt ?? 0),
      windowMinutes: policy.consumedSessionRetentionMinutes,
    };
  }
  return {
    referenceAt: record.completedAt ?? 0,
    windowMinutes: policy.unconsumedSessionRetentionMinutes,
  };
}

/** Observer interface for agent lifecycle notifications. */
export interface SubagentManagerObserver {
  /**
   * Fires when a run starts: the initial run, or a resume from whichever front
   * door asked for it. A consumer that tracks the widget's live set has to learn
   * that a settled record went back to running, and the only alternative is
   * polling.
   */
  onSubagentRunStarted(record: Subagent, kind: RunKind): void;
  /** Fires when a run reaches a terminal state, whatever that state is. */
  onSubagentRunFinished(record: Subagent, kind: RunKind): void;
  /**
   * Fires when a running child sends its parent a mid-run message.
   * Optional: the widget has no use for it, and a hook nobody supplies is a
   * vacant one.
   */
  onSubagentUpdate?(record: Subagent, message: string): void;
  /**
   * Fires when a teardown after the record's result was delivered reported
   * where its work went.
   * Optional for the same reason as `onSubagentUpdate`: the widget has no use
   * for it, and a hook nobody supplies is a vacant one.
   */
  onSubagentWorkspaceNotice?(record: Subagent, notice: string): void;
  onSubagentCompacted(record: Subagent, info: CompactionInfo): void;
  /** Fires synchronously after a background agent record is created (before run). */
  onSubagentCreated(record: Subagent): void;
}

export interface SubagentManagerOptions {
  /** Assembly factory that produces a born-complete SubagentSession per spawn. */
  createSubagentSession: (
    params: CreateSubagentSessionParams,
  ) => Promise<SubagentSession>;
  /** Concurrency limiter — schedules background run thunks FIFO against the limit. */
  limiter: ConcurrencyLimiter;
  /** Base working directory handed to a workspace provider (the parent cwd). */
  baseCwd: string;
  getRunConfig?: () => RunConfig;
  /** Live accessor for the session-retention windows; defaults applied when absent. */
  getRetentionPolicy?: () => RetentionPolicy;
  observer?: SubagentManagerObserver;
  /** Agent registry, consulted to canonicalize a spawn's type and resolve its config. */
  registry: SpawnTypeResolver;
  /**
   * Re-reads the agent definitions before a spawn resolves.
   *
   * The definition files live on disk and the project's trust is a session
   * fact, so the registry is refreshed at the choke point every front door
   * shares rather than once at load.
   */
  reloadDefinitions?: () => void;
  /**
   * The gates of the workspaces this runtime's children work in.
   *
   * One registry for the whole runtime, so the children of two parents
   * working in the same directory share one slot. A manager without one gets
   * a registry of its own, which is enough for its own children.
   */
  workspaceGates?: WorkspaceGateRegistry;
}

export interface AgentSpawnConfig {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  /**
   * How the resolved model was chosen, and why — the decision behind a launch,
   * carried so a spawned record can answer why it runs on the model it does.
   */
  modelSelection?: Pick<ModelSelection, "source" | "reason">;
  /**
   * The reasoning decision behind the level the child runs at: whether it
   * applied, where it came from, whether it was clamped, and why.
   */
  thinkingDecision?: Pick<
    ThinkingDecision,
    "applicable" | "source" | "clamped" | "reason"
  >;
  /**
   * Whether this door has committed to a background mode or is offering a
   * default the agent's frontmatter may override. Required so a new front door
   * cannot silently inherit another's policy.
   */
  background: BackgroundRequest;
  /**
   * Skip the maxConcurrent queue check for this spawn - start immediately even
   * if the configured concurrency limit would otherwise queue it. Useful for
   * callers (e.g. cross-extension RPC) that must not be deferred by the queue.
   */
  bypassQueue?: boolean;
  /** Parent abort signal - when aborted, the subagent is also stopped. */
  signal?: AbortSignal;
  /** Per-subagent lifecycle observer — replaces onSessionCreated callback. */
  observer?: SubagentLifecycleObserver;
  /** Parent session identity - grouped fields that travel together from the tool boundary. */
  parentSession?: ParentSessionInfo;
}

export class SubagentManager {
  private agents = new Map<string, Subagent>();
  private sweepInterval: ReturnType<typeof setInterval>;
  private readonly observer?: SubagentManagerObserver;
  private readonly createSubagentSession: (
    params: CreateSubagentSessionParams,
  ) => Promise<SubagentSession>;
  private readonly limiter: ConcurrencyLimiter;
  /** Background runs, spawned or resumed, wait for and hold a slot on the limiter. */
  private readonly admitBackground: RunScheduler = (thunk) =>
    this.limiter.schedule(thunk);
  private readonly baseCwd: string;
  private getRunConfig?: () => RunConfig;
  private getRetentionPolicy?: () => RetentionPolicy;
  private readonly registry: SpawnTypeResolver;
  private readonly reloadDefinitions: (() => void) | undefined;
  /**
   * The slot a child that may change files holds while it runs.
   *
   * One per workspace, not per manager: two parents in the same directory
   * have children reaching for the same files.
   */
  private readonly workspaceGates: WorkspaceGateRegistry;
  /**
   * What each record may change, and in which workspace.
   *
   * A resume reuses the child's session, so the tools it will use are the
   * ones it was spawned with — the answer is recorded once, at the spawn.
   */
  private readonly workspacePlans = new Map<string, WorkspacePlan>();
  private _workspaceProvider?: WorkspaceProvider;

  /** The registered workspace provider, or undefined when none is registered. */
  get workspaceProvider(): WorkspaceProvider | undefined {
    return this._workspaceProvider;
  }

  constructor(options: SubagentManagerOptions) {
    this.createSubagentSession = options.createSubagentSession;
    this.limiter = options.limiter;
    this.baseCwd = options.baseCwd;
    this.observer = options.observer;
    this.getRunConfig = options.getRunConfig;
    this.getRetentionPolicy = options.getRetentionPolicy;
    this.registry = options.registry;
    this.reloadDefinitions = options.reloadDefinitions;
    this.workspaceGates = options.workspaceGates ?? new WorkspaceGateRegistry();
    // Periodically release the heavy session of terminal agents past their
    // retention window. The lightweight record (with its result) is kept for the
    // session lifetime, so get_subagent_result never misses in-session.
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  /**
   * Register the single workspace provider. Throws if one is already
   * registered (chaining is out of scope — see ADR 0002). Returns a disposer
   * that clears the slot only if this provider is still the active one.
   */
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    if (this._workspaceProvider) {
      throw new Error(
        "A WorkspaceProvider is already registered; only one is supported.",
      );
    }
    this._workspaceProvider = provider;
    return () => {
      if (this._workspaceProvider === provider)
        this._workspaceProvider = undefined;
    };
  }

  /** Compose a per-agent lifecycle observer from manager and spawn-config concerns. */
  private buildObserver(options: AgentSpawnConfig): SubagentLifecycleObserver {
    return {
      onRunStarted: (agent, kind) => {
        try {
          this.observer?.onSubagentRunStarted(agent, kind);
        } catch (err) {
          debugLog("onSubagentRunStarted observer", err);
        }
      },
      onSessionCreated: options.observer?.onSessionCreated
        ? (agent) => options.observer!.onSessionCreated!(agent)
        : undefined,
      // Terminal transitions are reported for every agent. Whether the parent
      // needs telling is the notification layer's decision, made from the
      // carrier claim; suppressing the observer here would also suppress the
      // lifecycle event and the session-history record, which are facts about
      // the run rather than announcements.
      onRunFinished: (agent, kind) => {
        try {
          this.observer?.onSubagentRunFinished(agent, kind);
        } catch (err) {
          debugLog("onSubagentRunFinished observer", err);
        }
      },
      onUpdateSent: (agent, message) => {
        this.observer?.onSubagentUpdate?.(agent, message);
      },
      onWorkspaceNotice: (agent, notice) => {
        this.observer?.onSubagentWorkspaceNotice?.(agent, notice);
      },
      onCompacted: (agent, info) => {
        this.observer?.onSubagentCompacted(agent, info);
      },
    };
  }

  /**
   * Spawn an agent and return its ID immediately (for background use).
   * If the concurrency limit is reached, the agent is queued.
   *
   * Throws when the named agent type is disabled.
   */
  spawn(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    return this.create(
      snapshot,
      this.resolveSpawn(type, options.background),
      prompt,
      options,
    );
  }

  /**
   * Spawn an agent and wait for completion (foreground use).
   * Foreground agents bypass the concurrency queue.
   *
   * The caller holds the result, which is a delivery commitment: the agent must
   * not be queued and must not be announced, whatever its frontmatter declares.
   *
   * Rejects when the named agent type is disabled.
   */
  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ): Promise<Subagent> {
    const foreground: BackgroundRequest = {
      kind: "explicit",
      isBackground: false,
    };
    const id = this.create(
      snapshot,
      this.resolveSpawn(type, foreground),
      prompt,
      {
        ...options,
        background: foreground,
      },
    );
    const record = this.agents.get(id)!;
    // The caller holds the result, so this call is the carrier: claim the outcome
    // before awaiting it, so nothing announces what is already being delivered.
    record.claim();
    await record.promise;
    return record;
  }

  /**
   * Stamp the invariants every front door shares: a canonical agent type, a
   * rejection for a disabled one, and the effective background mode.
   */
  private resolveSpawn(
    type: string,
    background: BackgroundRequest,
  ): ResolvedSpawn {
    // Refresh first: a definition file added since the last spawn, and the
    // project's trust, are both facts that arrive after the extension loads.
    this.reloadDefinitions?.();
    const selection = this.registry.select(type);
    if (!selection.ok) {
      throw new Error(selection.error);
    }
    const definition = selection.definition;
    return {
      type: definition.id,
      isBackground: resolveBackgroundMode(definition, background),
      tools: definition.tools,
    };
  }

  /** Create, register, and start (or queue) a record for an already-resolved spawn. */
  private create(
    snapshot: ParentSnapshot,
    resolved: ResolvedSpawn,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    const { type, isBackground } = resolved;
    const id = randomUUID().slice(0, 17);
    // The tools this child will have, resolved once, here: the definition's
    // selection against the parent's active tools as they were when the
    // request was made. The child is given exactly these names, so the
    // runtime and the child can never disagree about what it may do — and a
    // definition edited while the child waited cannot hand it a shell it was
    // not cleared for.
    const toolNames = resolveChildToolNames(
      resolved.tools,
      snapshot.activeToolNames,
    );
    const impact = classifyWorkspaceImpact(toolNames);
    // The workspace the child works in: the parent's directory when the
    // request was made. Two parents in one directory share one slot.
    const gate = this.workspaceGates.gateFor(snapshot.cwd);
    const plan: WorkspacePlan = { gate, impact, id, signal: options.signal };
    this.workspacePlans.set(id, plan);
    const record = new Subagent({
      id,
      type,
      description: options.description,
      isBackground,
      execution: {
        createSubagentSession: this.createSubagentSession,
        snapshot,
        prompt,
        baseCwd: this.baseCwd,
        observer: this.buildObserver(options),
        getRunConfig: this.getRunConfig,
        getWorkspaceProvider: () => this._workspaceProvider,
        model: options.model,
        maxTurns: options.maxTurns,
        thinkingLevel: options.thinkingLevel,
        modelSelection: options.modelSelection,
        thinkingDecision: options.thinkingDecision,
        parentSession: options.parentSession,
        signal: options.signal,
        toolNames,
      },
    });
    this.agents.set(id, record);

    if (isBackground) {
      this.observer?.onSubagentCreated(record);
    }

    if (isBackground && !options.bypassQueue) {
      // Schedule on the limiter — scheduleVia captures the limiter promise
      // eagerly, so a queued agent is awaitable from spawn; guardedRun guards
      // against abort-while-queued when the slot frees. The workspace slot is
      // taken inside the scheduled task, so a child waiting for a concurrency
      // slot holds no workspace slot.
      record.scheduleVia((thunk) =>
        this.admitBackground(() => this.admit(plan, thunk)),
      );
      return id;
    }

    // A foreground child skips the concurrency queue, but not the workspace's
    // exclusive slot: two children that may change the same files must not
    // run at once, however they were launched.
    record.scheduleVia((thunk) => this.admit(plan, thunk));
    return id;
  }

  /**
   * Admit a run: take the workspace's exclusive slot when the child may
   * change files, then run it.
   *
   * The slot is held for the run and given up when it ends, so two children
   * that may write never overlap. A read-only child skips the slot entirely
   * and runs with the others.
   *
   * A wait cancelled by the caller's signal gives the slot up without taking
   * it. The run is still entered, but the signal has already fired: the run
   * ends before it prepares a workspace or creates a session, so the child
   * does nothing and the record settles.
   */
  private admit(
    plan: WorkspacePlan,
    thunk: () => Promise<void>,
  ): Promise<void> {
    if (plan.impact === "read-only") return thunk();
    const { gate, id, signal } = plan;
    // A free slot is taken now, so the run starts in the same turn it always
    // did; only a child that has to wait starts later.
    if (gate.tryAcquire(id)) {
      return this.runWithSlot(plan, thunk);
    }
    return gate.acquire(id, signal).then((granted) => {
      if (!granted) return thunk();
      return this.runWithSlot(plan, thunk);
    });
  }

  /** Run the child, giving the workspace slot up when the run ends. */
  private runWithSlot(
    plan: WorkspacePlan,
    thunk: () => Promise<void>,
  ): Promise<void> {
    return thunk().finally(() => plan.gate.release(plan.id));
  }

  /**
   * Resume an existing agent session with a new prompt.
   *
   * The refusal policy lives here rather than in a caller, so every front door
   * declines the same resumes for the same reasons; a door owns only how it
   * words the answer. Delegates to Subagent.resume(), which owns the observer
   * subscription lifecycle.
   *
   * Resolves when the resumed run reaches a terminal state, so a background
   * resume's wait spans any time it spends queued for a concurrency slot.
   */
  async resume(
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ): Promise<ResumeOutcome> {
    const start = this.startResume(id, prompt, options);
    if (start.kind === "refused") return start;
    await start.record.promise;
    return { kind: "resumed", record: start.record };
  }

  /**
   * Start a resume without waiting for it, handing back the record now running
   * it, or queued for a concurrency slot when it is a background resume and the
   * limit is reached. Refuses synchronously, for the same reasons `resume` does.
   *
   * A background resume is admitted through the limiter like a background
   * spawn; a foreground one starts at once, like a foreground spawn.
   */
  startResume(
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ): ResumeStart {
    const agent = this.agents.get(id);
    if (!agent) return { kind: "refused", reason: "unknown-agent" };
    const refusal = agent.resumeRefusal;
    if (refusal) return { kind: "refused", reason: refusal };
    // Each resume's caller decides who carries its outcome: the resume's run is
    // born claimed when the caller asks, and unclaimed otherwise, whatever
    // carriers held the runs before it.
    // Published as agent.promise, which always resolves; it rejects only for a
    // missing session, which resumeRefusal has already refused as no-session.
    // A resumed child may change files just as its first run could, so it
    // takes the same exclusive slot. The impact was decided at the spawn:
    // a resume reuses the session, and with it the child's tools. A record
    // with no plan is treated as a writer, which is the safe direction.
    const plan = this.workspacePlans.get(id);
    const gate = plan?.gate ?? this.workspaceGates.gateFor(this.baseCwd);
    const impact = plan?.impact ?? "file-changing";
    const resumePlan: WorkspacePlan = {
      gate,
      impact,
      id,
      signal: options.signal,
    };
    const schedule = options.background ? this.admitBackground : undefined;
    void agent.resume(
      prompt,
      {
        background: options.background,
        signal: options.signal,
        claimOutcome: options.claimOutcome,
      },
      schedule
        ? (thunk) => schedule(() => this.admit(resumePlan, thunk))
        : (thunk) => this.admit(resumePlan, thunk),
    );
    return { kind: "started", record: agent };
  }

  getRecord(id: string): Subagent | undefined {
    return this.agents.get(id);
  }

  listAgents(): Subagent[] {
    return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;

    // A queued agent has not started; stop it through the same terminal funnel
    // a running agent's stop uses. Its scheduled thunk becomes a no-op (status
    // guard) when its slot finally opens.
    if (record.status === "queued") {
      record.stopQueued();
      return true;
    }

    return record.abort();
  }

  /**
   * Remove a record from the map and tear its session down.
   * The map is updated first so the record is unreachable while its child's
   * extensions shut down.
   */
  private removeRecord(id: string, record: Subagent): Promise<void> {
    this.agents.delete(id);
    // The plan goes with the record: it described this child's workspace and
    // its capabilities, and neither outlives the child.
    this.workspacePlans.delete(id);
    return record.disposeSession();
  }

  /**
   * Release the heavy session of any terminal agent past its retention window.
   * The record (with its result) is retained for the session lifetime; only the
   * live `AgentSession` is freed. `resolveRetentionWindow` owns which window
   * applies.
   */
  private sweep() {
    const policy = this.getRetentionPolicy?.() ?? DEFAULT_RETENTION_POLICY;
    const now = Date.now();
    for (const record of this.agents.values()) {
      if (record.isActive()) continue;
      if (!record.isSessionReady()) continue; // already released, or never had a session
      const { referenceAt, windowMinutes } = resolveRetentionWindow(
        record,
        policy,
      );
      // Fire-and-forget: the sweep runs on an interval with no one to await it,
      // and Subagent.releaseSession() already swallows a failing teardown.
      if (now - referenceAt >= windowMinutes * 60_000)
        void record.releaseSession();
    }
  }

  /**
   * Remove all completed/stopped/errored records immediately.
   * Called on session start/switch so tasks from a prior session don't persist.
   */
  async clearCompleted(): Promise<void> {
    const teardowns: Promise<void>[] = [];
    for (const [id, record] of this.agents) {
      if (record.isActive()) continue;
      teardowns.push(this.removeRecord(id, record));
    }
    await Promise.all(teardowns);
  }

  /** Whether any agents are still running or queued. */
  // fallow-ignore-next-line unused-class-member
  hasRunning(): boolean {
    return [...this.agents.values()].some((r) => r.isActive());
  }

  /** Abort all running and queued agents immediately. */
  abortAll(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.status === "queued") {
        record.stopQueued();
        count++;
      } else if (record.abort()) {
        count++;
      }
    }
    // Drop pending thunks (their promises resolve).
    this.limiter.clear();
    return count;
  }

  /** Wait for all running and queued agents to complete (including queued ones). */
  // fallow-ignore-next-line unused-class-member
  async waitForAll(): Promise<void> {
    // Every spawned agent has a settled-on-completion promise (the limiter starts
    // queued ones as slots free), so a single allSettled covers the queued case.
    // The loop only catches agents spawned during the wait.
    let pending = this.pendingPromises();
    while (pending.length > 0) {
      await Promise.allSettled(pending);
      pending = this.pendingPromises();
    }
  }

  /** Promises of all running/queued agents that have one. */
  private pendingPromises(): Promise<void>[] {
    return [...this.agents.values()]
      .filter((r) => r.isActive())
      .map((r) => r.promise)
      .filter((p): p is Promise<void> => p != null);
  }

  /**
   * Tear down every record, resolving once each child's extensions have shut
   * down. The registry is emptied before the teardowns are awaited, so nothing
   * can reach a dying record; `allSettled` keeps one failing child from
   * abandoning its siblings.
   */
  async dispose(): Promise<void> {
    clearInterval(this.sweepInterval);
    // Drop pending thunks
    this.limiter.clear();
    const teardowns = [...this.agents.values()].map((record) =>
      record.disposeSession(),
    );
    this.agents.clear();
    await Promise.allSettled(teardowns);
  }
}
