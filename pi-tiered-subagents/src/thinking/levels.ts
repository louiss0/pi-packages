/**
 * levels.ts — Deriving an automatic level from a model's capabilities.
 *
 * Reasoning support is a property of the model, and Pi reports it per model as
 * an array: `["low", "high", "max"]` is a real shape, and so is `["off"]` or
 * `["max"]`. The arrays may have gaps, so automatic selection filters the
 * canonical effort order rather than assuming every level is present.
 *
 * {@link middleLevel} chooses the upper median of the supported non-off
 * levels. It never disables reasoning on a model that can reason and never
 * invents an unsupported level. `resolveThinking` remains the one place a
 * child's level is decided.
 */

import {
  THINKING_LEVELS,
  type SubagentThinkingLevel,
} from "#src/config/thinking-level";

/** The levels, in ascending order of effort. */
export const EFFORT: ReadonlyArray<SubagentThinkingLevel> = THINKING_LEVELS;

/** The levels a model reasons at, ascending, with "off" removed. */
export function reasoningLevels(
  supported: ReadonlyArray<SubagentThinkingLevel>,
): SubagentThinkingLevel[] {
  return EFFORT.filter((level) => level !== "off" && supported.includes(level));
}

/**
 * The upper median of a model's supported non-off levels.
 *
 * For an even number of levels this chooses the higher of the two middle
 * rungs: `[minimal, low, medium, high]` yields `medium`, while the six levels
 * from `minimal` through `max` yield `high`. A singleton keeps its only level;
 * a non-reasoning model returns undefined.
 */
export function middleLevel(
  supported: ReadonlyArray<SubagentThinkingLevel>,
): SubagentThinkingLevel | undefined {
  const levels = reasoningLevels(supported);
  return levels[Math.floor(levels.length / 2)];
}
