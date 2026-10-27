/**
 * profile.ts — What a family profile says, and how a malformed one is
 * rejected.
 *
 * A profile is data: the versions a family has, the tiers of each version in
 * capability order, and the concrete model ids of each tier. It holds no
 * code, no matchers and no parsers, so an operator can correct it — or add a
 * family of their own — without a strategy class.
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
import { matchesTier, tierNameList } from "#src/models/strategy";

/** Capability labels used by role-aware routing. */
const MODEL_SIZES = ["S", "M", "L"] as const;
const MODEL_CLASSES = ["planner", "worker"] as const;
const FAMILY_GROUPS = ["size", "planner-worker"] as const;

export type ModelSize = (typeof MODEL_SIZES)[number];
export type ModelClass = (typeof MODEL_CLASSES)[number];
export type FamilyGroup = (typeof FAMILY_GROUPS)[number];

/** A provider and model id, both trimmed and non-empty. */
const modelCandidateSchema = v.strictObject({
  provider: v.pipe(v.string(), v.trim(), v.minLength(1)),
  id: v.pipe(v.string(), v.trim(), v.minLength(1)),
});

/** A concrete model: the provider that serves it and its id there. */
export type ModelCandidate = Readonly<
  v.InferOutput<typeof modelCandidateSchema>
>;

/**
 * One rung of a version's ladder.
 *
 * The tier's name is how the parent's model is located on the ladder. The
 * empty name is the version's default model — the one whose id names no tier
 * of its own.
 *
 * Obsolete tier-level `fallbacks` are accepted and discarded: they predate
 * version-local routing, and rejecting them would strand profiles written for
 * an older release.
 */
const tierProfileSchema = v.pipe(
  v.strictObject({
    tier: v.pipe(v.string(), v.trim()),
    /** Required for a size-group family. */
    size: v.exactOptional(v.picklist(MODEL_SIZES)),
    /** Required for a planner-worker family. */
    class: v.exactOptional(v.picklist(MODEL_CLASSES)),
    /** The concrete models of this tier, most preferred first. */
    models: v.array(modelCandidateSchema),
    /** Obsolete; accepted and discarded. Contents are never read. */
    fallbacks: v.optional(v.unknown()),
  }),
  v.transform(({ fallbacks: _fallbacks, ...tier }) => tier),
);

type TierProfileOutput = v.InferOutput<typeof tierProfileSchema>;

type TierProfileLabels = {
  size?: Exclude<TierProfileOutput["size"], undefined>;
  class?: Exclude<TierProfileOutput["class"], undefined>;
};

export type TierProfile = Readonly<
  Omit<TierProfileOutput, "size" | "class" | "models"> &
    TierProfileLabels & {
      readonly models: ReadonlyArray<ModelCandidate>;
    }
>;

/** One version of a family. */
const versionProfileSchema = v.strictObject({
  version: v.pipe(v.string(), v.trim(), v.minLength(1)),
  /** The tiers, most capable first. */
  tiers: v.array(tierProfileSchema),
});

export type VersionProfile = Readonly<
  Omit<v.InferOutput<typeof versionProfileSchema>, "tiers">
> & {
  readonly tiers: ReadonlyArray<TierProfile>;
};

const profileBodySchema = v.strictObject({
  /** Which capability labels govern this family. */
  group: v.picklist(FAMILY_GROUPS),
  /** The versions, most recent first. */
  versions: v.array(versionProfileSchema),
});

type ProfileBodyOutput = v.InferOutput<typeof profileBodySchema>;

export type FamilyProfile = Readonly<
  Omit<ProfileBodyOutput, "versions"> & {
    /** The family this profile describes, e.g. "gpt". */
    family: string;
    versions: ReadonlyArray<VersionProfile>;
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
  class?: unknown;
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

/** Shared label rules for settings parsing and complete-profile validation. */
/** A missing or invalid group label, and the field it belongs to. */
type TierLabelProblem = Readonly<{
  field: "size" | "class";
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
    (group === "planner-worker" || labels.class !== undefined) &&
    labels.class !== "planner" &&
    labels.class !== "worker"
  ) {
    problems.push({
      field: "class",
      problem: 'a planner-worker tier needs a class: "planner" or "worker"',
    });
  }
  return problems;
}

/**
 * Check a profile against the family's naming structure.
 *
 * Returns the problems; an empty list means the profile is usable. The checks
 * are the ones that keep a profile from creating relationships nobody wrote:
 *
 * - the family is a plain identifier with a supported group;
 * - every tier carries the label required by that group;
 * - the versions and the tiers within a version are unique;
 * - every model names a provider and an id;
 * - every model belongs to this family, at this version, and to the tier it
 *   is listed under.
 */
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
  if (profile.versions.length === 0) {
    problems.push({
      where: profile.family,
      problem: "a profile needs a version",
    });
  }

  if (profile.group !== "size" && profile.group !== "planner-worker") {
    problems.push({
      where: profile.family,
      problem: 'a profile needs a group: "size" or "planner-worker"',
    });
  }

  const seenVersions = new Set<string>();
  for (const version of profile.versions) {
    const where = `${profile.family} ${version.version}`;
    if (seenVersions.has(version.version)) {
      problems.push({ where, problem: "the version is listed twice" });
    }
    seenVersions.add(version.version);

    if (version.tiers.length === 0) {
      problems.push({ where, problem: "a version needs a tier" });
    }

    const seenTiers = new Set<string>();
    for (const tier of version.tiers) {
      const tierWhere = `${where} tier "${tier.tier}"`;
      problems.push(
        ...tierLabelProblems(profile.group, tier).map(({ problem }) => ({
          where: tierWhere,
          problem,
        })),
      );
      if (seenTiers.has(tier.tier)) {
        problems.push({
          where: tierWhere,
          problem: "the tier is listed twice",
        });
      }
      seenTiers.add(tier.tier);

      if (tier.models.length === 0) {
        problems.push({ where: tierWhere, problem: "a tier needs a model" });
      }
      for (const model of tier.models) {
        if (!model.provider || !model.id) {
          problems.push({
            where: tierWhere,
            problem: "a model needs a provider and an id",
          });
          continue;
        }
        if (!strategy) continue;
        const parsed = strategy.parse(model.id);
        if (!parsed) {
          problems.push({
            where: tierWhere,
            problem: `"${model.id}" does not follow the ${profile.family} naming structure`,
          });
          continue;
        }
        // A model that names a version must name this one; a model that names
        // no version at all is placed by the profile, which is the only place
        // that relationship can be written down.
        if (
          parsed.version !== undefined &&
          parsed.version !== version.version
        ) {
          problems.push({
            where: tierWhere,
            problem: `"${model.id}" is version ${parsed.version}, not ${version.version}`,
          });
        }
        if (!matchesTier(parsed.tierCandidates, tier.tier)) {
          problems.push({
            where: tierWhere,
            problem: `"${model.id}" is not in the tier "${tier.tier}" (it names ${describeCandidates(parsed.tierCandidates)})`,
          });
        }
      }
    }
  }

  return problems;
}

/** The tier names a model's id carries, for a problem message. */
function describeCandidates(candidates: ReadonlyArray<string>): string {
  const names = tierNameList(candidates);
  return names.length > 0 ? names.join(", ") : "no tier";
}
