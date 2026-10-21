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
  isBelowMinimumTurns,
  MIN_MAX_TURNS,
  normalizeMaxTurns,
} from "#src/lifecycle/turn-limits";
import type { ModelRegistry } from "#src/session/model-resolver";
import { resolveInvocationModel } from "#src/session/model-resolver";
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

  // Resolve model
  const resolution = resolveInvocationModel(
    modelInfo.parentModel,
    resolvedConfig.model,
    resolvedConfig.modelFromParams,
    modelInfo.modelRegistry,
  );
  if (resolution.error) return { error: resolution.error };
  const model = resolution.model;

  const thinking = resolvedConfig.thinking;
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
    notes: [...buildMinimumTurnsNote(resolvedConfig.maxTurns)],
    execution: {
      prompt: params.prompt as string,
      description: params.description as string,
      model,
      effectiveMaxTurns,
      thinking,
      inheritContext,
      runInBackground,
    },
    presentation: { agentTags, detailBase },
  };
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
