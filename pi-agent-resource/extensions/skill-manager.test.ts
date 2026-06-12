import { dirname, join } from "node:path";
const { mockCreateExternalEditorFactory } = vi.hoisted(() => ({
  mockCreateExternalEditorFactory: vi.fn(),
}));

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form } from "@code-fixer-23/pi-form-components";
import { MemoryFileSystem, PathResolver } from "../shared/filesystem";
import type { ResourcePathResolver } from "../shared/filesystem";
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

vi.mock("@code-fixer-23/pi-form-components", async () => {
  const module = await vi.importActual<
    typeof import("@code-fixer-23/pi-form-components")
  >("@code-fixer-23/pi-form-components");

  return {
    ...module,
    createExternalEditorFactory: mockCreateExternalEditorFactory,
  };
});

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
  const testPathResolver = new PathResolver(localCwd, "/test-home");
  const skillPath = testPathResolver.resolveGlobalSkillPath(
    "test-skill/SKILL.md",
  );
  const localSkillPath = testPathResolver.resolveLocalSkillPath(
    "test-skill/SKILL.md",
  );
  const skillDirectory = dirname(skillPath);
  const localSkillDirectory = dirname(localSkillPath);
  let memoryFileSystem: MemoryFileSystem;
  let pathResolver: ResourcePathResolver;

  function getStubPathResolver() {
    return pathResolver;
  }

  function createPathResolverMock() {
    return {
      resolvePackPath: vi.fn(),
      resolvePackSkillPath: vi.fn(),
      resolvePackAgentPath: vi.fn(),
      resolvePackPromptPath: vi.fn(),
      resolveGlobalSkillPath: vi.fn((path) =>
        testPathResolver.resolveGlobalSkillPath(path),
      ),
      resolveLocalSkillPath: vi.fn((path) =>
        testPathResolver.resolveLocalSkillPath(path),
      ),
      resolveGlobalAgentPath: vi.fn(),
      resolveLocalAgentPath: vi.fn(),
      resolveGlobalPromptPath: vi.fn(),
      resolveLocalPromptPath: vi.fn(),
    } satisfies ResourcePathResolver;
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    memoryFileSystem = new MemoryFileSystem();
    pathResolver = createPathResolverMock();
    resetDevelopmentExtensionNotice();
  });

  afterEach(() => {
    memoryFileSystem.reset();
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
        name: ["Must be lowercase alphanumeric with dashes only"],
        description: ["Description is required"],
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
        license: ["License must be a valid path"],
        compatibility: ["Compatibility must be 500 characters or fewer"],
        allowedTools: ["Allowed tools must be a comma-separated list"],
      });
    });
  });

  it("handleCreate cancels when the required form is dismissed", async () => {
    const custom = vi.fn().mockResolvedValueOnce(null);
    const notify = vi.fn();

    await handleCreate(
      { ui: { custom, notify } } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

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

    await handleCreate(
      { ui: { custom, notify } } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    expectFormFactory(custom, 0, "Create Skill");
    const content = await memoryFileSystem.readFile(skillPath);
    expect(content).toMatchObject({
      data: expect.stringContaining("# Test Skill"),
      success: true,
    });
    expect(pathResolver.resolveGlobalSkillPath).toHaveBeenCalledWith(
      "test-skill",
    );
    expect(pathResolver.resolveLocalSkillPath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${skillPath}`,
    );
  });

  it("handleCreate writes a local skill when the local scope is requested", async () => {
    const custom = vi.fn().mockResolvedValueOnce({
      name: "test-skill",
      description: "Useful skill description",
      confirm: false,
    });
    const notify = vi.fn();

    const localFileSystem = new MemoryFileSystem();

    await handleCreate(
      { cwd: localCwd, ui: { custom, notify } } as never,
      "local",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    const content = await localFileSystem.readFile(localSkillPath);
    expect(content).toMatchObject({
      data: expect.stringContaining("# Test Skill"),
      success: true,
    });
    expect(pathResolver.resolveLocalSkillPath).toHaveBeenCalledWith(
      "test-skill",
    );
    expect(pathResolver.resolveGlobalSkillPath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${localSkillPath}`,
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

    await handleCreate(
      { ui: { custom, notify } } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    expectFormFactory(custom, 0, "Create Skill");
    expectFormFactory(custom, 1, "Skill Details");
    const content = await memoryFileSystem.readFile(skillPath);
    expect(content).toMatchObject({
      data: expect.stringContaining("allowed-tools: 'read, write'"),
      success: true,
    });
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${skillPath}`,
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

    await handleCreate(
      { ui: { custom, notify } } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    const content = await memoryFileSystem.readFile(skillPath);
    expect(content).toMatchObject({
      data: expect.stringContaining("# Test Skill"),
      success: true,
    });
    expect(notify).toHaveBeenCalledWith(
      `Skill created successfully: ${skillPath}`,
    );
  });

  it("handleCreate preserves an existing skill", async () => {
    memoryFileSystem.seed({
      [skillPath]: "existing skill content",
    });
    const notify = vi.fn();

    await handleCreate(
      {
        ui: {
          custom: vi.fn().mockResolvedValueOnce({
            name: "test-skill",
            description: "Useful skill description",
            confirm: false,
          }),
          notify,
        },
      } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    const content = await memoryFileSystem.readFile(skillPath);

    expect(content).toEqual({
      data: "existing skill content",
      success: true,
    });
    expect(notify).toHaveBeenCalledWith(
      "Skill already exists: test-skill",
      "error",
    );
  });

  it("handleEdit uses the external editor factory by default", async () => {
    memoryFileSystem.seed({
      [skillPath]: "existing skill content",
    });
    vi.stubEnv("EDITOR", "code");
    const editorFactory = vi.fn();
    mockCreateExternalEditorFactory.mockReturnValueOnce(editorFactory);
    const custom = vi
      .fn()
      .mockResolvedValueOnce(skillPath)
      .mockResolvedValueOnce({ before: "before", after: "after", changed: true });
    const notify = vi.fn();
    const reload = vi.fn().mockResolvedValueOnce(undefined);

    await handleEdit(
      { ui: { custom, notify }, reload } as never,
      undefined,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    expect(mockCreateExternalEditorFactory).toHaveBeenCalledWith(
      "code",
      skillPath,
    );
    expect(custom).toHaveBeenNthCalledWith(2, editorFactory, modalEditorOverlayOptions);
    expect(pathResolver.resolveGlobalSkillPath).toHaveBeenCalledWith();
    expect(pathResolver.resolveLocalSkillPath).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill updated. Reloading skills...",
      "info",
    );
  });

  it("handleEdit uses the external editor factory", async () => {
    memoryFileSystem.seed({
      [skillPath]: "existing skill content",
    });
    vi.stubEnv("VISUAL", 'code --wait +"set ft=markdown"');
    const editorFactory = vi.fn();
    mockCreateExternalEditorFactory.mockReturnValueOnce(editorFactory);
    const custom = vi
      .fn()
      .mockResolvedValueOnce(skillPath)
      .mockResolvedValueOnce({ before: "before", after: "after", changed: true });
    const notify = vi.fn();
    const reload = vi.fn().mockResolvedValueOnce(undefined);

    await handleEdit(
      { ui: { custom, notify }, reload } as never,
      "external",
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    expect(mockCreateExternalEditorFactory).toHaveBeenCalledWith(
      'code --wait +"set ft=markdown"',
      skillPath,
    );
    expect(custom).toHaveBeenNthCalledWith(2, editorFactory, modalEditorOverlayOptions);
    expect(pathResolver.resolveGlobalSkillPath).toHaveBeenCalledWith();
    expect(pathResolver.resolveLocalSkillPath).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill updated. Reloading skills...",
      "info",
    );
  });

  it("handleEdit reports cancellation when no skill is selected", async () => {
    memoryFileSystem.seed({
      [skillPath]: "existing skill content",
    });
    const notify = vi.fn();

    await handleEdit(
      {
        ui: {
          custom: vi.fn().mockResolvedValueOnce(null),
          notify,
        },
        reload: vi.fn(),
      } as never,
      undefined,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    expect(notify).toHaveBeenCalledWith("Skill edit cancelled", "info");
  });

  it("handleDelete removes the selected skill directory", async () => {
    memoryFileSystem.seed({
      [skillPath]: "existing skill content",
    });
    const custom = vi.fn().mockResolvedValueOnce(skillPath);
    const notify = vi.fn();

    await handleDelete(
      { ui: { custom, notify } } as never,
      "global",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    await expect(memoryFileSystem.readFile(skillPath)).resolves.toMatchObject({
      success: false,
    });
    expect(pathResolver.resolveGlobalSkillPath).toHaveBeenCalledWith();
    expect(pathResolver.resolveLocalSkillPath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      `Skill deleted successfully: ${skillDirectory}`,
    );
  });

  it("handleDelete removes the selected local skill directory", async () => {
    const localFileSystem = new MemoryFileSystem();
    localFileSystem.seed({
      [localSkillPath]: "existing local skill content",
    });
    const custom = vi.fn().mockResolvedValueOnce(localSkillPath);
    const notify = vi.fn();

    await handleDelete(
      { cwd: localCwd, ui: { custom, notify } } as never,
      "local",
      () => new MemoryFileSystem(),
      getStubPathResolver,
    );

    await expect(
      localFileSystem.readFile(localSkillPath),
    ).resolves.toMatchObject({
      success: false,
    });
    expect(pathResolver.resolveLocalSkillPath).toHaveBeenCalledWith();
    expect(pathResolver.resolveGlobalSkillPath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      `Skill deleted successfully: ${localSkillDirectory}`,
    );
  });
});
