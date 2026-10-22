/**
 * identity.ts — Naming a model exactly.
 *
 * An explicit model choice is a `provider/modelId`. The provider is the part
 * before the first slash; the id is everything after it, because a model id may
 * itself contain a namespace separator (`openrouter/anthropic/claude-sonnet-5`).
 *
 * The resolution is exact: the model the session knows, or an error. There is
 * no shorthand, no "close enough" match and no provider fallback — a caller
 * who names a model has named a model, and a caller who meant another one can
 * say so.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "#src/models/registry";

/** A model named exactly: the provider that serves it and its id there. */
export interface ExactModelIdentity {
  readonly provider: string;
  readonly id: string;
}

/** The models a session can run, as the session's own resolution reports them. */
export type AvailableModels = ModelRegistry;

/**
 * Split a `provider/modelId` string.
 *
 * Returns undefined when the string names no provider: an identity needs one.
 */
export function parseModelIdentity(
  input: string,
): ExactModelIdentity | undefined {
  const trimmed = input.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = trimmed.slice(0, slash);
  const id = trimmed.slice(slash + 1);
  if (id.length === 0) return undefined;
  return { provider, id };
}

/**
 * Resolve a model string to the model it names, exactly.
 *
 * Returns the model, or an error message naming what is available instead.
 */
export function resolveExactModel(
  input: string,
  registry: AvailableModels,
): Model<any> | string {
  const identity = parseModelIdentity(input);
  if (!identity) {
    return (
      `A model must be named "provider/modelId", for example ` +
      `"anthropic/claude-sonnet-5". Got "${input}".`
    );
  }

  const available = registry.getAvailable?.() ?? registry.getAll();
  const found = available.find(
    (model) =>
      model.provider.toLowerCase() === identity.provider.toLowerCase() &&
      model.id === identity.id,
  );
  if (found) return found;

  return (
    `Model not found: "${input}".\n\n` +
    "Name the model exactly, as provider/modelId. A model the session cannot " +
    "run is not a model it can be given.\n\n" +
    "Available models:\n" +
    (available
      .map((model) => `  ${model.provider}/${model.id}`)
      .sort()
      .join("\n") || "  (none)")
  );
}
