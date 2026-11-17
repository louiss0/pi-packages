/**
 * fork.ts — Seed an inherited parent conversation branch into a child session.
 *
 * `inherit_context: true` forks the parent's completed conversation into the
 * child's `SessionManager` in memory. No parent session file is read and no
 * intermediate fork file is written: the branch was captured from the parent's
 * in-memory tree at request time, and the child's own session manager replays
 * it through its public append API before the SDK session is created.
 *
 * Metadata entries that would otherwise pin the child to the parent's model,
 * reasoning level, usage totals, or session name are deliberately not
 * replayed: those are launch decisions, not conversation. A custom boundary
 * entry marks where the inherited history ends so the transcript viewer can
 * show only the child's own turns.
 */

import type { InheritedBranchEntry } from "#src/session/context";

/**
 * The custom session-entry type marking the end of inherited parent history.
 *
 * Kept as a literal here and in the UI transcript reader because the UI
 * boundary rule forbids presentation modules importing session implementation.
 */
export const FORK_BOUNDARY_ENTRY = "subagents:fork-boundary";

/** The append operations a session manager must expose to receive a fork. */
export interface ForkSessionManager {
  appendMessage(message: unknown): string;
  appendCustomMessageEntry(
    customType: string,
    content: unknown,
    display: boolean,
    details?: unknown,
  ): string;
  appendCompaction(
    summary: string,
    firstKeptEntryId: string | null,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
    usage?: unknown,
  ): string;
  appendContextEdit(targetId: string, replacement: unknown): string;
  appendCustomEntry(customType: string, data?: unknown): string;
}

type BranchRecord = Record<string, unknown> & { type?: unknown };

/**
 * Replay one captured parent branch into a child session manager, then append
 * the fork boundary.
 *
 * Appending in branch order keeps the conversation valid. Entry ids are
 * remapped because a fresh session generates its own: any reference inside a
 * replayed entry (`firstKeptEntryId` on a compaction, `targetId` on a context
 * edit) is resolved against the ids the new session issued.
 */
export function seedInheritedBranch(
  manager: ForkSessionManager,
  branch: ReadonlyArray<InheritedBranchEntry>,
): void {
  if (branch.length === 0) return;

  const replayedIds = new Map<string, string>();

  for (const raw of branch) {
    const record = raw as BranchRecord;
    const oldId = typeof record.id === "string" ? record.id : undefined;
    const replayedId = replayEntry(manager, record, replayedIds);
    if (oldId && replayedId) replayedIds.set(oldId, replayedId);
  }

  manager.appendCustomEntry(FORK_BOUNDARY_ENTRY);
}

function replayEntry(
  manager: ForkSessionManager,
  entry: BranchRecord,
  replayedIds: ReadonlyMap<string, string>,
): string | undefined {
  switch (entry.type) {
    case "message":
      // `captureParentBranch` drops system-prompt messages; guard here too so
      // a branch built directly cannot give the child a second system prompt.
      if (isSystemMessage(entry.message)) return undefined;
      return manager.appendMessage(entry.message);

    case "custom_message":
      return manager.appendCustomMessageEntry(
        asString(entry.customType),
        entry.content,
        entry.display === true,
        entry.details,
      );

    case "branch_summary":
      // A branch summary is model-visible context, but the SDK exposes no
      // appendBranchSummary() on the public surface. Replaying it as a custom
      // message keeps the decisions it recorded in the child's context.
      return manager.appendCustomMessageEntry(
        "subagents:fork-branch-summary",
        asString(entry.summary),
        false,
      );

    case "compaction": {
      const kept = asString(entry.firstKeptEntryId);
      return manager.appendCompaction(
        asString(entry.summary),
        kept ? (replayedIds.get(kept) ?? null) : null,
        asNumber(entry.tokensBefore),
        entry.details,
        entry.fromHook === true,
        entry.usage,
      );
    }

    case "context_edit": {
      const target = asString(entry.targetId);
      const mapped = target ? replayedIds.get(target) : undefined;
      // An edit whose target was not replayed has nothing to replace.
      return mapped
        ? manager.appendContextEdit(mapped, entry.replacement)
        : undefined;
    }

    // Model/thinking choices, usage totals, session names, labels, and opaque
    // custom entries are not conversation. Replaying them would either
    // re-decide a launch choice or double-count the parent's usage on the
    // child's record. Branch summaries are handled above.
    default:
      return undefined;
  }
}

function isSystemMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "system"
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
