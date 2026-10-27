/**
 * definition.ts — The agent definition model and the rules that layer it.
 *
 * A definition says what one agent is: how it is labelled, what it may do,
 * what it may use, and what it inherits. Definitions come from three layers —
 * the shipped specialists, the operator's global files, and the project's
 * files — and a later layer refines an earlier one field by field.
 *
 * The layering vocabulary is small on purpose:
 *
 * - **not specified** (`undefined`) — the layer says nothing, so the value from
 *   the layer below stands. A small override therefore does not discard a
 *   built-in specialist's tool restrictions.
 * - **an explicit value** — the layer replaces the inherited value.
 * - **cleared** (`null`) — the layer removes an inherited optional setting, so
 *   a fixed model or thinking choice goes away without copying the definition.
 * - **an empty list** — a real value: no tools at all, not "inherit".
 *
 * Lists are never concatenated across layers, and a body is either inherited
 * (empty) or replaces the instructions (non-empty).
 */

import type { SubagentThinkingLevel } from "#src/config/thinking-level";
import { defined } from "#src/optional";

/**
 * How a definition selects the tools the child may use.
 *
 * `inherit` takes the parent's active tools at request time; `explicit` names
 * the tools the child gets, whether or not the parent has them active.
 */
export type ToolSelection =
  | { readonly kind: "inherit" }
  | { readonly kind: "explicit"; readonly names: ReadonlyArray<string> };

/** Which layer a definition's values came from. */
export type DefinitionOrigin = "shipped" | "global" | "project";

/**
 * The effective definition of one agent.
 *
 * Every field is resolved: there is no "unspecified" state here, only in the
 * patches that produce it.
 */
export type AgentDefinition = Readonly<{
  /** Normalized identifier: lowercased, unique across the registry. */
  id: string;
  /** Readable label, separate from the identifier. */
  displayName: string;
  /** One line saying what this agent is for. */
  description: string;
  /** The agent's standing instructions — the Markdown body. */
  instructions: string;
  /** The tools the child may use. */
  tools: ToolSelection;
  /** A fixed model, when the definition names one. */
  model?: string;
  /** A fixed reasoning level, when the definition names one. */
  thinking?: SubagentThinkingLevel;
  /** A turn ceiling for the child, when the definition names one. */
  maxTurns?: number;
  /** Whether the child starts from the parent's conversation. */
  inheritContext: boolean;
  /** Whether the child runs in the background by default. */
  runInBackground: boolean;
  /** Whether the agent may be requested at all. */
  enabled: boolean;
  /** The layer the definition's values came from. */
  origin: DefinitionOrigin;
}>;

/**
 * What one layer contributes to a definition.
 *
 * `undefined` means the layer says nothing about the field; `null` clears an
 * inherited value. See the module comment for the full vocabulary.
 */
export type AgentDefinitionPatch = Readonly<{
  displayName?: string | null;
  description?: string | null;
  instructions?: string | null;
  tools?: ToolSelection | null;
  model?: string | null;
  thinking?: SubagentThinkingLevel | null;
  maxTurns?: number | null;
  inheritContext?: boolean | null;
  runInBackground?: boolean | null;
  enabled?: boolean | null;
}>;

/** The tool names this package registers for managing subagents. */
export const SUBAGENT_TOOL_NAMES = [
  "subagent",
  "get_subagent_result",
  "steer_subagent",
] as const;

/**
 * The definition a layer starts from when it introduces an agent the shipped
 * set does not have.
 *
 * The defaults are the ones the specification names: tools inherited from the
 * parent, a fresh conversation, and a background run.
 */
export function defaultDefinition(
  id: string,
  origin: DefinitionOrigin,
): AgentDefinition {
  return {
    id,
    displayName: id,
    description: "",
    instructions: "",
    tools: { kind: "inherit" },
    inheritContext: false,
    runInBackground: true,
    enabled: true,
    origin,
  };
}

