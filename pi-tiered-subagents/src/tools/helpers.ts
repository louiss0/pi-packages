import { defined } from "#src/optional";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import { isShippedSpecialist } from "#src/agents/shipped";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import { getLifetimeTotal, type LifetimeUsage } from "#src/lifecycle/usage";
import {
  type AgentDetails,
  formatTokens,
  type ModelIdentity,
  modelLabel,
} from "#src/ui/display";

/**
 * Build AgentDetails from a base + record-specific fields.
 *
 * `record` is a read view over a live subagent, so its optionals accept an
 * explicit `undefined` — see the note on `StatusOutcome`.
 */
export function buildDetails(
  base: Pick<
    AgentDetails,
    "displayName" | "description" | "subagentType" | "modelName" | "tags"
  >,
  record: {
    toolUses: number;
    startedAt: number;
    completedAt?: number | undefined;
    status: string;
    error?: string | undefined;
    id?: string | undefined;
    lifetimeUsage: LifetimeUsage;
    /** Live model object, when a session has materialized one. */
    model?: ModelIdentity | undefined;
    /** Durable prepared identity, available while the child is queued. */
    modelIdentity?: ModelIdentity | undefined;
    turnBudget?: TurnBudget | undefined;
  },
  overrides?: Partial<AgentDetails>,
): AgentDetails {
  return {
    ...base,
    toolUses: record.toolUses,
    tokens: formatLifetimeTokens(record),
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status as AgentDetails["status"],
    ...defined({
      modelName:
        modelLabel(record.modelIdentity ?? record.model) ?? base.modelName,
      agentId: record.id,
      error: record.error,
      turnBudget: record.turnBudget,
    }),
    ...overrides,
  };
}

/** Render a spawn's advisories as the prefix a result's leading line follows, or "" when there are none. */
export function renderSpawnNotes(notes: ReadonlyArray<string>): string {
  return notes.length > 0 ? `${notes.join("\n")}\n\n` : "";
}

/**
 * Tool execute return value for a text response.
 *
 * Generic over the details payload so a tool with its own presentation metadata
 * can attach it; defaults to `AgentDetails`, which is what every subagent-tool
 * call site passes.
 */
export function textResult<T = AgentDetails>(msg: string, details?: T) {
  return { content: [{ type: "text" as const, text: msg }], details };
}

/** Format an agent's lifetime token total, or "" when zero. */
export function formatLifetimeTokens(o: {
  lifetimeUsage: LifetimeUsage;
}): string {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}

/**
 * Narrow registry interface needed by buildTypeListText.
 */
export type TypeListRegistry = AgentDefinitionLookup;

/**
 * Build the full agent-type list text for the Agent tool description.
 * Used by the tool definition at the extension root.
 */
export function buildTypeListText(
  registry: TypeListRegistry,
  agentDir: string,
): string {
  const definitions = registry
    .list()
    .filter((definition) => definition.enabled);

  const shipped = definitions.filter((definition) =>
    isShippedSpecialist(definition.id),
  );
  const custom = definitions.filter(
    (definition) => !isShippedSpecialist(definition.id),
  );

  const describe = (definition: (typeof definitions)[number]) => {
    const modelSuffix = definition.model
      ? ` (${getModelLabelFromConfig(definition.model)})`
      : "";
    return `- ${definition.id}: ${definition.description}${modelSuffix}`;
  };

  return [
    ...(shipped.length > 0 ? ["Specialists:", ...shipped.map(describe)] : []),
    ...(custom.length > 0
      ? ["", "Custom agents:", ...custom.map(describe)]
      : []),
    "",
    `Custom agents can be defined in .pi/agents/<name>.md (project) or ${agentDir}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones. Creating a .md file with the same name as a specialist refines it, field by field.`,
  ].join("\n");
}

/**
 * Collect the per-agent usage guidelines for the subagent tool's Guidelines: block.
 *
 * Sourced from each enabled specialist's description, in registry order, so a
 * disabled one drops its guideline automatically.
 */
export function buildAgentGuidelines(registry: TypeListRegistry): string[] {
  return registry
    .list()
    .filter(
      (definition) => definition.enabled && isShippedSpecialist(definition.id),
    )
    .map(
      (definition) => `- Use ${definition.id} for: ${definition.description}`,
    )
    .filter((line) => line.length > 0);
}

/** Derive a short model label from a model string. */
export function getModelLabelFromConfig(model: string): string {
  // Strip provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
  const name = model.includes("/") ? model.split("/").pop()! : model;
  // Strip trailing date suffix (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
  return name.replace(/-\d{8}$/, "");
}
