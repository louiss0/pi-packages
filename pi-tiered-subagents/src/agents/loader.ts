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
 *
 * The frontmatter is untrusted bytes, so it is validated here, once, at the
 * seam: a recognized key holding an invalid value is reported and dropped
 * rather than reinterpreted as absence, and a frontmatter block that is not
 * readable YAML makes its file unusable — reported, never thrown out of the
 * loader (ARCHITECTURE-SPEC story 106).
 *
 * Both scopes are read unconditionally. Whether a project's files may be used
 * is Pi's decision, made for its own resources; this package adds no second
 * trust gate of its own (ARCHITECTURE-SPEC story 36).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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
import { defined } from "#src/optional";

/** One definition file, as read from disk. */
export type LoadedDefinition = Readonly<{
  /** The normalized identifier — the file's name, lowercased. */
  id: string;
  /** What the file contributes. */
  patch: AgentDefinitionPatch;
  /** Where the file was read from, for error messages. */
  path: string;
}>;

/** One file's name and content, as the collector sees it. */
export type DefinitionFile = Readonly<{
  /** The file's name, with its extension. */
  name: string;
  /** The file's content. */
  content: string;
  /** Where the file was read from, for error messages. */
  path: string;
}>;

/** The definitions one scope holds, and what went wrong while reading them. */
export type LoadedScope = Readonly<{
  /** Scope contents are unknown, so no lower-layer fallback is safe. */
  scopeError?: string;
  /** Identifier-specific failures that must not fall back to a lower layer. */
  invalidDefinitions?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** The definitions, in file-name order. */
  definitions: ReadonlyArray<LoadedDefinition>;
  /** Human-readable problems: a duplicate identifier, an unreadable file. */
  errors: ReadonlyArray<string>;
}>;

/** The two file scopes a registry merges. Both are always read. */
export type LoadedScopes = Readonly<{
  /** The operator's global definitions. */
  global: LoadedScope;
  /** The project's definitions. */
  project: LoadedScope;
}>;

/** Where the two file scopes are read from. */
export type DefinitionSources = Readonly<{
  /** Pi's agent directory; the global definitions live in `<agentDir>/agents`. */
  globalDir: string;
  /** The project root; the project definitions live in `<cwd>/.pi/agents`. */
  cwd: string;
}>;

/** Read both file scopes through the legacy synchronous registry path. */
export function loadDefinitionScopes(sources: DefinitionSources): LoadedScopes {
  return {
    global: loadDefinitionScope(join(sources.globalDir, "agents")),
    project: loadDefinitionScope(join(sources.cwd, ".pi", "agents")),
  };
}

/**
 * Read both file scopes asynchronously for one launch request.
 *
 * Each call owns its result. Concurrent preparations never select through the
 * mutable live registry, so one request cannot observe another request's
 * half-refreshed catalog.
 */
export async function loadDefinitionScopesAsync(
  sources: DefinitionSources,
  signal?: AbortSignal,
): Promise<LoadedScopes> {
  const [global, project] = await Promise.all([
    loadDefinitionScopeAsync(join(sources.globalDir, "agents"), signal),
    loadDefinitionScopeAsync(join(sources.cwd, ".pi", "agents"), signal),
  ]);
  throwIfAborted(signal);
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
    if (isMissingPathError(err)) return { definitions: [], errors: [] };
    debugLog("readdirSync agents dir", err);
    return failedScope(dir);
  }

  const files: DefinitionFile[] = [];
  const errors: string[] = [];
  const unreadable: Record<string, string[]> = {};

  for (const name of names) {
    const path = join(dir, name);
    try {
      files.push({ name, content: readFileSync(path, "utf-8"), path });
    } catch (err) {
      debugLog("readFileSync agent file", err);
      const problem = `Could not read the agent definition at ${path}.`;
      errors.push(problem);
      unreadable[normalizeAgentId(basename(name, ".md"))] = [problem];
    }
  }

  const scope = collectDefinitions(files);
  return {
    ...scope,
    ...(Object.keys(unreadable).length > 0
      ? { invalidDefinitions: { ...scope.invalidDefinitions, ...unreadable } }
      : {}),
    definitions: scope.definitions,
    errors: [...errors, ...scope.errors],
  };
}

/**
 * Asynchronously read every definition file in one directory.
 *
 * A missing directory remains an empty scope. Other directory failures are
 * scope-wide configuration failures, while unreadable files are reported
 * individually. Cancellation is different: it propagates so the
 * launch boundary can return the expected `cancelled` rejection.
 */
