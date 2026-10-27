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
 * - **Only declared data is read.** Unknown fields are rejected rather than
 *   ignored, so a misspelled key cannot silently lose configuration. The one
 *   exception is obsolete tier-level `fallbacks`, which is accepted and
 *   discarded.
 * - **A family with no naming structure is refused.** A profile may refine a
 *   family the package can read, and nothing else.
 *
 * The profiles live in the runtime's settings file, which the settings module
 * owns: this module reads the *data* it hands over and validates it, and never
 * touches a file of its own.
 */

import type { FamilyProfile, ProfileIssue } from "#src/models/profile";
import {
  parseProfileData,
  tierLabelProblems,
  validateProfile,
} from "#src/models/profile";
import type { FamilyStrategy } from "#src/models/strategy";

/** The profiles in effect, and what was wrong with the ones that were not. */
export type LoadedProfiles = Readonly<{
  /** The profiles, by family. */
  readonly profiles: Map<string, FamilyProfile>;
  /** The problems found in the operator's profiles, if any. */
  readonly problems: string[];
}>;

/**
 * Merge the shipped profiles with the operator's.
 *
 * The shipped profiles come first; the global layer replaces a family whole;
 * the project layer replaces a family whole. A family the operator did not
 * name keeps the shipped profile.
 */
export function mergeProfiles(
  shipped: ReadonlyArray<FamilyProfile>,
  global: ReadonlyArray<FamilyProfile>,
  project: ReadonlyArray<FamilyProfile>,
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
 * reported rather than used; the other families still load.
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
  const parsed = parseProfileData(family, value);
  const labelIssues = untrustedTierLabelIssues(value);
  if (!parsed.ok || labelIssues.length > 0) {
    const issues = parsed.ok ? labelIssues : [...parsed.issues, ...labelIssues];
    return { ok: false, problem: formatIssues(issues) };
  }

  return { ok: true, profile: parsed.profile };
}

/**
 * The group-specific label rules, with the tier path each problem belongs to.
 *
 * They read the untrusted value rather than the parsed profile, so a profile
 * rejected for another structural problem still reports every missing label in
 * the same message. They are structural rather than routing-domain rules: a
 * tier without the label its family group requires cannot describe a usable
 * rung at all.
 */
function untrustedTierLabelIssues(value: unknown): ProfileIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const group = raw.group;
  if (group !== "size" && group !== "planner-worker") return [];
  if (!Array.isArray(raw.versions)) return [];

  const issues: ProfileIssue[] = [];
  raw.versions.forEach((version, versionIndex) => {
    if (!version || typeof version !== "object") return;
    const tiers = (version as Record<string, unknown>).tiers;
    if (!Array.isArray(tiers)) return;
    tiers.forEach((tier, tierIndex) => {
      if (!tier || typeof tier !== "object") return;
      for (const label of tierLabelProblems(group, tier)) {
        issues.push({
          path: ["versions", versionIndex, "tiers", tierIndex, label.field],
          message: label.problem,
        });
      }
    });
  });
  return issues;
}

/** One deterministic, path-aware sentence per rejected family. */
function formatIssues(issues: ReadonlyArray<ProfileIssue>): string {
  return [...issues]
    .sort(compareProfileIssues)
    .map((issue) => {
      const path = formatProfilePath(issue.path);
      return `${path || "profile"}: ${issue.message}`;
    })
    .join("; ");
}

/** Render a path, e.g. `versions[0].tiers[1].models[0].id`. */
function formatProfilePath(path: ReadonlyArray<string | number>): string {
  return path.reduce<string>(
    (rendered, segment) =>
      typeof segment === "number"
        ? `${rendered}[${segment}]`
        : rendered
          ? `${rendered}.${segment}`
          : segment,
    "",
  );
}

/** Order issues deterministically, comparing array indexes numerically. */
function compareProfileIssues(a: ProfileIssue, b: ProfileIssue): number {
  const length = Math.max(a.path.length, b.path.length);
  for (let index = 0; index < length; index++) {
    const left = a.path[index];
    const right = b.path[index];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    const leftText = String(left);
    const rightText = String(right);
    if (leftText !== rightText) return leftText < rightText ? -1 : 1;
  }
  if (a.message === b.message) return 0;
  return a.message < b.message ? -1 : 1;
}
