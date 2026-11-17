import { describe, expect, it } from "vitest";
import { captureParentBranch, extractText } from "#src/session/context";
import type { SessionContext } from "#src/types";

function makeCtx(entries: unknown[]): SessionContext {
  return {
    cwd: "/",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "",
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionId: () => "test",
      getBranch: () => entries,
    },
  };
}

describe("extractText", () => {
  it("returns empty string for an empty array", () => {
    expect(extractText([])).toBe("");
  });

  it("extracts text from a single text block", () => {
    expect(extractText([{ type: "text", text: "hello" }])).toBe("hello");
  });

  it("joins multiple text blocks with newlines", () => {
    expect(
      extractText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("skips non-text blocks", () => {
    expect(
      extractText([
        { type: "thinking", thinking: "..." },
        { type: "text", text: "visible" },
        { type: "tool_use", name: "bash" },
      ]),
    ).toBe("visible");
  });

  it("returns empty string when no text blocks exist", () => {
    expect(extractText([{ type: "tool_result" }, { type: "thinking" }])).toBe(
      "",
    );
  });
});

describe("captureParentBranch", () => {
  it("returns an empty array for an empty or missing branch", () => {
    expect(captureParentBranch(makeCtx([]))).toEqual([]);
    expect(
      captureParentBranch(makeCtx(undefined as unknown as unknown[])),
    ).toEqual([]);
  });

  it("preserves completed conversation and tool steps in order", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "Check auth.test.ts" },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running test." },
            { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
          ],
        },
      },
      {
        type: "message",
        id: "e3",
        parentId: "e2",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "FAIL auth.test.ts" }],
        },
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual(entries);
  });

  it("cuts the uncommitted trailing assistant step calling subagent while keeping earlier completed steps in the same turn", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "Debug why auth.test.ts fails" },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-bash", name: "bash", arguments: {} },
          ],
        },
      },
      {
        type: "message",
        id: "e3",
        parentId: "e2",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-bash",
          toolName: "bash",
          content: [{ type: "text", text: "Error: token expired" }],
        },
      },
      {
        type: "message",
        id: "e4",
        parentId: "e3",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-read", name: "read", arguments: {} },
            {
              type: "toolCall",
              id: "call-subagent",
              name: "subagent",
              arguments: {},
            },
          ],
        },
      },
      {
        type: "message",
        id: "e5",
        parentId: "e4",
        timestamp: "2026-01-01T00:00:04.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-read",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
        },
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual(entries.slice(0, 3));
  });

  it("strips signed Anthropic thinking blocks and redacted_thinking while keeping unsigned thinking", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-opus-4-5",
          content: [
            {
              type: "thinking",
              thinking: "signed thought",
              thinkingSignature: "sig-123",
            },
            { type: "redacted_thinking", data: "opaque" },
            { type: "text", text: "Kept answer" },
          ],
        },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5",
          content: [
            { type: "thinking", thinking: "unsigned thought" },
            { type: "text", text: "Second answer" },
          ],
        },
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual([
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-opus-4-5",
          content: [{ type: "text", text: "Kept answer" }],
        },
      },
      entries[1],
    ]);
  });

  it("removes label entries and re-chains parentId and compaction firstKeptEntryId", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "First" },
      },
      {
        type: "label",
        id: "lbl-1",
        parentId: "e1",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "e1",
        label: "checkpoint",
      },
      {
        type: "message",
        id: "e2",
        parentId: "lbl-1",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second" }],
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "e2",
        timestamp: "2026-01-01T00:00:03.000Z",
        summary: "Compacted history",
        firstKeptEntryId: "lbl-1",
        tokensBefore: 1000,
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual([
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "First" },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second" }],
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "e2",
        timestamp: "2026-01-01T00:00:03.000Z",
        summary: "Compacted history",
        firstKeptEntryId: "e2",
        tokensBefore: 1000,
      },
    ]);
  });

  it("strips signed and redacted thinking blocks from custom messages too", () => {
    const entries = [
      {
        type: "custom_message",
        id: "cm1",
        parentId: null,
        customType: "my-ext:note",
        content: [
          { type: "thinking", thinking: "signed", thinkingSignature: "sig-1" },
          { type: "redacted_thinking", data: "opaque" },
          { type: "text", text: "kept note" },
        ],
        display: false,
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual([
      {
        type: "custom_message",
        id: "cm1",
        parentId: null,
        customType: "my-ext:note",
        content: [{ type: "text", text: "kept note" }],
        display: false,
      },
    ]);
  });

  it("keeps trailing metadata after the cut, re-chained to the new leaf", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        message: { role: "user", content: "Debug this" },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-subagent", name: "subagent" },
          ],
        },
      },
      { type: "model_change", id: "m1", parentId: "e2" },
      {
        type: "message",
        id: "e3",
        parentId: "m1",
        message: { role: "toolResult", toolCallId: "call-read" },
      },
    ];

    expect(captureParentBranch(makeCtx(entries))).toEqual([
      {
        type: "message",
        id: "e1",
        parentId: null,
        message: { role: "user", content: "Debug this" },
      },
      { type: "model_change", id: "m1", parentId: "e1" },
    ]);
  });

  it("deep-clones captured entries so later parent mutations do not affect the snapshot", () => {
    const content = [{ type: "text", text: "Original" }];
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content },
      },
    ];

    const captured = captureParentBranch(makeCtx(entries));
    content[0]!.text = "Mutated";

    expect(captured).toEqual([
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Original" }],
        },
      },
    ]);
  });
});
