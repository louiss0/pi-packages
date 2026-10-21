/**
 * selection.ts — Which model a child runs on.
 *
 * Three sources, in a fixed order:
 *
 * 1. **the request** — the model the tool call or the service call names;
 * 2. **the definition** — the model the agent file names;
 * 3. **automatic routing** — one rung down the parent's family ladder.
 *
 * The first two are *explicit* choices: they are resolved exactly, and a model
 * the session cannot run is an error rather than a silent fall back to
 * something else. A caller who named a model has named a model, and a caller
 * who meant another one can say so.
 *
 * The third is a *decision*, and it is reported as one: the model it chose,
 * the rung it came from, and a sentence saying why.
 */

import type { Model } from "@earendil-works/pi-ai";
import { type AvailableModels, resolveExactModel } from "#src/models/identity";
import { type RoutingContext, routeModel } from "#src/models/router";

/** What the launch asked for, and what the definition asked for. */
export interface ModelSelectionRequest {
  /** The model the request names, if any. */
  readonly requestedModel?: string;
  /** The model the definition names, if any. */
  readonly definitionModel?: string;
  /** The parent's model, which automatic routing steps down from. */
  readonly parentModel?: Model<any>;
}

/** Where the winning model came from. */
export type ModelSource = "request" | "definition" | "routed" | "inherited";

/** The resolved model, and the facts about how it was chosen. */
export interface ModelSelection {
  /** The model the child runs on. */
  readonly model: Model<any> | undefined;
  /** Where the choice came from. */
  readonly source: ModelSource;
  /** The provider that serves the model, when there is one. */
  readonly provider?: string;
  /** The model's id, when there is one. */
  readonly modelId?: string;
  /** A sentence for the launch note. */
  readonly reason: string;
}

/** The outcome of the selection: a model, or the reason there is none. */
export type ModelSelectionResult =
  | { readonly ok: true; readonly selection: ModelSelection }
  | { readonly ok: false; readonly error: string };

/**
 * Choose the model a child runs on.
 *
 * The session's available models, the profiles and the strategies are the
 * inputs; the request and the definition say what is asked for.
 */
export function selectModel(
  request: ModelSelectionRequest,
  registry: AvailableModels | undefined,
  routing: RoutingContext,
): ModelSelectionResult {
  if (request.requestedModel !== undefined) {
    return explicit(request.requestedModel, "request", registry);
  }
  if (request.definitionModel !== undefined) {
    return explicit(request.definitionModel, "definition", registry);
  }

  const outcome = routeModel(request.parentModel, routing);
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind === "retained") {
    return {
      ok: true,
      selection: {
        model: outcome.model,
        source: "inherited",
        reason: outcome.reason,
      },
    };
  }
  return {
    ok: true,
    selection: {
      model: outcome.model,
      source: "routed",
      provider: outcome.provider,
      modelId: outcome.modelId,
      reason: outcome.reason,
    },
  };
}

/** Resolve an explicitly named model, exactly. */
function explicit(
  modelInput: string,
  source: "request" | "definition",
  registry: AvailableModels | undefined,
): ModelSelectionResult {
  if (!registry) {
    return { ok: false, error: "No model registry available." };
  }
  const resolved = resolveExactModel(modelInput, registry);
  if (typeof resolved === "string") {
    return { ok: false, error: resolved };
  }
  return {
    ok: true,
    selection: {
      model: resolved,
      source,
      provider: resolved.provider,
      modelId: resolved.id,
      reason:
        source === "request"
          ? `the request named ${resolved.provider}/${resolved.id}`
          : `the agent definition named ${resolved.provider}/${resolved.id}`,
    },
  };
}
