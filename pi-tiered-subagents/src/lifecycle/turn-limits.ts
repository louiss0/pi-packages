/**
 * turn-limits.ts — The turn-budget policy for subagent execution.
 *
 * Owns the budget's shape, the final turn policy a launch resolves to, and the
 * tracker that decides, turn by turn, when the turn loop in SubagentSession
 * warns the child or stops it. The decisions live here, apart from the
 * session, so the policy is testable without one.
 */

/**
 * The turn ceiling a run is held to, resolved once when the launch is prepared.
 *
 * A closed alternative with no unresolved fallback: the session enforces this
 * decision and never consults a default of its own, so a setting changed after
 * acceptance cannot alter an accepted run's budget, and a deliberately
 * unlimited run cannot be quietly limited downstream.
 */
export type TurnPolicy =
  | {
      readonly kind: "limited";
      /** The normalized ceiling: at least {@link MIN_MAX_TURNS}. */
      readonly maxTurns: number;
      /** Turns left when the child is warned about its remaining budget. */
      readonly wrapUpTurns: number;
    }
  | { readonly kind: "unlimited" };

/** What the harness has done about a run's turn limit, in the order it happens. */
export type TurnBudgetPhase = "within" | "warned" | "exhausted";

/**
 * A run's turn budget and its use. Present only when a limit exists.
 *
 * `phase` is recorded rather than derived from the counts: whether the harness
 * warned or stopped the run is an event, and an agent that answered on its last
 * permitted turn has the same counts as one the harness cut off.
 */
export interface TurnBudget {
  /** The ceiling; absent for an unlimited run. */
  maxTurns?: number;
  /** Successful turns completed in this run. */
  used: number;
  phase: TurnBudgetPhase;
}

/** What the turn loop must do after a turn boundary: warn the child, stop it, or nothing. */
export type TurnBudgetAction = "warn" | "stop" | undefined;

/** How one turn ended, as far as the budget is concerned. */
export interface TurnOutcome {
  /** The response errored or was aborted; such a turn does not spend budget. */
  failed: boolean;
  /** The turn ran tools, so the agent loop goes on to another turn. */
  ranTools: boolean;
}

/**
 * The raw inputs one launch's turn policy is resolved from.
 *
 * Each is absent when that layer says nothing about the ceiling; the first one
 * present wins, which is the request → definition → operator precedence.
 */
export interface TurnPolicyInputs {
  /**
   * The ceiling the request and the definition resolved to, in that order.
   * `0` at either layer is a deliberate "unlimited" and is not replaced.
   */
  readonly resolvedMaxTurns?: number;
  /** The operator's default ceiling; `0` is a deliberate "unlimited". */
  readonly defaultMaxTurns?: number;
  /** Turns left when the child is warned about its budget. */
  readonly wrapUpTurns?: number;
}

/**
 * Wrap-up turns when no layer names any.
 *
 * The policy's own answer, exported so the settings store advertises the same
 * default the resolver falls back to rather than a second copy of it.
 */
export const DEFAULT_WRAP_UP_TURNS = 2;

/**
 * Resolve one launch's turn policy, once.
 *
 * Precedence is the request's ceiling, then the definition's, then the
 * operator's default; `0` at any layer is a deliberate unlimited and is not
 * overridden by a later layer. A ceiling below {@link MIN_MAX_TURNS} is raised,
 * because a subagent's result is its final response: it needs one turn to work
 * and one to answer.
 */
export function resolveTurnPolicy(inputs: TurnPolicyInputs): TurnPolicy {
  const maxTurns = normalizeMaxTurns(
    inputs.resolvedMaxTurns ?? inputs.defaultMaxTurns,
  );
  if (maxTurns === undefined) return { kind: "unlimited" };
  return {
    kind: "limited",
    maxTurns,
    wrapUpTurns: Math.max(1, inputs.wrapUpTurns ?? DEFAULT_WRAP_UP_TURNS),
  };
}

