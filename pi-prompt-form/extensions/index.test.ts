import type {
  ExtensionAPI,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form } from "@code-fixer-23/pi-form-components";
import { vi } from "vitest";

import {
  buildPromptInvocation,
  createPromptArgumentsForm,
  handlePromptInput,
  tokenizePromptInput,
  type FormWidgetHost,
} from "./index";

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

const MockPiFormWidget = {
  setStatusToFilling: vi.fn(),
  setStatusToReady: vi.fn(),
  setStatusToTransformingIfItIsFilling: vi.fn(),
} satisfies FormWidgetHost;

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
  overrides?: Partial<
    Pick<ExtensionUIContext, "confirm" | "custom" | "input" | "notify">
  >,
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
  });
});

describe("buildPromptInvocation", () => {
  it("preserves values with spaces and trims trailing optional blanks", () => {
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
    ).toBe("/release my project");
  });

  it.each([
    [
      {
        project: "line1\nline2",
        notes: "",
      },
      "/release line1\nline2",
    ],
    [
      {
        project: "path with spaces",
        notes: "extra note",
      },
      "/release path with spaces extra note",
    ],
    [
      {
        project: 'quote "inside"',
        notes: "",
      },
      '/release quote "inside"',
    ],
    [
      {
        project: "tab\tseparated",
        notes: "",
      },
      "/release tab\tseparated",
    ],
    [
      {
        project: "multi\nline",
        notes: "second line\nmore",
      },
      "/release multi\nline second line\nmore",
    ],
  ])("serializes newline-containing values in %s", (values, expected) => {
    expect(
      buildPromptInvocation(
        "release",
        [
          { name: "project", required: true, position: 1, initialValue: "" },
          { name: "notes", required: false, position: 2, initialValue: "" },
        ],
        values,
      ),
    ).toBe(expected);
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
    const result = await handlePromptInput(
      {
        text: "hello",
        hasUI: true,
        ui: createUi(),
        getCommands: vi.fn(() => []),
        readPromptFile: vi.fn(),
      },
      MockPiFormWidget,
    );

    expect(result).toEqual({ action: "continue" });
  });

  it("returns continue for /skill", async () => {
    const ui = createUi();
    const readPromptFile = vi.fn();

    const result = await handlePromptInput(
      {
        text: "/skill test",
        hasUI: true,
        ui,
        getCommands: vi.fn(() => [
          createPromptCommand({
            name: "skill, MockPiFormWidget",
            source: "prompt",
            sourceInfo: { path: "skill.md" },
          }),
        ]),
        readPromptFile,
      },
      MockPiFormWidget,
    );

    expect(result).toEqual({ action: "continue" });
    expect(readPromptFile).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("does not treat /skill-prefixed names as /skill", async () => {
    const ui = createUi({
      custom: vi.fn().mockResolvedValue({
        topic: "forms",
      }),
    });

    const result = await handlePromptInput(
      {
        text: "/skill-form",
        hasUI: true,
        ui,
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
      MockPiFormWidget,
    );

    expect(result).toEqual({
      action: "transform",
      text: "/skill-form forms",
    });
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("returns continue when the slash command is not a prompt", async () => {
    const ui = createUi();

    const result = await handlePromptInput(
      {
        text: "/help",
        hasUI: true,
        ui,
        getCommands: vi.fn(() => []),
        readPromptFile: vi.fn(),
      },
      MockPiFormWidget,
    );

    expect(result).toEqual({ action: "continue" });
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("returns a normalized command when the prompt does not declare arguments", async () => {
    const ui = createUi({ custom: vi.fn() });

    const result = await handlePromptInput(
      {
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
      },
      MockPiFormWidget,
    );

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

    const result = await handlePromptInput(
      {
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
      },
      MockPiFormWidget,
    );

    expect(result).toEqual({
      action: "transform",
      text: "/release my project 1.0.0",
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
            const form = factory(
              createTui(),
              createTheme(),
              {} as never,
              vi.fn(),
            );
            return form.render(120).join("\n");
          },
        ),
    });

    await handlePromptInput(
      {
        text: "/release my-project",
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
          async () => `---\nargument-hint: <project>\n---\nHello $1`,
        ),
      },
      MockPiFormWidget,
    );

    const renderedForm = (ui.custom as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value;
    await expect(renderedForm).resolves.toContain("my-project");
  });

  it("asks for extra trailing info when placeholders support it", async () => {
    const ui = createUi({
      confirm: vi.fn(async () => true),
      custom: vi.fn().mockResolvedValue({
        project: "pkg",
      }),
      input: vi.fn().mockResolvedValue("more info here"),
    });

    const result = await handlePromptInput(
      {
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
          async () => `---\nargument-hint: <project>\n---\nHello $1 $@`,
        ),
      },
      MockPiFormWidget,
    );

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

    const result = await handlePromptInput(
      {
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
          async () => `---\nargument-hint: <project>\n---\nHello $1`,
        ),
      },
      MockPiFormWidget,
    );

    expect(result).toEqual({ action: "handled" });
    expect(ui.notify).toHaveBeenCalledWith("Prompt /release cancelled", "info");
  });
});
