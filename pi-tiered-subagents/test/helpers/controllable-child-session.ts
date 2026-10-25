/**
 * controllable-child-session.ts — A deterministic ChildSession double (story 113).
 *
 * Behavior tests drive the Subagents interface with the real preparer and
 * manager; the one substitution is child execution, and it happens here. The
 * double is typed against the package's own `ChildSession` contract — no SDK
 * session class, no private-field casts at call sites — and the test controls
 * every interesting moment:
 *
 * - **pause**: nothing settles on its own. A run's turn loop pends until the
 *   test settles it, and `pauseCreation()` holds a child unborn, so no test
 *   needs an arbitrary sleep to observe queued/running state.
 * - **settle / fail**: `run.settle(text)` completes a run with its answer,
 *   `run.settleExhausted(text)` ends it at the turn ceiling, `run.fail(err)`
 *   ends it in an execution failure.
 * - **steer**: every delivered steer is recorded on `child.steered`.
 * - **cancel**: through the run's real abort lever (`run.signal`). The default
 *   mirrors the real session — the loop returns once the lever fires — and
 *   `settleOnAbort: false` simulates a child that never notices, for tests of
 *   the machinery around a hung stop.
 * - **events**: `child.emit(event)` drives the record observer's subscription
 *   (usage, compaction, tool executions), as `MockSession.emit` does.
 *
 * The manager's seam still names the concrete `SubagentSession` class, so one
 * contained bridge cast lives at the bottom of this file — the same pattern
 * `mock-session.ts`'s `toSubagentSession` established, with the input side
 * fully typed against `ChildSession`.
 */

import type {
  AgentSessionEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  ChildSession,
  CreateChildSession,
  CreateSubagentSessionParams,
} from "#src/lifecycle/create-subagent-session";
import type {
  SubagentSession,
  TurnLoopOptions,
  TurnLoopResult,
} from "#src/lifecycle/subagent-session";
import type {
  TurnBudget,
  TurnBudgetPhase,
  TurnPolicy,
} from "#src/lifecycle/turn-limits";
import type { SessionStatsLike } from "#src/lifecycle/usage";

// ── One controllable run ──────────────────────────────────────────────────────

/** One turn loop the child is running: the initial run, or one resume. */
export interface ControllableRun {
  /** The prompt the loop received (parent context already folded in by the record). */
  readonly prompt: string;
  /** The run's own abort lever, handed to the loop by the record. */
  readonly signal: AbortSignal | undefined;
  /** Every budget the loop reported, in order: the initial state, then each advance. */
  readonly budgets: readonly TurnBudget[];
  /** Settles (never rejects) when the loop settles, either way. */
  readonly settled: Promise<void>;
  /** Count a turn and report the budget it left, as a real turn boundary would. */
  advanceTurn(): void;
  /** Resolve the loop with the run's final answer (default "done"). */
  settle(responseText?: string): void;
  /** Resolve the loop as a run the harness stopped at its turn ceiling. */
  settleExhausted(responseText?: string): void;
  /** Reject the loop: the run ends in an execution failure. */
  fail(error: unknown): void;
  /** Fire the run's cancellation lever, if it has one. */
  cancel(): void;
}

/** The initial budget a run reports, derived from the child's captured policy. */
function initialBudget(policy: TurnPolicy): TurnBudget {
  return policy.kind === "limited"
    ? { maxTurns: policy.maxTurns, used: 0, phase: "within" }
    : { used: 0, phase: "within" };
}

function createControllableRun(
  prompt: string,
  opts: TurnLoopOptions,
  policy: TurnPolicy,
  settleOnAbort: boolean,
): { run: ControllableRun; loop: Promise<TurnLoopResult> } {
  // A fresh counter per run, as the real session's per-run budget tracker: a
  // resume keeps the policy and starts over (story 74).
  let budget = initialBudget(policy);
  const budgets: TurnBudget[] = [];
  const reportBudget = (): void => {
    budgets.push(budget);
    opts.onTurnBudget?.(budget);
  };
  // The real loop states the budget before the first turn.
  reportBudget();

  const signal = opts.signal;
  // A lever that already fired takes no turn and has no answer, exactly as the
  // real promptForAnswer returns without prompting.
  if (signal?.aborted) {
    const run: ControllableRun = {
      prompt,
      signal,
      budgets,
      settled: Promise.resolve(),
      advanceTurn: () => {},
      settle: () => {},
      settleExhausted: () => {},
      fail: () => {},
      cancel: () => {},
    };
    return {
      run,
      loop: Promise.resolve({ responseText: "", turnBudget: budget }),
    };
  }

  const outcome = Promise.withResolvers<TurnLoopResult>();
  let isSettled = false;
  const onAbort = (): void => {
    // The default mirrors the real session: Pi's abort() ends the prompt, so
    // the loop returns with no further answer and the record's own transition
    // (already "stopped") stands.
    if (settleOnAbort) finish("");
  };
  // Attached for the loop's duration and released on every settlement path —
  // a one-shot listener alone would leak when the run settles first.
  signal?.addEventListener("abort", onAbort, { once: true });

  const finish = (responseText: string, phase?: TurnBudgetPhase): void => {
    if (isSettled) return;
    isSettled = true;
    signal?.removeEventListener("abort", onAbort);
    if (phase) {
      budget = { ...budget, phase };
      // The real tracker reports the final phase through the budget channel,
      // so the record's budget reads exhausted, not only the loop result.
      reportBudget();
    }
    outcome.resolve({ responseText, turnBudget: budget });
  };
  const failWith = (error: unknown): void => {
    if (isSettled) return;
    isSettled = true;
    signal?.removeEventListener("abort", onAbort);
    outcome.reject(error);
  };

  const run: ControllableRun = {
    prompt,
    signal,
    budgets,
    // Never rejects: a waiter learns the loop ended, not how.
    settled: outcome.promise.then(
      () => undefined,
      () => undefined,
    ),
    advanceTurn(): void {
      if (isSettled) return;
      budget = { ...budget, used: budget.used + 1 };
      reportBudget();
    },
    settle: (responseText = "done") => finish(responseText),
    settleExhausted: (responseText = "") => finish(responseText, "exhausted"),
    fail: failWith,
    cancel: onAbort,
  };
  return { run, loop: outcome.promise };
}

