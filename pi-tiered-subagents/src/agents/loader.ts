/**
 * loader.ts — Reads agent definitions from Markdown files.
 *
 * A definition file is a Markdown document whose frontmatter carries the
 * settings and whose body is the agent's standing instructions:
 *
 * ```markdown
 * ---
 * display_name: Reviewer
 * description: Independent assessment of a scoped change
 * tools: read, grep, find
 * model: anthropic/claude-sonnet-5
 * thinking: medium
 * inherit_context: false
 * ---
 *
 * Assess the change against the stated requirements. Report findings; do not
 * claim checks you did not run.
 * ```
 *
 * The file's name is the agent's identifier, lowercased. A file contributes
 * only what it mentions: an absent key leaves the layer below untouched, and
 * `null` clears an inherited optional setting.
 *
 * Two files in one scope that normalize to the same identifier are a
 * duplicate, and a duplicate is reported rather than resolved by filesystem
 * order — the operator has to delete one of them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type {
  AgentDefinitionPatch,
  ToolSelection,
} from "#src/agents/definition";
import { normalizeAgentId } from "#src/agents/definition";
import {
  parseThinkingLevel,
  thinkingLevelError,
} from "#src/config/thinking-level";
import { debugLog } from "#src/debug";

/** One definition file, as read from disk. */
export interface LoadedDefinition {
  /** The normalized identifier — the file's name, lowercased. */
  readonly id: string;
  /** What the file contributes. */
  readonly patch: AgentDefinitionPatch;
  /** Where the file was read from, for error messages. */
  readonly path: string;
}

/** One file's name and content, as the collector sees it. */
export interface DefinitionFile {
  /** The file's name, with its extension. */
  readonly name: string;
  /** The file's content. */
  readonly content: string;
  /** Where the file was read from, for error messages. */
  readonly path: string;
}

/** The definitions one scope holds, and what went wrong while reading them. */
export interface LoadedScope {
  /** The definitions, in file-name order. */
  readonly definitions: readonly LoadedDefinition[];
  /** Human-readable problems: a duplicate identifier, an unreadable file. */
  readonly errors: readonly string[];
}

/** The two file scopes a registry merges. */
export interface LoadedScopes {
  /** The operator's global definitions. */
  readonly global: LoadedScope;
  /**
   * The project's definitions.
   *
   * Absent when the project is not trusted: its files are never read, so
   * opening a repository cannot change what an agent may do.
   */
  readonly project?: LoadedScope;
}

/** Where the two file scopes are read from. */
export interface DefinitionSources {
  /** Pi's agent directory; the global definitions live in `<agentDir>/agents`. */
  readonly globalDir: string;
  /** The project root; the project definitions live in `<cwd>/.pi/agents`. */
  readonly cwd: string;
  /** Whether Pi has granted the project trust. */
  readonly projectTrusted: boolean;
}

/**
 * Read both file scopes.
 *
 * The project scope is read only when the project is trusted.
 */
export function loadDefinitionScopes(sources: DefinitionSources): LoadedScopes {
  const global = loadDefinitionScope(join(sources.globalDir, "agents"));
  const project = sources.projectTrusted
    ? loadDefinitionScope(join(sources.cwd, ".pi", "agents"))
    : undefined;
  return { global, project };
}

/**
 * The keyword that selects the parent's tools instead of naming them.
 *
 * A definition writes `tools: inherit` to say "whatever the parent has".
 */
const INHERIT_TOOLS = "inherit";

/**
 * The word that means "no tools at all", as upstream's agent files spell it.
 *
 * An empty list (`tools: []`) says the same thing; this is the older
 * spelling, kept so existing files keep working.
 */
const NO_TOOLS = "none";

/**
 * Read every definition file in a directory.
 *
 * A missing directory holds no definitions — that is the normal case for a
 * scope the operator never used.
 */
export function loadDefinitionScope(dir: string): LoadedScope {
  if (!existsSync(dir)) return { definitions: [], errors: [] };

  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .sort();
  } catch (err) {
    debugLog("readdirSync agents dir", err);
    return { definitions: [], errors: [] };
  }

  const files: DefinitionFile[] = [];
  const errors: string[] = [];

  for (const name of names) {
    const path = join(dir, name);
    try {
      files.push({ name, content: readFileSync(path, "utf-8"), path });
    } catch (err) {
      debugLog("readFileSync agent file", err);
      errors.push(`Could not read the agent definition at ${path}.`);
    }
  }

  const scope = collectDefinitions(files);
  return {
    definitions: scope.definitions,
    errors: [...errors, ...scope.errors],
  };
}

