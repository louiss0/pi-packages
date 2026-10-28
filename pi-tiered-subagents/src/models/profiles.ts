/**
 * profiles.ts — What a family profile says, and how a malformed one is
 * rejected.
 *
 * A profile is a version-independent family tier ladder. Strategies extract
 * the parent's version and construct exact candidate IDs; profiles never
 * enumerate releases, providers, or concrete identities.
 *
 * The rules a profile must satisfy are checked when it is read, not when it is
 * used: a malformed profile is reported, rather than quietly creating a
 * routing relationship nobody wrote down.
 *
 * The shapes are derived from the Valibot schema that reads them. Structural
 * parsing and normalization happen in `user-profiles.ts`; this module keeps
 * the routing-domain rules (naming structure, placement, cardinality).
 */

import * as v from "valibot";
import type { FamilyStrategy } from "#src/models/strategy";

/** Capability labels used by role-aware routing. */
const MODEL_SIZES = ["S", "M", "L"] as const;
const TIER_ROLES = ["planner", "worker"] as const;
const FAMILY_GROUPS = ["size", "planner-worker"] as const;

export type ModelSize = (typeof MODEL_SIZES)[number];
export type TierRole = (typeof TIER_ROLES)[number];
export type FamilyGroup = (typeof FAMILY_GROUPS)[number];

/** An exact candidate identity for documentation fixtures, not profile data. */
export type ModelCandidate = Readonly<{ provider: string; id: string }>;

/** One rung of the family ladder. Empty names denote the default line.
 * Obsolete tier-level fallbacks are accepted and discarded.
 */
const tierProfileSchema = v.pipe(
  v.strictObject({
    tier: v.pipe(v.string(), v.trim()),
    /** Required for a size-group family. */
    size: v.exactOptional(v.picklist(MODEL_SIZES)),
    /** Required for a planner-worker family. */
    role: v.exactOptional(v.picklist(TIER_ROLES)),
    /** Obsolete; accepted and discarded. Contents are never read. */
    fallbacks: v.optional(v.unknown()),
  }),
  v.transform(({ fallbacks: _fallbacks, ...tier }) => tier),
);

type TierProfileOutput = v.InferOutput<typeof tierProfileSchema>;

type TierProfileLabels = {
  size?: Exclude<TierProfileOutput["size"], undefined>;
  role?: Exclude<TierProfileOutput["role"], undefined>;
};

export type TierProfile = Readonly<
  Omit<TierProfileOutput, "size" | "role"> & TierProfileLabels
>;

const profileBodySchema = v.strictObject({
  group: v.picklist(FAMILY_GROUPS),
  tiers: v.array(tierProfileSchema),
});

export type FamilyProfile = Readonly<
  Omit<v.InferOutput<typeof profileBodySchema>, "tiers"> & {
    family: string;
    tiers: ReadonlyArray<TierProfile>;
  }
>;

/** A profile that failed to read, and why. */
export type ProfileProblem = Readonly<{
  /** Where the problem is, e.g. `gpt 6.1 tier "sol"`. */
  where: string;
  /** What is wrong. */
  problem: string;
}>;

/** Untrusted labels read from a tier before its profile is accepted. */
type TierLabels = Readonly<{
  size?: unknown;
  role?: unknown;
}>;

/**
 * One structural problem in untrusted profile data.
 *
 * Paths are rendered the same way in every diagnostic, so an operator can find
 * the field in the settings file without counting array entries.
 */
export type ProfileIssue = Readonly<{
  path: ReadonlyArray<string | number>;
  message: string;
}>;

/** Parse one profile body, adding the operator's family key from its position. */
export function parseProfileData(
  family: string,
  value: unknown,
):
  | { readonly ok: true; readonly profile: FamilyProfile }
  | { readonly ok: false; readonly issues: ReadonlyArray<ProfileIssue> } {
  const parsed = v.safeParse(profileBodySchema, value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.issues.map((issue) => ({
        path: (issue.path ?? [])
          .map((item) => item.key)
          .filter(
            (key): key is string | number =>
              typeof key === "string" || typeof key === "number",
          ),
        message: issue.message,
      })),
    };
  }
  const profile: FamilyProfile = { family, ...parsed.output };
  return {
    ok: true,
    profile,
  };
}

/** A missing or invalid group label, and the field it belongs to. */
type TierLabelProblem = Readonly<{
  field: "size" | "role";
  problem: string;
}>;

