/**
 * spawn-config.ts — Pure config resolution for the Agent tool.
 *
 * Extracts all config resolution logic from execute: type resolution,
 * invocation config merge, model resolution, max-turns normalization,
 * tag building, and detail-base construction.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "#src/agents/definition";
import { resolveInvocation } from "#src/agents/invocation";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import {
  parseThinkingLevel,
  thinkingLevelError,
} from "#src/config/thinking-level";
import {
  type ModelSelection,
  type ModelSelectionResult,
  selectModel,
} from "#src/models/selection";
import type { ModelRegistry } from "#src/models/registry";
import type { RoutingContext } from "#src/models/router";
import { type ThinkingDecision, resolveThinking } from "#src/thinking/resolve";
import {
  isBelowMinimumTurns,
  MIN_MAX_TURNS,
  normalizeMaxTurns,
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
  /** The profiles and strategies the automatic routing uses. */
  routing: RoutingContext;
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
  effectiveMaxTurns: number | undefined;
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

/** Error result when model resolution fails. */
export interface SpawnConfigError {
  error: string;
}

/**
 * Resolve all config for an Agent tool invocation.
 *
 * Pure function — no SDK types, no side effects.
 * Returns either a fully resolved config or an error.
 */
export function resolveSpawnConfig(
  params: Record<string, unknown>,
  registry: AgentDefinitionLookup,
  modelInfo: ModelInfo,
  settings: { readonly defaultMaxTurns: number | undefined },
): ResolvedSpawnConfig | SpawnConfigError {
  // Validated at the door, so the merge below and every layer past it receive a
  // level the SDK recognizes rather than one it would clamp to "off" (Refs #834).
  const thinkingParam = params.thinking;
  const thinkingFromParams = parseThinkingLevel(thinkingParam);
  if (thinkingParam != null && thinkingFromParams === undefined) {
    return { error: thinkingLevelError(thinkingParam) };
  }

  const rawType = params.subagent_type as SubagentType;

  // An unknown or disabled agent is an error, never another agent: the caller
  // asked for something specific, and running a different role would answer a
  // question nobody asked.
  const selection = registry.select(rawType);
  if (!selection.ok) return { error: selection.error };
  const definition = selection.definition;
  const subagentType = definition.id;

  const displayName = definition.displayName;

  // Merge the definition's defaults with the tool-call params.
  const resolvedConfig = resolveInvocation(definition, {
    model: params.model as string | undefined,
    thinking: thinkingFromParams,
    maxTurns: params.max_turns as number | undefined,
    inheritContext: params.inherit_context as boolean | undefined,
    runInBackground: params.run_in_background as boolean | undefined,
  });

  // Resolve the model: the request's own choice, then the definition's, then
  // the automatic step down the parent's family ladder.
  const modelChoice: ModelSelectionResult = selectModel(
    {
      requestedModel: resolvedConfig.modelFromParams
        ? resolvedConfig.model
        : undefined,
      definitionModel: resolvedConfig.modelFromParams
        ? undefined
        : resolvedConfig.model,
      parentModel: modelInfo.parentModel,
    },
    modelInfo.modelRegistry,
    modelInfo.routing,
  );
  if (!modelChoice.ok) return { error: modelChoice.error };
  const model = modelChoice.selection.model;

  // The reasoning level follows the model: what a model can do is a property of
  // the model, so the level is resolved once the model is known.
  const thinkingDecision = resolveThinking({
    requested: thinkingFromParams,
    defined: resolvedConfig.thinking,
    model,
    parentLevel: modelInfo.parentThinkingLevel,
    // The parent's model was kept when nothing below it was available.
    parentModelKept: modelChoice.selection.source === "inherited",
  });
  const thinking = thinkingDecision.level;
  const inheritContext = resolvedConfig.inheritContext;
  const runInBackground = resolvedConfig.runInBackground;

  const modelName = modelLabel(model);

  const effectiveMaxTurns = normalizeMaxTurns(
    resolvedConfig.maxTurns ?? settings.defaultMaxTurns,
  );

  const { tags: invocationTags } = buildInvocationTags({
    thinking,
    maxTurns: resolvedConfig.maxTurns,
    inheritContext,
    runInBackground,
  });
  const agentTags = invocationTags;

  const detailBase = {
    displayName,
    description: params.description as string,
    subagentType,
    modelName,
    tags: agentTags.length > 0 ? agentTags : undefined,
  };

  return {
    identity: { subagentType, rawType, displayName, definition },
    notes: [
      ...buildMinimumTurnsNote(resolvedConfig.maxTurns),
      ...buildModelNote(modelChoice.selection),
      ...buildThinkingNote(thinkingDecision),
    ],
    execution: {
      prompt: params.prompt as string,
      description: params.description as string,
      model,
      modelSelection: modelChoice.selection,
      thinkingDecision,
      effectiveMaxTurns,
      thinking,
      inheritContext,
      runInBackground,
    },
    presentation: { agentTags, detailBase },
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
 * Advise that the model was chosen automatically, and say which.
 *
 * The caller did not name a model, so it cannot know which one the child will
 * run on; the launch note is where it finds out.
 */
function buildModelNote(selection: ModelSelection): string[] {
  if (selection.source !== "routed") return [];
  return [`Note: the model was chosen automatically — ${selection.reason}.`];
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
