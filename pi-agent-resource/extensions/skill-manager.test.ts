import { dirname, join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form } from "@code-fixer-23/pi-form-components";
import {
  getResourceFileSystem,
  resetResourceFileSystem,
  useMemoryResourceFileSystem,
} from "../shared/filesystem";
import { resetDevelopmentExtensionNotice } from "../shared/runtime";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

vi.mock("@earendil-works/pi-tui", async () => {
  return vi.importActual<typeof import("@earendil-works/pi-tui")>(
    "@earendil-works/pi-tui",
  );
});

vi.mock("node:os", () => ({
  homedir: () => "/test-home",
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

const TAB_KEY = "\t";
const ENTER_KEY = "\r";

import registerSkillManager, {
  createOptionalSkillForm,
  createRequiredSkillForm,
  handleCreate,
  handleDelete,
  handleEdit,
  LOCAL_SKILLS_DIRECTORY,
  parseOptionalSkillFormValues,
  parseRequiredSkillFormValues,
  parseSkillCommandArgument,
} from "./skill-manager";

describe("skill manager handlers", () => {
  const localCwd = "/workspace";
  const expectedSkillPath = join(
    "/test-home",
    ".pi",
    "agent",
    "skills",
    "test-skill",
    "SKILL.md",
  );
  const expectedLocalSkillPath = join(
    localCwd,
    ".pi",
    "skills",
    "test-skill",
    "SKILL.md",
  );
  const expectedSkillDirectory = dirname(expectedSkillPath);
  const expectedLocalSkillDirectory = dirname(expectedLocalSkillPath);
  let memoryFileSystem: ReturnType<typeof useMemoryResourceFileSystem>;

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

  function expectFormFactory(
    custom: ReturnType<typeof vi.fn>,
    callIndex: number,
    title: string,
  ) {
    const [factory, options] = custom.mock.calls[callIndex] as [
      (
        tui: TUI,
        theme: Theme,
        keyboard: unknown,
        done: (value: unknown) => void,
      ) => unknown,
      unknown,
    ];
    const component = factory(createTui(), createTheme(), {}, vi.fn());

    expect(component).toBeInstanceOf(Form);
    expect(
      (component as Form<Record<string, string | boolean>>)
        .render(80)
        .join("\n"),
    ).toContain(title);
    expect(options).toEqual(formOverlayOptions);
  }

  function expectEditorOverlayFactory(
    custom: ReturnType<typeof vi.fn>,
    callIndex: number,
  ) {
    const [factory, options] = custom.mock.calls[callIndex] as [
      (
        tui: TUI,
        theme: Theme,
        keyboard: unknown,
        done: (value: unknown) => void,
      ) => unknown,
      unknown,
    ];
    const component = factory(createTui(), createTheme(), {}, vi.fn());

    expect(
      (component as { render: (width: number) => string[] })
        .render(80)
        .join("\n"),
    ).toContain("Edit Skill Markdown");
    expect(options).toEqual(modalEditorOverlayOptions);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    memoryFileSystem = useMemoryResourceFileSystem();
    resetDevelopmentExtensionNotice();
  });

  afterEach(() => {
    resetResourceFileSystem();
  });

  describe("parseSkillCommandArgument", () => {
    it("parses the skill subcommand without inline flags", () => {
      expect(parseSkillCommandArgument("create")).toEqual({
        success: true,
        output: "create",
      });
    });

    it("parses edit without inline flags", () => {
      expect(parseSkillCommandArgument("edit")).toEqual({
        success: true,
        output: "edit",
      });
    });
  });

  describe("extension registration", () => {
    it("registers a dedicated command for local skills", async () => {
      const registerCommand = vi.fn();
      const registerFlag = vi.fn();
      const getFlag = vi.fn(() => false);
      const notify = vi.fn();
      const custom = vi.fn().mockResolvedValueOnce(null);

      registerSkillManager({ registerCommand, registerFlag, getFlag } as never);

      expect(registerFlag).toHaveBeenCalledWith("external-skill-editor", {
        description: "Use the external editor for skill edit commands",
        type: "boolean",
        default: false,
      });
      expect(registerFlag).toHaveBeenCalledTimes(1);
      expect(registerCommand).toHaveBeenNthCalledWith(
        1,
        "resource:skill",
        expect.objectContaining({
          description: "This is for managing global skills",
        }),
      );
      expect(registerCommand).toHaveBeenNthCalledWith(
        2,
        "resource:local-skill",
        expect.objectContaining({
          description: "This is for managing project skills",
        }),
      );

      const localCommand = registerCommand.mock.calls[1]?.[1] as {
        handler: (
          arg: string,
          ctx: {
            cwd: string;
            ui: { notify: typeof notify; custom: typeof custom };
          },
        ) => Promise<void>;
      };
      await localCommand.handler("create", {
        cwd: localCwd,
        ui: { notify, custom },
      });

      expect(notify).toHaveBeenNthCalledWith(
        1,
        `Using local skills from ${join(localCwd, LOCAL_SKILLS_DIRECTORY)}`,
        "info",
      );
    });
  });

  describe("createRequiredSkillForm", () => {
    it("uses the shared form component and required title", () => {
      const form = createRequiredSkillForm(createTui(), createTheme(), vi.fn());
      const lines = form.render(80).join("\n");

      expect(form).toBeInstanceOf(Form);
      expect(lines).toContain("Create Skill");
      expect(lines).toContain("Do you want to fill in the next fields?");
    });

    it("renders required form errors when invalid values are submitted", () => {
      const form = createRequiredSkillForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      form.handleInput("B");
      form.handleInput("a");
      form.handleInput("d");
      form.handleInput(TAB_KEY);
      form.handleInput(TAB_KEY);
      form.handleInput(ENTER_KEY);

      const lines = form.render(80).join("\n");

      expect(lines).toContain(
        "Must be lowercase alphanumeric with dashes only",
      );
      expect(lines).toContain("Description is required");
    });

    it("validates description when name is already filled", () => {
      const form = createRequiredSkillForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      for (const character of "test-skill") {
        form.handleInput(character);
      }

      form.handleInput(TAB_KEY);
      form.handleInput(TAB_KEY);
      form.handleInput(ENTER_KEY);

      const lines = form.render(80).join("\n");

      expect(lines).not.toContain("Name is required");
      expect(lines).not.toContain(
        "Must be lowercase alphanumeric with dashes only",
      );
      expect(lines).toContain("Description is required");
    });
  });

  describe("createOptionalSkillForm", () => {
    it("uses the shared form component and optional title", () => {
      const form = createOptionalSkillForm(createTui(), createTheme(), vi.fn());
      const lines = form.render(80).join("\n");

      expect(form).toBeInstanceOf(Form);
      expect(lines).toContain("Skill Details");
      expect(lines).toContain("license");
      expect(lines).toContain("allowedTools");
    });

    it("renders optional form errors when invalid values are submitted", () => {
      const form = createOptionalSkillForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      for (const character of "bad:path") {
        form.handleInput(character);
      }
      form.handleInput(TAB_KEY);
      for (const character of "x".repeat(501)) {
        form.handleInput(character);
      }
      form.handleInput(TAB_KEY);
      for (const character of "bash read") {
        form.handleInput(character);
      }
      form.handleInput(ENTER_KEY);

      const lines = form.render(80).join("\n");

      expect(lines).toContain("License must be a valid path");
      expect(lines).toContain("Compatibility must be 500 characters or fewer");
      expect(lines).toContain("Allowed tools must be a comma-separated list");
    });

    it("validates later optional fields when earlier fields are empty", () => {
      const form = createOptionalSkillForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      form.handleInput(TAB_KEY);
      form.handleInput(TAB_KEY);
      for (const character of "bash read") {
        form.handleInput(character);
      }
      form.handleInput(ENTER_KEY);

      const lines = form.render(80).join("\n");

      expect(lines).not.toContain("License must be a valid path");
      expect(lines).not.toContain(
        "Compatibility must be 500 characters or fewer",
      );
      expect(lines).toContain("Allowed tools must be a comma-separated list");
    });
  });

  describe("parseRequiredSkillFormValues", () => {
    it("returns the expected required field errors", () => {
      expect(
        parseRequiredSkillFormValues({
          name: "Bad Name",
          description: "",
        }),
      ).toEqual({
        name: "Must be lowercase alphanumeric with dashes only",
        description: "Description is required",
      });
    });
  });

  describe("parseOptionalSkillFormValues", () => {
    it("returns the expected optional field errors", () => {
      expect(
        parseOptionalSkillFormValues({
          license: "bad:path",
          compatibility: "x".repeat(501),
          allowedTools: "bash read",
        }),
      ).toEqual({
        license: "License must be a valid path",
        compatibility: "Compatibility must be 500 characters or fewer",
        allowedTools: "Allowed tools must be a comma-separated list",
      });
    });
  });

  it("handleCreate cancels when the required form is dismissed", async () => {
    const custom = vi.fn().mockResolvedValueOnce(null);
    const notify = vi.fn();

    await handleCreate({ ui: { custom, notify } } as never);

    expectFormFactory(custom, 0, "Create Skill");
    expect(custom).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Skill creation cancelled", "info");
  });

  it("handleCreate writes the skill after the required form completes", async () => {
    const custom = vi.fn().mockResolvedValueOnce({
      name: "test-skill",
      description: "Useful skill description",
      confirm: false,
    });
    const notify = vi.fn();

    await handleCreate({ ui: { custom, notify } } as never);

    expectFormFactory(custom, 0, "Create Skill");
    const content = await getResourceFileSystem().readFile(
      expectedSkillPath,
      "utf8",
    );
    expect(content).toContain("# Test Skill");
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${expectedSkillPath}`,
    );
  });

  it("handleCreate writes a local skill when the local scope is requested", async () => {
    const custom = vi.fn().mockResolvedValueOnce({
      name: "test-skill",
      description: "Useful skill description",
      confirm: false,
    });
    const notify = vi.fn();

    await handleCreate(
      { cwd: localCwd, ui: { custom, notify } } as never,
      "local",
    );

    const content = await getResourceFileSystem().readFile(
      expectedLocalSkillPath,
      "utf8",
    );
    expect(content).toContain("# Test Skill");
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${expectedLocalSkillPath}`,
    );
  });

  it("handleCreate uses a shared Form for optional fields when requested", async () => {
    const custom = vi
      .fn()
      .mockResolvedValueOnce({
        name: "test-skill",
        description: "Useful skill description",
        confirm: true,
      })
      .mockResolvedValueOnce({
        license: "./LICENSE",
        compatibility: "pi >= 0.67",
        allowedTools: "read, write",
      });
    const notify = vi.fn();

    await handleCreate({ ui: { custom, notify } } as never);

    expectFormFactory(custom, 0, "Create Skill");
    expectFormFactory(custom, 1, "Skill Details");
    const content = await getResourceFileSystem().readFile(
      expectedSkillPath,
      "utf8",
    );
    expect(content).toContain("allowed-tools: 'read, write'");
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${expectedSkillPath}`,
    );
  });

  it("handleCreate creates the skill when the optional form is dismissed", async () => {
    const custom = vi
      .fn()
      .mockResolvedValueOnce({
        name: "test-skill",
        description: "Useful skill description",
        confirm: true,
      })
      .mockResolvedValueOnce(null);
    const notify = vi.fn();

    await handleCreate({ ui: { custom, notify } } as never);

    const content = await getResourceFileSystem().readFile(
      expectedSkillPath,
      "utf8",
    );
    expect(content).toContain("# Test Skill");
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${expectedSkillPath}`,
    );
  });

  it("handleCreate reports an existing skill without overwriting it", async () => {
    memoryFileSystem.seed({
      [expectedSkillPath]: "existing skill content",
    });
    const notify = vi.fn();

    await handleCreate({
      ui: {
        custom: vi.fn().mockResolvedValueOnce({
          name: "test-skill",
          description: "Useful skill description",
          confirm: false,
        }),
        notify,
      },
    } as never);

    expect(notify).toHaveBeenCalledWith(
      "Skill already exists: test-skill",
      "error",
    );
  });

  it("handleEdit uses an 80% overlay editor by default", async () => {
    memoryFileSystem.seed({
      [expectedSkillPath]: "existing skill content",
    });
    const custom = vi.fn().mockResolvedValueOnce(expectedSkillPath);
    custom.mockResolvedValueOnce("updated skill content");
    const notify = vi.fn();
    const reload = vi.fn().mockResolvedValueOnce(undefined);

    await handleEdit({ ui: { custom, notify }, reload } as never);

    expectEditorOverlayFactory(custom, 1);
    expect(spawn).not.toHaveBeenCalled();
    expect(
      await getResourceFileSystem().readFile(expectedSkillPath, "utf8"),
    ).toBe("updated skill content");
    expect(reload).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill updated. Reloading skills...",
      "info",
    );
  });

  it("handleEdit uses the external editor without shell mode", async () => {
    memoryFileSystem.seed({
      [expectedSkillPath]: "existing skill content",
    });
    vi.stubEnv("VISUAL", 'code --wait +"set ft=markdown"');
    vi.mocked(spawn).mockReturnValueOnce({
      on: (event: string, callback: (value?: number) => void) => {
        if (event === "exit") {
          callback(0);
        }
      },
    } as never);
    const custom = vi.fn().mockResolvedValueOnce(expectedSkillPath);
    const notify = vi.fn();
    const reload = vi.fn().mockResolvedValueOnce(undefined);

    await handleEdit({ ui: { custom, notify }, reload } as never, "external");

    expect(spawn).toHaveBeenCalledWith(
      "code",
      ["--wait", "+set ft=markdown", expectedSkillPath],
      expect.objectContaining({ shell: false }),
    );
    expect(reload).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill updated. Reloading skills...",
      "info",
    );
  });

  it("handleEdit reports cancellation when no skill is selected", async () => {
    memoryFileSystem.seed({
      [expectedSkillPath]: "existing skill content",
    });
    const notify = vi.fn();

    await handleEdit({
      ui: {
        custom: vi.fn().mockResolvedValueOnce(null),
        notify,
      },
      reload: vi.fn(),
    } as never);

    expect(notify).toHaveBeenCalledWith("Skill edit cancelled", "info");
  });

  it("handleDelete removes the selected skill directory", async () => {
    memoryFileSystem.seed({
      [expectedSkillPath]: "existing skill content",
    });
    const custom = vi.fn().mockResolvedValueOnce(expectedSkillPath);
    const notify = vi.fn();

    await handleDelete({ ui: { custom, notify } } as never);

    await expect(
      getResourceFileSystem().readFile(expectedSkillPath, "utf8"),
    ).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith(
      `Skill deleted successfully: ${expectedSkillDirectory}`,
    );
  });

  it("handleDelete removes the selected local skill directory", async () => {
    memoryFileSystem.seed({
      [expectedLocalSkillPath]: "existing local skill content",
    });
    const custom = vi.fn().mockResolvedValueOnce(expectedLocalSkillPath);
    const notify = vi.fn();

    await handleDelete(
      { cwd: localCwd, ui: { custom, notify } } as never,
      "local",
    );

    await expect(
      getResourceFileSystem().readFile(expectedLocalSkillPath, "utf8"),
    ).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith(
      `Skill deleted successfully: ${expectedLocalSkillDirectory}`,
    );
  });
});
