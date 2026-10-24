import type { SubagentStatus } from "#src/lifecycle/subagent-state";

/** Exhaustive-handling sentinel: passing anything but `never` is a type error. */

export function assertNever(status: never): never {
  throw new Error(`Unhandled case: ${status}`);
}

/** Type-only exhaustiveness test — if a new member is added to `SubagentStatus` without updating this table, this line fails to compile. */
export const ALL_SUBAGENT_STATUSES = [
  "queued",
  "running",
  "completed",
  "aborted",
  "stopped",
  "error",
] satisfies SubagentStatus[];

/** The status switch in `statusMeaning` (outcome-delivery.ts) handles every member of `SubagentStatus`. Adding a new status without updating the switch makes this type fail to compile. */
export type ExhaustiveStatusSwitch = SubagentStatus;
