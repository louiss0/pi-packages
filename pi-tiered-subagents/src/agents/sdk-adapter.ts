/**
 * sdk-adapter.ts — Adapter for SDK model and reasoning support.
 *
 * The adapter translates SDK-specific model availability and reasoning
 * support into package-owned operations. All SDK details are localized
 * to this module; package core consumes only these exports.
 */

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";

/** Package-owned thinking level. */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Supported levels from SDK, mapped to Pi names. */
export function supportedLevels(model?: Model<any>): readonly ThinkingLevel[] {
  if (!model) return ["off"];
  const sdk = getSupportedThinkingLevels(model);
  const withOff = sdk.includes("off") ? sdk : [...sdk, "off"];
  return (
    [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] as ThinkingLevel[]
  ).filter((l) => withOff.includes(l as any));
}

/** Clamp to SDK-supported levels (Pi-compatible). */
export function clampLevel(
  level: ThinkingLevel,
  model?: Model<any>,
): ThinkingLevel {
  if (!model) return "off";
  return clampThinkingLevel(model, level) as ThinkingLevel;
}

/** Whether model supports reasoning. */
export function canReason(model?: Model<any>): boolean {
  if (!model) return false;
  return getSupportedThinkingLevels(model).some((l) => l !== "off");
}

/** Exact identity from SDK model. */
export function modelIdentity(
  model?: Model<any>,
): { provider: string; id: string } | undefined {
  if (!model) return undefined;
  return {
    provider: (model as any).provider || "unknown",
    id: (model as any).id || "",
  };
}

/** Adapter interface for test verification. */
export interface SdkAdapterInterface {
  supportedLevels(model?: Model<any>): readonly ThinkingLevel[];
  clampLevel(level: ThinkingLevel, model?: Model<any>): ThinkingLevel;
  canReason(model?: Model<any>): boolean;
  modelIdentity(
    model?: Model<any>,
  ): { provider: string; id: string } | undefined;
}

/** Default adapter instance for direct use. */
export const adapter: SdkAdapterInterface = {
  supportedLevels,
  clampLevel,
  canReason,
  modelIdentity,
};
