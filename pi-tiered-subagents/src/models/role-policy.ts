/** The shipped specialist-to-target policy; unknown identifiers use worker. */
import type { ModelClass, ModelSize } from "#src/models/profile";

export interface RolePolicy {
  readonly size: ModelSize | "equal" | "one-below";
  readonly class: ModelClass;
}

export const ROLE_POLICY = {
  worker: { size: "one-below", class: "worker" },
  researcher: { size: "S", class: "worker" },
  debug: { size: "M", class: "worker" },
  reviewer: { size: "equal", class: "planner" },
  explore: { size: "S", class: "worker" },
} as const satisfies Record<string, RolePolicy>;

export function policyFor(agentId: string): RolePolicy {
  return Object.hasOwn(ROLE_POLICY, agentId)
    ? ROLE_POLICY[agentId as keyof typeof ROLE_POLICY]
    : ROLE_POLICY.worker;
}
