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
 * in-flight `subagent` call itself), keeps only conversation entries while
 * re-chaining `parentId` / `firstKeptEntryId`, strips session-bound thinking
 * signatures from every model-visible content block, and deep-copies every
 * entry so later parent mutations cannot affect a queued child.
 */
export function captureParentBranch(
  ctx: SessionContext,
): ReadonlyArray<InheritedBranchEntry> {
  const raw = ctx.sessionManager.getBranch();
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const cloned = structuredClone(raw).filter(isMutableBranchEntry);
  const committed = stripUncommittedTrailingAssistantStep(cloned);
  const conversation = keepConversationAndRechain(committed);
  sanitizeModelVisibleContent(conversation);
  return conversation;
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
  // part of the uncommitted turn, and keepConversationAndRechain re-chains it
  // to the new leaf.
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

function keepConversationAndRechain(
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

    // Pi stores the effective system prompt as a `message` entry with the
    // `system` role. It is prompt state, not conversation: replaying it gives
    // the child two system messages. The child builds its own prompt.
    if (entry.type === "message" && entry.message?.role === "system") {
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

/**
 * Signature fields a provider may bind to the session that produced a block.
 * Anthropic uses `thinkingSignature` / `signature`; Gemini uses
 * `thoughtSignature` on tool calls and `textSignature` on text. All of them
 * are invalid in a fresh session, whatever the provider.
 */
const SIGNATURE_KEYS = [
  "thinkingSignature",
  "thoughtSignature",
  "textSignature",
  "signature",
] as const;

function hasSignature(record: ContentBlock): boolean {
  return SIGNATURE_KEYS.some(
    (key) => typeof record[key] === "string" && record[key].length > 0,
  );
}

/** A thinking block bound to the parent session cannot be replayed. */
function isUnsafeThinkingBlock(block: unknown): boolean {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const record = block as ContentBlock;
  if (record.type === "redacted_thinking") return true;
  return (
    record.type === "thinking" &&
    (record.redacted === true || hasSignature(record))
  );
}

/** Keep a block's content but drop the session-bound signature from it. */
function stripSignatureFields(block: unknown): unknown {
  if (!block || typeof block !== "object" || Array.isArray(block)) return block;
  const record = block as ContentBlock;
  const present = SIGNATURE_KEYS.filter((key) => key in record);
  if (present.length === 0) return block;
  const copy: ContentBlock = { ...record };
  for (const key of present) delete copy[key];
  return copy;
}

/**
 * One filter for every array of content blocks that can reach a provider
 * request: drop signed/redacted thinking, keep everything else with its
 * signature fields removed.
 */
function sanitizeContentBlocks(blocks: unknown[]): unknown[] {
  return blocks
    .filter((block) => !isUnsafeThinkingBlock(block))
    .map(stripSignatureFields);
}

/**
 * Sanitize the model-visible content of every retained entry. Compaction and
 * branch summaries are free text: a signature-shaped string inside prose is
 * inert, so they are deliberately left alone.
 */
function sanitizeModelVisibleContent(entries: MutableBranchEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "custom_message" && Array.isArray(entry.content)) {
      entry.content = sanitizeContentBlocks(entry.content);
      continue;
    }

    if (
      entry.type === "context_edit" &&
      entry.replacement &&
      Array.isArray(entry.replacement.content)
    ) {
      entry.replacement.content = sanitizeContentBlocks(
        entry.replacement.content,
      );
      continue;
    }

    if (entry.type === "message" && Array.isArray(entry.message?.content)) {
      entry.message!.content = sanitizeContentBlocks(entry.message!.content);
    }
  }
}
