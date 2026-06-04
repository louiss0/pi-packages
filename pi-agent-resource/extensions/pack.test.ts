import {
  type ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import { getMemoryResourceFileSystem, MemoryFileSystem } from "../shared/filesystem";
import {
  exampleAgentContent,
  examplePromptContent,
  exampleSkillContent,
  getCreatePackResourceSelector,
  ROOT_PACK_FOLDER_PATH,
  rootPackResourceReducer,
} from "./pack";

type MockContext =
  | Partial<ExtensionCommandContext>
  | { ui: Partial<ExtensionCommandContext["ui"]> };

function createTestContext(ctx: MockContext) {
  return ctx as unknown as ExtensionCommandContext;
}

const getMockCreatePackResourceSelector = (
  choices: Array<"skills" | "prompts" | "agents">,
): ReturnType<typeof getCreatePackResourceSelector> => {
  return (_tui: TUI, _theme: Theme, _: KeybindingsManager, done) => {
    return {
      invalidate: vi.fn(),
      handleInput: vi.fn(() => done(choices)),
      render: vi.fn(),
    } satisfies Component;
  };
};

const mockCustomUIFactory = async <T>(
  factory: (
    tui: TUI,
    theme: Theme,
    _: KeybindingsManager,
    done: (result?: T) => void,
  ) => Component | Promise<Component>,
) => {
  let value;

  const result = await factory({} as TUI, {} as Theme, {} as KeybindingsManager, (result) => {
    value = result;
  });

  result.handleInput?.("data");

  return value as never;
};

describe("Pack", () => {
  let fileSystem: MemoryFileSystem;
  let writeFile: ReturnType<typeof vi.spyOn>;
  let removeDirectory: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    fileSystem = getMemoryResourceFileSystem(ROOT_PACK_FOLDER_PATH);
    writeFile = vi.spyOn(fileSystem, "writeFile");
    removeDirectory = vi.spyOn(fileSystem, "removeDirectory");
  });

  afterEach(() => {
    writeFile.mockClear();
    removeDirectory.mockClear();
    fileSystem.reset();
  });

  describe("Testing rootPackResourceReducer", () => {
    it("creates a pack when create is passed in", async () => {
      const output = "front-end";
      const selectionChoices = ["prompts", "skills", "agents"] as const;

      const ctx = {
        ui: {
          input: vi.fn().mockResolvedValue(output),
          notify: vi.fn(),
          custom: vi.fn(mockCustomUIFactory),
        },
      } satisfies MockContext;

      const mockCreatePackResourceSelector = getMockCreatePackResourceSelector(
        selectionChoices.slice(),
      );

      await rootPackResourceReducer("create", {
        ctx: createTestContext(ctx),
        createPackResourceSelector: mockCreatePackResourceSelector,
        fileSystem,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith("pack", "What is the name of your agent pack?");

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack created successfully with name '${output}'`,
      );

      expect(ctx.ui.custom).toHaveBeenCalledWith(mockCreatePackResourceSelector);

      expect(writeFile).toHaveBeenCalledWith(
        `${fileSystem.rootPath}/${output}/${selectionChoices[0]}/example.md`,
        examplePromptContent,
      );

      expect(writeFile).toHaveBeenCalledWith(
        `${fileSystem.rootPath}/${output}/${selectionChoices[1]}/example/SKILL.md`,
        exampleSkillContent,
      );

      expect(writeFile).toHaveBeenCalledWith(
        `${fileSystem.rootPath}/${output}/${selectionChoices[2]}/example.md`,
        exampleAgentContent,
      );
    });

    it("deletes a pack when delete is passed in", async () => {
      const output = "C#";

      await fileSystem.mkdir(`${ROOT_PACK_FOLDER_PATH}${output}`, { recursive: true });
      await fileSystem.writeFile(
        `${ROOT_PACK_FOLDER_PATH}${output}/example.md`,
        exampleAgentContent,
      );

      const ctx = {
        ui: {
          input: vi.fn(async () => output),
          notify: vi.fn(),
        },
      };

      await rootPackResourceReducer("delete", {
        createPackResourceSelector: getMockCreatePackResourceSelector([]),
        ctx: createTestContext(ctx),
        fileSystem,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );

      expect(removeDirectory).toHaveBeenCalledWith(`${ROOT_PACK_FOLDER_PATH}${output}`);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe.todo("Testing skillPackResourceReducer", () => {});
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
