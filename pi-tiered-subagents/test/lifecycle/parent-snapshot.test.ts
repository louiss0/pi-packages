import { defined } from "#src/optional";
import { describe, expect, it, vi } from "vitest";

const { buildParentContextMock } = vi.hoisted(() => ({
  buildParentContextMock: vi.fn((): string => ""),
}));

vi.mock("#src/session/context", () => ({
  buildParentContext: buildParentContextMock,
}));

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildParentSnapshot,
  type ParentPromptOptions,
} from "#src/lifecycle/parent-snapshot";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/test/project",
    getSystemPrompt: () => "parent system prompt",
    model: { id: "claude-sonnet" },
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    getActiveTools: () => ["read", "bash"],
    isProjectTrusted: () => true,
    sessionManager: { getBranch: vi.fn(() => []) },
    ...defined(overrides),
  } as unknown as ExtensionContext;
}

describe("buildParentSnapshot", () => {
  it("captures cwd from ctx", () => {
    const snapshot = buildParentSnapshot(makeCtx({ cwd: "/custom/path" }));
    expect(snapshot.cwd).toBe("/custom/path");
  });

  it("captures systemPrompt from ctx.getSystemPrompt()", () => {
    const snapshot = buildParentSnapshot(
      makeCtx({ getSystemPrompt: () => "my prompt" }),
    );
    expect(snapshot.systemPrompt).toBe("my prompt");
  });

  it("captures the parent's model as an owned identity", () => {
    const model = { id: "claude-haiku", provider: "anthropic" };
    const snapshot = buildParentSnapshot(makeCtx({ model }));
    expect(snapshot.parentModelIdentity).toEqual({
      provider: "anthropic",
      id: "claude-haiku",
    });
    // The owned value is a copy, not the session's object.
    expect(snapshot.parentModelIdentity).not.toBe(model);
  });

  it("captures no identity when the parent model has no provider", () => {
    const snapshot = buildParentSnapshot(makeCtx({ model: { id: "x" } }));
    expect(snapshot.parentModelIdentity).toBeUndefined();
  });

  it("does not carry the live model registry into accepted work", () => {
    const snapshot = buildParentSnapshot(makeCtx());
    expect(snapshot).not.toHaveProperty("modelRegistry");
  });

  it("copies registered tool names for request-time MCP expansion", () => {
    const registered = ["read", "mcp__github__get_issue"];
    const snapshot = buildParentSnapshot(
      makeCtx(),
      false,
      undefined,
      ["read"],
      registered,
    );
    registered.push("mcp__github__delete_repo");

    expect(snapshot.registeredToolNames).toEqual([
      "read",
      "mcp__github__get_issue",
    ]);
  });

  it("sets parentContext to undefined when inheritContext is false", () => {
    const snapshot = buildParentSnapshot(makeCtx(), false);
    expect(snapshot.parentContext).toBeUndefined();
    expect(buildParentContextMock).not.toHaveBeenCalled();
  });

  it("sets parentContext to undefined when inheritContext is undefined", () => {
    const snapshot = buildParentSnapshot(makeCtx());
    expect(snapshot.parentContext).toBeUndefined();
    expect(buildParentContextMock).not.toHaveBeenCalled();
  });

  it("populates parentContext when inheritContext is true and conversation exists", () => {
    buildParentContextMock.mockReturnValueOnce("# Parent Conversation\n...");
    const snapshot = buildParentSnapshot(makeCtx(), true);
    expect(snapshot.parentContext).toBe("# Parent Conversation\n...");
    expect(buildParentContextMock).toHaveBeenCalledTimes(1);
  });

  it("sets parentContext to undefined when inheritContext is true but conversation is empty", () => {
    buildParentContextMock.mockReturnValueOnce("");
    const snapshot = buildParentSnapshot(makeCtx(), true);
    expect(snapshot.parentContext).toBeUndefined();
  });

  describe("portablePrompt", () => {
    it("is undefined when no prompt options were captured", () => {
      expect(
        buildParentSnapshot(makeCtx(), false).portablePrompt,
      ).toBeUndefined();
    });

    it("is undefined when the captured options carry no operator-authored parts", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {});
      expect(snapshot.portablePrompt).toBeUndefined();
    });

    it("carries no project context, which each child resolves for itself", () => {
      // The block names context files by absolute path, so the parent's copy
      // would tell a relocated child its files live in the parent's checkout.
      // Pi's payload still carries them at runtime, which the cast reproduces.
      const captured = {
        customPrompt: "You are a specialist.",
        contextFiles: [{ path: "/repo/AGENTS.md", content: "Repo rules." }],
      } as ParentPromptOptions;

      const snapshot = buildParentSnapshot(makeCtx(), false, captured);

      expect(snapshot.portablePrompt).toBe("You are a specialist.");
    });

    it("orders the parts the way Pi composes them: custom, then append", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        customPrompt: "You are a specialist.",
        appendSystemPrompt: "Extra instructions.",
      });
      expect(snapshot.portablePrompt).toBe(
        [
          "You are a specialist.",
          "",
          "<addendum>",
          "Extra instructions.",
          "</addendum>",
        ].join("\n"),
      );
    });

    it("wraps an appended prompt alone in the addendum section", () => {
      // pi 0.86 and later render appendSystemPrompt as an <addendum> section; the
      // portable identity leaves out the base preamble Pi would put first.
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        appendSystemPrompt: "Extra instructions.",
      });
      expect(snapshot.portablePrompt).toBe(
        "<addendum>\nExtra instructions.\n</addendum>",
      );
    });

    it("omits a section whose input is absent", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        customPrompt: "You are a specialist.",
      });
      expect(snapshot.portablePrompt).toBe("You are a specialist.");
    });

    it("treats a whitespace-only custom or append prompt as absent", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        customPrompt: "   ",
        appendSystemPrompt: "\n\n",
      });
      expect(snapshot.portablePrompt).toBeUndefined();
    });
  });
});
