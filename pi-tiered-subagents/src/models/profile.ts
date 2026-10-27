/**
 * profile.ts — What a family profile says, and how a malformed one is
 * rejected.
 *
 * A profile is data: the versions a family has, the tiers of each version in
 * capability order, the concrete model ids of each tier, and the versions a
 * family may cross into. It holds no code, no matchers and no parsers, so an
 * operator can correct it — or add a family of their own — without a
 * strategy class.
 *
 * The rules a profile must satisfy are checked when it is read, not when it is
 * used: a malformed profile is reported, rather than quietly creating a
 * routing relationship nobody wrote down.
 */

import type { FamilyStrategy } from "#src/models/strategy";
import { matchesTier, tierNameList } from "#src/models/strategy";

/** Capability labels used by role-aware routing. */
export type ModelSize = "S" | "M" | "L";
export type ModelClass = "planner" | "worker";
export type FamilyGroup = "size" | "planner-worker";

/** A concrete model: the provider that serves it and its id there. */
export interface ModelCandidate {
  readonly provider: string;
  readonly id: string;
}

/** A tier of a family's ladder: a version and a tier within it. */
export interface TierRef {
  readonly version: string;
  readonly tier: string;
}

/**
 * One rung of a version's ladder.
 *
 * The tier's name is how the parent's model is located on the ladder. The
 * empty name is the version's default model — the one whose id names no tier
 * of its own.
 */
export interface TierProfile {
  readonly tier: string;
  /** Required for a size-group family. */
  readonly size?: ModelSize;
  /** Required for a planner-worker family. */
  readonly class?: ModelClass;
  /** The concrete models of this tier, most preferred first. */
  readonly models: readonly ModelCandidate[];
  /**
   * The rungs this one may fall back to, most preferred first.
   *
   * A version is only ever crossed when the profile says so: the router walks
   * the parent's own version first, and crosses only into a rung named here.
   * The link is explicit because the tiers of two versions are not
   * comparable by name — one version's cheapest line may be dearer than
   * another's.
   */
  readonly fallbacks?: readonly TierRef[];
}

/** One version of a family. */
export interface VersionProfile {
  readonly version: string;
  /** The tiers, most capable first. */
  readonly tiers: readonly TierProfile[];
}

/** One family's ladder. */
export interface FamilyProfile {
  /** The family this profile describes, e.g. "gpt". */
  readonly family: string;
  /** Which capability labels govern this family. */
  readonly group: FamilyGroup;
  /** The versions, most recent first. */
  readonly versions: readonly VersionProfile[];
}

/** A profile that failed to read, and why. */
export interface ProfileProblem {
  /** Where the problem is, e.g. `gpt 6.1 tier "sol"`. */
  readonly where: string;
  /** What is wrong. */
  readonly problem: string;
}

/** Untrusted labels read from a tier before its profile is accepted. */
interface TierLabels {
  readonly size?: unknown;
  readonly class?: unknown;
}

/** Shared label rules for settings parsing and complete-profile validation. */
export function tierLabelProblems(
  group: FamilyGroup,
  labels: TierLabels,
): string[] {
  const problems: string[] = [];
  if (
    (group === "size" || labels.size !== undefined) &&
    labels.size !== "S" &&
    labels.size !== "M" &&
    labels.size !== "L"
  ) {
    problems.push('a size-group tier needs a size: "S", "M", or "L"');
  }
  if (
    (group === "planner-worker" || labels.class !== undefined) &&
    labels.class !== "planner" &&
    labels.class !== "worker"
  ) {
    problems.push('a planner-worker tier needs a class: "planner" or "worker"');
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
        ...tierLabelProblems(profile.group, tier).map((problem) => ({
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

      for (const fallback of tier.fallbacks ?? []) {
        const target = profile.versions.find(
          (candidate) => candidate.version === fallback.version,
        );
        if (!target) {
          problems.push({
            where: tierWhere,
            problem: `the fallback version "${fallback.version}" is not in the profile`,
          });
          continue;
        }
        if (
          !target.tiers.some((candidate) => candidate.tier === fallback.tier)
        ) {
          problems.push({
            where: tierWhere,
            problem: `the fallback tier "${fallback.tier}" is not in version ${fallback.version}`,
          });
        }
      }
    }
  }

  return problems;
}

/** The tier names a model's id carries, for a problem message. */
function describeCandidates(candidates: readonly string[]): string {
  const names = tierNameList(candidates);
  return names.length > 0 ? names.join(", ") : "no tier";
}
