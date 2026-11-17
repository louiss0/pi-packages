/**
 * context.ts — Capture and sanitize parent session branch entries for subagent inheritance.
 */

import type { TextContent } from "@earendil-works/pi-ai";
import type { SessionContext } from "#src/types";

/**
 * One entry captured from the parent's session branch for in-memory seeding
 * into a child's `SessionManager`.
 */
export type InheritedBranchEntry = Readonly<
  Record<string, unknown> & { type: string }
>;

type ContentBlock = Record<string, unknown> & { type?: unknown };
type MessageRecord = Record<string, unknown> & {
  role?: unknown;
  provider?: unknown;
  api?: unknown;
  model?: unknown;
  content?: unknown;
  toolCallId?: unknown;
};
type MutableBranchEntry = Record<string, unknown> & {
  type: string;
  id?: unknown;
  parentId?: unknown;
  firstKeptEntryId?: unknown;
  targetId?: unknown;
  message?: MessageRecord;
  replacement?: { content?: unknown } | null;
};

/** Type predicate: narrow an unknown content block to TextContent. */
function isTextContent(c: unknown): c is TextContent {
  return (
    typeof c === "object" &&
    c !== null &&
    (c as { type: string }).type === "text"
  );
}

/** Extract text from a message content block array. */
export function extractText(content: unknown[]): string {
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n");
}

/**
 * Capture and sanitize the completed portion of the parent's session branch.
 *
 * Strips any uncommitted trailing assistant tool-call step (such as the
 * in-flight `subagent` call itself), removes `label` entries while re-chaining
 * `parentId` / `firstKeptEntryId`, strips parent-bound Anthropic thinking
 * signatures and `redacted_thinking` blocks, and deep-copies every entry so
 * later parent mutations cannot affect a queued child.
 */
export function captureParentBranch(
  ctx: SessionContext,
): ReadonlyArray<InheritedBranchEntry> {
  const raw = ctx.sessionManager.getBranch();
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const cloned = structuredClone(raw).filter(isMutableBranchEntry);
  const committed = stripUncommittedTrailingAssistantStep(cloned);
  const rechained = stripLabelsAndRechain(committed);
  sanitizeUnsafeThinkingBlocks(rechained);
  return rechained;
}

function isMutableBranchEntry(entry: unknown): entry is MutableBranchEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof (entry as { type?: unknown }).type === "string" &&
    (entry as { type: string }).type !== "session"
  );
}

