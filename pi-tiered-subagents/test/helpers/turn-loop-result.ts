import { defined, type Patch } from "#src/optional";
import type { ChildCompletedEvent } from "#src/lifecycle/child-lifecycle";
import type { TurnLoopResult } from "#src/lifecycle/subagent-session";

/** A turn loop that ran to completion. */
export function turnLoopResult(
  overrides: Patch<TurnLoopResult> = {},
): TurnLoopResult {
  return {
    responseText: "done",
    ...defined(overrides),
  };
}

/** A `subagents:child:completed` payload. */
export function childCompletedEvent(
  overrides: Patch<ChildCompletedEvent> = {},
): ChildCompletedEvent {
  return {
    sessionDir: "/sessions/child",
    agentName: "Explore",
    ...defined(overrides),
  };
}
