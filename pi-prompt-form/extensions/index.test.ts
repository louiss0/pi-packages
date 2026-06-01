import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form } from "@code-fixer-23/pi-form-components";
import { describe, expect, it, vi } from "vitest";

import {
  buildPromptInvocation,
  createPromptArgumentsForm,
  handlePromptInput,
  tokenizePromptInput,
} from "./index";

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

function createPromptCommand(command: PromptCommand) {
  return command;
}

function createTheme() {
  return {
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
}

function createTui() {
  return {
    requestRender: vi.fn(),
    terminal: {
      rows: 40,
      columns: 120,
    },
  } as unknown as TUI;
}

function createUi(
  overrides?: Partial<Pick<ExtensionUIContext, "confirm" | "custom" | "input" | "notify">>,
) {
  return {
    confirm: vi.fn(async () => false),
    custom: vi.fn(),
    input: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  } as Pick<ExtensionUIContext, "confirm" | "custom" | "input" | "notify">;
}

describe("tokenizePromptInput", () => {
  it("supports quoted arguments", () => {
    expect(tokenizePromptInput('/release "my project" 1.0.0')).toEqual({
      commandName: "release",
      passedArguments: ["my project", "1.0.0"],
    });
  });

  it("returns an error for unterminated quotes", () => {
    expect(tokenizePromptInput('/release "my project')).toBeInstanceOf(Error);
  });
});

describe("createPromptArgumentsForm", () => {
  it("creates a shared form component for prompt arguments", () => {
    const form = createPromptArgumentsForm({
      commandName: "release",
      argumentFields: [
        { name: "project", required: true, position: 1, initialValue: "pkg" },
        { name: "notes", required: false, position: 2, initialValue: "" },
      ],
      tui: createTui(),
      theme: createTheme(),
      done: vi.fn(),
    });

    expect(form).toBeInstanceOf(Form);
    const renderedForm = form.render(80).join("\n");
    expect(renderedForm).toContain("Fill /release");
    expect(renderedForm).toContain("project");
    expect(renderedForm).toContain("notes");
    expect(renderedForm).toContain("pkg");
  });
});

describe("buildPromptInvocation", () => {
  it("quotes values with spaces and trims trailing optional blanks", () => {
    expect(
      buildPromptInvocation(
        "release",
        [
          { name: "project", required: true, position: 1, initialValue: "" },
          { name: "notes", required: false, position: 2, initialValue: "" },
        ],
        {
          project: "my project",
          notes: "",
        },
      ),
    ).toBe('/release "my project"');
  });

  it("appends extra trailing text raw", () => {
    expect(
      buildPromptInvocation(
        "release",
        [{ name: "project", required: true, position: 1, initialValue: "" }],
        { project: "pkg" },
        "more info here",
      ),
    ).toBe("/release pkg more info here");
  });
});

describe("handlePromptInput", () => {
  it("returns continue for non-command input", async () => {
    const result = await handlePromptInput({
      text: "hello",
      hasUI: true,
      ui: createUi(),
      getCommands: vi.fn(() => []),
      readPromptFile: vi.fn(),
    });

    expect(result).toEqual({ action: "continue" });
  });

  it("returns a normalized command when the prompt does not declare arguments", async () => {
    const ui = createUi({ custom: vi.fn() });

    const result = await handlePromptInput({
      text: "/release",
      hasUI: true,
      ui,
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\n---\nHello`),
    });

    expect(result).toEqual({ action: "transform", text: "/release" });
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("shows a form and transforms text values back into the prompt", async () => {
    const ui = createUi({
      custom: vi.fn().mockResolvedValue({
        project: "my project",
        notes: "1.0.0",
      }),
    });

    const result = await handlePromptInput({
      text: "/release",
      hasUI: true,
      ui,
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(
        async () => `---\nargument-hint: <project> [notes]\n---\nHello $1 $2`,
      ),
    });

    expect(result).toEqual({
      action: "transform",
      text: '/release "my project" 1.0.0',
    });
    expect(ui.custom).toHaveBeenCalledOnce();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("prefills existing typed text arguments in the form", async () => {
    const ui = createUi({
      custom: vi
        .fn()
        .mockImplementation(
          async (
            factory: (
              tui: TUI,
              theme: Theme,
              keybindings: never,
              done: (value: string | null) => void,
            ) => Form<Record<string, string>>,
          ) => {
            const form = factory(createTui(), createTheme(), {} as never, vi.fn());
            return form.render(120).join("\n");
          },
        ),
    });

    await handlePromptInput({
      text: '/release "my project"',
      hasUI: true,
      ui,
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project>\n---\nHello $1`),
    });

    const renderedForm = (ui.custom as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    await expect(renderedForm).resolves.toContain("my project");
  });

  it("asks for extra trailing info when placeholders support it", async () => {
    const ui = createUi({
      confirm: vi.fn(async () => true),
      custom: vi.fn().mockResolvedValue({
        project: "pkg",
      }),
      input: vi.fn().mockResolvedValue("more info here"),
    });

    const result = await handlePromptInput({
      text: "/release",
      hasUI: true,
      ui,
      getCommands: vi.fn(() => [
        createPromptCommand({
          name: "release",
          source: "prompt",
          sourceInfo: { path: "release.md" },
        }),
      ]),
      readPromptFile: vi.fn(async () => `---\nargument-hint: <project>\n---\nHello $1 $@`),
    });

    expect(result).toEqual({
      action: "transform",
      text: "/release pkg more info here",
    });
    expect(ui.confirm).toHaveBeenCalledOnce();
    expect(ui.input).toHaveBeenCalledOnce();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("returns handled when the prompt form is cancelled", async () => {
    const ui = createUi({ custom: vi.fn().mockResolvedValue(null) });

    const result = await handlePromptInput({
      text: "/release",
      hasUI: true,
      ui,
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
    expect(ui.notify).toHaveBeenCalledWith("Prompt /release cancelled", "info");
  });
});
