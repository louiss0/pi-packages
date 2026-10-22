/**
 * impact.ts — What a child's tools may change in the workspace.
 *
 * Two children that may both write the same file compete for it, so the
 * runtime lets only one of them run at a time. What decides this is the
 * child's *effective* tools — the ones it will really have, after its
 * definition's override — and never the role's name: a worker overridden to
 * read only changes nothing, and a reviewer handed a shell changes
 * everything.
 *
 * The classification is deliberately one-sided. Only the tools this package
 * knows to be read-only count as read-only; anything else — a shell, an
 * editor, an extension's own tool this package has never heard of — is
 * treated as able to change files. A tool that turns out to be harmless costs
 * a wait; a tool that turns out to write costs a corrupted workspace.
 */

/** How a child's tools may change the workspace. */
export type WorkspaceImpact = "read-only" | "file-changing";

/**
 * The tools this package knows only read.
 *
 * The list is the read-only half of the vocabulary the shipped specialists
 * use: the local readers and the web search. Every other name — including
 * names this package has never seen — is treated as able to write.
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
]);

/**
 * Classify a child's effective tools.
 *
 * A child with no tools changes nothing, so it is read-only; one with any
 * tool this package cannot vouch for takes the exclusive slot.
 */
export function classifyWorkspaceImpact(
  toolNames: readonly string[],
): WorkspaceImpact {
  for (const name of toolNames) {
    if (!READ_ONLY_TOOLS.has(name)) return "file-changing";
  }
  return "read-only";
}