// ── One controllable child ────────────────────────────────────────────────────

/** A created child: its double, the params it was born from, and its controls. */
export interface ControllableChild {
  /** The double, typed against the package's own ChildSession contract. */
  readonly session: ChildSession;
  /**
   * The params the factory was called with — the prepared launch as the child
   * adapter actually received it (definition, turn policy, exact tool names).
   */
  readonly params: CreateSubagentSessionParams;
  /** One entry per turn loop: the initial run, then one per resume. */
  readonly runs: readonly ControllableRun[];
  /** Every steer delivered to the child, in order. */
  readonly steered: readonly string[];
  /** How many times teardown actually ran (the real teardown is idempotent). */
  readonly disposeCount: number;
  /** Resolves the first time teardown is requested. */
  readonly disposeRequested: Promise<void>;
  /** Emit a session event to every live subscriber (usage, compaction, turns). */
  emit(event: unknown): void;
  /** Live subscriber count: an unsubscribed listener is not counted. */
  listenerCount(): number;
  /**
   * Await the nth run's turn loop. Indexed rather than "next", so the call is
   * safe no matter whether the run started before or after the test asked.
   */
  runStarted(index: number): Promise<ControllableRun>;
  /** The nth run, or a failed expectation rather than an undefined slip. */
  runAt(index: number): ControllableRun;
}

