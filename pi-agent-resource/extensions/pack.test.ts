import {
  type ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import {
  getMemoryResourceFileSystem,
  MemoryFileSystem,
  PathResolver,
} from "../shared/filesystem";
import {
  exampleAgentContent,
  examplePromptContent,
  exampleSkillContent,
  getCreatePackResourceSelector,
  getSkillPackResourceSelector as getCreatePackSkillResourceSelector,
  rootPackResourceReducer,
  skillPackResourceReducer,
} from "./pack";

type MockContext =
  | Partial<ExtensionCommandContext>
  | { ui: Partial<ExtensionCommandContext["ui"]> };

function createTestContext(ctx: MockContext) {
  return ctx as unknown as ExtensionCommandContext;
}

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
  let pathResolver: PathResolver;
  let writeFile: ReturnType<typeof vi.spyOn>;
  let removeDirectory: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    fileSystem = getMemoryResourceFileSystem();
    pathResolver = new PathResolver("/workspace", "/test-home");
    writeFile = vi.spyOn(fileSystem, "writeFile");
    removeDirectory = vi.spyOn(fileSystem, "removeDirectory");
  });

  afterEach(() => {
    writeFile.mockClear();
    removeDirectory.mockClear();
    fileSystem.reset();
  });

  describe("Testing rootPackResourceReducer", () => {
    const getMockCreatePackResourceSelector = (
      choices: ReadonlyArray<"skills" | "prompts" | "agents">,
    ): ReturnType<typeof getCreatePackResourceSelector> => {
      return (_tui: TUI, _theme: Theme, _: KeybindingsManager, done) => {
        return {
          invalidate: vi.fn(),
          handleInput: vi.fn(() => done(choices)),
          render: vi.fn(),
        } satisfies Component;
      };
    };

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

      const mockCreatePackResourceSelector =
        getMockCreatePackResourceSelector(selectionChoices);

      await rootPackResourceReducer("create", {
        ctx: createTestContext(ctx),
        createPackResourceSelector: mockCreatePackResourceSelector,
        fileSystem,
        pathResolver,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith("pack", "What is the name of your agent pack?");

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack created successfully with name '${output}'`,
      );

      expect(ctx.ui.custom).toHaveBeenCalledWith(mockCreatePackResourceSelector);

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackPromptPath(output, "example.md"),
        examplePromptContent,
      );

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(output, "example/SKILL.md"),
        exampleSkillContent,
      );

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackAgentPath(output, "example.md"),
        exampleAgentContent,
      );
    });

    it("deletes a pack when delete is passed in", async () => {
      const output = "C#";

      fileSystem.seed({
        [pathResolver.resolvePackAgentPath(output, "example.md")]:
          exampleAgentContent,
        [pathResolver.resolvePackSkillPath(output, "example/SKILL.md")]:
          exampleSkillContent,
        [pathResolver.resolvePackPromptPath(output, "example.md")]:
          examplePromptContent,
      });

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
        pathResolver,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );

      expect(removeDirectory).toHaveBeenCalledWith(
        pathResolver.resolvePackPath(output),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe.todo("Testing skillPackResourceReducer", () => {
    const getMockCreatePackSkillResourceSelector = vi.fn(
      (
        _title: string,
        _packName: string,
        skills: string[],
      ): ReturnType<typeof getCreatePackSkillResourceSelector> =>
        (_tu, _th, _k, done) => {
          return {
            render: vi.fn(),
            invalidate: vi.fn(),
            handleInput: vi.fn(() => done(skills)),
          };
        },
    );

    it("deletes a skill pack when delete is passed in", async () => {


      const packName = "C#";

      const folderNames = [
        "front-end",
        "back-end",
        "systems-programming",
        "sentry",
        "render",
        `${packName}`,
      ];

      const skillSeedMap = folderNames.reduce((acc, dir) => {
        acc.set(
          pathResolver.resolvePackSkillPath(dir, "example/SKILL.md"),
          exampleSkillContent,
        );
        return acc;
      }, new Map<string, string>());

      fileSystem.seed(Object.fromEntries(skillSeedMap));

      const ctx = {
        ui: {
          custom: vi.fn(mockCustomUIFactory),
          select: vi.fn().mockResolvedValue(packName),
          notify: vi.fn(),
        },
      } satisfies MockContext;

      await skillPackResourceReducer("delete", {
        getSkillPackResourceSelector: getMockCreatePackSkillResourceSelector,
        ctx: createTestContext(ctx),
        fileSystem,
      });

      const readDirectoryNamesSpy = vi.spyOn(fileSystem, "readDirectoryNames");

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(pathResolver.resolvePackPath());

      expect(readDirectoryNamesSpy).resolves.toEqual(folderNames);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        "Which pack do you want to delete a skill from?",
        folderNames,
      );

      expect(ctx.ui.select).resolves.toEqual(packName);

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(packName),
      );

      expect(getMockCreatePackSkillResourceSelector).toHaveBeenCalledWith(
        "Which skill do you want to delete from the pack?",
        packName,
        ["example"],
      );
      expect(ctx.ui.custom).toHaveBeenCalledWith(getMockCreatePackSkillResourceSelector.mock.results[0].value);

      const removeDirectorySpy = vi.spyOn(fileSystem, "removeDirectory");

      expect(removeDirectorySpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(packName, "example"),
      );
    });
  });
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
