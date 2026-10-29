/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Every run — initial or resumed, background or foreground, spawned or
 * awaited — is subject to one configurable concurrency limit (default: 4).
 * Excess runs are scheduled on a ConcurrencyLimiter and auto-started as
 * running ones complete. There is no public bypass: waiting for a result does
 * not grant extra execution capacity (ARCHITECTURE-SPEC stories 67 and 68).
 */

import { randomUUID } from "node:crypto";
import type { ExactModelIdentity } from "#src/models/identity";
import {
  type BackgroundRequest,
  resolveBackgroundMode,
} from "#src/agents/invocation";
import { resolveChildToolNames } from "#src/agents/definition";
import type { AgentDefinition, ToolSelection } from "#src/agents/definition";
import type { ChildShapingSettings } from "#src/agents/launch-preparer";
import type { ModelSelection } from "#src/models/selection";
import { expandMcpToolPatterns } from "#src/session/mcp-tool-patterns";
import type { ThinkingDecision } from "#src/thinking/resolve";
import type { AgentSelection } from "#src/agents/registry";
import { debugLog } from "#src/debug";
import type { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import {
  type LaunchOutcome,
  ownerCanAccept,
  type SessionOwner,
} from "#src/lifecycle/session-owner";
import {
  type ResumeRefusal,
  type ResumeRunOptions,
  type RunScheduler,
  Subagent,
  type SubagentLifecycleObserver,
} from "#src/lifecycle/subagent";
import type { RunKind, RunOutcome } from "#src/lifecycle/subagent-run";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { WorkspaceGate, WorkspaceGateRegistry } from "#src/scheduling/gate";
import { defined } from "#src/optional";
import {
  classifyWorkspaceImpact,
  type WorkspaceImpact,
} from "#src/scheduling/impact";

import type { RunConfig } from "#src/runtime";
import type { TurnPolicy } from "#src/lifecycle/turn-limits";
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
 * `unknown-agent` and `stale-session` are the manager's own: no such record,
 * or a record belonging to a session that is no longer current. The rest are
 * facts about the record itself, owned by {@link ResumeRefusal}.
 */
export type ResumeRefusalReason =
  | ResumeRefusal
  | "unknown-agent"
  | "stale-session";

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

/** The exact run a foreground wait observed, even if a resume replaces it. */
export type ForegroundRunOutcome = Readonly<{
  record: Subagent;
  run: RunOutcome;
}>;

/** A spawn's resolved identity and mode — the invariants every front door shares. */
type ResolvedSpawn = {
  type: SubagentType;
  isBackground: boolean;
  /** The exact definition selected during preparation. */
  definition: AgentDefinition;
  /** The tools the child will get — the basis of its workspace impact. */
  tools: ToolSelection;
};

/**
 * What a child may change, and where.
 *
 * The plan a child's admission follows: the slot it takes when it may change
 * files, and the lever that ends its wait.
 */
type WorkspacePlan = Readonly<{
  /** The slot of the workspace the child works in. */
  gate: WorkspaceGate;
  /** What the child's tools may change. */
  impact: WorkspaceImpact;
  /** The child's id — the slot's holder while the child runs. */
  id: string;
  /** The lever that cancels a wait for the slot, when the caller named one. */
  signal?: AbortSignal;
}>;

/**
 * Session-retention windows (minutes). `SettingsManager` satisfies this
 * structurally; a live getter (`getRetentionPolicy`) lets the sweep read the
 * current values without a construction-time settings dependency.
 */
export type RetentionPolicy = Readonly<{
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;
}>;

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  consumedSessionRetentionMinutes: 10,
  unconsumedSessionRetentionMinutes: 720,
};

/**
 * Only what the retention rule reads. Narrower than `Subagent` so the rule
 * stays a plain function over four facts, testable without spawning an agent.
 */
export type RetentionCandidate = {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
};

/** When a terminal record's session-release window opened, and how long it runs. */
export type RetentionWindow = {
  referenceAt: number;
  windowMinutes: number;
};

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
   * The definition files live on disk, so the registry is refreshed at the
   * choke point every front door shares rather than once at load.
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

