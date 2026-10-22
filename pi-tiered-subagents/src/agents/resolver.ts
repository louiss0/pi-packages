/**
 * resolver.ts — The one resolver both spawn doors use.
 *
 * The tool door and the programmatic service door ask the same question in
 * different words: given what the caller asked for, what the definition named,
 * and what the session can run, what does this launch resolve to?
 *
 * Both doors translate their own inputs into a {@link SpawnRequest}, and this
 * module is the single place that answers it. The tool door validates its tool
 * call and resolves the type through the registry; the service door resolves it
 * through its own collaborator. Everything past that — the merge, the automatic
 * routing, the reasoning level, the advisories — is one implementation, so the
 * two doors cannot drift apart on what a launch resolved to.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "#src/agents/definition";
import { resolveInvocation } from "#src/agents/invocation";
import { type SubagentThinkingLevel } from "#src/config/thinking-level";
import { type ModelSelection } from "#src/models/selection";
import { resolveLaunchModel } from "#src/models/launch";
import type { ModelRegistry } from "#src/models/registry";
import type { RoutingLadders } from "#src/models/router";
import { type ThinkingDecision } from "#src/thinking/resolve";
import {
  isBelowMinimumTurns,
  MIN_MAX_TURNS,
  resolveTurnPolicy,
  type TurnPolicy,
} from "#src/lifecycle/turn-limits";
import type { SubagentType, ThinkingLevel } from "#src/types";
import {
  type AgentDetails,
  buildInvocationTags,
  modelLabel,
} from "#src/ui/display";

/** Model info extracted from the parent session context. */
export interface ModelInfo {
  parentModel: Model<any> | undefined;
  modelRegistry: ModelRegistry | undefined;
  /** The routing ladders the automatic model selection walks. */
  ladders: RoutingLadders;
  /** The effort the parent was running at, when the parent has one. */
  parentThinkingLevel?: ThinkingLevel;
}

/** Identity: who is being spawned. */
export interface SpawnIdentity {
  subagentType: string;
  rawType: SubagentType;
  displayName: string;
  /** The definition the request resolved to. */
  definition: AgentDefinition;
}

/** Execution: how the agent will run. */
export interface SpawnExecution {
  prompt: string;
  description: string;
  model: Model<any> | undefined;
  /** How the model was chosen, and why. */
  modelSelection: ModelSelection;
  /** The reasoning level, and what was decided about it. */
  thinkingDecision: ThinkingDecision;
  /**
   * The run's turn ceiling, resolved once here.
   *
   * A closed decision with no unresolved fallback: the child session enforces
   * this and never merges another default of its own, so a later change to the
   * operator's default cannot alter accepted work.
   */
  turnPolicy: TurnPolicy;
  thinking: ThinkingLevel | undefined;
  inheritContext: boolean;
  runInBackground: boolean;
}

/** Presentation: display/UI values derived from identity and execution. */
export interface SpawnPresentation {
  agentTags: string[];
  detailBase: Pick<
    AgentDetails,
    "displayName" | "description" | "subagentType" | "modelName" | "tags"
  >;
}

/** Fully resolved config for spawning an agent — composed of domain-aligned sub-interfaces. */
export interface ResolvedSpawnConfig {
  identity: SpawnIdentity;
  execution: SpawnExecution;
  presentation: SpawnPresentation;
  /** Model-visible advisories about how this spawn resolved. Both runners render them. */
  notes: string[];
}

/** Error result when resolution fails. */
export interface SpawnConfigError {
  error: string;
}

/**
 * The one input every spawn door feeds the resolver.
 *
 * The fields are the caller's own answers, before the definition fills the
 * ones the caller left open — the same precedence the invocation merge applies,
 * so a door that has no definition to refine from simply omits the refinements.
 */
export interface SpawnRequest {
  /** The definition the spawn names, already resolved. */
  readonly definition: AgentDefinition;
  /** The prompt for the child. */
  readonly prompt: string;
  /** The description for the record, when the caller gave one. */
  readonly description?: string;
  /** The model the caller named, when it did. */
  readonly requestedModel?: string;
  /** The reasoning level the caller named, when it did. */
  readonly requestedThinking?: SubagentThinkingLevel;
  /** The turn ceiling the caller named, before the definition fills it. */
  readonly requestedMaxTurns?: number;
  /** The caller's context preference, before the definition fills it. */
  readonly inheritContext?: boolean;
  /** The caller's background preference, before the definition fills it. */
  readonly runInBackground?: boolean;
  /** The type as the caller spelled it, before the registry normalized it. */
  readonly rawType?: SubagentType;
  /** The session facts the automatic routing reads. */
  readonly modelInfo: ModelInfo;
  /**
   * The operator's turn-budget defaults, captured with the launch.
   *
   * Read at preparation, so a queued child runs with the budget that was in
   * force when the request was made.
   */
  readonly settings: TurnSettings;
}

