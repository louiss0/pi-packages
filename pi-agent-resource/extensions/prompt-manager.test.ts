import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form } from "@code-fixer-23/pi-form-components";
import { getMemoryResourceFileSystem } from "../shared/filesystem";
import { resetDevelopmentExtensionNotice } from "../shared/runtime";

vi.mock("@earendil-works/pi-tui", async () => {
  const module =
    await vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");

  return {
    ...module,
    matchesKey: (data: string, key: string) => data === key,
  };
});

vi.mock("node:os", () => ({
  homedir: () => "/test-home",
}));

import registerPromptManager, {
  createPromptForm,
  handleCreate,
  handleDelete,
  handleEdit,
  LOCAL_PROMPT_DIRECTORY,
  parsePromptCommandArgument,
  parsePromptFormValues,
} from "./prompt-manager";

describe("extensions/prompt-manager", () => {
  const localCwd = "/workspace";
  const expectedPromptPath = "/create-react-component.md";
  const expectedLocalPromptPath = "/create-react-component.md";
  let memoryFileSystem: ReturnType<typeof getMemoryResourceFileSystem>;

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    memoryFileSystem = getMemoryResourceFileSystem(join(".pi", "agent", "prompts"));
    resetDevelopmentExtensionNotice();
  });

  afterEach(() => {
    memoryFileSystem.reset();
  });

  describe("parsePromptCommandArgument", () => {
    it("parses the prompt subcommand without inline flags", () => {
      expect(parsePromptCommandArgument("create")).toEqual({
        success: true,
        output: "create",
      });
    });
  });

  describe("extension registration", () => {
    it("registers a dedicated command for local prompts", async () => {
      const registerCommand = vi.fn();
      const registerFlag = vi.fn();
      const getFlag = vi.fn();
      const notify = vi.fn();

      registerPromptManager({
        registerCommand,
        registerFlag,
        getFlag,
      } as never);

      expect(registerFlag).not.toHaveBeenCalled();
      expect(registerCommand).toHaveBeenNthCalledWith(
        1,
        "resource:prompts",
        expect.objectContaining({
          description: "This is for managing global prompts",
        }),
      );
      expect(registerCommand).toHaveBeenNthCalledWith(
        2,
        "resource:local-prompt",
        expect.objectContaining({
          description: "This is for managing project prompts",
        }),
      );

      const command = registerCommand.mock.calls[1]?.[1] as {
        handler: (
          arg: string,
          ctx: { cwd: string; ui: { notify: typeof notify } },
        ) => Promise<void>;
      };
      await command.handler("create", {
        cwd: localCwd,
        ui: { notify, custom: vi.fn() },
      } as never);

      expect(notify).toHaveBeenNthCalledWith(
        1,
        `Using local prompts from ${join(localCwd, LOCAL_PROMPT_DIRECTORY)}`,
        "info",
      );
    });
  });

  describe("createPromptForm", () => {
    it("uses the shared form component and required footer", () => {
      const form = createPromptForm(createTui(), createTheme(), vi.fn());
      const lines = form.render(100).join("\n");

      expect(form).toBeInstanceOf(Form);
      expect(lines).toContain("Create Prompt");
      expect(lines).toContain("argument-hint is optional");
      expect(lines).toContain("Templat");
    });
  });

  describe("parsePromptFormValues", () => {
    it("validates prompt form values", () => {
      const errors = parsePromptFormValues({
        name: "UP",
        description: "too short",
        "argument-hint": "plain",
      });

      expect(errors).toEqual({
        name: "Name must be at least 3 characters\nName must be lowercase letters, numbers, and dashes only",
        description: "Description must be at least 35 characters",
        "argument-hint": "Argument hint must use [] or <> tokens",
      });
    });
  });

  describe("handleCreate", () => {
    it("writes the created prompt after the template overlay submits", async () => {
      const custom = vi
        .fn()
        .mockResolvedValueOnce({
          name: "create-react-component",
          description: "This prompt creates a React component with full file output",
          "argument-hint": "<name> [directory]",
        })
        .mockResolvedValueOnce("Write the component template here");
      const notify = vi.fn();

      await handleCreate({ ui: { custom, notify } } as never, "global", () => memoryFileSystem);

      const content = await memoryFileSystem.readFile(expectedPromptPath);

      expect(content).toMatchObject({
        data: expect.stringContaining("argument-hint: <name> [directory]"),
        success: true,
      });
      expect(content).toMatchObject({
        data: expect.stringContaining("Write the component template here"),
        success: true,
      });
      expect(notify).toHaveBeenCalledWith("Prompt created");
    });

    it("writes the created local prompt when local scope is requested", async () => {
      const custom = vi
        .fn()
        .mockResolvedValueOnce({
          name: "create-react-component",
          description: "This prompt creates a React component with full file output",
          "argument-hint": "<name> [directory]",
        })
        .mockResolvedValueOnce("Write the component template here");
      const notify = vi.fn();

      const localFileSystem = getMemoryResourceFileSystem(join(localCwd, ".pi", "prompts"));

      await handleCreate(
        { cwd: localCwd, ui: { custom, notify } } as never,
        "local",
        () => localFileSystem,
      );

      const content = await localFileSystem.readFile(expectedLocalPromptPath);

      expect(content).toMatchObject({
        data: expect.stringContaining("Write the component template here"),
        success: true,
      });
      expect(notify).toHaveBeenCalledWith("Prompt created");
    });
  });

  describe("handleEdit", () => {
    it("edits the selected global prompt", async () => {
      memoryFileSystem.seed({
        [expectedPromptPath.slice(1)]: "---\nname: create-react-component\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("global: create-react-component");
      const editor = vi.fn().mockResolvedValueOnce("updated prompt content");
      const notify = vi.fn();

      await handleEdit({ ui: { notify, select, editor } } as never, "global", () => memoryFileSystem);

      const content = await memoryFileSystem.readFile(expectedPromptPath);

      expect(select).toHaveBeenCalledWith("Edit Prompt", ["global: create-react-component"]);
      expect(content).toEqual({
        data: "updated prompt content",
        success: true,
      });
      expect(notify).toHaveBeenCalledWith("Prompt edited");
    });

    it("edits the selected local prompt", async () => {
      const localFileSystem = getMemoryResourceFileSystem(join(localCwd, ".pi", "prompts"));
      localFileSystem.seed({
        [expectedLocalPromptPath.slice(1)]: "---\nname: create-react-component\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("local: create-react-component");
      const editor = vi.fn().mockResolvedValueOnce("updated local prompt content");
      const notify = vi.fn();

      await handleEdit(
        { cwd: localCwd, ui: { notify, select, editor } } as never,
        "local",
        () => localFileSystem,
      );

      const content = await localFileSystem.readFile(expectedLocalPromptPath);

      expect(select).toHaveBeenCalledWith("Edit Prompt", ["local: create-react-component"]);
      expect(content).toEqual({
        data: "updated local prompt content",
        success: true,
      });
      expect(notify).toHaveBeenCalledWith("Prompt edited");
    });
  });

  describe("handleDelete", () => {
    it("deletes the selected global prompt", async () => {
      memoryFileSystem.seed({
        [expectedPromptPath.slice(1)]: "---\nname: create-react-component\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("global: create-react-component");
      const notify = vi.fn();

      await handleDelete({ ui: { notify, select } } as never, "global", () => memoryFileSystem);

      await expect(memoryFileSystem.readFile(expectedPromptPath)).resolves.toMatchObject({
        success: false,
      });
      expect(notify).toHaveBeenCalledWith("Prompt deleted");
    });

    it("deletes the selected local prompt", async () => {
      const localFileSystem = getMemoryResourceFileSystem(join(localCwd, ".pi", "prompts"));
      localFileSystem.seed({
        [expectedLocalPromptPath.slice(1)]: "---\nname: create-react-component\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("local: create-react-component");
      const notify = vi.fn();

      await handleDelete(
        { cwd: localCwd, ui: { notify, select } } as never,
        "local",
        () => localFileSystem,
      );

      await expect(localFileSystem.readFile(expectedLocalPromptPath)).resolves.toMatchObject({
        success: false,
      });
      expect(notify).toHaveBeenCalledWith("Prompt deleted");
    });
  });
});
