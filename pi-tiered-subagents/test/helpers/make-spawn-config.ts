import type { AgentDefinition } from "#src/agents/definition";
import { defaultDefinition } from "#src/agents/definition";
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";

/** Flat options for {@link createResolvedSpawnConfig}; only the scalars tests vary. */
export interface ResolvedSpawnConfigOptions {
  subagentType?: string;
  rawType?: string;
  displayName?: string;
  prompt?: string;
  description?: string;
  model?: string;
  runInBackground?: boolean;
  definition?: AgentDefinition;
  /** Advisories the result leads with. */
  notes?: string[];
}

/**
 * Build a `ResolvedSpawnConfig` for tool tests from flat options.
 *
 * Derives the mirrored regions the hand-built fixtures duplicate:
 * `displayName`/`description`/`subagentType`/`model` → `presentation.detailBase`.
 * Flat options sidestep the `Partial<ResolvedSpawnConfig>` deep-merge trap.
 */
export function createResolvedSpawnConfig(
  options: ResolvedSpawnConfigOptions = {},
): ResolvedSpawnConfig {
  const subagentType = options.subagentType ?? "worker";
  const displayName = options.displayName ?? "Worker";
  const description = options.description ?? "task";
  const runInBackground = options.runInBackground ?? true;
  const modelName = options.model;
  const rawType = options.rawType ?? subagentType;
  const definition =
    options.definition ??
    ({
      ...defaultDefinition(subagentType, "shipped"),
      displayName,
    } as AgentDefinition);

  return {
    identity: { subagentType, rawType, displayName, definition },
    notes: options.notes ?? [],
    execution: {
      prompt: options.prompt ?? "do the task",
      description,
      model: undefined,
      effectiveMaxTurns: undefined,
      thinking: undefined,
      inheritContext: false,
      runInBackground,
    },
    presentation: {
      agentTags: [],
      detailBase: {
        displayName,
        description,
        subagentType,
        modelName,
        tags: undefined,
      },
    },
  };
}
