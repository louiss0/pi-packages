/**
 * strategy.ts — How a model id is read.
 *
 * A family's ids follow a naming structure, and the structure differs between
 * families: `gpt-6.1-sol` puts the version before the tier, `claude-opus-5`
 * puts the line first, `qwen3.7-max` glues the version to the prefix, and
 * `MiniMax-M2.7` capitalizes. A strategy knows one family's structure and
 * reports the parts a profile's ladder is written in.
 *
 * A strategy also constructs the exact candidate ID from a version and tier.
 * It does not know capability labels, ladder order, or session availability.
 * Those remain profile data and session facts, respectively.
 */

/** The parts of a model id, as the family's naming structure reads them. */
export type ParsedModelId = Readonly<{
  /** The family the id belongs to, e.g. "gpt". */
  family: string;
  /** The version, when the naming structure carries one, e.g. "6.1". */
  version?: string;
  /**
   * The segments that could name a tier, in order.
   *
   * A tier name may be one segment ("sol") or several joined ("flash-lite"),
   * so the profile's tier names are matched against the contiguous joins of
   * this list.
   */
  tierCandidates: ReadonlyArray<string>;
}>;

/** Reads one family's model ids. */
export interface FamilyStrategy {
  /** The family's identifier, e.g. "gpt". */
  readonly family: string;
  /**
   * Whether an id belongs to this family at all.
   *
   * A family is recognised by its naming structure's prefix, even when the id
   * does not carry a version: such a model is in a known family that the
   * profile may have no ladder for, which is a different answer from a model
   * in no family at all.
   */
  belongs(id: string): boolean;
  /**
   * Split a model id into its parts.
   *
   * Returns undefined when the id does not follow the family's naming
   * structure — an id this family cannot place is not one of its models.
   */
  parse(id: string): ParsedModelId | undefined;
  /** Construct the exact unqualified identity at one version and tier. */
  construct(version: string, tier: string): string;
}

/** A version segment: digits, optionally dotted. */
const VERSION = /^\d+(?:\.\d+)*$/;

/** A date qualifier: eight digits, as the dated snapshots carry. */
const DATE_QUALIFIER = /^\d{8}$/;

/**
 * The contiguous joins of a candidate list, shortest first.
 *
 * `["flash", "lite"]` yields "flash", "lite" and "flash-lite"; an empty list
 * yields the empty string, which is how a version's default model is named.
 */
export function candidateJoins(candidates: ReadonlyArray<string>): string[] {
  const joins: string[] = [];
  for (let start = 0; start < candidates.length; start++) {
    // The suffix from each position is the set of joins that start there, so
    // iterating the suffixes rather than an index pair keeps every segment a
    // defined value rather than a possibly-absent read.
    let joined = "";
    for (const segment of candidates.slice(start)) {
      joined = joined === "" ? segment : `${joined}-${segment}`;
      joins.push(joined);
    }
  }
  if (joins.length === 0) joins.push("");
  return joins;
}

/**
 * The segments a tier name is made of.
 *
 * The empty name is the version's default rung: a model that names no tier.
 */
export function tierSegments(tier: string): string[] {
  return tier === "" ? [] : tier.split("-");
}

/**
 * Whether a model's candidates name a tier.
 *
 * The tier's segments must be the *prefix* of the candidates: a model may
 * carry qualifiers the tier does not name — a serving variant, a dated
 * snapshot — and still belong to the tier.
 */
export function matchesTier(
  candidates: ReadonlyArray<string>,
  tier: string,
): boolean {
  const segments = tierSegments(tier);
  if (segments.length === 0) return candidates.length === 0;
  if (candidates.length < segments.length) return false;
  return segments.every((segment, index) => candidates[index] === segment);
}

/**
 * The tier names a model's id carries, longest first.
 *
 * A tier name may be one segment ("sol") or several joined ("flash-lite"),
 * and a model may qualify a tier further ("code-highspeed").
 */
export function tierNameList(candidates: ReadonlyArray<string>): string[] {
  return candidateJoins(candidates).filter((join) => join !== "");
}

/**
 * The most specific tier a model's candidates name.
 *
 * `["flash", "lite"]` is the "flash-lite" tier rather than the "flash" one, so
 * the parent's rung is located on the tier it really belongs to.
 */
export function mostSpecificTier(
  candidates: ReadonlyArray<string>,
  tiers: ReadonlyArray<string>,
): string | undefined {
  let best: string | undefined;
  for (const tier of tiers) {
    if (!matchesTier(candidates, tier)) continue;
    if (
      best === undefined ||
      tierSegments(tier).length > tierSegments(best).length
    ) {
      best = tier;
    }
  }
  return best;
}

/**
 * A family whose id is `<prefix><version>[-<variant>…]`, with the version
 * glued to the prefix.
 *
 * GPT (`gpt-6.1-sol`), Gemini (`gemini-3.1-pro`) and Qwen (`qwen3.7-max`).
 */