export async function loadDefinitionScopeAsync(
  dir: string,
  signal?: AbortSignal,
): Promise<LoadedScope> {
  throwIfAborted(signal);

  let names: string[];
  try {
    names = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
  } catch (err) {
    if (signal?.aborted) throw err;
    if (isMissingPathError(err)) return { definitions: [], errors: [] };
    debugLog("readdir agents dir", err);
    return failedScope(dir);
  }

  const files: DefinitionFile[] = [];
  const errors: string[] = [];
  const unreadable: Record<string, string[]> = {};
  for (const name of names) {
    throwIfAborted(signal);
    const path = join(dir, name);
    try {
      const content = await readFile(path, {
        encoding: "utf-8",
        ...defined({ signal }),
      });
      files.push({ name, content, path });
    } catch (err) {
      if (signal?.aborted) throw err;
      debugLog("readFile agent file", err);
      const problem = `Could not read the agent definition at ${path}.`;
      errors.push(problem);
      unreadable[normalizeAgentId(basename(name, ".md"))] = [problem];
    }
  }

  throwIfAborted(signal);
  const scope = collectDefinitions(files);
  return {
    ...scope,
    ...(Object.keys(unreadable).length > 0
      ? { invalidDefinitions: { ...scope.invalidDefinitions, ...unreadable } }
      : {}),
    definitions: scope.definitions,
    errors: [...errors, ...scope.errors],
  };
}

function failedScope(dir: string): LoadedScope {
  const scopeError = `Could not read the agent definitions directory at ${dir}.`;
  return { definitions: [], errors: [scopeError], scopeError };
}

/** Stop before starting another filesystem operation after caller cancellation. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

/** Whether a failed directory read means the optional scope does not exist. */
function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "ENOENT"
  );
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
  files: ReadonlyArray<DefinitionFile>,
): LoadedScope {
  const definitions: LoadedDefinition[] = [];
  const errors: string[] = [];
  const byId = new Map<string, LoadedDefinition>();
  const duplicated = new Set<string>();
  const invalidDefinitions: Record<string, string[]> = {};

  for (const file of files) {
    const id = normalizeAgentId(basename(file.name, ".md"));

    const existing = byId.get(id);
    if (duplicated.has(id)) continue;
    if (existing) {
      if (!duplicated.has(id)) {
        const problem =
          `Two agent definitions normalize to the identifier "${id}": ` +
          `${existing.path} and ${file.path}. Rename one of them; neither is used.`;
        errors.push(problem);
        invalidDefinitions[id] = [problem];
        duplicated.add(id);
        definitions.splice(definitions.indexOf(existing), 1);
        byId.delete(id);
      }
      continue;
    }

    const parsed = parseDefinitionFile(file);
    if (!parsed.ok) {
      invalidDefinitions[id] = [
        ...(invalidDefinitions[id] ?? []),
        parsed.error,
      ];
      errors.push(parsed.error);
      continue;
    }
    errors.push(...parsed.problems);
    if (parsed.problems.length > 0) {
      invalidDefinitions[id] = [
        ...(invalidDefinitions[id] ?? []),
        ...parsed.problems,
      ];
    }

    const definition: LoadedDefinition = {
      id,
      patch: parsed.patch,
      path: file.path,
    };
    definitions.push(definition);
    byId.set(id, definition);
  }

  return {
    definitions,
    errors,
    ...(Object.keys(invalidDefinitions).length ? { invalidDefinitions } : {}),
  };
}

