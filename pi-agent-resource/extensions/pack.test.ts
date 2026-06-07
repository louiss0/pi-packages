import {
  type ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import { MemoryFileSystem, PathResolver, ResourcePathResolver } from "../shared/filesystem";
import {
  exampleAgentContent,
  examplePromptContent,
  exampleSkillContent,
  getCreatePackResourceSelector,
  getMultiSelectorFactory,
  openExternalEditor,
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

  if (value === undefined) {
    throw new Error("Custom UI factory did not call done()");
  }

  return value;
};

const mockGetMultiSelectorFactory = vi.fn<typeof getMultiSelectorFactory>(() => {
  return (_t, _theme, _keybindingsManager, done) => {
    return {
      handleInput: vi.fn((data) => done(data)),
      render: vi.fn(),
      invalidate: vi.fn(),
    };
  };
});

function createPathResolver() {
  const pathResolver = new PathResolver("/workspace", "/test-home");

  return {
    resolvePackPath: vi.fn(pathResolver.resolvePackPath),
    resolvePackSkillPath: vi.fn((packName, path) =>
      pathResolver.resolvePackSkillPath(packName, path),
    ),
    resolvePackAgentPath: vi.fn((packName, path) =>
      pathResolver.resolvePackAgentPath(packName, path),
    ),
    resolvePackPromptPath: vi.fn((packName, path) =>
      pathResolver.resolvePackPromptPath(packName, path),
    ),
    resolveGlobalSkillPath: vi.fn(pathResolver.resolveGlobalSkillPath),
    resolveLocalSkillPath: vi.fn(pathResolver.resolveLocalSkillPath),
    resolveGlobalAgentPath: vi.fn(pathResolver.resolveGlobalAgentPath),
    resolveLocalAgentPath: vi.fn(pathResolver.resolveLocalAgentPath),
    resolveGlobalPromptPath: vi.fn(pathResolver.resolveGlobalPromptPath),
    resolveLocalPromptPath: vi.fn(pathResolver.resolveLocalPromptPath),
  } satisfies ResourcePathResolver;
}

const mockOpenExternalEditor = vi.fn<typeof openExternalEditor>();

describe("Pack", () => {
  let fileSystem: MemoryFileSystem;
  let pathResolver: ReturnType<typeof createPathResolver>;

  beforeAll(() => {
    fileSystem = new MemoryFileSystem();
    pathResolver = createPathResolver();
  });

  afterEach(() => {
    vi.resetAllMocks();
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

      const writeFile = vi.spyOn(fileSystem, "writeFile");
      expect(ctx.ui.custom).toHaveBeenCalledWith(mockCreatePackResourceSelector);

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackPromptPath(output, "example.md"),
        examplePromptContent,
      );
      expect(pathResolver.resolvePackPath).toHaveBeenCalledWith(output);
      expect(pathResolver.resolvePackPromptPath).toHaveBeenCalledWith(output, "");
      expect(pathResolver.resolvePackPromptPath).toHaveBeenCalledWith(output, "example.md");

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(output, "example/SKILL.md"),
        exampleSkillContent,
      );
      expect(pathResolver.resolvePackSkillPath).toHaveBeenCalledWith(output, "");
      expect(pathResolver.resolvePackSkillPath).toHaveBeenCalledWith(output, "example");
      expect(pathResolver.resolvePackSkillPath).toHaveBeenCalledWith(
        output,
        "example/SKILL.md",
      );

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackAgentPath(output, "example.md"),
        exampleAgentContent,
      );
      expect(pathResolver.resolvePackAgentPath).toHaveBeenCalledWith(output, "");
      expect(pathResolver.resolvePackAgentPath).toHaveBeenCalledWith(output, "example.md");
    });

    it("deletes a pack when delete is passed in", async () => {
      const output = "C#";

      fileSystem.seed({
        [pathResolver.resolvePackAgentPath(output, "example.md")]: exampleAgentContent,
        [pathResolver.resolvePackSkillPath(output, "example/SKILL.md")]: exampleSkillContent,
        [pathResolver.resolvePackPromptPath(output, "example.md")]: examplePromptContent,
      });
      vi.mocked(pathResolver.resolvePackPath).mockClear();

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
        pathResolver: pathResolver,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );
      const removeDirectory = vi.spyOn(fileSystem, "writeFile");

      expect(removeDirectory).toHaveBeenCalledWith(pathResolver.resolvePackPath(output));
      expect(pathResolver.resolvePackPath).toHaveBeenCalledWith(output);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe("Testing skillPackResourceReducer", () => {
    function seedPacksWithResource(
      folderNames: string[],
      pathResolver: (path: string, filename: string) => string,
      options: { filePath: string; content: string },
    ): void {
      const seedMap = folderNames.reduce((acc, dir) => {
        acc.set(pathResolver(dir, options.filePath), options.content);
        return acc;
      }, new Map<string, string>());

      return fileSystem.seed(Object.fromEntries(seedMap));
    }

    const test = it
      .extend("folders", () => [
        "front-end",
        "back-end",
        "systems-programming",
        "sentry",
        "render",
      ])
      .extend(
        "randomFolder",
        ({ folders }) => folders[Math.floor(Math.random() * folders.length)],
      )
      .extend("randomSkill", () => {
        const skills = [
          "typescript",
          "angular",
          "golang",
          "tanstack-query",
          "react",
          "vue",
          "rust",
          "python",
          "nodejs",
          "docker",
          "kubernetes",
          "graphql",
          "postgresql",
          "redis",
        ];
        return skills[Math.floor(Math.random() * skills.length)];
      });

    test("creates a skill in a pack when create is passed in", async ({
      folders,
      randomSkill,
      randomFolder,
    }) => {
      seedPacksWithResource(folders, pathResolver.resolvePackSkillPath, {
        filePath: "example/SKILL.md",
        content: exampleSkillContent,
      });

      const ctx = {
        ui: {
          select: vi.fn<ExtensionCommandContext["ui"]["select"]>(),
          input: vi.fn<ExtensionCommandContext["ui"]["input"]>(),
          notify: vi.fn<ExtensionCommandContext["ui"]["notify"]>(),
        },
      } satisfies MockContext;

      await skillPackResourceReducer("create", {
        getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
        pathResolver,
        openExternalEditor: mockOpenExternalEditor,
        ctx: createTestContext(ctx),
        fileSystem,
      });

      const readDirectoryNamesSpy = vi.spyOn(fileSystem, "readDirectoryNames");
      const writeFileSpy = vi.spyOn(fileSystem, "writeFile");

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath.mock.results[0].value,
      );

      await expect(readDirectoryNamesSpy).resolves.toEqual(folders);

      ctx.ui.select.mockResolvedValue(randomFolder);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        "What pack do you want to add the skill to?",
        folders.map((folder) => `${folder} pack`),
      );

      ctx.ui.input.mockResolvedValue(randomSkill);

      expect(ctx.ui.input).toHaveBeenCalledWith("Which skill do you want to add to the pack?");

      await expect(ctx.ui.input).resolves.toBe(randomSkill);

      expect(writeFileSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(randomFolder, randomSkill),
        exampleSkillContent,
      );

      await expect(writeFileSpy).resolves.toBe(undefined);

      const result = await fileSystem.readDirectoryNames(
        pathResolver.resolvePackSkillPath(randomFolder, ""),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith();

      if (result.success) {
        expect(result.data).toContain(randomSkill);
      }
    });

    test("allows the user to edit a skill when the edit command is passed in", async ({
      folders,
      randomFolder,
    }) => {
      seedPacksWithResource(folders, pathResolver.resolvePackSkillPath, {
        filePath: "example/SKILL.md",
        content: exampleSkillContent,
      });

      const ctx = {
        ui: {
          select: vi.fn<ExtensionCommandContext["ui"]["select"]>(),
          editor: vi.fn<ExtensionCommandContext["ui"]["editor"]>(),
          notify: vi.fn<ExtensionCommandContext["ui"]["notify"]>(),
        },
      } satisfies MockContext;

      await skillPackResourceReducer("edit", {
        getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
        openExternalEditor: mockOpenExternalEditor,
        pathResolver,
        ctx: createTestContext(ctx),
        fileSystem,
      });

      expect(pathResolver.resolvePackPath).toHaveBeenCalledWith("");

      const readDirectoryNamesSpy = vi.spyOn(fileSystem, "readDirectoryNames");

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath.mock.results[0].value,
      );

      await expect(readDirectoryNamesSpy).resolves.toEqual(folders);

      ctx.ui.select.mockResolvedValue(randomFolder);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        "What pack has the skill you want to edit?",
        folders.map((folder) => folder),
      );

      await expect(ctx.ui.select).resolves.toBe(randomFolder);

      expect(pathResolver.resolvePackPath).toHaveBeenCalledWith(randomFolder);

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath.mock.results[0].value,
      );

      await expect(readDirectoryNamesSpy).resolves.toEqual(["example"]);

      ctx.ui.select.mockResolvedValue("example");

      expect(ctx.ui.select).toHaveBeenCalledWith("What skill do you want to edit?", [
        "example",
      ]);

      await expect(ctx.ui.select).resolves.toBe("example");

      expect(pathResolver.resolvePackSkillPath).toHaveBeenCalledWith("example/SKILL.md");

      expect(mockOpenExternalEditor).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath.mock.results[0].value,
      );

      await expect(mockOpenExternalEditor).resolves.toBeUndefined();
    });

    test("deletes a skill in a pack when delete is passed in", async ({
      folders,
      randomFolder,
      randomSkill,
    }) => {
      seedPacksWithResource(folders, pathResolver.resolvePackSkillPath, {
        filePath: `${randomSkill}/SKILL.md`,
        content: exampleSkillContent,
      });

      const ctx = {
        ui: {
          custom: vi.fn(mockCustomUIFactory),
          select: vi.fn().mockResolvedValue(randomFolder),
          notify: vi.fn(),
        },
      } satisfies MockContext;

      await skillPackResourceReducer("delete", {
        getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
        pathResolver,
        openExternalEditor: mockOpenExternalEditor,

        ctx: createTestContext(ctx),
        fileSystem,
      });

      const readDirectoryNamesSpy = vi.spyOn(fileSystem, "readDirectoryNames");

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(pathResolver.resolvePackPath());

      expect(readDirectoryNamesSpy).resolves.toEqual(folders);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        "Which pack do you want to delete a skill from?",
        folders,
      );

      expect(ctx.ui.select).resolves.toEqual(randomFolder);

      expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath(randomFolder),
      );

      expect(mockGetMultiSelectorFactory).toHaveBeenCalledWith(
        "Which skill do you want to delete from the pack?",
      );
      expect(ctx.ui.custom).toHaveBeenCalledWith(
        mockGetMultiSelectorFactory.mock.results[0].value,
      );

      const removeDirectorySpy = vi.spyOn(fileSystem, "removeDirectory");

      expect(removeDirectorySpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(randomFolder, randomSkill),
      );
    });
  });
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