export type AgentSpawnConfig = {
  description: string;
  /** Definition selected and copied by LaunchPreparer; absent only for internal legacy callers. */
  definition?: AgentDefinition;
  /**
   * The child-shaping settings captured with the launch (story 56). When
   * present, execution uses these instead of the live run config, so a
   * queued child keeps the update policy it was asked under.
   */
  childShaping?: ChildShapingSettings;
  /** Exact capability allowlist captured by shared preparation. */
  toolNames?: ReadonlyArray<string>;
  /** Exact model choice captured by preparation; materialized at child creation. */
  modelIdentity?: ExactModelIdentity;
  /**
   * The run's turn ceiling, resolved once by the door that prepared the launch.
   *
   * A closed decision, so the record enforces it rather than re-reading a
   * default that may since have changed.
   */
  turnPolicy: TurnPolicy;
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
   * default its agent's frontmatter may override. Required so a new front door
   * cannot silently inherit another's policy.
   */
  background: BackgroundRequest;
  /**
   * The session this launch was asked for under, captured with the request.
   *
   * Required, and checked at the moment of acceptance: a request prepared for
   * a session that has since been replaced is refused rather than attached to
   * the session that replaced it. That result would be delivered to a parent
   * that never asked for it, so there is no version of "accept it anyway" that
   * is correct.
   */
  owner: SessionOwner;
  /** Parent abort signal - when aborted, the subagent is also stopped. */
  signal?: AbortSignal;
  /** Per-subagent lifecycle observer — replaces onSessionCreated callback. */
  observer?: SubagentLifecycleObserver;
  /** Parent session identity - grouped fields that travel together from the tool boundary. */
  parentSession?: ParentSessionInfo;
};

export class SubagentManager {
  private agents = new Map<string, Subagent>();
  private sweepInterval: ReturnType<typeof setInterval>;
  private readonly observer: SubagentManagerObserver | undefined;
  private readonly createSubagentSession: (
    params: CreateSubagentSessionParams,
  ) => Promise<SubagentSession>;
  private readonly limiter: ConcurrencyLimiter;
  /** Every run — background, foreground, initial, or resumed — waits for and holds a limiter slot. */
  private readonly admitBackground: RunScheduler = (thunk) =>
    this.limiter.schedule(thunk);
  private readonly baseCwd: string;
  private getRunConfig: (() => RunConfig) | undefined;
  private getRetentionPolicy: (() => RetentionPolicy) | undefined;
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
  private _workspaceProvider: WorkspaceProvider | undefined;

  /**
   * The session allowed to accept work right now, and the one whose end is
   * being considered.
   *
   * `ownerEnding` is the half that makes a tentative switch safe. Pi emits
   * `session_before_switch` before it knows whether the switch will happen —
   * a handler can veto it, and the operator can back out — so cancelling there
   * would destroy live children for a navigation that never occurred. Instead
   * the flag only closes the door to *new* launches, and `beginOwner` decides
   * what actually happened.
   */
  private owner: SessionOwner | undefined = undefined;
  private ownerEnding = false;
  private generationCounter = 0;
  /** The in-flight teardown of an ended owner, if any. */
  private ownerCleanup: Promise<void> | undefined;
  /** Owner transitions are serialized in lifecycle call order. */
  private ownerTransition: Promise<void> = Promise.resolve();
  private pendingOwnerTransitions = 0;
  /** The manager-wide teardown, shared by repeated lifecycle delivery. */
  private disposePromise: Promise<void> | undefined;

  /** The registered workspace provider, or undefined when none is registered. */
  get workspaceProvider(): WorkspaceProvider | undefined {
    return this._workspaceProvider;
  }

  // ── Session ownership ─────────────────────────────────────────────────────

  /**
   * The token a launch under the current session must carry.
   *
   * Undefined when no session is active, and undefined again while one is
   * ending — which is what turns "the session I asked under has gone" into a
   * refusal at acceptance rather than a child attached to the wrong parent.
   */
  currentOwner(): SessionOwner | undefined {
    return this.ownerEnding ? undefined : this.owner;
  }

