/**
 * router.ts — Choosing the model a child runs on.
 *
 * The rule is one sentence: **the parent's model, one tier down the family's
 * ladder.** Not "a cheaper model", not "a model with a similar name" — the
 * tier the profile says is below the parent's, and then the concrete id the
 * profile lists for that tier.
 *
 * The walk:
 *
 * 1. The tiers below the parent's, in the parent's own version, most capable
 *    first. Within a tier, the concrete ids in the profile's preference order.
 * 2. The tiers the profile approves as fallbacks, and their own fallbacks.
 *
 * A version is only ever crossed when the profile says so — the links are
 * written on the tier that may cross, because the tiers of two versions are
 * not comparable by name. A model is only ever chosen when the session can
 * run it: the router asks the session's model resolution, and never invents a
 * provider, a credential, or an id.
 *
 * A family the router cannot place is an error rather than a guess, and a
 * family whose ladder has nothing left to offer keeps the parent's model.
 */

import type { Model } from "@earendil-works/pi-ai";
import type {
  FamilyProfile,
  ModelCandidate,
  TierRef,
} from "#src/models/profile";
import {
  candidateJoins,
  type FamilyStrategy,
  mostSpecificTier,
} from "#src/models/strategy";

/** The models the session can run, and the profiles and strategies to use. */
export interface RoutingContext {
  /** The models the session can run, as the session's own resolution reports them. */
  readonly available: readonly Model<any>[];
  /** The family profiles, by family. */
  readonly profiles: ReadonlyMap<string, FamilyProfile>;
  /** The naming structures, by family. */
  readonly strategies: ReadonlyMap<string, FamilyStrategy>;
}

/** The ladders the routing walks: the profiles and the naming structures. */
export interface RoutingLadders {
  readonly profiles: ReadonlyMap<string, FamilyProfile>;
  readonly strategies: ReadonlyMap<string, FamilyStrategy>;
}

/**
 * Build a routing context for the models the session can run right now.
 *
 * The available models are a session fact, so the context is built per
 * selection rather than held.
 */
export function routingContext(
  ladders: RoutingLadders,
  available: readonly Model<any>[],
): RoutingContext {
  return {
    available,
    profiles: ladders.profiles,
    strategies: ladders.strategies,
  };
}

/** What the router decided. */
export type RoutingOutcome =
  | {
      readonly kind: "routed";
      /** The model the child runs on. */
      readonly model: Model<any>;
      /** The provider that serves it. */
      readonly provider: string;
      /** Its id there. */
      readonly modelId: string;
      /** The tier it came from, e.g. "gpt 6.1 tier luna". */
      readonly tier: string;
      /** A sentence for the launch note. */
      readonly reason: string;
    }
  | {
      /** The parent's model is kept: the ladder has nothing to offer. */
      readonly kind: "retained";
      readonly model: Model<any> | undefined;
      readonly reason: string;
    }
  | {
      /** The parent's model cannot be placed: the family is unknown. */
      readonly kind: "error";
      readonly error: string;
    };

/**
 * Choose the model a child should run on, given the parent's.
 *
 * The parent's model is the input; the session's available models are the
 * only candidates.
 */
export function routeModel(
  parent: Model<any> | undefined,
  context: RoutingContext,
): RoutingOutcome {
  if (!parent) {
    return {
      kind: "retained",
      model: undefined,
      reason: "the parent has no model to step down from",
    };
  }

  const strategy = strategyFor(parent.id, context);
  if (!strategy) {
    return {
      kind: "error",
      error:
        `Cannot place the model "${parent.id}" in a known family, so there is no ` +
        "automatic routing for it. Name the model explicitly to choose one.",
    };
  }

  const profile = context.profiles.get(strategy.family);
  if (!profile) {
    return {
      kind: "retained",
      model: parent,
      reason: `the ${strategy.family} family has no profile, so there is no lower tier to step down to`,
    };
  }

  const parts = strategy.parse(parent.id);
  const version = parts?.version
    ? profile.versions.find((candidate) => candidate.version === parts.version)
    : undefined;
  if (!version) {
    return {
      kind: "retained",
      model: parent,
      reason: `the ${strategy.family} family has no profile for version ${parts?.version ?? "the model's"}`,
    };
  }

  const tier = mostSpecificTier(
    parts?.tierCandidates ?? [],
    version.tiers.map((candidate) => candidate.tier),
  );
  if (tier === undefined) {
    return {
      kind: "retained",
      model: parent,
      reason: `the ${strategy.family} ${version.version} ladder does not name the tier of "${parent.id}"`,
    };
  }

  const available = indexAvailable(context.available);
  const found = walkDown(
    profile,
    { version: version.version, tier },
    available,
    new Set([`${version.version}/${tier}`]),
    false,
  );
  if (!found) {
    return {
      kind: "retained",
      model: parent,
      reason: `no lower ${strategy.family} tier is available in this session`,
    };
  }

  return {
    kind: "routed",
    model: found.model,
    provider: found.candidate.provider,
    modelId: found.candidate.id,
    tier: `${strategy.family} ${found.tier.version} tier ${found.tier.tier || "default"}`,
    reason: `${parent.id} → ${found.candidate.id} (${describeStep(found.step, strategy.family)})`,
  };
}