/**
 * Counts a run's successful turns and decides when the harness warns the child
 * about its remaining budget and when it stops the run at the ceiling.
 *
 * The warning goes out once `wrapUpTurns` turns remain (`warnAt = maxTurns −
 * wrapUpTurns`, floored at 0), but only after a turn that ran tools: such a
 * turn guarantees another one, which is where the child reads the warning. A
 * warning after a final answer would sit in the transcript unread until a
 * resume, by then stale.
 *
 * The ceiling stops the run after turn `maxTurns` when that turn ran tools; a
 * ceiling turn without tool calls is the child's answer, and the run ends on
 * its own. A turn that starts past the ceiling anyway (a steer queued on the
 * final turn forces one) is stopped as it starts.
 */
export class TurnBudgetTracker {
  /**
   * The ceiling this run is held to, already decided.
   *
   * A closed alternative rather than two possibly-absent numbers: the tracker
   * never has to ask whether a default is still to be found.
   */
  private readonly ceiling:
    | { readonly kind: "unlimited" }
    | {
        readonly kind: "limited";
        readonly maxTurns: number;
        readonly warnAt: number;
      };
  private used = 0;
  private phase: TurnBudgetPhase = "within";

  constructor(policy: TurnPolicy) {
    this.ceiling =
      policy.kind === "unlimited"
        ? { kind: "unlimited" }
        : {
            kind: "limited",
            maxTurns: policy.maxTurns,
            warnAt: Math.max(0, policy.maxTurns - policy.wrapUpTurns),
          };
  }

  /** Whether the budget must be stated before the first turn; records the warning when it must. */
  warnBeforeFirstTurn(): boolean {
    if (this.ceiling.kind !== "limited") return false;
    if (this.ceiling.warnAt !== 0 || this.phase !== "within") return false;
    this.phase = "warned";
    return true;
  }

  /** Account for a turn that just ended. */
  onTurnEnd(turn: TurnOutcome): TurnBudgetAction {
    if (turn.failed) return undefined;
    this.used++;
    if (this.ceiling.kind !== "limited" || !turn.ranTools) return undefined;
    const { maxTurns, warnAt } = this.ceiling;
    if (this.used >= maxTurns) {
      this.phase = "exhausted";
      return "stop";
    }
    if (this.phase === "within" && this.used >= warnAt) {
      this.phase = "warned";
      return "warn";
    }
    return undefined;
  }

  /** Account for a turn about to start. */
  onTurnStart(): TurnBudgetAction {
    if (this.ceiling.kind !== "limited") return undefined;
    if (this.phase === "exhausted" || this.used < this.ceiling.maxTurns)
      return undefined;
    this.phase = "exhausted";
    return "stop";
  }

  /** Turns left before the ceiling; undefined for an unlimited run. */
  get remaining(): number | undefined {
    return this.ceiling.kind === "limited"
      ? this.ceiling.maxTurns - this.used
      : undefined;
  }

  /** A snapshot of the budget, safe to hand to the record. */
  get budget(): TurnBudget {
    return this.ceiling.kind === "limited"
      ? {
          maxTurns: this.ceiling.maxTurns,
          used: this.used,
          phase: this.phase,
        }
      : { used: this.used, phase: this.phase };
  }
}

/**
 * A run that finished on its own after the harness warned it about its turn
 * limit: the one outcome every presentation qualifies with a turn-limit caveat.
 * Takes the two fields it reads, so any outcome-shaped object satisfies it.
 */
export function wrappedUpAtTurnLimit(outcome: {
  status: string;
  turnBudget?: TurnBudget;
}): boolean {
  return (
    outcome.status === "completed" && outcome.turnBudget?.phase === "warned"
  );
}

/**
 * The fewest turns a run may have: a subagent's result is its final response,
 * so it needs one turn to work and one to answer.
 */
export const MIN_MAX_TURNS = 2;

/** Normalize max turns. undefined or 0 = unlimited, otherwise at least MIN_MAX_TURNS. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
  if (n == null || n === 0) return undefined;
  return Math.max(MIN_MAX_TURNS, n);
}

/** Whether a configured limit is a real one below the minimum, which normalizeMaxTurns raises. */
export function isBelowMinimumTurns(n: number | undefined): n is number {
  return n != null && n !== 0 && n < MIN_MAX_TURNS;
}