  /**
   * Take ownership for `sessionId`, ending whatever session held it before.
   *
   * Called from `session_start`. Reaching here is what confirms a switch
   * happened: the previous owner — if there was one, and if it was not this
   * same session id — is gone for real, so its children are cancelled now.
   * A `session_start` that names the session already in hand is the abandoned
   * switch, and its owner is simply restored with its children untouched.
   */
  beginOwner(sessionId: string): Promise<void> {
    const previous = this.owner;
    const abandoned = previous?.sessionId === sessionId;

    // A first start (and an abandoned switch) has no cleanup to wait for, so
    // retain the historical synchronous acceptance. Once a transition is
    // pending, however, every request joins the call-order chain.
    if (this.pendingOwnerTransitions === 0 && (abandoned || !previous)) {
      this.installOwner(sessionId);
      return Promise.resolve();
    }

    if (previous && !abandoned) {
      // Invalidate synchronously. No launch can enter the old owner, or sneak
      // into the replacement while its children are being torn down.
      this.owner = undefined;
      this.ownerEnding = true;
    }

    return this.enqueueOwnerTransition(async () => {
      if (previous && !abandoned) await this.endOwned(previous.generation);
      this.installOwner(sessionId);
    });
  }

  private installOwner(sessionId: string): void {
    // Every session gets a fresh generation even when the id repeats: a token
    // from an earlier session must never compare equal to a later one.
    this.owner = {
      generation: ++this.generationCounter,
      sessionId,
    };
    this.ownerEnding = false;
  }

  /**
   * Note that the current session may be about to be replaced, without
   * cancelling anything yet.
   *
   * No new launch is accepted from here on, so nothing joins a session that is
   * leaving. Children already running continue, because the switch may still
   * be vetoed or abandoned — see `beginOwner` for the case where it was not.
   */
  beginOwnerEnd(): void {
    if (this.owner) this.ownerEnding = true;
  }

  /**
   * End the current session for good, cancelling the work it owned.
   *
   * The shutdown path, where there is no later session to restore.
   */
  endOwner(): Promise<void> {
    const owner = this.owner;

    // Closing the owner is synchronous, before any queued cleanup. Thus stale
    // launch tokens are refused even if callers do not await this callback.
    if (owner) {
      this.owner = undefined;
      this.ownerEnding = false;
    }

    // Even with no visible owner, wait behind an earlier begin/end request;
    // otherwise a later lifecycle event could be observed as complete first.
    return this.enqueueOwnerTransition(() => {
      // If a replacement was already queued, it is the owner at this point;
      // this end request still follows it in lifecycle call order and must end
      // that replacement rather than becoming a no-op.
      const target = owner ?? this.owner;
      if (!target) return;
      this.owner = undefined;
      this.ownerEnding = false;
      return this.endOwned(target.generation);
    });
  }

  private enqueueOwnerTransition(
    transition: () => void | Promise<void>,
  ): Promise<void> {
    this.pendingOwnerTransitions++;
    const queued = this.ownerTransition.then(transition);
    this.ownerTransition = queued.finally(() => {
      this.pendingOwnerTransitions--;
    });
    return queued;
  }

  /**
   * Cancel and then fully tear down each child of one ended owner.
   *
   * Shutdown requests are issued to every sibling before any teardown is
   * awaited. `allSettled` is deliberate: one throwing/rejecting child must not
   * abandon the rest, and each child's own session shutdown has its enforced
   * timeout before it reaches SDK disposal.
   */
  private endOwned(generation: number): Promise<void> {
    if (this.ownerCleanup) return this.ownerCleanup;

    const records = [...this.agents.values()].filter(
      (agent) => agent.ownerGeneration === generation,
    );
    for (const agent of records) {
      if (agent.status === "queued") agent.stopQueued();
      else if (agent.isActive()) agent.abort();
    }

    const cleanup = Promise.allSettled(
      records.map((agent) => agent.disposeSession()),
    ).then(() => undefined);
    this.ownerCleanup = cleanup;
    void cleanup.then(() => {
      if (this.ownerCleanup === cleanup) this.ownerCleanup = undefined;
    });
    return cleanup;
  }

