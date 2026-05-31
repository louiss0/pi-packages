import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { handlePromptInput, validatePromptArguments } from "./index.js";

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

function createPromptCommand(command: PromptCommand) {
  return command;
}

describe("validatePromptArguments", () => {
  it("returns an error when required arguments are missing", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: [],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "single", position: 1 }],
      }),
    ).toBe("Missing required arguments for /release: <project>");
  });

  it("returns an error when too many positional arguments are passed", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg", "1.0.0", "extra"],
        promptArguments: [
          { name: "project", required: true, position: 1 },
          { name: "version", required: false, position: 2 },
        ],
        placeholders: [
          { kind: "single", position: 1 },
          { kind: "single", position: 2 },
        ],
      }),
    ).toBe("Too many arguments for /release: expected at most 2 but received 3");
  });

  it("allows extra arguments when the prompt uses $ARGUMENTS", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg", "1.0.0", "extra"],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "named", name: "ARGUMENTS" }],
      }),
    ).toBeNull();
  });

  it("allows extra arguments when the prompt uses $@", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg", "1.0.0", "extra"],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "rest" }],
      }),
    ).toBeNull();
  });

  it("returns an error when placeholders require a missing argument", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg"],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "single", position: 2 }],
      }),
    ).toBe("Missing argument for /release: placeholder requires argument 2");
  });
});

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

  it("returns handled when the command is not a prompt", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/missing",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "missing",
          source: "extension",
          sourceInfo: { path: "ignored.md" },
        }),
      ]),
      readPromptFile: vi.fn(),
    });

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith("Prompt not found: /missing", "error");
  });

  it("returns handled and notifies when prompt parsing fails", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project> [version] <tag>\n---\nHello $1`),
    });

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Invalid argument hint: <project> [version] <tag> all optional arguments must be at the end",
      "error",
    );
  });

  it("returns handled and notifies when required arguments are missing", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project>\n---\nHello $1`),
    });

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith("Missing required arguments for /release: <project>", "error");
  });

  it("returns handled and notifies when too many arguments are passed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release pkg 1.0.0 extra",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project> [version]\n---\nHello $1 $2`),
    });

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Too many arguments for /release: expected at most 2 but received 3",
      "error",
    );
  });

  it("returns continue when rest arguments are allowed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release pkg 1.0.0 extra",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project>\n---\nHello $@`),
    });

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns continue when prompt parsing and argument validation succeed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput({
      text: "/release pkg 1.0.0",
      ui: { notify },
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project> [version]\n---\nHello $1 $2`),
    });

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });
});
