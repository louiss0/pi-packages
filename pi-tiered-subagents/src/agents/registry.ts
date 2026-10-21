/**
 * registry.ts — The layered registry of agent definitions.
 *
 * Three layers, each refining the one below it:
 *
 * 1. the shipped specialists,
 * 2. the operator's global files (`<agentDir>/agents/*.md`),
 * 3. the project's files (`<cwd>/.pi/agents/*.md`) — read only when Pi has
 *    granted the project trust, so opening a repository cannot silently
 *    change what an agent may do.
 *
 * A later layer refines an earlier one field by field. A file that mentions
 * one setting does not restate the rest, so a small override never discards a
 * built-in specialist's tool restrictions.
 *
 * The registry answers one question with an answer, never with a substitute:
 * asking for an agent that does not exist, or for one that is disabled, is an
 * error. Silently running a different role would answer a question nobody
 * asked.
 */

import type { AgentDefinition, DefinitionOrigin } from "#src/agents/definition";
import { defaultDefinition, mergeDefinition } from "#src/agents/definition";
import { type LoadedScope, type LoadedScopes } from "#src/agents/loader";
import { SHIPPED_DEFINITIONS } from "#src/agents/shipped";
import { normalizeAgentId } from "#src/agents/definition";

/**
 * The outcome of asking for one agent.
 */
export type AgentSelection =
  | { readonly ok: true; readonly definition: AgentDefinition }
  | { readonly ok: false; readonly error: string };

/**
 * The registry slice the runtime reads.
 *
 * The doors ask it to select an agent; the session assembler asks it for the
 * definition it assembles from.
 */
export interface AgentDefinitionLookup {
  /** The definition for an identifier, or the reason there is none. */
  select(id: string): AgentSelection;
  /** The definition for an identifier, or undefined when there is none. */
  find(id: string): AgentDefinition | undefined;
  /** Every definition, in identifier order. */
  list(): readonly AgentDefinition[];
}

/**
 * The registry of agent definitions.
 *
 * Holds the merged result of the three layers and reloads it on demand, so a
 * definition file added while the session runs is picked up without a
 * restart.
 */
export class AgentRegistry implements AgentDefinitionLookup {
  private definitions = new Map<string, AgentDefinition>();
  private loadErrors: string[] = [];

  constructor(private readonly load: () => LoadedScopes) {
    this.reload();
  }

  /** Re-read the file layers and rebuild the merged definitions. */
  reload(): void {
    const { global, project } = this.load();
    this.loadErrors = [...global.errors, ...(project?.errors ?? [])];
    this.definitions = buildDefinitions(global, project);
  }

  /** Every definition, in identifier order. */
  list(): readonly AgentDefinition[] {
    return [...this.definitions.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  /** The identifiers of every definition, in the same order. */
  ids(): string[] {
    return this.list().map((definition) => definition.id);
  }

  /** The definitions an operator may request: the enabled ones. */
  enabledIds(): string[] {
    return this.list()
      .filter((definition) => definition.enabled)
      .map((definition) => definition.id);
  }

  /** The definition for an identifier, or undefined when there is none. */
  find(id: string): AgentDefinition | undefined {
    return this.definitions.get(normalizeAgentId(id));
  }

  /**
   * The definition for an identifier, or the reason there is none.
   *
   * An unknown identifier and a disabled one are different failures, and both
   * are failures: neither is answered with another agent.
   */
  select(id: string): AgentSelection {
    const normalized = normalizeAgentId(id);
    const definition = this.definitions.get(normalized);
    if (!definition) {
      const available = this.enabledIds();
      return {
        ok: false,
        error:
          `Unknown agent type "${normalized}".` +
          (available.length > 0
            ? ` Available types: ${available.join(", ")}.`
            : " No agent types are available."),
      };
    }
    if (!definition.enabled) {
      return {
        ok: false,
        error: `Agent "${normalized}" is disabled.`,
      };
    }
    return { ok: true, definition };
  }

  /** The problems found while reading the file layers, if any. */
  errors(): readonly string[] {
    return this.loadErrors;
  }
}

/**
 * Merge the layers into the effective definitions.
 *
 * The shipped specialists are the base; the global files refine them; the
 * project's files refine those. A definition no layer introduces gets the
 * defaults, so a file can define an agent the package has never heard of.
 */
function buildDefinitions(
  global: LoadedScope,
  project: LoadedScope | undefined,
): Map<string, AgentDefinition> {
  const definitions = new Map<string, AgentDefinition>();

  for (const shipped of SHIPPED_DEFINITIONS) {
    definitions.set(shipped.id, { ...shipped });
  }

  applyScope(definitions, global, "global");
  if (project) applyScope(definitions, project, "project");

  return definitions;
}

/** Apply one scope's definitions onto the merged set. */
function applyScope(
  definitions: Map<string, AgentDefinition>,
  scope: LoadedScope,
  origin: DefinitionOrigin,
): void {
  for (const loaded of scope.definitions) {
    // The identifier is normalized wherever the definition came from, so a
    // file called "Reviewer.md" refines the shipped "reviewer".
    const id = normalizeAgentId(loaded.id);
    const base = definitions.get(id) ?? defaultDefinition(id, origin);
    definitions.set(id, mergeDefinition(base, loaded.patch, origin));
  }
}
