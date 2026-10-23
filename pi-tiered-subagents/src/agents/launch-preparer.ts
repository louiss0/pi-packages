/**
 * launch-preparer.ts — The one authority that turns a caller request into a
 * complete launch decision.
 *
 * Both the model-facing tool and programmatic service submit the same owned
 * request here. This module selects the definition, validates the caller's
 * thinking level, captures the current routing/turn inputs, and delegates the
 * existing resolution policy. It does not allocate a child session or accept
 * work into the manager.
 */

import type { AgentDefinition } from "#src/agents/definition";
import type { LoadedScopes } from "#src/agents/loader";
import { buildCatalog } from "#src/agents/registry";
import type {
  ModelInfo,
  ResolvedSpawnConfig,
  TurnSettings,
} from "#src/agents/resolver";
import { resolveSpawn } from "#src/agents/resolver";
import {
  parseThinkingLevel,
  thinkingLevelError,
} from "#src/config/thinking-level";
import { defined } from "#src/optional";
import type { PromptInheritance, SubagentType } from "#src/types";

/** Caller-specific names translated into one preparation request. */
export interface LaunchRequest {
  readonly type: string;
  readonly prompt: string;
  readonly description?: string;
  readonly model?: string;
  /** Kept as a string until this shared validation boundary. */
  readonly thinking?: string;
  readonly maxTurns?: number;
  readonly inheritContext?: boolean;
  readonly runInBackground?: boolean;
}

/** A definition and all execution decisions captured for one accepted request. */
export interface PreparedLaunch {
  readonly definition: AgentDefinition;
  readonly config: ResolvedSpawnConfig;
  /**
   * The child-shaping settings in force when the request was made.
   *
   * Operational controls (concurrency, retention, interrupt policy) stay
   * live; these three shape what a child *is*, so a queued child keeps the
   * policy it was asked under rather than adopting a later edit
   * (ARCHITECTURE-SPEC stories 56 and 57).
   */
  readonly childShaping: ChildShapingSettings;
}

/**
 * The settings that shape a child, captured with the launch.
 *
 * Copied at capture: the excluded list and the inheritance record are fresh
 * arrays/objects, so later settings edits reach only the next launch.
 */
export interface ChildShapingSettings {
  /** Whether a background child gets the `notify_parent` channel. */
  readonly midRunUpdates: boolean;
  /** The extension packages the child's resource loader must not resolve. */
  readonly excludedExtensionPackages: readonly string[];
  /** Per-provider prompt-inheritance strategy; unlisted providers inherit "full". */
  readonly promptInheritance: Readonly<Record<string, PromptInheritance>>;
}

/** Resolve the strategy a child on `provider` adopts from captured settings. */
export function capturedPromptInheritance(
  captured: ChildShapingSettings,
  provider: string | undefined,
): PromptInheritance {
  if (provider === undefined) return "full";
  return captured.promptInheritance[provider] ?? "full";
}

/** Expected failures while preparing a caller request. */
export type LaunchPreparationRejection =
  | "unknown-agent"
  | "disabled-agent"
  | "invalid-thinking"
  | "configuration"
  | "cancelled";

/** Preparation is an expected-value boundary; implementation failures still throw. */
export type LaunchPreparationOutcome =
  | { readonly kind: "prepared"; readonly value: PreparedLaunch }
  | {
      readonly kind: "rejected";
      readonly reason: LaunchPreparationRejection;
      readonly message: string;
    };

/** Dependencies are the small live reads preparation needs at invocation. */
export interface LaunchPreparerDeps {
  /**
   * Load one preparation's definition scopes asynchronously.
   *
   * Each call owns its result: concurrent preparations never select through
   * the mutable live registry. Cancellation propagates from `signal`.
   */
  readonly loadScopes: (signal?: AbortSignal) => Promise<LoadedScopes>;
  /** Parent model facts are read before resolution can yield. */
  readonly modelInfo: () => ModelInfo;
  /** Operator turn defaults are captured with this request. */
  readonly turnSettings: () => TurnSettings;
  /** Child-shaping settings are captured with this request. */
  readonly childShaping: () => ChildShapingSettings;
}

export class LaunchPreparer {
  constructor(private readonly deps: LaunchPreparerDeps) {}

  /**
   * Prepare one launch from its caller vocabulary into a selected definition and
   * fully resolved spawn config.
   *
   * Asynchronous so configuration loading never blocks the host event loop
   * (ARCHITECTURE-SPEC story 60). Every session-facing input is captured
   * before the first await, so nothing a later turn changes can reach this
   * request (story 15). A caller's signal cancels preparation before
   * acceptance; cancellation is an expected rejection, not an exception
   * (story 77).
   */
  async prepare(
    request: LaunchRequest,
    signal?: AbortSignal,
  ): Promise<LaunchPreparationOutcome> {
    // Capture the invocation-time facts first. These reads must reflect the
    // request, not the moment the definition files finished loading.
    const modelInfo = this.deps.modelInfo();
    const turnSettings = { ...this.deps.turnSettings() };
    const childShapingCapture = this.deps.childShaping();

    if (signal?.aborted) return cancelledRejection();

    const scopes = await this.deps.loadScopes(signal);
    if (signal?.aborted) return cancelledRejection();

    const registry = buildCatalog(scopes);
    const selection = registry.select(request.type);
    if (!selection.ok) {
      return {
        kind: "rejected",
        reason: selection.reason,
        message: selection.error,
      };
    }

    const definition = copyDefinition(selection.definition);
    const thinking = request.thinking;
    const requestedThinking = parseThinkingLevel(thinking);
    if (thinking != null && requestedThinking === undefined) {
      return {
        kind: "rejected",
        reason: "invalid-thinking",
        message: thinkingLevelError(thinking),
      };
    }

    const config = resolveSpawn({
      definition,
      prompt: request.prompt,
      ...defined({
        description: request.description,
        requestedModel: request.model,
        requestedThinking,
        requestedMaxTurns: request.maxTurns,
        inheritContext: request.inheritContext,
        runInBackground: request.runInBackground,
        rawType: request.type as SubagentType,
      }),
      modelInfo,
      settings: turnSettings,
    });

    if ("error" in config) {
      return {
        kind: "rejected",
        reason: "configuration",
        message: config.error,
      };
    }

    const childShaping = copyChildShaping(childShapingCapture);

    return {
      kind: "prepared",
      value: { definition, config, childShaping },
    };
  }
}

/** The expected rejection for a caller that cancelled before preparation finished. */
function cancelledRejection(): LaunchPreparationOutcome {
  return {
    kind: "rejected",
    reason: "cancelled",
    message: "The launch was cancelled before preparation completed.",
  };
}

/** Copy nested child-shaping values: a prepared launch cannot track settings edits. */
function copyChildShaping(
  captured: ChildShapingSettings,
): ChildShapingSettings {
  return {
    midRunUpdates: captured.midRunUpdates,
    excludedExtensionPackages: [...captured.excludedExtensionPackages],
    promptInheritance: { ...captured.promptInheritance },
  };
}

/** Copy nested definition values: a prepared launch cannot track registry edits. */
function copyDefinition(definition: AgentDefinition): AgentDefinition {
  return {
    ...definition,
    tools:
      definition.tools.kind === "explicit"
        ? { kind: "explicit", names: [...definition.tools.names] }
        : { kind: "inherit" },
  };
}