/**
 * Collect the definitions a scope's files describe.
 *
 * Two files that normalize to the same identifier are a duplicate, and a
 * duplicate is reported rather than resolved by filesystem order — the
 * operator has to delete one of them. Neither is used: picking one would make
 * the answer depend on which file the filesystem listed first.
 */
export function collectDefinitions(
  files: readonly DefinitionFile[],
): LoadedScope {
  const definitions: LoadedDefinition[] = [];
  const errors: string[] = [];
  const byId = new Map<string, LoadedDefinition>();
  const duplicated = new Set<string>();

  for (const file of files) {
    const id = normalizeAgentId(basename(file.name, ".md"));

    const existing = byId.get(id);
    if (existing) {
      if (!duplicated.has(id)) {
        errors.push(
          `Two agent definitions normalize to the identifier "${id}": ` +
            `${existing.path} and ${file.path}. Rename one of them; neither is used.`,
        );
        duplicated.add(id);
        definitions.splice(definitions.indexOf(existing), 1);
        byId.delete(id);
      }
      continue;
    }

    const definition: LoadedDefinition = {
      id,
      patch: parseDefinitionContent(file.content),
      path: file.path,
    };
    definitions.push(definition);
    byId.set(id, definition);
  }

  return { definitions, errors };
}

/**
 * Read one definition file's frontmatter and body into a patch.
 *
 * Pure: the file's content in, the patch out. A frontmatter value the
 * definition does not recognize is ignored rather than failing the file.
 */
export function parseDefinitionContent(content: string): AgentDefinitionPatch {
  const { frontmatter: fm, body } = parseFrontmatter(content);

  return {
    displayName: stringField(fm.display_name),
    description: stringField(fm.description),
    // The body is the standing instructions. An empty body inherits the
    // instructions of the layer below, so a configuration-only override stays
    // concise.
    instructions: body.trim() === "" ? undefined : body.trim(),
    tools: toolSelection(fm.tools),
    model: stringField(fm.model),
    thinking: thinkingField(fm.thinking),
    maxTurns: numberField(fm.max_turns),
    inheritContext: booleanField(fm.inherit_context),
    runInBackground: booleanField(fm.run_in_background),
    enabled: booleanField(fm.enabled),
  };
}

/**
 * A string field: absent stays absent, an explicit null clears, anything else
 * is trimmed.
 */
function stringField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

/**
 * A number field: absent stays absent, an explicit null clears, and a
 * non-negative number is taken as written.
 */
function numberField(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 0 ? undefined : value;
}

/**
 * A boolean field: absent stays absent, an explicit null clears, and only
 * `true` and `false` are read as booleans.
 */
function booleanField(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "boolean") return undefined;
  return value;
}

/**
 * The reasoning level a definition names.
 *
 * An unrecognized level is dropped rather than passed on: Pi clamps a level it
 * does not know down to `off`, which would silently disable reasoning for an
 * agent whose author asked for more of it.
 */
function thinkingField(value: unknown): AgentDefinitionPatch["thinking"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const level = parseThinkingLevel(value);
  if (level === undefined) {
    debugLog("agent frontmatter thinking", thinkingLevelError(value));
    return undefined;
  }
  return level;
}

/**
 * The tool selection a definition names.
 *
 * `inherit` selects the parent's tools; a list names the tools; an empty list
 * (or upstream's `none`) means no tools at all.
 */
function toolSelection(value: unknown): ToolSelection | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (trimmed.toLowerCase() === INHERIT_TOOLS) return { kind: "inherit" };
    if (trimmed.toLowerCase() === NO_TOOLS) {
      return { kind: "explicit", names: [] };
    }
    return { kind: "explicit", names: splitList(trimmed) };
  }

  if (Array.isArray(value)) {
    const names = value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
    if (names.length === 0) return { kind: "explicit", names: [] };
    if (names.length === 1 && names[0]?.toLowerCase() === INHERIT_TOOLS) {
      return { kind: "inherit" };
    }
    return { kind: "explicit", names };
  }

  return undefined;
}

/** Split a comma-separated tool list. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