  /** Whether a launch carrying `owner` may still be accepted. */
  private accepts(owner: SessionOwner): boolean {
    return ownerCanAccept(owner, this.currentOwner());
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
      // A session-created hook is optional: the observer takes the forwarding
      // callback or omits the key, never a key holding undefined.
      ...defined({
        onSessionCreated: options.observer?.onSessionCreated
          ? (agent: Subagent) => options.observer!.onSessionCreated!(agent)
          : undefined,
      }),
      onRunStarted: (agent, kind) => {
        try {
          this.observer?.onSubagentRunStarted(agent, kind);
        } catch (err) {
          debugLog("onSubagentRunStarted observer", err);
        }
      },
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
      // Terminal transitions are reported for every agent. Whether the parent
      // needs telling is the notification layer's decision, made from the
      // carrier claim; suppressing the observer here would also suppress the
      // lifecycle event and the session-history record, which are facts about
      // the run rather than announcements.
    };
  }

  /**
   * Spawn an agent and hand back its ID immediately (for background use).
   * If the concurrency limit is reached, the agent is queued.
   *
   * Accepts or refuses; it does not throw for a request the current session
   * cannot honour. Only a genuine defect throws.
   */
  spawn(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: AgentSpawnConfig,
  ): LaunchOutcome<string> {
    const resolved = this.resolveSpawn(
      type,
      options.background,
      options.definition,
    );
    if (resolved.kind === "rejected") return resolved;
    return this.create(snapshot, resolved.value, prompt, options);
  }

  /**
   * Spawn an agent and wait for completion (foreground use).
   *
   * The run takes the same concurrency slot a background run does: waiting for
   * a result is a delivery choice, not a licence for extra capacity.
   *
   * The caller holds the result, which is a delivery commitment: the agent must
   * not be announced, whatever its frontmatter declares.
   *
   * Accepts or refuses, like {@link spawn}, and on acceptance claims the outcome
   * before awaiting it so nothing announces what is already being delivered.
   */
  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ): Promise<LaunchOutcome<Subagent>> {
    const outcome = await this.spawnAndWaitWithOutcome(
      snapshot,
      type,
      prompt,
      options,
    );
    return outcome.kind === "rejected"
      ? outcome
      : { kind: "accepted", value: outcome.value.record };
  }

  /** Await a foreground run while retaining the exact run it began on. */
  async spawnAndWaitWithOutcome(
    snapshot: ParentSnapshot,
    type: SubagentType,
    prompt: string,
    options: Omit<AgentSpawnConfig, "background">,
  ): Promise<LaunchOutcome<ForegroundRunOutcome>> {
    const foreground: BackgroundRequest = {
      kind: "explicit",
      isBackground: false,
    };
    const resolved = this.resolveSpawn(type, foreground, options.definition);
    if (resolved.kind === "rejected") return resolved;
    const started = this.create(snapshot, resolved.value, prompt, {
      ...options,
      background: foreground,
    });
    if (started.kind === "rejected") return started;
    const record = this.agents.get(started.value);
    // `create` registered the record under the id it returned, so the lookup
    // cannot miss; the assertion states that rather than defending against it.
    if (!record) {
      throw new Error(`Subagent record vanished immediately: ${started.value}`);
    }
    record.claim();
    const run = record.latestRun;
    await record.promise;
    return { kind: "accepted", value: { record, run } };
  }

  /**
   * Stamp the invariants every front door shares: a canonical agent type, a
   * verdict for a rejected one, and the effective background mode.
   *
   * The verdict is computed here, before any record exists, so a refused
   * launch leaves nothing behind: no id, no workspace plan, no entry in the
   * map a caller could poll.
   */
  private resolveSpawn(
    type: string,
    background: BackgroundRequest,
    preparedDefinition?: AgentDefinition,
  ): LaunchOutcome<ResolvedSpawn> {
    let definition = preparedDefinition;
    if (!definition) {
      // Internal callers that have not moved to LaunchPreparer still use the
      // manager's checked path. The extension tool always passes the
      // definition selected by the shared preparer.
      this.reloadDefinitions?.();
      const selection = this.registry.select(type);
      if (!selection.ok) {
        return selection.reason === "configuration"
          ? {
              kind: "rejected",
              reason: selection.reason,
              diagnostics: selection.diagnostics,
            }
          : { kind: "rejected", reason: selection.reason };
      }
      definition = selection.definition;
    }
    return {
      kind: "accepted",
      value: {
        type: definition.id,
        isBackground: resolveBackgroundMode(definition, background),
        definition,
        tools: definition.tools,
      },
    };
  }

  /** Create, register, and start (or queue) a record for an already-resolved spawn. */
  private create(
    snapshot: ParentSnapshot,
    resolved: ResolvedSpawn,
    prompt: string,
    options: AgentSpawnConfig,
  ): LaunchOutcome<string> {
    // The last check before anything exists. A launch whose session has ended
    // is refused here, so it leaves no id, no workspace plan, and no record for
    // a caller to poll — the outcome of work nobody asked for any more.
    if (!this.accepts(options.owner)) {
      return { kind: "rejected", reason: "session-ended" };
    }
    const { type, isBackground, definition } = resolved;
    const id = randomUUID().slice(0, 17);
    // The tools this child will have, resolved once, here: the definition's
    // selection against the parent's active tools as they were when the
    // request was made. The child is given exactly these names, so the
    // runtime and the child can never disagree about what it may do — and a
    // definition edited while the child waited cannot hand it a shell it was
    // not cleared for.
    const toolNames =
      options.toolNames !== undefined
        ? [...options.toolNames]
        : expandMcpToolPatterns(
            resolveChildToolNames(resolved.tools, snapshot.activeToolNames),
            snapshot.registeredToolNames,
          ).toolNames;
    const impact = classifyWorkspaceImpact(toolNames);
    // The workspace the child works in: the parent's directory when the
    // request was made. Two parents in one directory share one slot.
    const gate = this.workspaceGates.gateFor(snapshot.cwd);
    const plan: WorkspacePlan = {
      gate,
      impact,
      id,
      // A caller that named no signal has none; the field is absent rather
      // than present-and-undefined, so the gate cannot mistake the two.
      ...defined({ signal: options.signal }),
    };
    this.workspacePlans.set(id, plan);
    const record = new Subagent({
      id,
      type,
      description: options.description,
      isBackground,
      ownerGeneration: options.owner.generation,
      execution: {
        createSubagentSession: this.createSubagentSession,
        snapshot,
        prompt,
        baseCwd: this.baseCwd,
        observer: this.buildObserver(options),
        getWorkspaceProvider: () => this._workspaceProvider,
        turnPolicy: options.turnPolicy,
        definition,
        ...defined({ childShaping: options.childShaping }),
        toolNames,
        ...defined({
          getRunConfig: this.getRunConfig,
          modelIdentity: options.modelIdentity,
          thinkingLevel: options.thinkingLevel,
          modelSelection: options.modelSelection,
          thinkingDecision: options.thinkingDecision,
          parentSession: options.parentSession,
          signal: options.signal,
        }),
      },
    });
    this.agents.set(id, record);

    if (isBackground) {
      this.observer?.onSubagentCreated(record);
    }

    // Every run is admitted through the limiter. scheduleVia captures the
    // limiter promise eagerly, so a queued agent is awaitable from spawn;
    // guardedRun guards against abort-while-queued when the slot frees. The
    // workspace slot is taken inside the scheduled task, so a child waiting
    // for a concurrency slot holds no workspace slot.
    record.scheduleVia((thunk) =>
      this.admitBackground(() => this.admit(plan, thunk)),
    );
    return { kind: "accepted", value: id };
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
   * it, or queued for a concurrency slot when the limit is reached. Refuses
   * synchronously, for the same reasons `resume` does.
   *
   * A resume is admitted through the same limiter as a spawn, whether it runs
   * in the background or the caller is awaiting it.
   */
  startResume(
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ): ResumeStart {
    const agent = this.agents.get(id);
    if (!agent) return { kind: "refused", reason: "unknown-agent" };
    // Before the record's own state: a child belongs to the session that asked
    // for it, and continuing it from a session that did not would hand its
    // outcome to a parent that never knew the child existed.
    // Compare against the live owner, not the generation counter: `beginOwner`
    // clears the owner synchronously before it awaits the old owner's teardown
    // and installs the replacement, so only the owner says "no current session"
    // during that window.
    if (agent.ownerGeneration !== this.owner?.generation) {
      return { kind: "refused", reason: "stale-session" };
    }
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
      ...defined({ signal: options.signal }),
    };
    void agent.resume(
      prompt,
      {
        background: options.background,
        ...defined({
          signal: options.signal,
          claimOutcome: options.claimOutcome,
        }),
      },
      (thunk) => this.admitBackground(() => this.admit(resumePlan, thunk)),
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
  dispose(): Promise<void> {
    if (!this.disposePromise) this.disposePromise = this.disposeOnce();
    return this.disposePromise;
  }

  private async disposeOnce(): Promise<void> {
    clearInterval(this.sweepInterval);
    // Drop pending thunks.
    this.limiter.clear();
    const teardownInProgress = this.ownerCleanup;
    const teardowns = [...this.agents.values()].map((record) =>
      record.disposeSession(),
    );
    this.agents.clear();
    this.workspacePlans.clear();
    this.owner = undefined;
    this.ownerEnding = false;
    await Promise.allSettled([
      ...teardowns,
      ...(teardownInProgress ? [teardownInProgress] : []),
    ]);
  }
}
