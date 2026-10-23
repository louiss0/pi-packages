import { defined, type Patch } from "#src/optional";
import type { ChildCompletedEvent } from "#src/lifecycle/child-lifecycle";
import type { TurnLoopResult } from "#src/lifecycle/subagent-session";

/** A turn loop that ran to completion, one turn, with no turn limit. */
export function turnLoopResult(
  overrides: Patch<TurnLoopResult> = {},
): TurnLoopResult {
  return {
    responseText: "done",
    turnBudget: { used: 1, phase: "within" },
    ...defined(overrides),
  };
}

/** A `subagents:child:completed` payload for a run with no turn limit. */
export function childCompletedEvent(
  overrides: Patch<ChildCompletedEvent> = {},
): ChildCompletedEvent {
  return {
    sessionDir: "/sessions/child",
    agentName: "Explore",
    ...defined(overrides),
  };
}