function gluedVersionFamily(family: string, prefix: string): FamilyStrategy {
  return {
    family,
    construct: (version, tier) =>
      `${prefix}${version}${tier ? `-${tier}` : ""}`,
    belongs: (id) => id.toLowerCase().startsWith(prefix.toLowerCase()),
    parse(id) {
      if (!id.toLowerCase().startsWith(prefix.toLowerCase())) return undefined;
      const rest = id.slice(prefix.length);
      const version = readVersion(rest);
      if (!version) return undefined;
      return {
        family,
        version: version.value,
        tierCandidates: readVariants(rest.slice(version.length)),
      };
    },
  };
}

/**
 * A family whose id is `<prefix><tag><version>[-<variant>…]`, with a letter
 * in front of the version.
 *
 * MiMo (`mimo-v2.5`), DeepSeek (`deepseek-v4.1-flash`) and
 * MiniMax (`MiniMax-M2.7`).
 */
function taggedVersionFamily(
  family: string,
  prefix: string,
  tag: string,
): FamilyStrategy {
  return {
    family,
    construct: (version, tier) =>
      `${prefix}${tag}${version}${tier ? `-${tier}` : ""}`,
    belongs: (id) => id.toLowerCase().startsWith(prefix.toLowerCase()),
    parse(id) {
      if (!id.toLowerCase().startsWith(prefix.toLowerCase())) return undefined;
      const rest = id.slice(prefix.length);
      if (!rest.toLowerCase().startsWith(tag.toLowerCase())) return undefined;
      const version = readVersion(rest.slice(tag.length));
      if (!version) return undefined;
      return {
        family,
        version: version.value,
        tierCandidates: readVariants(rest.slice(tag.length + version.length)),
      };
    },
  };
}

/**
 * A family whose id is `<prefix><line>-<version…>[-<date>]`, with the line
 * before the version.
 *
 * Claude (`claude-opus-4-5-20251001`).
 */
function lineThenVersionFamily(family: string, prefix: string): FamilyStrategy {
  return {
    family,
    construct: (version, tier) =>
      `${prefix}${tier}-${version.replaceAll(".", "-")}`,
    belongs: (id) => id.toLowerCase().startsWith(prefix.toLowerCase()),
    parse(id) {
      if (!id.toLowerCase().startsWith(prefix.toLowerCase())) return undefined;
      const segments = id.slice(prefix.length).split("-");
      const line = segments[0];
      if (!line || VERSION.test(line)) return undefined;

      // The version is the run of numeric segments after the line; a dated
      // snapshot's date is a qualifier, not a version.
      const versionParts: string[] = [];
      const variants: string[] = [];
      let seenQualifier = false;
      for (const segment of segments.slice(1)) {
        // A dated snapshot's date is a qualifier, not a version part.
        if (DATE_QUALIFIER.test(segment)) {
          seenQualifier = true;
          continue;
        }
        if (!seenQualifier && VERSION.test(segment)) {
          versionParts.push(segment);
          continue;
        }
        seenQualifier = true;
        variants.push(segment);
      }
      if (versionParts.length === 0) return undefined;

      return {
        family,
        version: versionParts.join("."),
        tierCandidates: [line, ...variants],
      };
    },
  };
}

/**
 * Read a leading version from a string.
 *
 * Returns the version and its length, so the caller can read the variants that
 * follow it.
 */
function readVersion(
  text: string,
): { value: string; length: number } | undefined {
  const match = /^\d+(?:\.\d+)*/.exec(text);
  if (!match) return undefined;
  // The version ends at a segment boundary: `gpt-4o` is not version 4 of
  // something, and `gpt-4.1` is.
  const next = text[match[0].length];
  if (next !== undefined && next !== "-") return undefined;
  return { value: match[0], length: match[0].length };
}

/** Read the variant segments that follow a version, dropping dated qualifiers. */
function readVariants(text: string): string[] {
  if (!text.startsWith("-")) return [];
  return text
    .slice(1)
    .split("-")
    .filter((segment) => segment.length > 0 && !DATE_QUALIFIER.test(segment));
}

/**
 * The strategies this package ships.
 *
 * Eight families, each with its own naming structure. A profile may refine
 * any of them; a family outside this set has no structure to read, so a
 * profile for one cannot be used.
 */
export const SHIPPED_STRATEGIES: ReadonlyArray<FamilyStrategy> = [
  gluedVersionFamily("gpt", "gpt-"),
  gluedVersionFamily("gemini", "gemini-"),
  gluedVersionFamily("qwen", "qwen"),
  gluedVersionFamily("glm", "glm-"),
  taggedVersionFamily("mimo", "mimo-", "v"),
  taggedVersionFamily("deepseek", "deepseek-", "v"),
  taggedVersionFamily("minimax", "MiniMax-", "M"),
  lineThenVersionFamily("claude", "claude-"),
];

/** The strategies, by family. */
export function strategiesByFamily(
  strategies: ReadonlyArray<FamilyStrategy>,
): Map<string, FamilyStrategy> {
  return new Map(strategies.map((strategy) => [strategy.family, strategy]));
}
