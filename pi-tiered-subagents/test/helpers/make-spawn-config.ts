import { defined } from "#src/optional";
import type { AgentDefinition } from "#src/agents/definition";
import { defaultDefinition } from "#src/agents/definition";
import type { TurnPolicy } from "#src/lifecycle/turn-limits";
import type { ResolvedSpawnConfig } from "#src/tools/spawn-config";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";

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
  /** The resolved turn ceiling; unlimited unless a test says otherwise. */
  turnPolicy?: TurnPolicy;
}

/**
 * Build a `ResolvedSpawnConfig` for tool tests from flat options.
 *
 * Derives the mirrored regions the hand-built fixtures duplicate:
 * `displayName`/`description`/`subagentType`/`model` → `presentation.detailBase`.
 * Flat options sidestep the `Patch<ResolvedSpawnConfig>` deep-merge trap.
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
      modelSelection: {
        model: undefined,
        source: "inherited",
        reason: "the parent has no model to step down from",
      },
      thinkingDecision: {
        applicable: false,
        source: "none",
        clamped: false,
        reason: "no model was resolved, so there is no reasoning level to set",
      },
      turnPolicy: options.turnPolicy ?? UNLIMITED_TURNS,
      inheritContext: false,
      runInBackground,
    },
    presentation: {
      agentTags: [],
      detailBase: defined({
        displayName,
        description,
        subagentType,
        modelName,
      }),
    },
  };
}
