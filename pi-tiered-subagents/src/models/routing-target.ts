/**
 * Each family group owns its target semantics. The router only needs to know
 * where a target starts, which tiers match it, and which fallbacks it permits.
 * Profiles remain plain data; these classes interpret their validated labels.
 */
import type {
  FamilyGroup,
  TierRole,
  ModelSize,
  TierProfile,
  FamilyProfile,
} from "#src/models/profiles";
import type { RolePolicy } from "#src/models/role-policy";

export interface RoutingTarget {
  readonly label: string;
  startingTier(
    version: FamilyProfile,
    parentTier: TierProfile,
  ): TierProfile | undefined;
  allowsFallback(tier: TierProfile): boolean;
}

class SizeRoutingTarget implements RoutingTarget {
  private static readonly rank = {
    S: 0,
    M: 1,
    L: 2,
    XL: 3,
  } as const satisfies Record<ModelSize, number>;
  private static readonly oneBelow = {
    S: "S",
    M: "S",
    L: "M",
    XL: "L",
  } as const satisfies Record<ModelSize, ModelSize>;
  readonly label: ModelSize;
  private readonly keepParentRung: boolean;

  constructor(requestedSize: RolePolicy["size"], parentSize: ModelSize) {
    this.keepParentRung = requestedSize === "equal";
    this.label =
      requestedSize === "equal"
        ? parentSize
        : requestedSize === "one-below"
          ? SizeRoutingTarget.oneBelow[parentSize]
          : requestedSize;
  }

  startingTier(
    version: FamilyProfile,
    parentTier: TierProfile,
  ): TierProfile | undefined {
    return this.keepParentRung
      ? parentTier
      : version.tiers.find((tier) => tier.size === this.label);
  }

  allowsFallback(tier: TierProfile): boolean {
    return (
      tier.size !== undefined &&
      SizeRoutingTarget.rank[tier.size] <= SizeRoutingTarget.rank[this.label]
    );
  }
}

class PlannerWorkerRoutingTarget implements RoutingTarget {
  private static readonly rank = {
    worker: 0,
    planner: 1,
  } as const satisfies Record<TierRole, number>;

  constructor(readonly label: TierRole) {}

  startingTier(version: FamilyProfile): TierProfile | undefined {
    return version.tiers.find((tier) => tier.role === this.label);
  }

  allowsFallback(tier: TierProfile): boolean {
    return (
      tier.role !== undefined &&
      PlannerWorkerRoutingTarget.rank[tier.role] <=
        PlannerWorkerRoutingTarget.rank[this.label]
    );
  }
}

/** Select a concept once; size routing requires the parent's validated size. */
export function createRoutingTarget(
  group: FamilyGroup,
  policy: RolePolicy,
  parentTier: TierProfile,
): RoutingTarget | undefined {
  if (group === "planner-worker")
    return new PlannerWorkerRoutingTarget(policy.role);
  return parentTier.size === undefined
    ? undefined
    : new SizeRoutingTarget(policy.size, parentTier.size);
}
