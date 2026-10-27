/**
 * levels.ts — Deriving one level from another.
 *
 * Reasoning support is a property of the model, and Pi reports it per model as
 * an array: `["low", "high", "max"]` is a real shape, and so is `["off"]` or
 * `["max"]`. The arrays are ordered by effort but they are **not contiguous**,
 * so "one step down" cannot be arithmetic on an index into a fixed list.
 *
 * These helpers answer two questions without deciding policy:
 *
 * - {@link levelBelow} — the next level down that this model can actually run,
 *   or undefined when the model has no rung below.
 * - {@link stepDown} — the same, but falling back to the model's own floor when
 *   nothing is below. This is what a caller means by "a lower level than the
 *   parent": honour it where the model allows, and land on the model's floor
 *   where it does not, rather than inventing a level or turning reasoning off.
 *
 * Neither helper sets a level, and neither is wired into a launch by itself;
 * `resolveThinking` remains the one place a child's level is decided.
 */

import {
  THINKING_LEVELS,
  type SubagentThinkingLevel,
} from "#src/config/thinking-level";

/** The levels, in ascending order of effort. */
export const EFFORT: readonly SubagentThinkingLevel[] = THINKING_LEVELS;

/** The levels a model reasons at, ascending, with "off" removed. */
export function reasoningLevels(
  supported: readonly SubagentThinkingLevel[],
): SubagentThinkingLevel[] {
  return EFFORT.filter((level) => level !== "off" && supported.includes(level));
}

/**
 * The highest level a model supports that is strictly below `parent`.
 *
 * Gaps are skipped by construction: on `["low", "high", "max"]` the level below
 * `max` is `high`, and the level below `high` is `low`. A model with nothing
 * below the parent returns undefined — the caller decides whether that means
 * "keep the parent's effort" or "use the model's floor".
 */
export function levelBelow(
  supported: readonly SubagentThinkingLevel[],
  parent: SubagentThinkingLevel,
): SubagentThinkingLevel | undefined {
  const parentEffort = EFFORT.indexOf(parent);
  if (parentEffort === -1) return undefined;
  return reasoningLevels(supported)
    .filter((level) => EFFORT.indexOf(level) < parentEffort)
    .at(-1);
}

/**
 * The level below the parent, or the model's own lowest reasoning level.
 *
 * This never returns "off" for a model that reasons, and never returns a level
 * the model does not support. It returns undefined only when the model has no
 * reasoning level at all.
 *
 * The floor is a floor, not a failure: a parent already at `low` on a model
 * whose lowest level is `low` gets `low`. The result then equals the parent's
 * effort, which the caller can report honestly instead of claiming a step down
 * that did not happen.
 */
export function stepDown(
  supported: readonly SubagentThinkingLevel[],
  parent: SubagentThinkingLevel,
): SubagentThinkingLevel | undefined {
  return levelBelow(supported, parent) ?? reasoningLevels(supported)[0];
}
