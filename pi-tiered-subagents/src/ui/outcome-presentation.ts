import type { AgentStatus, TurnBudget } from "./view-types.js";

/** Recorded outcome facts shared by terminal renderers, not execution policy. */
interface OutcomeView {
  readonly status: AgentStatus | "background";
  readonly turnBudget?: TurnBudget | undefined;
}

/** A completed run that heeded its budget warning keeps a presentation caveat. */
export function wrappedUpAtTurnLimit(outcome: OutcomeView): boolean {
  return (
    outcome.status === "completed" && outcome.turnBudget?.phase === "warned"
  );
}
