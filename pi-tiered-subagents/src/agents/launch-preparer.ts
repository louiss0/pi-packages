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
import type { AgentDefinitionLookup } from "#src/agents/registry";
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
import type { SubagentType } from "#src/types";

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
}

/** Expected failures while preparing a caller request. */
export type LaunchPreparationRejection =
  | "unknown-agent"
  | "disabled-agent"
  | "invalid-thinking"
  | "configuration";

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
  readonly registry: AgentDefinitionLookup;
  /** Refresh mutable on-disk configuration once, before selecting this request. */
  readonly reload: () => void;
  /** Parent model facts are read before resolution can yield. */
  readonly modelInfo: () => ModelInfo;
  /** Operator turn defaults are captured with this request. */
  readonly turnSettings: () => TurnSettings;
}

export class LaunchPreparer {
  constructor(private readonly deps: LaunchPreparerDeps) {}

  /**
   * Prepare one launch from its caller vocabulary into a selected definition and
   * fully resolved spawn config. This method is synchronous today; its boundary
   * is deliberately before snapshot capture and manager acceptance so loading
   * can become asynchronous without moving caller policy into either door.
   */
  prepare(request: LaunchRequest): LaunchPreparationOutcome {
    this.deps.reload();

    const selection = this.deps.registry.select(request.type);
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
      modelInfo: this.deps.modelInfo(),
      settings: { ...this.deps.turnSettings() },
    });

    if ("error" in config) {
      return {
        kind: "rejected",
        reason: "configuration",
        message: config.error,
      };
    }

    return { kind: "prepared", value: { definition, config } };
  }
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
