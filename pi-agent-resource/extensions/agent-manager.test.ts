import { join } from "node:path";
import { Form } from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  getResourceFileSystem,
  resetResourceFileSystem,
  useMemoryResourceFileSystem,
} from "../shared/filesystem";
import { resetDevelopmentExtensionNotice } from "../shared/runtime";

vi.mock("@earendil-works/pi-tui", async () => {
  return vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");
});

vi.mock("node:os", () => ({
  homedir: () => "/test-home",
}));

const TAB_KEY = "\t";
const ENTER_KEY = "\r";

import registerAgentManager, {
  createAgentForm,
  handleCreate,
  handleDelete,
  handleEdit,
  LOCAL_AGENT_DIRECTORY,
  parseAgentCommandArgument,
  parseAgentFormValues,
} from "./agent-manager";

describe("extensions/agent-manager", () => {
  const localCwd = "/workspace";
  const expectedAgentPath = join("/test-home", ".pi", "agent", "agents", "oracle.md");
  const expectedLocalAgentPath = join(localCwd, ".pi", "agents", "oracle.md");
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    memoryFileSystem = useMemoryResourceFileSystem();
    resetDevelopmentExtensionNotice();
  });

  afterEach(() => {
    resetResourceFileSystem();
  });

  describe("parseAgentCommandArgument", () => {
    it("parses the agent subcommand without inline flags", () => {
      expect(parseAgentCommandArgument("create")).toEqual({
        success: true,
        output: "create",
      });
    });
  });

  describe("extension registration", () => {
    it("registers a dedicated command for local agents", async () => {
      const registerCommand = vi.fn();
      const registerFlag = vi.fn();
      const getFlag = vi.fn();
      const notify = vi.fn();

      registerAgentManager({ registerCommand, registerFlag, getFlag } as never);

      expect(registerFlag).not.toHaveBeenCalled();
      expect(registerCommand).toHaveBeenNthCalledWith(
        1,
        "resource:agent",
        expect.objectContaining({
          description: "This is for managing global agents",
        }),
      );
      expect(registerCommand).toHaveBeenNthCalledWith(
        2,
        "resource:local-agent",
        expect.objectContaining({
          description: "This is for managing project agents",
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
        `Using local agents from ${join(localCwd, LOCAL_AGENT_DIRECTORY)}`,
        "info",
      );
    });
  });

  describe("createAgentForm", () => {
    it("uses the shared form component and required footer", () => {
      const form = createAgentForm(createTui(), createTheme(), vi.fn());
      const lines = form.render(100).join("\n");

      expect(form).toBeInstanceOf(Form);
      expect(lines).toContain("Create Agent");
      expect(lines).toContain("* required");
      expect(lines).toContain("Use lowercase values for every field");
    });

    it("renders the expected errors when invalid values are submitted", () => {
      const form = createAgentForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      form.handleInput("O");
      form.handleInput("r");
      form.handleInput("a");
      form.handleInput("c");
      form.handleInput("l");
      form.handleInput("e");
      form.handleInput(TAB_KEY);

      form.handleInput("s");
      form.handleInput("h");
      form.handleInput("o");
      form.handleInput("r");
      form.handleInput("t");
      form.handleInput(TAB_KEY);

      form.handleInput("R");
      form.handleInput("e");
      form.handleInput("a");
      form.handleInput("d");
      form.handleInput(TAB_KEY);

      form.handleInput("C");
      form.handleInput(ENTER_KEY);

      const lines = form.render(100).join("\n");

      expect(lines).toContain("Name must be lowercase letters, numbers, and dashes only");
      expect(lines).toContain("Description must be at least 35 characters");
      expect(lines).toContain("Tools must be a lowercase comma-separated list");
      expect(lines).toContain("Model must be at least 2 characters");
      expect(lines).toContain("Model must be lowercase");
    });

    it("validates later required fields when name is filled first", () => {
      const form = createAgentForm(createTui(), createTheme(), vi.fn());

      form.focused = true;
      form.handleInput("o");
      form.handleInput("r");
      form.handleInput("a");
      form.handleInput("c");
      form.handleInput("l");
      form.handleInput("e");

      form.handleInput(TAB_KEY);
      form.handleInput(TAB_KEY);
      form.handleInput(TAB_KEY);
      form.handleInput(ENTER_KEY);

      const lines = form.render(100).join("\n");

      expect(lines).not.toContain("Name is required");
      expect(lines).not.toContain("Name must be lowercase letters, numbers, and dashes only");
      expect(lines).toContain("Description must be at least 35 characters");
      expect(lines).toContain("Tools are required");
      expect(lines).toContain("Model must be at least 2 characters");
    });
  });

  describe("parseAgentFormValues", () => {
    it("validates required agent fields", () => {
      const errors = parseAgentFormValues({
        name: "Oracle",
        description: "too short",
        tools: "Read, Write",
        model: "C",
      });

      expect(errors).toEqual({
        name: "Name must be lowercase letters, numbers, and dashes only",
        description: "Description must be at least 35 characters",
        tools: "Tools must be a lowercase comma-separated list",
        model: "Model must be at least 2 characters\nModel must be lowercase",
      });
    });
  });

  describe("handleCreate", () => {
    it("writes the created agent to the global agents directory", async () => {
      const custom = vi.fn().mockResolvedValueOnce({
        name: "oracle",
        description: "made for careful research and deep code review work",
        tools: "read,write,bash",
        model: "claude",
      });
      const notify = vi.fn();

      await handleCreate({ ui: { custom, notify } } as never);

      const content = await getResourceFileSystem().readFile(expectedAgentPath, "utf8");

      expect(content).toContain("name: oracle");
      expect(notify).toHaveBeenCalledWith("Agent created");
    });

    it("writes the created agent to the project agents directory when local", async () => {
      const custom = vi.fn().mockResolvedValueOnce({
        name: "oracle",
        description: "made for careful research and deep code review work",
        tools: "read,write,bash",
        model: "claude",
      });
      const notify = vi.fn();

      await handleCreate({ cwd: localCwd, ui: { custom, notify } } as never, "local");

      const content = await getResourceFileSystem().readFile(expectedLocalAgentPath, "utf8");

      expect(content).toContain("name: oracle");
      expect(notify).toHaveBeenCalledWith("Agent created");
    });

    it("reports filesystem errors when agent creation fails", async () => {
      const custom = vi.fn().mockResolvedValueOnce({
        name: "oracle",
        description: "made for careful research and deep code review work",
        tools: "read,write,bash",
        model: "claude",
      });
      const notify = vi.fn();
      vi.spyOn(memoryFileSystem, "writeFile").mockRejectedValueOnce(
        new Error("write denied"),
      );

      await handleCreate({ ui: { custom, notify } } as never);

      expect(notify).toHaveBeenCalledWith(
        "Agent creation failed: write denied",
        "error",
      );
      expect(notify).not.toHaveBeenCalledWith("Agent created");
    });

    it("reports cancellation when agent creation is dismissed", async () => {
      const notify = vi.fn();

      await handleCreate({
        ui: { custom: vi.fn().mockResolvedValueOnce(null), notify },
      } as never);

      await expect(
        getResourceFileSystem().readFile(expectedAgentPath, "utf8"),
      ).rejects.toThrow();
      expect(notify).toHaveBeenCalledWith("Agent creation cancelled", "info");
    });
  });

  describe("handleEdit", () => {
    it("edits the selected global agent", async () => {
      memoryFileSystem.seed({
        [expectedAgentPath]: "---\nname: oracle\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("global: oracle");
      const editor = vi.fn().mockResolvedValueOnce("updated agent content");
      const notify = vi.fn();

      await handleEdit({ ui: { notify, select, editor } } as never);

      const content = await getResourceFileSystem().readFile(expectedAgentPath, "utf8");

      expect(select).toHaveBeenCalledWith("Edit Agent", ["global: oracle"]);
      expect(editor).toHaveBeenCalledWith("Edit Agent", "---\nname: oracle\n---\n");
      expect(content).toBe("updated agent content");
      expect(notify).toHaveBeenCalledWith("Agent edited");
    });

    it("edits the selected local agent", async () => {
      memoryFileSystem.seed({
        [expectedLocalAgentPath]: "---\nname: oracle\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("local: oracle");
      const editor = vi.fn().mockResolvedValueOnce("updated local agent content");
      const notify = vi.fn();

      await handleEdit({ cwd: localCwd, ui: { notify, select, editor } } as never, "local");

      const content = await getResourceFileSystem().readFile(expectedLocalAgentPath, "utf8");

      expect(select).toHaveBeenCalledWith("Edit Agent", ["local: oracle"]);
      expect(content).toBe("updated local agent content");
      expect(notify).toHaveBeenCalledWith("Agent edited");
    });

    it("reports filesystem errors when agent editing fails", async () => {
      memoryFileSystem.seed({
        [expectedAgentPath]: "---\nname: oracle\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("global: oracle");
      const editor = vi.fn().mockResolvedValueOnce("updated agent content");
      const notify = vi.fn();
      vi.spyOn(memoryFileSystem, "writeFile").mockRejectedValueOnce(
        new Error("write denied"),
      );

      await handleEdit({ ui: { notify, select, editor } } as never);

      expect(notify).toHaveBeenCalledWith(
        "Agent edit failed: write denied",
        "error",
      );
      expect(notify).not.toHaveBeenCalledWith("Agent edited");
    });
  });

  describe("handleDelete", () => {
    it("deletes the selected global agent", async () => {
      memoryFileSystem.seed({
        [expectedAgentPath]: "---\nname: oracle\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("global: oracle");
      const notify = vi.fn();

      await handleDelete({ ui: { notify, select } } as never);

      await expect(
        getResourceFileSystem().readFile(expectedAgentPath, "utf8"),
      ).rejects.toThrow();
      expect(select).toHaveBeenCalledWith("Delete Agent", ["global: oracle"]);
      expect(notify).toHaveBeenCalledWith("Agent deleted");
    });

    it("deletes the selected local agent", async () => {
      memoryFileSystem.seed({
        [expectedLocalAgentPath]: "---\nname: oracle\n---\n",
      });
      const select = vi.fn().mockResolvedValueOnce("local: oracle");
      const notify = vi.fn();

      await handleDelete({ cwd: localCwd, ui: { notify, select } } as never, "local");

      await expect(
        getResourceFileSystem().readFile(expectedLocalAgentPath, "utf8"),
      ).rejects.toThrow();
      expect(select).toHaveBeenCalledWith("Delete Agent", ["local: oracle"]);
      expect(notify).toHaveBeenCalledWith("Agent deleted");
    });
  });
});
