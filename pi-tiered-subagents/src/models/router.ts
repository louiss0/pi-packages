/**
 * Role-aware model selection on data-only family ladders.
 *
 * Resolve the role's size/class target first, then try that rung and cheaper
 * rungs in capability order, followed by approved links. Names only locate a
 * parent; group/size/class come from profile data, never name heuristics.
 * Versions are crossed only through links on the rungs visited. Only models
 * the session can run may win; an exhausted walk retains the parent.
 */

import type { Model } from "@earendil-works/pi-ai";
import type {
  FamilyProfile,
  ModelCandidate,
  ModelSize,
  ModelClass,
  TierRef,
  TierProfile,
} from "#src/models/profile";
import { policyFor } from "#src/models/role-policy";
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
  agentId = "worker",
): RoutingOutcome {
  const policy = policyFor(agentId);
  const intent = `${agentId} targets ${policy.size} size / ${policy.class} class`;
  if (!parent) {
    return {
      kind: "retained",
      model: undefined,
      reason: `${intent}: the parent has no model to route from`,
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
      reason: `${intent}: the ${strategy.family} family has no profile; keeping ${parent.id}`,
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
      reason: `${intent}: the ${strategy.family} family has no profile for version ${parts?.version ?? "the model's"}; keeping ${parent.id}`,
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
      reason: `${intent}: the ${strategy.family} ${version.version} ladder does not name the tier of "${parent.id}"; keeping the parent`,
    };
  }

  const parentTier = version.tiers.find((candidate) => candidate.tier === tier);
  const target =
    profile.group === "planner-worker"
      ? policy.class
      : policy.size === "equal"
        ? parentTier?.size
        : policy.size === "one-below"
          ? sizeBelow(parentTier?.size)
          : policy.size;
  const matchesTarget = (candidate: TierProfile) =>
    profile.group === "size"
      ? candidate.size === target
      : candidate.class === target;
  const targetTier =
    profile.group === "size" && policy.size === "equal"
      ? parentTier
      : version.tiers.find(matchesTarget);
  const available = indexAvailable(context.available);
  const runnableFrom = (start: TierRef) =>
    walkLadder(profile, start, new Set(), (candidate, ref) => {
      // Links may expose a higher class solely to make another role's target
      // reachable (flash-only Gemini -> pro). That is not a cheaper fallback.
      const label = profile.group === "size" ? candidate.size : candidate.class;
      if (!label || !target || CAPABILITY[label] > CAPABILITY[target])
        return undefined;
      const selected = pickAvailable(candidate.models, available);
      return selected ? { ...selected, tier: ref } : undefined;
    });
  const found = targetTier
    ? runnableFrom({ version: version.version, tier: targetTier.tier })
    : walkLadder(
        profile,
        { version: version.version, tier },
        new Set(),
        (candidate, ref) =>
          matchesTarget(candidate) ? runnableFrom(ref) : undefined,
      );
  if (!found) {
    return {
      kind: "retained",
      model: parent,
      reason: `${agentId} targets ${target}: no runnable target or lower ${strategy.family} tier; keeping ${parent.id}`,
    };
  }

  return {
    kind: "routed",
    model: found.model,
    provider: found.candidate.provider,
    modelId: found.candidate.id,
    tier: `${strategy.family} ${found.tier.version} tier ${found.tier.tier || "default"}`,
    reason: `${agentId} targets ${target}: ${parent.id} → ${found.candidate.id} (${strategy.family} ${found.tier.version} tier ${found.tier.tier || "default"})`,
  };
}

/** Labels order fallback capability only within their own family group. */
const CAPABILITY = {
  S: 0,
  M: 1,
  L: 2,
  worker: 0,
  planner: 1,
} as const satisfies Record<ModelSize | ModelClass, number>;

/** The smallest size is a floor, never an invented rung below S. */
function sizeBelow(size: ModelSize | undefined): ModelSize | undefined {
  return size === "L" ? "M" : size === undefined ? undefined : "S";
}

/**
 * Visit the starting rung and cheaper same-version rungs before their links.
 * The same order resolves missing targets and finds runnable models, without
 * ever comparing version numbers or inventing a cross-version relationship.
 */
function walkLadder<T>(
  profile: FamilyProfile,
  from: TierRef,
  visited: Set<string>,
  pick: (tier: TierProfile, ref: TierRef) => T | undefined,
): T | undefined {
  const version = profile.versions.find(
    (candidate) => candidate.version === from.version,
  );
  if (!version) return undefined;
  const index = version.tiers.findIndex((tier) => tier.tier === from.tier);
  if (index === -1) return undefined;

  const rungs = version.tiers
    .slice(index)
    .filter((tier) => !visited.has(`${version.version}/${tier.tier}`));
  for (const tier of rungs) {
    const ref = { version: version.version, tier: tier.tier };
    visited.add(`${ref.version}/${ref.tier}`);
    const found = pick(tier, ref);
    if (found !== undefined) return found;
  }
  for (const tier of rungs) {
    for (const fallback of tier.fallbacks ?? []) {
      const found = walkLadder(profile, fallback, visited, pick);
      if (found !== undefined) return found;
    }
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

/** The tier names a model's id carries — for a message. */
export function tierNamesOf(candidates: readonly string[]): string[] {
  return candidateJoins(candidates).filter((join) => join !== "");
}
