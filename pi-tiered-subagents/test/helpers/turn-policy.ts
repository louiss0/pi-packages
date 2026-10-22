import type { TurnPolicy } from "#src/lifecycle/turn-limits";

/**
 * The turn policy a fixture gets when it does not exercise the budget.
 *
 * Unlimited, because a budget a fixture did not ask for would stop turns the
 * test expects to happen. A test that is about the budget names one itself
 * through {@link limitedTurns}.
 */
export const UNLIMITED_TURNS: TurnPolicy = { kind: "unlimited" };

/** A limited policy, for tests that exercise the warning or the ceiling. */
export function limitedTurns(maxTurns: number, wrapUpTurns = 2): TurnPolicy {
  return { kind: "limited", maxTurns, wrapUpTurns };
}
