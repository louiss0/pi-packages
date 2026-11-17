/**
 * resolve.ts — The reasoning level a child runs at.
 *
 * The model is chosen first; the level follows it, because what a model can do
 * is a property of the model.
 *
 * The order of precedence is the request, then the definition, then the
 * automatic choice. The automatic choice is the **upper median of the child
 * model's supported non-off levels**. Parent effort does not affect it, even
 * when routing retains the parent's model. Automatic selection never turns
 * reasoning off on a model that has it.
 *
 * A model that does not reason is not a failure: the level is discarded and
 * reported as *not applicable*. Explicit levels retain their clamping behavior.
 */

import { type Model } from "@earendil-works/pi-ai";
import { type SubagentThinkingLevel } from "#src/config/thinking-level";
import { middleLevel } from "#src/thinking/levels";
import {
  supportedLevels as adapterSupportedLevels,
  clampLevel as adapterClampLevel,
} from "#src/agents/sdk-adapter";

/** Where the level came from. */
export type ThinkingSource = "request" | "definition" | "automatic" | "none";

/** The level the child runs at, and what was decided. */
export type ThinkingDecision = Readonly<{
  /**
   * The level the child runs at.
   *
   * Undefined when the model does not reason: the setting is not applicable
   * rather than wrong.
   */
  level?: SubagentThinkingLevel;
  /** Whether the model reasons at all. */
  applicable: boolean;
  /** Where the level came from. */
  source: ThinkingSource;
  /** Whether a requested level had to be clamped to what the model supports. */
  clamped: boolean;
  /** A sentence for the launch note. */
  reason: string;
}>;

/** What the resolution needs to know. */
export type ThinkingRequest = Readonly<{
  /** The level the request names, when it names one. */
  requested?: SubagentThinkingLevel;
  /** The level the definition names, when it names one. */
  defined?: SubagentThinkingLevel;
  /** The model the child runs on. */
  model?: Model<any>;
}>;

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

  const supported = adapterSupportedLevels(
    model,
  ) as ReadonlyArray<SubagentThinkingLevel>;
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

  const level = middleLevel(supported);
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
    reason: `the automatic reasoning level for ${model.provider}/${model.id} is ${level}, the upper median of its supported non-off levels`,
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
  supported: ReadonlyArray<SubagentThinkingLevel>,
  model: Model<any>,
): ThinkingDecision {
  // A model that reasons does not reason less because the caller asked it to:
  // an explicit "off" is refused on such a model, and the lowest level it does
  // support takes its place. A model that does not reason never reaches here —
  // the level does not apply to it at all.
  if (requested === "off") {
    const lowest = supported.find((level) => level !== "off");
    if (lowest) {
      return {
        level: lowest,
        applicable: true,
        source,
        clamped: true,
        reason: `${model.provider}/${model.id} does extended reasoning, so "off" was not applied; the lowest level it supports is ${lowest}`,
      };
    }
  }

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

  const clamped = adapterClampLevel(requested, model) as SubagentThinkingLevel;
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