function createControllableChild(
  params: CreateSubagentSessionParams,
  index: number,
  settleOnAbort: boolean,
): ControllableChild {
  const runs: ControllableRun[] = [];
  const steered: string[] = [];
  const subscribers = new Set<(event: AgentSessionEvent) => void>();
  const runWaiters: Array<{
    index: number;
    resolve: (run: ControllableRun) => void;
  }> = [];
  let disposeCount = 0;
  let disposed = false;
  const disposeSignal = Promise.withResolvers<void>();
  const disposePromise = disposeSignal.promise;

  const notifyRunStarted = (): void => {
    // A waiter stays queued until its index exists, so awaiting run 1 before
    // run 0 has started does not consume the waiter on run 0's arrival.
    for (let i = runWaiters.length - 1; i >= 0; i--) {
      const waiter = runWaiters[i];
      if (!waiter) continue;
      const run = runs[waiter.index];
      if (run) {
        runWaiters.splice(i, 1);
        waiter.resolve(run);
      }
    }
  };

  const session: ChildSession = {
    outputFile: `/sessions/controllable-child-${index}.jsonl`,
    model: params.model,
    thinkingLevel: params.thinkingLevel ?? "off",
    runTurnLoop(
      prompt: string,
      opts: TurnLoopOptions,
    ): Promise<TurnLoopResult> {
      const { run, loop } = createControllableRun(
        prompt,
        opts,
        params.turnPolicy,
        settleOnAbort,
      );
      runs.push(run);
      notifyRunStarted();
      return loop;
    },
    steer(message: string): Promise<void> {
      steered.push(message);
      return Promise.resolve();
    },
    getConversation: () => "",
    getContextPercent: () => null,
    subscribe(fn: (event: AgentSessionEvent) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    getSessionStats: (): SessionStatsLike => ({
      tokens: { input: 0, output: 0, cacheWrite: 0 },
      contextUsage: { percent: null },
    }),
    messages: [],
    agentMessages: [],
    getToolDefinition: (_name: string): ToolDefinition | undefined => undefined,
    dispose(): Promise<void> {
      if (!disposed) {
        disposed = true;
        disposeCount++;
        disposeSignal.resolve();
      }
      return disposePromise;
    },
  };

  return {
    session,
    params,
    runs,
    steered,
    get disposeCount() {
      return disposeCount;
    },
    disposeRequested: disposeSignal.promise,
    emit(event: unknown): void {
      // Test-driven events, as MockSession.emit: the subscriber's contract is
      // AgentSessionEvent, but fixtures carry only the fields the observer reads.
      for (const fn of [...subscribers]) fn(event as AgentSessionEvent);
    },
    listenerCount: () => subscribers.size,
    runStarted(index: number): Promise<ControllableRun> {
      const existing = runs[index];
      if (existing) return Promise.resolve(existing);
      return new Promise<ControllableRun>((resolve) => {
        runWaiters.push({ index, resolve });
      });
    },
    runAt(index: number): ControllableRun {
      const run = runs[index];
      if (run === undefined)
        throw new Error(`expected run #${index} to have started`);
      return run;
    },
  };
}

// ── The factory ───────────────────────────────────────────────────────────────

export interface ControllableChildFactoryOptions {
  /**
   * What a run's loop does when its lever fires mid-run. True (the default)
   * mirrors the real session: the prompt returns and the loop settles with no
   * further answer. False simulates a child that ignores cancellation, for
   * tests of the machinery around a hung stop.
   */
  readonly settleOnAbort?: boolean;
}

export interface ControllableChildFactory {
  /** The manager-seam factory: pass as `SubagentManagerOptions.createSubagentSession`. */
  readonly createSubagentSession: (
    params: CreateSubagentSessionParams,
  ) => Promise<SubagentSession>;
  /** The same factory, typed against the package-owned ChildSession seam. */
  readonly createChild: CreateChildSession;
  /** Every child created so far, in creation order. */
  readonly children: readonly ControllableChild[];
  /**
   * Await the nth child creation. Indexed rather than "next", so the call is
   * safe no matter whether the child was born before or after the test asked.
   */
  childBorn(index: number): Promise<ControllableChild>;
  /** The nth child, or a failed expectation rather than an undefined slip. */
  childAt(index: number): ControllableChild;
  /** Hold every creation until resumeCreation() — a child not yet born. */
  pauseCreation(): void;
  resumeCreation(): void;
  /** Make the next creation (or the next n, called repeatedly) reject. */
  failNextCreation(error: unknown): void;
}

export function createControllableChildFactory(
  options: ControllableChildFactoryOptions = {},
): ControllableChildFactory {
  const settleOnAbort = options.settleOnAbort ?? true;
  const children: ControllableChild[] = [];
  const childWaiters: Array<{
    index: number;
    resolve: (child: ControllableChild) => void;
  }> = [];
  const creationFailures: unknown[] = [];
  let creationGate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;

  const notifyChildBorn = (): void => {
    for (let i = childWaiters.length - 1; i >= 0; i--) {
      const waiter = childWaiters[i];
      if (!waiter) continue;
      const child = children[waiter.index];
      if (child) {
        childWaiters.splice(i, 1);
        waiter.resolve(child);
      }
    }
  };

  const createChild: CreateChildSession = async (params) => {
    // A per-pause gate: a creation released from one pause still observes the
    // next one, so a test can hold a second child while the first runs.
    while (creationGate) await creationGate;
    if (creationFailures.length > 0) throw creationFailures.shift();
    const child = createControllableChild(
      params,
      children.length + 1,
      settleOnAbort,
    );
    children.push(child);
    notifyChildBorn();
    return child.session;
  };

  return {
    createChild,
    createSubagentSession: asManagerSessionFactory(createChild),
    children,
    childBorn(index: number): Promise<ControllableChild> {
      const existing = children[index];
      if (existing) return Promise.resolve(existing);
      return new Promise<ControllableChild>((resolve) => {
        childWaiters.push({ index, resolve });
      });
    },
    childAt(index: number): ControllableChild {
      const child = children[index];
      if (child === undefined)
        throw new Error(`expected child #${index} to have been created`);
      return child;
    },
    pauseCreation(): void {
      if (creationGate) return;
      const gate = Promise.withResolvers<void>();
      creationGate = gate.promise;
      releaseGate = gate.resolve;
    },
    resumeCreation(): void {
      releaseGate?.();
      creationGate = undefined;
      releaseGate = undefined;
    },
    failNextCreation(error: unknown): void {
      creationFailures.push(error);
    },
  };
}

/**
 * The one bridge between the package-owned ChildSession contract and the
 * manager's concrete SubagentSession seam. SubagentSession is a class with
 * private fields, so no plain object is assignable to it; the cast is
 * contained here, with the input side fully typed against ChildSession —
 * mirroring the established toSubagentSession bridge in mock-session.ts.
 */
function asManagerSessionFactory(
  factory: CreateChildSession,
): (params: CreateSubagentSessionParams) => Promise<SubagentSession> {
  return factory as unknown as (
    params: CreateSubagentSessionParams,
  ) => Promise<SubagentSession>;
}