function stripUncommittedTrailingAssistantStep(
  entries: MutableBranchEntry[],
): MutableBranchEntry[] {
  const lastAssistantIdx = entries.findLastIndex(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  if (lastAssistantIdx === -1) return entries;

  const assistantEntry = entries[lastAssistantIdx]!;
  const content = assistantEntry.message?.content;
  if (!Array.isArray(content)) return entries;

  const toolCalls = content.filter(
    (block): block is ContentBlock =>
      typeof block === "object" &&
      block !== null &&
      (block as ContentBlock).type === "toolCall",
  );
  if (toolCalls.length === 0) return entries;

  const trailingResults = entries
    .slice(lastAssistantIdx + 1)
    .filter(
      (entry) =>
        entry.type === "message" && entry.message?.role === "toolResult",
    );

  const completedIds = new Set(
    trailingResults
      .map((entry) => entry.message?.toolCallId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const allCompleted =
    trailingResults.length >= toolCalls.length &&
    toolCalls.every((call) => {
      const id = call.id;
      return typeof id === "string" && id.length > 0
        ? completedIds.has(id)
        : true;
    });

  if (allCompleted) return entries;

  // Cut the in-flight assistant step and only the tool results that belong to
  // it. Any trailing metadata (model/usage/custom entries) stays: it is not
  // part of the uncommitted turn, and stripLabelsAndRechain re-chains it to
  // the new leaf.
  return entries.filter((entry, index) => {
    if (index === lastAssistantIdx) return false;
    if (index > lastAssistantIdx) {
      return !(
        entry.type === "message" && entry.message?.role === "toolResult"
      );
    }
    return true;
  });
}

function stripLabelsAndRechain(
  entries: MutableBranchEntry[],
): MutableBranchEntry[] {
  const result: MutableBranchEntry[] = [];
  const replacementByLabelId = new Map<string, string>();
  const pendingLabelIds: string[] = [];
  let pathParentId: string | null = null;

  for (const entry of entries) {
    if (entry.type === "label") {
      if (typeof entry.id === "string") {
        pendingLabelIds.push(entry.id);
      }
      continue;
    }

    if (typeof entry.id === "string") {
      for (const labelId of pendingLabelIds) {
        replacementByLabelId.set(labelId, entry.id);
      }
      pendingLabelIds.length = 0;
    }

    const next: MutableBranchEntry = { ...entry };
    if ("parentId" in next || typeof next.id === "string") {
      next.parentId = pathParentId;
    }
    if (
      next.type === "compaction" &&
      typeof next.firstKeptEntryId === "string" &&
      next.firstKeptEntryId !== next.id
    ) {
      next.firstKeptEntryId =
        replacementByLabelId.get(next.firstKeptEntryId) ??
        next.firstKeptEntryId;
    }

    result.push(next);
    if (typeof next.id === "string") {
      pathParentId = next.id;
    }
  }

  return result;
}

function isUnsafeAnthropicThinkingBlock(
  message: MessageRecord,
  block: unknown,
): boolean {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const record = block as ContentBlock;
  if (record.type === "redacted_thinking") return true;
  if (record.type !== "thinking") return false;
  if (record.redacted === true) return true;

  const provider =
    typeof message.provider === "string" ? message.provider.toLowerCase() : "";
  const api = typeof message.api === "string" ? message.api.toLowerCase() : "";
  const model =
    typeof message.model === "string" ? message.model.toLowerCase() : "";
  const isAnthropic =
    provider === "anthropic" ||
    api === "anthropic-messages" ||
    model.startsWith("anthropic/");
  if (!isAnthropic) return false;

  const signature =
    typeof record.thinkingSignature === "string"
      ? record.thinkingSignature
      : typeof record.signature === "string"
        ? record.signature
        : "";
  return signature.length > 0;
}

function sanitizeUnsafeThinkingBlocks(entries: MutableBranchEntry[]): void {
  const entriesById = new Map<string, MutableBranchEntry>();
  for (const entry of entries) {
    if (typeof entry.id === "string") {
      entriesById.set(entry.id, entry);
    }
  }

  for (const entry of entries) {
    // A custom message is replayed as a user-role message. Provider metadata
    // is absent there, so any signed or redacted thinking block is unsafe to
    // carry across the fork, whatever produced it.
    if (entry.type === "custom_message" && Array.isArray(entry.content)) {
      entry.content = entry.content.filter(
        (block) => !isSignedOrRedactedThinking(block),
      );
      continue;
    }

    const targetMessage =
      entry.type === "context_edit" && typeof entry.targetId === "string"
        ? entriesById.get(entry.targetId)?.message
        : entry.message;
    const contentOwner =
      entry.type === "context_edit" ? entry.replacement : targetMessage;
    if (
      targetMessage?.role !== "assistant" ||
      !contentOwner ||
      !Array.isArray(contentOwner.content)
    ) {
      continue;
    }
    contentOwner.content = contentOwner.content.filter(
      (block) => !isUnsafeAnthropicThinkingBlock(targetMessage, block),
    );
  }
}

/** Whether a content block carries a signature bound to the parent session. */
function isSignedOrRedactedThinking(block: unknown): boolean {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const record = block as ContentBlock;
  if (record.type === "redacted_thinking") return true;
  if (record.type !== "thinking") return false;
  return (
    record.redacted === true ||
    (typeof record.thinkingSignature === "string" &&
      record.thinkingSignature.length > 0) ||
    (typeof record.signature === "string" && record.signature.length > 0)
  );
}
