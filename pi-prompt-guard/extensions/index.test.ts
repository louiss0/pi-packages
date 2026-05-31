import { describe, expect, it, vi } from "vitest";

import { handlePromptInput } from "./index.js";

describe("handlePromptInput", () => {
  it("returns continue for non-command input", async () => {
    const result = await handlePromptInput({
      text: "hello",
      ui: { notify: vi.fn() },
      getCommands: vi.fn(() => []),
      readPromptFile: vi.fn(),
    });

    expect(result).toEqual({ action: "continue" });
  });

  it("returns continue when the command is not a prompt", async () => {
    const result = await handlePromptInput({
      text: "/missing",
      ui: { notify: vi.fn() },
      getCommands: vi.fn(() => [
        {
          name: "missing",
          source: "extension",
          sourceInfo: { path: "ignored.md" },
        },
      ]),
      readPromptFile: vi.fn(),
    });

    expect(result).toEqual({ action: "continue" });
  });

  it("returns handled and notifies when prompt parsing fails", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release",
      ui: { notify },
      getCommands: vi.fn(() => [
        {
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        },
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project> [version] <tag>\n---\nHello $1`),
    });

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Invalid argument hint: <project> [version] <tag> all optional arguments must be at the end",
      "error",
    );
  });

  it("returns continue when prompt parsing succeeds", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release",
      ui: { notify },
      getCommands: vi.fn(() => [
        {
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        },
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project> [version]\n---\nHello $1`),
    });

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });
});
