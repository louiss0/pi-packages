/**
 * resolve.ts — The reasoning level a child runs at.
 *
 * The model is chosen first; the level follows it, because what a model can do
 * is a property of the model.
 *
 * The order of precedence is the request, then the definition, then the
 * automatic choice. The automatic choice prefers **medium**, then **low**,
 * then the lowest supported non-off level — and never turns reasoning off on a
 * model that has it.
 *
 * Two rules make the fallback honest:
 *
 * - A model that does not reason is not a failure. The level is discarded and
 *   reported as *not applicable*; the launch goes ahead.
 * - When the parent's model is kept, the child's effort never rises. The
 *   fallback prefers medium or low only when they are *below* the effort the
 *   parent was running at; otherwise it takes a supported level below it, and
 *   failing that it keeps the parent's own effort.
 *
 * The supported levels come from Pi's own report about the model, and an
 * unsupported request is clamped the way Pi clamps it — never by a numerical
 * midpoint, and never silently down to "off" on a reasoning model.
 */

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";
import type { SubagentThinkingLevel } from "#src/config/thinking-level";

/** The levels, in ascending order of effort. */
const EFFORT: readonly SubagentThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Where the level came from. */
export type ThinkingSource =
  | "request"
  | "definition"
  | "automatic"
  | "parent"
  | "none";

/** The level the child runs at, and what was decided. */
export interface ThinkingDecision {
  /**
   * The level the child runs at.
   *
   * Undefined when the model does not reason: the setting is not applicable
   * rather than wrong.
   */
  readonly level?: SubagentThinkingLevel;
  /** Whether the model reasons at all. */
  readonly applicable: boolean;
  /** Where the level came from. */
  readonly source: ThinkingSource;
  /** Whether a requested level had to be clamped to what the model supports. */
  readonly clamped: boolean;
  /** A sentence for the launch note. */
  readonly reason: string;
}

/** What the resolution needs to know. */
export interface ThinkingRequest {
  /** The level the request names, when it names one. */
  readonly requested?: SubagentThinkingLevel;
  /** The level the definition names, when it names one. */
  readonly defined?: SubagentThinkingLevel;
  /** The model the child runs on. */
  readonly model?: Model<any>;
  /** The effort the parent was running at, when the parent has one. */
  readonly parentLevel?: SubagentThinkingLevel;
  /**
   * Whether the parent's model was kept because no lower target was
   * available.
   *
   * Absent means the model changed — the default is a child that works on its
   * own model, and the retained-parent rule does not apply.
   */
  readonly parentModelKept?: boolean;
}

/**
 * Resolve the reasoning level for a launch.
 *
 * Never fails: a level the model cannot express is clamped, and a model that
 * cannot reason at all simply has no level.
 */
export function resolveThinking(request: ThinkingRequest): ThinkingDecision {
  const { model } = request;

  if (!model) {
    // No model was resolved, so nothing is known about what it can do. The
    // level the caller named passes through untouched, and the session's own
    // resolution has the last word.
    const level = request.requested ?? request.defined;
    if (level === undefined) {
      return {
        applicable: false,
        source: "none",
        clamped: false,
        reason: "no model was resolved, so there is no reasoning level to set",
      };
    }
    return {
      level,
      applicable: true,
      source: request.requested !== undefined ? "request" : "definition",
      clamped: false,
      reason:
        request.requested !== undefined
          ? `the request asked for ${level}`
          : `the agent definition asked for ${level}`,
    };
  }

  const supported = getSupportedThinkingLevels(
    model,
  ) as readonly SubagentThinkingLevel[];
  const nonOff = supported.filter((level) => level !== "off");

  if (nonOff.length === 0) {
    return {
      applicable: false,
      source: "none",
      clamped: false,
      reason: `${model.provider}/${model.id} does not do extended reasoning, so the thinking level does not apply`,
    };
  }

  if (request.requested !== undefined) {
    return explicit(request.requested, "request", supported, model);
  }
  if (request.defined !== undefined) {
    return explicit(request.defined, "definition", supported, model);
  }

  if (request.parentModelKept) {
    return retainedParent(request.parentLevel, supported);
  }

  const level = automaticLevel(nonOff);
  if (!level) {
    return {
      applicable: true,
      source: "automatic",
      clamped: false,
      reason: `${model.provider}/${model.id} supports no reasoning level below off`,
    };
  }
  return {
    level,
    applicable: true,
    source: "automatic",
    clamped: false,
    reason: `the default reasoning level for ${model.provider}/${model.id} is ${level}`,
  };
}

