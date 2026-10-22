/**
 * spawn-config.ts — The tool door's entry into the one spawn resolver.
 *
 * The tool door owns what a tool call is: it validates the call's own fields,
 * resolves the type through the registry, and hands the merged answer to
 * {@link resolveSpawn}, the one resolver both doors share. The service door
 * answers the same question through the same function.
 */

import type { AgentDefinitionLookup } from "#src/agents/registry";
import {
  resolveSpawn,
  type ModelInfo,
  type ResolvedSpawnConfig,
  type SpawnConfigError,
} from "#src/agents/resolver";
import {
  parseThinkingLevel,
  thinkingLevelError,
} from "#src/config/thinking-level";
import type { SubagentType } from "#src/types";

// Re-exported for the narrow interfaces that name the resolved shapes they
// hand across module boundaries.
export type {
  ModelInfo,
  ResolvedSpawnConfig,
  SpawnConfigError,
} from "#src/agents/resolver";
export type {
  SpawnIdentity,
  SpawnExecution,
  SpawnPresentation,
} from "#src/agents/resolver";
export { resolveSpawn } from "#src/agents/resolver";

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

  return resolveSpawn({
    definition: selection.definition,
    prompt: params.prompt as string,
    description: params.description as string | undefined,
    requestedModel: params.model as string | undefined,
    requestedThinking: thinkingFromParams,
    requestedMaxTurns: params.max_turns as number | undefined,
    inheritContext: params.inherit_context as boolean | undefined,
    runInBackground: params.run_in_background as boolean | undefined,
    rawType,
    modelInfo,
    settings,
  });
}
