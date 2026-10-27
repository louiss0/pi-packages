/**
 * invocation.ts — The precedence between a caller's request and a definition.
 *
 * A request names what this launch should do; a definition names what that
 * agent is. When both speak, the request wins — a caller is present to read an
 * error, while a definition's author is not — except for the fields the
 * request does not mention, which the definition fills.
 *
 * There is no lock. Upstream let a definition withhold fields from its
 * callers; the specification gives the request unconditional precedence, and
 * a second mechanism for the same question would make the answer depend on
 * which file the reader happened to open.
 */

import type { AgentDefinition } from "#src/agents/definition";
import type { SubagentThinkingLevel } from "#src/config/thinking-level";
import { defined } from "#src/optional";

/** The resolved per-run settings of one launch. */
export type ResolvedInvocation = Readonly<{
  /**
   * The model the launch runs on, when one was named.
   *
   * A request names a model; a definition may fix one; neither means the
   * launch takes the parent's model or an automatically routed one.
   */
  model?: string;
  /** Whether the model came from the request rather than the definition. */
  modelFromParams: boolean;
  /** The reasoning level the launch runs at, when one was chosen. */
  thinking?: SubagentThinkingLevel;
  /** The turn ceiling for the launch, when one was named. */
  maxTurns?: number;
  /** Whether the child starts from the parent's conversation. */
  inheritContext: boolean;
  /** Whether the launch runs in the background. */
  runInBackground: boolean;
}>;

/** The fields a caller may name in one launch. */
export type InvocationParams = Readonly<{
  model?: string;
  thinking?: SubagentThinkingLevel;
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
}>;

/**
 * A front door's answer to "should this agent run in the background?".
 *
 * `explicit` is a commitment the door has already acted on — the foreground
 * runner holds the result promise, or the tool door merged the request itself
 * and routed on the answer. `default` is a door with no commitment, so the
 * definition's own preference fills it.
 */
export type BackgroundRequest =
  | { kind: "explicit"; isBackground: boolean }
  | { kind: "default"; isBackground: boolean };

/** Resolve the effective background mode. Explicit answers are honored verbatim. */
export function resolveBackgroundMode(
  definition: { readonly runInBackground?: boolean },
  request: BackgroundRequest,
): boolean {
  return request.kind === "explicit"
    ? request.isBackground
    : (definition.runInBackground ?? request.isBackground);
}

/**
 * Resolve one launch's settings from the request and the definition.
 *
 * The request wins for every field it names; the definition fills the rest.
 */
export function resolveInvocation(
  definition: AgentDefinition,
  params: InvocationParams,
): ResolvedInvocation {
  const model = params.model ?? definition.model;
  return {
    modelFromParams: params.model !== undefined,
    inheritContext: params.inheritContext ?? definition.inheritContext,
    runInBackground: params.runInBackground ?? definition.runInBackground,
    // A definition that names no model, level, or ceiling leaves the key
    // absent, so a later reader cannot mistake "unset" for "set to nothing".
    ...defined({
      model,
      thinking: params.thinking ?? definition.thinking,
      maxTurns: params.maxTurns ?? definition.maxTurns,
    }),
  };
}