/** How a tier was reached. */
type Step = "below" | "fallback";

/** A model the walk found, and where it found it. */
interface Found {
  readonly candidate: ModelCandidate;
  readonly model: Model<any>;
  readonly tier: TierRef;
  readonly step: Step;
}

/**
 * Walk the ladder down from a tier.
 *
 * The tiers below it in its own version come first — a compatible lower tier
 * in the same version is preferred — and the fallbacks the profile approves
 * come after. A fallback tier is itself a candidate: it is the target the
 * profile approved.
 */
function walkDown(
  profile: FamilyProfile,
  from: TierRef,
  available: ReadonlyMap<string, Model<any>>,
  visited: ReadonlySet<string>,
  isFallback: boolean,
): Found | undefined {
  const version = profile.versions.find(
    (candidate) => candidate.version === from.version,
  );
  if (!version) return undefined;

  const index = version.tiers.findIndex((tier) => tier.tier === from.tier);
  if (index === -1) return undefined;
  const tier = version.tiers[index];
  if (!tier) return undefined;

  if (isFallback) {
    const found = pickAvailable(tier.models, available);
    if (found) {
      return {
        ...found,
        tier: { version: version.version, tier: tier.tier },
        step: "fallback",
      };
    }
  }

  for (const lower of version.tiers.slice(index + 1)) {
    const found = pickAvailable(lower.models, available);
    if (found) {
      return {
        ...found,
        tier: { version: version.version, tier: lower.tier },
        step: "below",
      };
    }
  }

  for (const fallback of tier.fallbacks ?? []) {
    const key = `${fallback.version}/${fallback.tier}`;
    if (visited.has(key)) continue;
    const found = walkDown(
      profile,
      fallback,
      available,
      new Set([...visited, key]),
      true,
    );
    if (found) return found;
  }

  return undefined;
}

/** The available models, by provider and id. */
function indexAvailable(
  available: readonly Model<any>[],
): Map<string, Model<any>> {
  const index = new Map<string, Model<any>>();
  for (const model of available) {
    index.set(`${model.provider}/${model.id}`, model);
  }
  return index;
}

/** The first candidate of a tier the session can run. */
function pickAvailable(
  candidates: readonly ModelCandidate[],
  available: ReadonlyMap<string, Model<any>>,
): { candidate: ModelCandidate; model: Model<any> } | undefined {
  for (const candidate of candidates) {
    const model = available.get(`${candidate.provider}/${candidate.id}`);
    if (model) return { candidate, model };
  }
  return undefined;
}

/** The strategy that claims a model id, if any. */
function strategyFor(
  id: string,
  context: RoutingContext,
): FamilyStrategy | undefined {
  for (const strategy of context.strategies.values()) {
    if (strategy.belongs(id)) return strategy;
  }
  return undefined;
}

/** A phrase for how the tier was reached. */
function describeStep(step: Step, family: string): string {
  return step === "below"
    ? "one tier below, in the same version"
    : `a lower tier the ${family} profile approves`;
}

/** The tier names a model's id carries — for a message. */
export function tierNamesOf(candidates: readonly string[]): string[] {
  return candidateJoins(candidates).filter((join) => join !== "");
}
