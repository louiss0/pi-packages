/**
 * user-profiles.ts — The family profiles an operator writes.
 *
 * A profile is data: the same shape the shipped profiles have. An operator may
 * replace a shipped family wholesale, or add a family the package has a naming
 * structure for.
 *
 * Three rules, and they are the point of the module:
 *
 * - **A family is replaced, not merged.** A profile that names "gpt" is the
 *   whole gpt profile; it does not inherit the shipped rungs it does not
 *   mention, and it does not disturb the other families.
 * - **Only data is read.** A value the schema does not know is ignored, never
 *   evaluated: there is no matcher, no pattern, and no parser to run.
 * - **A family with no naming structure is refused.** A profile may refine a
 *   family the package can read, and nothing else.
 *
 * The profiles live in the runtime's settings file, which the settings module
 * owns: this module reads the *data* it hands over and validates it, and never
 * touches a file of its own.
 */

import type { FamilyProfile, ModelClass, ModelSize } from "#src/models/profile";
import { tierLabelProblems, validateProfile } from "#src/models/profile";
import type { FamilyStrategy } from "#src/models/strategy";

/** The profiles in effect, and what was wrong with the ones that were not. */
export interface LoadedProfiles {
  /** The profiles, by family. */
  readonly profiles: Map<string, FamilyProfile>;
  /** The problems found in the operator's profiles, if any. */
  readonly problems: string[];
}

/**
 * Merge the shipped profiles with the operator's.
 *
 * The shipped profiles come first; the global layer replaces a family whole;
 * the project layer replaces a family whole. A family the operator did not
 * name keeps the shipped profile.
 */
export function mergeProfiles(
  shipped: readonly FamilyProfile[],
  global: readonly FamilyProfile[],
  project: readonly FamilyProfile[],
  strategies: ReadonlyMap<string, FamilyStrategy>,
): LoadedProfiles {
  const profiles = new Map<string, FamilyProfile>();
  for (const profile of shipped) profiles.set(profile.family, profile);

  const problems: string[] = [];
  for (const [layer, layerProfiles] of [
    ["global", global],
    ["project", project],
  ] as const) {
    for (const profile of layerProfiles) {
      const found = validateProfile(profile, strategies.get(profile.family));
      if (found.length > 0) {
        problems.push(
          ...found.map(
            (problem) =>
              `The ${layer} ${profile.family} profile is not usable: ${problem.problem} (at ${problem.where}).`,
          ),
        );
        continue;
      }
      profiles.set(profile.family, profile);
    }
  }

  return { profiles, problems };
}

/**
 * Read the operator's profiles out of the settings data.
 *
 * The data is the `familyProfiles` object of the settings file, already merged
 * per family by the settings module. A family whose profile cannot be read is
 * reported rather than used.
 */
export function parseUserProfiles(raw: unknown): {
  profiles: FamilyProfile[];
  problems: string[];
} {
  if (!raw || typeof raw !== "object") return { profiles: [], problems: [] };

  const profiles: FamilyProfile[] = [];
  const problems: string[] = [];
  for (const [family, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const parsed = parseProfile(family, value);
    if (parsed.ok) {
      profiles.push(parsed.profile);
      continue;
    }
    problems.push(`The ${family} profile is not usable: ${parsed.problem}.`);
  }
  return { profiles, problems };
}

/** Read one family profile out of the settings data. */
export function parseProfile(
  family: string,
  value: unknown,
): { ok: true; profile: FamilyProfile } | { ok: false; problem: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problem: "a profile is an object" };
  }
  const raw = value as Record<string, unknown>;
  const group = raw.group;
  if (group !== "size" && group !== "planner-worker") {
    return {
      ok: false,
      problem: 'a profile needs a group: "size" or "planner-worker"',
    };
  }
  const versions = raw.versions;
  if (!Array.isArray(versions)) {
    return { ok: false, problem: "a profile needs a versions list" };
  }

  const parsedVersions: MutableVersion[] = [];
  for (const entry of versions) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, problem: "a version is an object" };
    }
    const version = entry as Record<string, unknown>;
    if (typeof version.version !== "string") {
      return { ok: false, problem: "a version needs a version name" };
    }
    if (!Array.isArray(version.tiers)) {
      return { ok: false, problem: "a version needs a tiers list" };
    }
    const tiers: MutableTier[] = [];
    for (const tierEntry of version.tiers) {
      if (!tierEntry || typeof tierEntry !== "object") {
        return { ok: false, problem: "a tier is an object" };
      }
      const tier = tierEntry as Record<string, unknown>;
      if (typeof tier.tier !== "string") {
        return { ok: false, problem: "a tier needs a tier name" };
      }
      const labelProblem = tierLabelProblems(group, tier)[0];
      if (labelProblem) return { ok: false, problem: labelProblem };
      const size = tier.size;
      const modelClass = tier.class;
      if (!Array.isArray(tier.models)) {
        return { ok: false, problem: "a tier needs a models list" };
      }
      const models: { provider: string; id: string }[] = [];
      for (const model of tier.models) {
        if (!model || typeof model !== "object") {
          return { ok: false, problem: "a model is an object" };
        }
        const candidate = model as Record<string, unknown>;
        if (
          typeof candidate.provider !== "string" ||
          typeof candidate.id !== "string"
        ) {
          return {
            ok: false,
            problem: "a model needs a provider and an id",
          };
        }
        models.push({ provider: candidate.provider, id: candidate.id });
      }
      tiers.push({
        tier: tier.tier,
        ...(size === "S" || size === "M" || size === "L" ? { size } : {}),
        ...(modelClass === "planner" || modelClass === "worker"
          ? { class: modelClass }
          : {}),
        models,
      });
    }
    parsedVersions.push({ version: version.version, tiers });
  }

  return { ok: true, profile: { family, group, versions: parsedVersions } };
}

/** A version as the settings data is read into. */
interface MutableVersion {
  version: string;
  tiers: MutableTier[];
}

/** A tier as the settings data is read into. */
interface MutableTier {
  tier: string;
  size?: ModelSize;
  class?: ModelClass;
  models: { provider: string; id: string }[];
}
