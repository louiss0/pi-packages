/**
 * launch.ts — The one resolver both doors use.
 *
 * The tool door and the programmatic service door ask the same question in
 * different words: given what the request named, what the definition named, and
 * what the session can run, which model does the child run on, and at what
 * reasoning level?
 *
 * One resolver answers it, so the two doors cannot drift apart. It resolves the
 * model first — the request's own choice, then the definition's, then the
 * automatic role target on the parent's ladder — and the reasoning level after it,
 * because what a model can do is a property of the model.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { SubagentThinkingLevel } from "#src/config/thinking-level";
import type { ExactModelIdentity } from "#src/models/identity";
import type { ModelRegistry } from "#src/models/registry";
import { routingContext, type RoutingLadders } from "#src/models/router";
import { defined } from "#src/optional";
import { type ModelSelection, selectModel } from "#src/models/selection";
import { type ThinkingDecision, resolveThinking } from "#src/thinking/resolve";

/** The session facts the resolver reads. */
export interface LaunchModelContext {
  /** The session's model resolution, when there is one. */
  readonly registry: ModelRegistry | undefined;
  /** The routing ladders. */
  readonly ladders: RoutingLadders;
  /** The parent's model, which the automatic routing steps down from. */
  readonly parentModel?: Model<any>;
  /** The effort the parent is running at. */
  readonly parentThinkingLevel?: SubagentThinkingLevel;
}

/** What the request and the definition asked for. */
export interface LaunchModelRequest {
  /** The resolved definition's identifier. */
  readonly agentId?: string;
  /** The model the request named, when it named one. */
  readonly requestedModel?: string;
  /** The model the definition named, when it named one. */
  readonly definitionModel?: string;
  /** The level the request named, when it named one. */
  readonly requestedThinking?: SubagentThinkingLevel;
  /** The level the definition named, when it named one. */
  readonly definitionThinking?: SubagentThinkingLevel;
}

/** The resolved model and level. */
export interface ResolvedLaunchModel {
  /** The exact model the child runs on, captured as owned data. */
  readonly modelIdentity?: ExactModelIdentity;
  /** How the model was chosen, and why. */
  readonly modelSelection: ModelSelection;
  /** The level the child reasons at, when it reasons at all. */
  readonly thinking?: SubagentThinkingLevel;
  /** What was decided about the level. */
  readonly thinkingDecision: ThinkingDecision;
}

/** The outcome: the resolved model, or the reason there is none. */
export type LaunchModelResult =
  | { readonly ok: true; readonly resolved: ResolvedLaunchModel }
  | { readonly ok: false; readonly error: string };

/**
 * Resolve the model and the reasoning level of a launch.
 *
 * Never fails on the *level*: a level the model cannot express is clamped, and
 * a model that does not reason simply has no level. It fails only on the
 * model, when the request named one the session cannot run.
 */
export function resolveLaunchModel(
  request: LaunchModelRequest,
  context: LaunchModelContext,
): LaunchModelResult {
  const available =
    context.registry?.getAvailable?.() ?? context.registry?.getAll() ?? [];

  const selection = selectModel(
    {
      ...defined({
        agentId: request.agentId,
        requestedModel: request.requestedModel,
        definitionModel: request.definitionModel,
        parentModel: context.parentModel,
      }),
    },
    context.registry,
    routingContext(context.ladders, available),
  );
  if (!selection.ok) return { ok: false, error: selection.error };

  // Thinking capabilities are read now, while preparation owns the registry
  // view. Only the resulting decision survives into the queued launch.
  // A role may deliberately select the same model (equal size or the bottom
  // rung). Identity, not selection source, determines retention.
  const parentModelKept =
    selection.selection.identity !== undefined &&
    selection.selection.identity.provider === context.parentModel?.provider &&
    selection.selection.identity.id === context.parentModel?.id;
  const selectedModel = selection.selection.identity
    ? (context.registry?.find(
        selection.selection.identity.provider,
        selection.selection.identity.id,
      ) ?? (parentModelKept ? context.parentModel : undefined))
    : undefined;
  const thinkingDecision = resolveThinking(
    defined({
      parentModelKept,
      model: selectedModel,
      requested: request.requestedThinking,
      defined: request.definitionThinking,
      parentLevel: context.parentThinkingLevel,
    }),
  );

  return {
    ok: true,
    resolved: defined({
      modelSelection: selection.selection,
      thinkingDecision,
      modelIdentity: selection.selection.identity,
      thinking: thinkingDecision.level,
    }),
  };
}
