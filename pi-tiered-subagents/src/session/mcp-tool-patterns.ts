/**
 * mcp-tool-patterns.ts — expand `mcp__…*` entries of an agent's tool allowlist.
 *
 * An MCP server's tool names exist only once the server connects. Rather than
 * passing Pi a live glob that could admit capabilities added after acceptance,
 * an agent may write a pattern such as `mcp__github__*`, expanded against
 * the tool names the parent session has registered when the child is created.
 * Pi derives an MCP tool's name from its server and tool alone, so the child's
 * own MCP extension registers the same names.
 */

/** Reject SDK selection syntax left after request-time MCP pattern expansion. */
export function concreteToolNamesError(
  toolNames: ReadonlyArray<string>,
): string | undefined {
  return toolNames.some((name) => name.includes("*") || /^[+-]/.test(name))
    ? "Child capabilities require concrete tool names; unresolved patterns and +/- tool modifiers are not supported."
    : undefined;
}

/** An agent's allowlist with its MCP patterns expanded. */
export type ExpandedTools = {
  /** Literal entries kept, each pattern replaced by its matches, deduplicated, order preserved. */
  toolNames: string[];
  /** Patterns that matched none of the available tools. */
  unmatchedPatterns: string[];
};

/**
 * Expand each `mcp__` entry containing `*` into the `available` names it
 * matches, where `*` matches any run of characters and the whole name must
 * match. Every other entry is kept as written.
 */
export function expandMcpToolPatterns(
  declared: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
): ExpandedTools {
  const toolNames = new Set<string>();
  const unmatchedPatterns: string[] = [];
  for (const entry of declared) {
    if (!isMcpPattern(entry)) {
      toolNames.add(entry);
      continue;
    }
    const matcher = patternMatcher(entry);
    const matches = available.filter((name) => matcher.test(name));
    if (matches.length === 0) unmatchedPatterns.push(entry);
    for (const name of matches) toolNames.add(name);
  }
  return { toolNames: [...toolNames], unmatchedPatterns };
}

function isMcpPattern(entry: string): boolean {
  return entry.startsWith("mcp__") && entry.includes("*");
}

function patternMatcher(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}
