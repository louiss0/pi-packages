/**
 * registry.ts — The layered registry of agent definitions.
 *
 * Three layers, each refining the one below it:
 *
 * 1. the shipped specialists,
 * 2. the operator's global files (`<agentDir>/agents/*.md`),
 * 3. the project's files (`<cwd>/.pi/agents/*.md`).
 *
 * All three load while the extension runs. Whether a project's files may be
 * used is Pi's decision about its own resources; this package adds no second
 * trust gate (ARCHITECTURE-SPEC story 36).
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
  | {
      readonly ok: false;
      /** Which kind of failure it is, for a caller that must branch. */
      readonly reason: "unknown-agent" | "disabled-agent";
      /** The sentence an operator reads. Never parsed — branch on `reason`. */
      readonly error: string;
    };

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
  private scopes: LoadedScopes;

  constructor(private readonly load: () => LoadedScopes) {
    this.scopes = load();
    this.rebuild();
  }

  /** Re-read the file layers and rebuild the merged definitions. */
  reload(): void {
    this.scopes = this.load();
    this.rebuild();
  }

  /**
   * The scopes of the last reload, with their arrays copied.
   *
   * Preparation builds an immutable catalog from these instead of selecting
   * through this mutable registry (ARCHITECTURE-SPEC story 29).
   */
  currentScopes(): LoadedScopes {
    return {
      global: {
        ...this.scopes.global,
        definitions: [...this.scopes.global.definitions],
        errors: [...this.scopes.global.errors],
      },
      project: {
        ...this.scopes.project,
        definitions: [...this.scopes.project.definitions],
        errors: [...this.scopes.project.errors],
      },
    };
  }

  private rebuild(): void {
    const { global, project } = this.scopes;
    this.loadErrors = [...global.errors, ...project.errors];
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
    return selectFrom(this.definitions, id);
  }

  /** The problems found while reading the file layers, if any. */
  errors(): readonly string[] {
    return this.loadErrors;
  }
}

/**
 * Build an immutable catalog for one preparation from already-loaded scopes.
 *
 * Each preparation owns its catalog: concurrent launches never select
 * through the mutable live registry, so one request cannot observe another
 * request's half-refreshed definitions.
 */
export function buildCatalog(scopes: LoadedScopes): AgentDefinitionLookup {
  return new Catalog(buildDefinitions(scopes.global, scopes.project));
}

/** An immutable lookup over one preparation's merged definitions. */
class Catalog implements AgentDefinitionLookup {
  constructor(private readonly definitions: Map<string, AgentDefinition>) {}

  /** Every definition, in identifier order. */
  list(): readonly AgentDefinition[] {
    return [...this.definitions.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  /** The definition for an identifier, or undefined when there is none. */
  find(id: string): AgentDefinition | undefined {
    return this.definitions.get(normalizeAgentId(id));
  }

  /** The definition for an identifier, or the reason there is none. */
  select(id: string): AgentSelection {
    return selectFrom(this.definitions, id);
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
  project: LoadedScope,
): Map<string, AgentDefinition> {
  const definitions = new Map<string, AgentDefinition>();

  for (const shipped of SHIPPED_DEFINITIONS) {
    definitions.set(shipped.id, { ...shipped });
  }

  applyScope(definitions, global, "global");
  applyScope(definitions, project, "project");

  return definitions;
}

/**
 * The selection both lookup implementations answer with.
 *
 * An unknown identifier and a disabled one are different failures, and both
 * are failures: neither is answered with another agent.
 */
function selectFrom(
  definitions: Map<string, AgentDefinition>,
  id: string,
): AgentSelection {
  const normalized = normalizeAgentId(id);
  const definition = definitions.get(normalized);
  if (!definition) {
    const available = [...definitions.values()]
      .filter((candidate) => candidate.enabled)
      .map((candidate) => candidate.id)
      .sort();
    return {
      ok: false,
      reason: "unknown-agent",
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
      reason: "disabled-agent",
      error: `Agent "${normalized}" is disabled.`,
    };
  }
  return { ok: true, definition };
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