export function tierLabelProblems(
  group: FamilyGroup,
  labels: TierLabels,
): TierLabelProblem[] {
  const problems: TierLabelProblem[] = [];
  if (
    (group === "size" || labels.size !== undefined) &&
    labels.size !== "S" &&
    labels.size !== "M" &&
    labels.size !== "L"
  ) {
    problems.push({
      field: "size",
      problem: 'a size-group tier needs a size: "S", "M", or "L"',
    });
  }
  if (
    (group === "planner-worker" || labels.role !== undefined) &&
    labels.role !== "planner" &&
    labels.role !== "worker"
  ) {
    problems.push({
      field: "role",
      problem: 'a planner-worker tier needs a role: "planner" or "worker"',
    });
  }
  return problems;
}

/** Validate labels, unique tier names, and construct/parse round-tripping. */
export function validateProfile(
  profile: FamilyProfile,
  strategy: FamilyStrategy | undefined,
): ProfileProblem[] {
  const problems: ProfileProblem[] = [];

  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.family)) {
    problems.push({
      where: profile.family,
      problem: "a family is a lowercase identifier",
    });
  }
  if (!strategy) {
    problems.push({
      where: profile.family,
      problem:
        "no naming structure is known for this family, so its models cannot be placed",
    });
  }
  if (profile.group !== "size" && profile.group !== "planner-worker") {
    problems.push({
      where: profile.family,
      problem: 'a profile needs a group: "size" or "planner-worker"',
    });
  }
  if (profile.tiers.length === 0) {
    problems.push({ where: profile.family, problem: "a profile needs a tier" });
  }
  const seen = new Set<string>();
  for (const tier of profile.tiers) {
    const where = `${profile.family} tier "${tier.tier}"`;
    problems.push(
      ...tierLabelProblems(profile.group, tier).map(({ problem }) => ({
        where,
        problem,
      })),
    );
    if (seen.has(tier.tier))
      problems.push({ where, problem: "the tier is listed twice" });
    seen.add(tier.tier);
    if (
      tier.tier !== "" &&
      !/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(tier.tier)
    ) {
      problems.push({
        where,
        problem: "a tier must be a lowercase name, not a model id or version",
      });
    }
    if (strategy) {
      const id = strategy.construct("97.2", tier.tier);
      const parsed = strategy.parse(id);
      if (
        parsed?.version !== "97.2" ||
        parsed.tierCandidates.join("-") !== tier.tier
      ) {
        problems.push({
          where,
          problem:
            "the tier cannot round-trip through the family naming structure",
        });
      }
    }
  }
  return problems;
}

/** Version-independent capability ladders, most capable first.
 * Names and labels describe relationships, never a release/availability catalogue.
 * The empty tier denotes the family's unnamed default line.
 */

export const SHIPPED_PROFILES: ReadonlyArray<FamilyProfile> = [
  {
    family: "gpt",
    group: "size",
    tiers: [
      { tier: "astra", size: "L" },
      { tier: "sol", size: "L" },
      { tier: "terra", size: "M" },
      { tier: "pro", size: "M" },
      { tier: "", size: "M" },
      { tier: "luna", size: "S" },
      { tier: "mini", size: "S" },
      { tier: "nano", size: "S" },
    ],
  },
  {
    family: "claude",
    group: "size",
    tiers: [
      { tier: "fable", size: "L" },
      { tier: "opus", size: "L" },
      { tier: "sonnet", size: "M" },
      { tier: "haiku", size: "S" },
    ],
  },
  {
    family: "gemini",
    group: "planner-worker",
    tiers: [
      { tier: "argon", role: "planner" },
      { tier: "pro-preview", role: "planner" },
      { tier: "pro", role: "planner" },
      { tier: "flash", role: "worker" },
      { tier: "flash-lite", role: "worker" },
    ],
  },
  {
    family: "glm",
    group: "planner-worker",
    tiers: [
      { tier: "", role: "planner" },
      { tier: "flash", role: "worker" },
    ],
  },
  {
    family: "minimax",
    group: "planner-worker",
    tiers: [
      { tier: "highspeed", role: "planner" },
      { tier: "", role: "planner" },
      { tier: "flash", role: "worker" },
    ],
  },
  {
    family: "qwen",
    group: "size",
    tiers: [
      { tier: "max", size: "L" },
      { tier: "plus", size: "M" },
      { tier: "flash", size: "S" },
    ],
  },
  {
    family: "deepseek",
    group: "planner-worker",
    tiers: [{ tier: "pro", role: "planner" }],
  },
  {
    family: "mimo",
    group: "planner-worker",
    tiers: [
      { tier: "pro-ultraspeed", role: "planner" },
      { tier: "pro", role: "planner" },
      { tier: "", role: "planner" },
      { tier: "flash", role: "worker" },
    ],
  },
];