/**
 * Apply one layer's patch to the definition below it.
 *
 * Field by field, never list by list: a patch that names no tools keeps the
 * inherited selection, and a patch that names an empty list clears it.
 */
export function mergeDefinition(
  base: AgentDefinition,
  patch: AgentDefinitionPatch,
  origin: DefinitionOrigin,
): AgentDefinition {
  return {
    id: base.id,
    displayName: merged(patch.displayName, base.displayName, base.id),
    description: merged(patch.description, base.description, ""),
    instructions: mergedInstructions(patch.instructions, base.instructions),
    tools: mergedTools(patch.tools, base.tools),
    inheritContext: merged(patch.inheritContext, base.inheritContext, false),
    runInBackground: merged(patch.runInBackground, base.runInBackground, false),
    enabled: merged(patch.enabled, base.enabled, true),
    origin,
    // A cleared optional choice is an absent key, not a key holding undefined.
    ...defined({
      model: mergedOptional(patch.model, base.model),
      thinking: mergedOptional(patch.thinking, base.thinking),
      maxTurns: mergedOptional(patch.maxTurns, base.maxTurns),
    }),
  };
}

/**
 * One field's outcome: the patch's value when it says something, the
 * inherited value when it does not, and the field's default when it clears.
 */
function merged<T>(patch: T | null | undefined, inherited: T, cleared: T): T {
  if (patch === undefined) return inherited;
  if (patch === null) return cleared;
  return patch;
}

/**
 * An optional field's outcome: clearing it leaves the field unset, which is
 * how a fixed model or thinking choice returns to automatic selection.
 */
function mergedOptional<T>(
  patch: T | null | undefined,
  inherited: T | undefined,
): T | undefined {
  if (patch === undefined) return inherited;
  if (patch === null) return undefined;
  return patch;
}

/**
 * The standing instructions' outcome.
 *
 * An empty body inherits the instructions below it — a configuration-only
 * override stays concise — and a nonempty body replaces them. Clearing them
 * (null) leaves the agent with no standing instructions at all.
 */
function mergedInstructions(
  patch: string | null | undefined,
  inherited: string,
): string {
  if (patch === undefined) return inherited;
  if (patch === null) return "";
  return patch.trim() === "" ? inherited : patch;
}

/**
 * The tool selection's outcome.
 *
 * An explicit selection replaces the inherited one, including an empty list,
 * which means "no tools" rather than "inherit". Clearing the selection (null)
 * returns to inheriting the parent's tools.
 */
function mergedTools(
  patch: ToolSelection | null | undefined,
  inherited: ToolSelection,
): ToolSelection {
  if (patch === undefined) return inherited;
  if (patch === null) return { kind: "inherit" };
  return patch;
}

/**
 * The tool names a child gets, given the definition's selection and the
 * parent's active tools.
 *
 * `inherit` takes the parent's active tools as they were when the request was
 * made. `explicit` takes the named tools, whether or not the parent has them
 * active — a built-in tool is instantiated for the child either way.
 *
 * The subagent-management tools are stripped in both cases: a child cannot
 * delegate further in this release.
 */
export function resolveChildToolNames(
  selection: ToolSelection,
  parentActiveTools: ReadonlyArray<string>,
): string[] {
  const names =
    selection.kind === "explicit" ? selection.names : parentActiveTools;
  return names.filter((name) => !isSubagentTool(name));
}

/** Whether a tool name is one of this package's subagent-management tools. */
export function isSubagentTool(name: string): boolean {
  return (SUBAGENT_TOOL_NAMES as ReadonlyArray<string>).includes(name);
}

/**
 * Normalize an agent identifier: lowercased and trimmed.
 *
 * Identifiers are matched case-insensitively, so `Reviewer` and `reviewer` name
 * the same agent.
 */
export function normalizeAgentId(id: string): string {
  return id.trim().toLowerCase();
}
