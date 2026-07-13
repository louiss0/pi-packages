import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

import {
  handlePromptInput,
  tokenizePromptInput,
  validatePromptArguments,
  type GuardWidgetHost,
} from "./index";
import type { Argument, Placeholder } from "./internal/prompt-parser";

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

function createPromptCommand(command: PromptCommand) {
  return command;
}

const MockGuardWidgetHost = {
  setStatusToGuarding: vi.fn(),
  setStatusToReady: vi.fn(),
  setStatusToUnguardingIfItIsGuarding: vi.fn(),
} satisfies GuardWidgetHost;

describe("tokenizePromptInput", () => {
  const delimiterCases = [
    {
      text: '/release "my project" 1.0.0',
      passedArguments: ['"my', 'project"', "1.0.0"],
    },
    { text: "/release 'my project'", passedArguments: ["'my", "project'"] },
    { text: "/release one,two;three", passedArguments: ["one,two;three"] },
    { text: "/release [one|two]", passedArguments: ["[one|two]"] },
    { text: '/release "my project', passedArguments: ['"my', "project"] },
    { text: "/release line1\nline2", passedArguments: ["line1", "line2"] },
  ];

  it.for(delimiterCases)("uses whitespace as the only argument delimiter", ({
    text,
    passedArguments,
  }) => {
    expect(tokenizePromptInput(text)).toEqual({
      commandName: "release",
      passedArguments,
    });
  });
});

describe("validatePromptArguments", () => {
  it("returns an error when required arguments are missing", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: [],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "single", position: 1 }],
      }),
    ).toBe("Missing required arguments for /release: <project>.");
  });

  const placeholderVariations: Array<{
    passedArguments: string[];
    promptArguments: Argument[];
    placeholders: Placeholder[];
    expected: string | null;
  }> = [
    {
      passedArguments: ["pkg", "1.0.0"],
      promptArguments: [
        { name: "project", required: true, position: 1 },
        { name: "version", required: false, position: 2 },
      ],
      placeholders: [
        { kind: "single", position: 1 },
        { kind: "default", position: 2, value: "latest" },
      ],
      expected: null,
    },
    {
      passedArguments: ["pkg", "1.0.0", "extra"],
      promptArguments: [
        { name: "project", required: true, position: 1 },
        { name: "version", required: false, position: 2 },
        { name: "channel", required: false, position: 3 },
      ],
      placeholders: [
        { kind: "single", position: 1 },
        { kind: "slice", start: 2, end: Number.POSITIVE_INFINITY },
      ],
      expected: null,
    },
    {
      passedArguments: ["pkg", "1.0.0", "beta"],
      promptArguments: [
        { name: "project", required: true, position: 1 },
        { name: "version", required: false, position: 2 },
        { name: "channel", required: false, position: 3 },
      ],
      placeholders: [
        { kind: "single", position: 1 },
        { kind: "slice", start: 2, end: 4 },
      ],
      expected: "Prompt /release references slice 2..4 but only declares 3.",
    },
    {
      passedArguments: ["pkg"],
      promptArguments: [{ name: "project", required: true, position: 1 }],
      placeholders: [{ kind: "default", position: 1, value: "fallback" }],
      expected: null,
    },
    {
      passedArguments: ["pkg", "1.0.0", "extra"],
      promptArguments: [{ name: "project", required: true, position: 1 }],
      placeholders: [{ kind: "rest" }],
      expected: null,
    },
  ];

  it.each(placeholderVariations)("validates placeholder variations", ({
    passedArguments,
    promptArguments,
    placeholders,
    expected,
  }) => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments,
        promptArguments,
        placeholders,
      }),
    ).toBe(expected);
  });

  it("returns an error when placeholders require a missing argument", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg"],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "single", position: 2 }],
      }),
    ).toBe("Prompt /release references argument 2 but only declares 1.");
  });

  it("returns an error when prompt placeholders exceed declared arguments", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg", "1.0.0"],
        promptArguments: [{ name: "project", required: true, position: 1 }],
        placeholders: [{ kind: "single", position: 2 }],
      }),
    ).toBe("Prompt /release references argument 2 but only declares 1.");
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

  it("returns nothing when $ARGUMENTS is used ", () => {
    expect(
      validatePromptArguments({
        commandName: "release",
        passedArguments: ["pkg"],
        promptArguments: [],
        placeholders: [{ kind: "named", name: "ARGUMENTS" }],
      }),
    ).toBeNull();
  });
});

describe("handlePromptInput", () => {
  it("returns continue for non-command input", async () => {
    const result = await handlePromptInput(
      {
        text: "hello",
        ui: { notify: vi.fn() },
        getCommands: vi.fn(() => []),
        readPromptFile: vi.fn(),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
  });

  it("returns continue when the command is not a prompt", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
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
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns continue for /skill", async () => {
    const notify = vi.fn();
    const readPromptFile = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/skill test",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "skill",
            source: "prompt",
            sourceInfo: { path: "skill.md" },
          }),
        ]),
        readPromptFile,
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(readPromptFile).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not treat /skill-prefixed names as /skill", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/skill-form forms",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "skill-form",
            source: "prompt",
            sourceInfo: { path: "skill-form.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () => `---\nargument-hint: <topic>\n---\nHello $1`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not reject an unmatched delimiter", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: '/release "my project',
        ui: { notify },
        getCommands: vi.fn(() => []),
        readPromptFile: vi.fn(),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns handled and notifies when prompt parsing fails", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () =>
            `---\nargument-hint: <project> [version] <tag>\n---\nHello $1`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Invalid argument hint: <project> [version] <tag> all optional arguments must be at the end",
      "error",
    );
  });

  it("returns handled and notifies when required arguments are missing", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () => `---\nargument-hint: <project>\n---\nHello $1`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Missing required arguments for /release: <project>.",
      "error",
    );
  });

  it("returns handled and notifies when too many arguments are passed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release pkg 1.0.0 extra",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () =>
            `---\nargument-hint: <project> [version]\n---\nHello $1 $2`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Too many arguments for /release: expected at most 2 but received 3.",
      "error",
    );
  });

  it("accepts delimiter characters as part of whitespace-delimited arguments", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: '/release "project" 1.0.0',
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () =>
            `---\nargument-hint: <project> [version]\n---\nHello $1 $2`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns continue when rest arguments are allowed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release pkg 1.0.0 extra",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () => `---\nargument-hint: <project>\n---\nHello $@`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns handled when prompt placeholders exceed declared arguments", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release pkg",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () => `---\nargument-hint: <project>\n---\nHello $2`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "handled" });
    expect(notify).toHaveBeenCalledWith(
      "Prompt /release references argument 2 but only declares 1.",
      "error",
    );
  });

  it("returns continue when prompt parsing and argument validation succeed", async () => {
    const notify = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/release pkg 1.0.0",
        ui: { notify },
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "release",
            source: "prompt",
            sourceInfo: { path: "release.md" },
          }),
        ]),
        readPromptFile: vi.fn(
          async () =>
            `---\nargument-hint: <project> [version]\n---\nHello $1 $2`,
        ),
      },
      MockGuardWidgetHost,
    );

    expect(result).toEqual({ action: "continue" });
    expect(notify).not.toHaveBeenCalled();
  });
});
