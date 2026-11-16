import { describe, expect, it, vi } from "vitest";
import {
  FORK_BOUNDARY_ENTRY,
  seedInheritedBranch,
  type ForkSessionManager,
} from "#src/session/fork";
import type { InheritedBranchEntry } from "#src/session/context";

function makeManager() {
  let seq = 0;
  const nextId = () => `new-${++seq}`;
  const manager: ForkSessionManager & {
    calls: Array<[string, unknown[]]>;
  } = {
    calls: [],
    appendMessage: vi.fn((message: unknown) => {
      manager.calls.push(["appendMessage", [message]]);
      return nextId();
    }),
    appendCustomMessageEntry: vi.fn(
      (
        customType: string,
        content: unknown,
        display: boolean,
        details?: unknown,
      ) => {
        manager.calls.push([
          "appendCustomMessageEntry",
          [customType, content, display, details],
        ]);
        return nextId();
      },
    ),
    appendCompaction: vi.fn(
      (
        summary: string,
        firstKeptEntryId: string | null,
        tokensBefore: number,
        details?: unknown,
        fromHook?: boolean,
        usage?: unknown,
      ) => {
        manager.calls.push([
          "appendCompaction",
          [summary, firstKeptEntryId, tokensBefore, details, fromHook, usage],
        ]);
        return nextId();
      },
    ),
    appendContextEdit: vi.fn((targetId: string, replacement: unknown) => {
      manager.calls.push(["appendContextEdit", [targetId, replacement]]);
      return nextId();
    }),
    appendCustomEntry: vi.fn((customType: string, data?: unknown) => {
      manager.calls.push(["appendCustomEntry", [customType, data]]);
      return nextId();
    }),
  };
  return manager;
}

function entry(overrides: Record<string, unknown>): InheritedBranchEntry {
  return { type: "message", ...overrides };
}

describe("seedInheritedBranch", () => {
  it("does nothing for an empty branch", () => {
    const manager = makeManager();
    seedInheritedBranch(manager, []);
    expect(manager.calls).toEqual([]);
  });

  it("replays conversation messages in order and appends the fork boundary last", () => {
    const manager = makeManager();
    const userMessage = { role: "user", content: "parent question" };
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "parent answer" }],
    };
    const toolResult = {
      role: "toolResult",
      toolName: "bash",
      content: [{ type: "text", text: "debug output" }],
    };

    seedInheritedBranch(manager, [
      entry({ id: "e1", parentId: null, message: userMessage }),
      entry({ id: "e2", parentId: "e1", message: assistantMessage }),
      entry({ id: "e3", parentId: "e2", message: toolResult }),
    ]);

    expect(manager.calls.map(([name]) => name)).toEqual([
      "appendMessage",
      "appendMessage",
      "appendMessage",
      "appendCustomEntry",
    ]);
    expect(manager.appendMessage).toHaveBeenNthCalledWith(1, userMessage);
    expect(manager.appendMessage).toHaveBeenNthCalledWith(2, assistantMessage);
    expect(manager.appendMessage).toHaveBeenNthCalledWith(3, toolResult);
    expect(manager.appendCustomEntry).toHaveBeenCalledWith(FORK_BOUNDARY_ENTRY);
  });

  it("replays custom messages that participate in model context", () => {
    const manager = makeManager();
    const content = [{ type: "text", text: "extension note" }];

    seedInheritedBranch(manager, [
      {
        type: "custom_message",
        id: "cm1",
        parentId: null,
        customType: "my-ext:note",
        content,
        display: false,
        details: { k: 1 },
      },
    ]);

    expect(manager.appendCustomMessageEntry).toHaveBeenCalledWith(
      "my-ext:note",
      content,
      false,
      { k: 1 },
    );
  });

  it("replays a branch summary as model-visible context", () => {
    const manager = makeManager();

    seedInheritedBranch(manager, [
      {
        type: "branch_summary",
        id: "bs1",
        parentId: null,
        summary: "Earlier branch",
      },
    ]);

    expect(manager.appendCustomMessageEntry).toHaveBeenCalledWith(
      "subagents:fork-branch-summary",
      "Earlier branch",
      false,
    );
  });

  it("remaps a compaction's firstKeptEntryId to the replayed entry id", () => {
    const manager = makeManager();
    seedInheritedBranch(manager, [
      entry({
        id: "e1",
        parentId: null,
        message: { role: "user", content: "kept question" },
      }),
      {
        type: "compaction",
        id: "c1",
        parentId: "e1",
        summary: "Earlier work",
        firstKeptEntryId: "e1",
        tokensBefore: 4200,
        details: { files: ["a.ts"] },
        fromHook: false,
        usage: { input: 1 },
      },
    ]);

    expect(manager.appendCompaction).toHaveBeenCalledWith(
      "Earlier work",
      "new-1",
      4200,
      { files: ["a.ts"] },
      false,
      { input: 1 },
    );
  });

  it("remaps a context edit's targetId to the replayed entry id", () => {
    const manager = makeManager();
    const replacement = { content: [{ type: "text", text: "trimmed" }] };
    seedInheritedBranch(manager, [
      entry({
        id: "e1",
        parentId: null,
        message: { role: "user", content: "original" },
      }),
      {
        type: "context_edit",
        id: "ce1",
        parentId: "e1",
        targetId: "e1",
        replacement,
      },
    ]);

    expect(manager.appendContextEdit).toHaveBeenCalledWith(
      "new-1",
      replacement,
    );
  });

  it("skips metadata and non-context entries so the child's model and stats stay its own", () => {
    const manager = makeManager();
    seedInheritedBranch(manager, [
      {
        type: "model_change",
        id: "m1",
        parentId: null,
        provider: "anthropic",
        modelId: "x",
      },
      {
        type: "thinking_level_change",
        id: "t1",
        parentId: "m1",
        thinkingLevel: "high",
      },
      { type: "usage", id: "u1", parentId: "t1", usage: { input: 99 } },
      { type: "session_info", id: "s1", parentId: "u1", name: "parent" },
      {
        type: "custom",
        id: "x1",
        parentId: "s1",
        customType: "ext:data",
        data: {},
      },
      {
        type: "custom_message",
        id: "cm1",
        parentId: "x1",
        customType: "ext:note",
        content: "note",
        display: false,
      },
      { type: "unrecognized", id: "z1", parentId: "cm1" },
    ]);

    expect(manager.calls.map(([name]) => name)).toEqual([
      "appendCustomMessageEntry",
      "appendCustomEntry",
    ]);
  });

  it("drops a context edit whose target was not replayed", () => {
    const manager = makeManager();
    seedInheritedBranch(manager, [
      {
        type: "context_edit",
        id: "ce1",
        parentId: null,
        targetId: "missing",
        replacement: { content: "x" },
      },
    ]);

    expect(manager.appendContextEdit).not.toHaveBeenCalled();
  });
});