/** One file's parse outcome: the patch and its diagnostics, or the reason the file is unusable. */
type ParsedDefinitionFile =
  | {
      readonly ok: true;
      readonly patch: AgentDefinitionPatch;
      readonly problems: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Read one file into a patch without letting its bytes escape the seam.
 *
 * A frontmatter block that is not readable YAML makes the file unusable —
 * reported, like a duplicate, rather than resolved into a definition the
 * operator did not write. A recognized key holding an invalid value is a
 * diagnostic on an otherwise usable file: the value is dropped, never
 * reinterpreted as absence.
 */
function parseDefinitionFile(file: DefinitionFile): ParsedDefinitionFile {
  const problems: string[] = [];
  let patch: AgentDefinitionPatch;
  try {
    patch = parseDefinitionContent(file.content, (problem) =>
      problems.push(problem),
    );
  } catch (err) {
    debugLog("parse agent definition", err);
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not parse the agent definition at ${file.path}: ${reason}.`,
    };
  }
  return {
    ok: true,
    patch,
    problems: problems.map(
      (problem) => `The agent definition at ${file.path}: ${problem}.`,
    ),
  };
}

/** Reports a field-level problem found while validating one file's frontmatter. */
type FieldReporter = (problem: string) => void;

/**
 * Read one definition file's frontmatter and body into a patch.
 *
 * Pure: the file's content in, the patch out. A frontmatter value the
 * definition does not recognize is ignored rather than failing the file; a
 * value it recognizes but cannot use is reported through `report` and dropped
 * — absence stays the file's own choice, not the loader's reinterpretation.
 *
 * Throws when the frontmatter block is not readable YAML; the collector turns
 * that into a diagnostic, so the throw never leaves the seam.
 */
export function parseDefinitionContent(
  content: string,
  report?: FieldReporter,
): AgentDefinitionPatch {
  const { frontmatter: rawFrontmatter, body } = parseFrontmatter(content);
  // The SDK types the frontmatter as a record, but the bytes decide: a scalar
  // or a sequence is a frontmatter the file did not write, so it is diagnosed
  // and ignored rather than read key by key as if it were a mapping.
  const fm: Record<string, unknown> =
    typeof rawFrontmatter === "object" &&
    rawFrontmatter !== null &&
    !Array.isArray(rawFrontmatter)
      ? rawFrontmatter
      : {};
  if (fm !== rawFrontmatter) {
    report?.("the frontmatter is not a mapping; its keys are ignored");
  }

  return {
    ...defined({
      displayName: stringField("display_name", fm.display_name, report),
      description: stringField("description", fm.description, report),
      // The body is the standing instructions. An empty body inherits the
      // instructions of the layer below, so a configuration-only override stays
      // concise.
      instructions: body.trim() === "" ? undefined : body.trim(),
      tools: toolSelection(fm.tools, report),
      model: stringField("model", fm.model, report),
      thinking: thinkingField(fm.thinking, report),
      maxTurns: numberField("max_turns", fm.max_turns, report),
      inheritContext: booleanField(
        "inherit_context",
        fm.inherit_context,
        report,
      ),
      runInBackground: booleanField(
        "run_in_background",
        fm.run_in_background,
        report,
      ),
      enabled: booleanField("enabled", fm.enabled, report),
    }),
  };
}

/**
 * A string field: absent stays absent, an explicit null clears, anything else
 * is trimmed. A value of another type is reported rather than dropped
 * silently.
 */
function stringField(
  key: string,
  value: unknown,
  report?: FieldReporter,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    report?.(`the "${key}" value must be a string; the value is ignored`);
    return undefined;
  }
  return value.trim();
}

/**
 * A number field: absent stays absent, an explicit null clears, and a
 * non-negative number is taken as written. Anything else is reported.
 */
function numberField(
  key: string,
  value: unknown,
  report?: FieldReporter,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    report?.(
      `the "${key}" value must be a non-negative number; the value is ignored`,
    );
    return undefined;
  }
  return value;
}

/**
 * A boolean field: absent stays absent, an explicit null clears, and only
 * `true` and `false` are read as booleans. Anything else is reported.
 */
function booleanField(
  key: string,
  value: unknown,
  report?: FieldReporter,
): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "boolean") {
    report?.(`the "${key}" value must be true or false; the value is ignored`);
    return undefined;
  }
  return value;
}

/**
 * The reasoning level a definition names.
 *
 * An unrecognized level is dropped rather than passed on: Pi clamps a level it
 * does not know down to `off`, which would silently disable reasoning for an
 * agent whose author asked for more of it.
 */
function thinkingField(
  value: unknown,
  report?: FieldReporter,
): AgentDefinitionPatch["thinking"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const level = parseThinkingLevel(value);
  if (level === undefined) {
    report?.(thinkingLevelError(value));
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
function toolSelection(
  value: unknown,
  report?: FieldReporter,
): ToolSelection | null | undefined {
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
    // Only strings name a tool; coercing another type would reinterpret a
    // value the file did not write, so it is reported and dropped.
    const invalid = value.filter((entry) => typeof entry !== "string");
    if (invalid.length > 0) {
      report?.(
        `the "tools" list holds ${invalid.length} ${
          invalid.length === 1 ? "entry that is" : "entries that are"
        } not a tool name; ${invalid.length === 1 ? "it is" : "they are"} ignored`,
      );
    }
    const names = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (names.length === 0) return { kind: "explicit", names: [] };
    if (names.length === 1 && names[0]?.toLowerCase() === INHERIT_TOOLS) {
      return { kind: "inherit" };
    }
    return { kind: "explicit", names };
  }

  report?.(
    `the "tools" value must be a comma-separated list or a YAML list; the value is ignored`,
  );
  return undefined;
}

/** Split a comma-separated tool list. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
