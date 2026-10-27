/**
 * Role-aware model selection on data-only family ladders.
 *
 * Resolve the role's size/class target first, then try that rung and cheaper
 * rungs within the parent's exact family and version. Names only locate a
 * parent; group/size/class come from profile data, never name heuristics.
 * Versions are never crossed. Only models the session can run may win; an
 * unknown family or exhausted version ladder retains the parent.
 */

import type { Model } from "@earendil-works/pi-ai";
import type {
  FamilyProfile,
  ModelCandidate,
  TierProfile,
} from "#src/models/profile";
import { policyFor } from "#src/models/role-policy";
import {
  createRoutingTarget,
  type RoutingTarget,
} from "#src/models/routing-target";
import {
  candidateJoins,
  type FamilyStrategy,
  mostSpecificTier,
} from "#src/models/strategy";

/** The models the session can run, and the profiles and strategies to use. */
export type RoutingContext = Readonly<{
  /** The models the session can run, as the session's own resolution reports them. */
  available: ReadonlyArray<Model<any>>;
  /** The family profiles, by family. */
  profiles: ReadonlyMap<string, FamilyProfile>;
  /** The naming structures, by family. */
  strategies: ReadonlyMap<string, FamilyStrategy>;
}>;

/** The ladders the routing walks: the profiles and the naming structures. */
export type RoutingLadders = Readonly<{
  profiles: ReadonlyMap<string, FamilyProfile>;
  strategies: ReadonlyMap<string, FamilyStrategy>;
}>;

/**
 * Build a routing context for the models the session can run right now.
 *
 * The available models are a session fact, so the context is built per
 * selection rather than held.
 */
export function routingContext(
  ladders: RoutingLadders,
  available: ReadonlyArray<Model<any>>,
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
      kind: "retained",
      model: parent,
      reason: `${intent}: ${parent.id} belongs to an unknown family; keeping the parent model`,
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

  const parentTierName = mostSpecificTier(
    parts?.tierCandidates ?? [],
    version.tiers.map((candidate) => candidate.tier),
  );
  const parentTier = version.tiers.find(
    (candidate) => candidate.tier === parentTierName,
  );
  if (!parentTier) {
    return {
      kind: "retained",
      model: parent,
      reason: `${intent}: the ${strategy.family} ${version.version} ladder does not name the tier of "${parent.id}"; keeping the parent`,
    };
  }

  const routingTarget = createRoutingTarget(profile.group, policy, parentTier);
  if (!routingTarget) {
    return {
      kind: "retained",
      model: parent,
      reason: `${intent}: the parent tier has no size label; keeping ${parent.id}`,
    };
  }
  const startingTier = routingTarget.startingTier(version, parentTier);
  const candidateTiers = startingTier
    ? version.tiers.slice(version.tiers.indexOf(startingTier))
    : [];
  const found = pickRunnableTier(
    candidateTiers,
    routingTarget,
    indexAvailable(context.available),
  );
  if (!found) {
    return {
      kind: "retained",
      model: parent,
      reason: `${agentId} targets ${routingTarget.label}: no runnable target or cheaper tier in ${strategy.family} ${version.version}; keeping ${parent.id}`,
    };
  }

  return {
    kind: "routed",
    model: found.model,
    provider: found.candidate.provider,
    modelId: found.candidate.id,
    tier: `${strategy.family} ${version.version} tier ${found.tierName || "default"}`,
    reason: `${agentId} targets ${routingTarget.label}: ${parent.id} → ${found.candidate.id} (${strategy.family} ${version.version} tier ${found.tierName || "default"})`,
  };
}

/** The first runnable target/cheaper rung within the one selected version. */
function pickRunnableTier(
  tiers: ReadonlyArray<TierProfile>,
  target: RoutingTarget,
  available: ReadonlyMap<string, Model<any>>,
) {
  for (const tier of tiers) {
    if (!target.allowsFallback(tier)) continue;
    const selected = pickAvailable(tier.models, available);
    if (selected) return { ...selected, tierName: tier.tier };
  }
  return undefined;
}

/** The available models, by provider and id. */
function indexAvailable(
  available: ReadonlyArray<Model<any>>,
): Map<string, Model<any>> {
  const index = new Map<string, Model<any>>();
  for (const model of available) {
    index.set(`${model.provider}/${model.id}`, model);
  }
  return index;
}

/** The first candidate of a tier the session can run. */
function pickAvailable(
  candidates: ReadonlyArray<ModelCandidate>,
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
export function tierNamesOf(candidates: ReadonlyArray<string>): string[] {
  return candidateJoins(candidates).filter((join) => join !== "");
}