/**
 * A level the request or the definition named.
 *
 * A level the model does not support is clamped the way Pi clamps it, and the
 * clamp is reported: the caller asked for one thing and got another.
 */
function explicit(
  requested: SubagentThinkingLevel,
  source: "request" | "definition",
  supported: readonly SubagentThinkingLevel[],
  model: Model<any>,
): ThinkingDecision {
  if (supported.includes(requested)) {
    return {
      level: requested,
      applicable: true,
      source,
      clamped: false,
      reason:
        source === "request"
          ? `the request asked for ${requested}`
          : `the agent definition asked for ${requested}`,
    };
  }

  const clamped = clampThinkingLevel(model, requested) as SubagentThinkingLevel;
  return {
    level: clamped,
    applicable: true,
    source,
    clamped: true,
    reason:
      source === "request"
        ? `${requested} is not a level ${model.provider}/${model.id} supports, so the request was clamped to ${clamped}`
        : `${requested} is not a level ${model.provider}/${model.id} supports, so the definition's level was clamped to ${clamped}`,
  };
}

/**
 * The automatic level: medium, then low, then the lowest supported non-off
 * level.
 */
function automaticLevel(
  nonOff: readonly SubagentThinkingLevel[],
): SubagentThinkingLevel | undefined {
  if (nonOff.includes("medium")) return "medium";
  if (nonOff.includes("low")) return "low";
  // The levels arrive in ascending order, so the first non-off is the lowest.
  return nonOff[0];
}

/**
 * The level for a child that keeps the parent's model.
 *
 * The effort never rises: the preferred levels are taken only when they are
 * below the parent's own, then any supported level below it, and failing both
 * the parent's effort stands.
 */
function retainedParent(
  parentLevel: SubagentThinkingLevel | undefined,
  supported: readonly SubagentThinkingLevel[],
): ThinkingDecision {
  const nonOff = supported.filter((level) => level !== "off");

  if (parentLevel === undefined) {
    const level = automaticLevel(nonOff);
    return {
      ...(level ? { level } : {}),
      applicable: true,
      source: "automatic",
      clamped: false,
      reason: level
        ? `the parent's model was kept, and its default reasoning level is ${level}`
        : "the parent's model was kept, and it supports no reasoning level below off",
    };
  }

  const parentEffort = EFFORT.indexOf(parentLevel);
  for (const candidate of ["medium", "low"] as const) {
    if (!nonOff.includes(candidate)) continue;
    if (EFFORT.indexOf(candidate) < parentEffort) {
      return {
        level: candidate,
        applicable: true,
        source: "parent",
        clamped: false,
        reason: `the parent's model was kept, and ${candidate} is below the effort the parent was running at (${parentLevel})`,
      };
    }
  }

  const below = nonOff.filter((level) => EFFORT.indexOf(level) < parentEffort);
  const lowest = below[0];
  if (lowest) {
    return {
      level: lowest,
      applicable: true,
      source: "parent",
      clamped: false,
      reason: `the parent's model was kept, and ${lowest} is the lowest level it supports below the effort the parent was running at (${parentLevel})`,
    };
  }

  return {
    level: parentLevel,
    applicable: true,
    source: "parent",
    clamped: false,
    reason: `the parent's model was kept, and it supports no level below the effort the parent was running at (${parentLevel}), so that effort stands`,
  };
}
