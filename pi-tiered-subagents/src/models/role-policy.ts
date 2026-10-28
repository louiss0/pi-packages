/** The shipped specialist-to-target policy; unknown identifiers use worker. */
import type { TierRole, ModelSize } from "#src/models/profiles";

export type RolePolicy = Readonly<{
  size: ModelSize | "equal" | "one-below";
  role: TierRole;
}>;

export const ROLE_POLICY = {
  worker: { size: "one-below", role: "worker" },
  researcher: { size: "S", role: "worker" },
  debug: { size: "M", role: "worker" },
  reviewer: { size: "equal", role: "planner" },
  explore: { size: "S", role: "worker" },
} as const satisfies Record<string, RolePolicy>;

export function policyFor(agentId: string): RolePolicy {
  return Object.hasOwn(ROLE_POLICY, agentId)
    ? ROLE_POLICY[agentId as keyof typeof ROLE_POLICY]
    : ROLE_POLICY.worker;
}