/** The operator's turn-budget defaults the resolver reads. */
export interface TurnSettings {
  readonly defaultMaxTurns: number | undefined;
  readonly wrapUpTurns: number;
}

/**
 * Resolve all config for spawning an agent.
 *
 * Pure function — no SDK types, no side effects.
 * Returns either a fully resolved config or an error.
 */
export function resolveSpawn(
  request: SpawnRequest,
): ResolvedSpawnConfig | SpawnConfigError {
  // The doors narrow the level before it reaches this merge; one they cannot
  // narrow is rejected there rather than clamped by the SDK down to "off".
  const resolvedInvocation = resolveInvocation(request.definition, {
    model: request.requestedModel,
    thinking: request.requestedThinking,
    maxTurns: request.requestedMaxTurns,
    inheritContext: request.inheritContext,
    runInBackground: request.runInBackground,
  });

  // Resolve the model and the reasoning level, through the same resolver the
  // invocation merge answers for: the request's own choice, then the
  // definition's, then the automatic step down the parent's ladder.
  const launch = resolveLaunchModel(
    {
      requestedModel: resolvedInvocation.modelFromParams
        ? resolvedInvocation.model
        : undefined,
      definitionModel: resolvedInvocation.modelFromParams
        ? undefined
        : resolvedInvocation.model,
      requestedThinking: request.requestedThinking,
      definitionThinking: resolvedInvocation.thinking,
    },
    {
      registry: request.modelInfo.modelRegistry,
      ladders: request.modelInfo.ladders,
      parentModel: request.modelInfo.parentModel,
      parentThinkingLevel: request.modelInfo.parentThinkingLevel,
    },
  );
  if (!launch.ok) return { error: launch.error };
  const { model, modelSelection, thinking, thinkingDecision } = launch.resolved;
  const inheritContext = resolvedInvocation.inheritContext;
  const runInBackground = resolvedInvocation.runInBackground;

  const modelName = modelLabel(model);

  // The turn ceiling, decided once: the request's, then the definition's, then
  // the operator's default, captured here so a later default change reaches
  // only the next launch.
  const turnPolicy = resolveTurnPolicy({
    resolvedMaxTurns: resolvedInvocation.maxTurns,
    defaultMaxTurns: request.settings.defaultMaxTurns,
    wrapUpTurns: request.settings.wrapUpTurns,
  });

  const { tags: invocationTags } = buildInvocationTags({
    thinking,
    maxTurns: resolvedInvocation.maxTurns,
    inheritContext,
    runInBackground,
  });
  const agentTags = invocationTags;

  const subagentType = request.definition.id;
  const displayName = request.definition.displayName;
  const description = request.description ?? request.prompt.slice(0, 80);

  return {
    identity: {
      subagentType,
      rawType: request.rawType ?? request.definition.id,
      displayName,
      definition: request.definition,
    },
    notes: [
      ...buildMinimumTurnsNote(resolvedInvocation.maxTurns),
      ...buildModelNote(modelSelection),
      ...buildThinkingNote(thinkingDecision),
    ],
    execution: {
      prompt: request.prompt,
      description,
      model,
      modelSelection,
      thinkingDecision,
      turnPolicy,
      thinking,
      inheritContext,
      runInBackground,
    },
    presentation: {
      agentTags,
      detailBase: {
        displayName,
        description,
        subagentType,
        modelName,
        tags: agentTags.length > 0 ? agentTags : undefined,
      },
    },
  };
}

/**
 * Advise that the reasoning level was not the one that was asked for, or that
 * it does not apply.
 */
function buildThinkingNote(decision: ThinkingDecision): string[] {
  if (!decision.applicable) {
    return [`Note: ${decision.reason}.`];
  }
  if (decision.clamped) {
    return [`Note: ${decision.reason}.`];
  }
  return [];
}

/**
 * Advise which model the child will run on, and say why.
 *
 * The caller did not name a model, so it cannot know which one the child
 * runs on; the launch note is where it finds out.
 */
function buildModelNote(selection: ModelSelection): string[] {
  if (selection.source === "request") return [];
  const model = selection.model;
  const named = model ? `${model.provider}/${model.id}` : "the parent's model";
  return [`Note: the child runs on ${named} — ${selection.reason}.`];
}

/**
 * Advise that the resolved max_turns was raised to the minimum.
 *
 * The value came from this call or from the agent file, and either way the caller
 * would otherwise read a budget it never got.
 */
function buildMinimumTurnsNote(maxTurns: number | undefined): string[] {
  if (!isBelowMinimumTurns(maxTurns)) return [];
  return [
    `Note: max_turns ${maxTurns} is below the minimum of ${MIN_MAX_TURNS} (one turn to work, one to answer), so the subagent runs with ${MIN_MAX_TURNS}.`,
  ];
}
