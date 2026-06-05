import {
  type ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import { MemoryFileSystem, PathResolver } from "../shared/filesystem";
import type { ResourcePathResolver } from "../shared/filesystem";
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
  let pathResolverMock: ResourcePathResolver;
  let writeFile: ReturnType<typeof vi.spyOn>;
  let removeDirectory: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    fileSystem = new MemoryFileSystem();
    pathResolver = new PathResolver("/workspace", "/test-home");
    writeFile = vi.spyOn(fileSystem, "writeFile");
    removeDirectory = vi.spyOn(fileSystem, "removeDirectory");
  });

  beforeEach(() => {
    pathResolverMock = {
      resolvePackPath: vi.fn((path) => pathResolver.resolvePackPath(path)),
      resolvePackSkillPath: vi.fn((packName, path) =>
        pathResolver.resolvePackSkillPath(packName, path),
      ),
      resolvePackAgentPath: vi.fn((packName, path) =>
        pathResolver.resolvePackAgentPath(packName, path),
      ),
      resolvePackPromptPath: vi.fn((packName, path) =>
        pathResolver.resolvePackPromptPath(packName, path),
      ),
      resolveGlobalSkillPath: vi.fn(),
      resolveLocalSkillPath: vi.fn(),
      resolveGlobalAgentPath: vi.fn(),
      resolveLocalAgentPath: vi.fn(),
      resolveGlobalPromptPath: vi.fn(),
      resolveLocalPromptPath: vi.fn(),
    } satisfies ResourcePathResolver;
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
        pathResolver: pathResolverMock,
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
      expect(pathResolverMock.resolvePackPath).toHaveBeenCalledWith(output);
      expect(pathResolverMock.resolvePackPromptPath).toHaveBeenCalledWith(output, "");
      expect(pathResolverMock.resolvePackPromptPath).toHaveBeenCalledWith(output, "example.md");

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(output, "example/SKILL.md"),
        exampleSkillContent,
      );
      expect(pathResolverMock.resolvePackSkillPath).toHaveBeenCalledWith(output, "");
      expect(pathResolverMock.resolvePackSkillPath).toHaveBeenCalledWith(output, "example");
      expect(pathResolverMock.resolvePackSkillPath).toHaveBeenCalledWith(
        output,
        "example/SKILL.md",
      );

      expect(writeFile).toHaveBeenCalledWith(
        pathResolver.resolvePackAgentPath(output, "example.md"),
        exampleAgentContent,
      );
      expect(pathResolverMock.resolvePackAgentPath).toHaveBeenCalledWith(output, "");
      expect(pathResolverMock.resolvePackAgentPath).toHaveBeenCalledWith(output, "example.md");
    });

    it("deletes a pack when delete is passed in", async () => {
      const output = "C#";

      fileSystem.seed({
        [pathResolver.resolvePackAgentPath(output, "example.md")]: exampleAgentContent,
        [pathResolver.resolvePackSkillPath(output, "example/SKILL.md")]: exampleSkillContent,
        [pathResolver.resolvePackPromptPath(output, "example.md")]: examplePromptContent,
      });
      vi.mocked(pathResolverMock.resolvePackPath).mockClear();

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
        pathResolver: pathResolverMock,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of the pack you want to delete?",
      );

      expect(removeDirectory).toHaveBeenCalledWith(pathResolver.resolvePackPath(output));
      expect(pathResolverMock.resolvePackPath).toHaveBeenCalledWith(output);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${output}'`,
      );
    });
  });
  describe("Testing skillPackResourceReducer", () => {
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

    const skillIt = test
      .extend("folders", () => [
        "front-end",
        "back-end",
        "systems-programming",
        "sentry",
        "render",
      ])
      .extend("folder", ({ folders }) => folders[Math.floor(Math.random() * folders.length)])
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

    skillIt(
      "creates a skill in a pack when create is passed in",
      async ({ folders, randomSkill }) => {
        seedPacksWithResource(folders, pathResolver.resolvePackSkillPath, {
          filePath: "example/SKILL.md",
          content: exampleSkillContent,
        });

        const ctx = {
          ui: {
            custom: vi.fn(mockCustomUIFactory),
            input: vi.fn().mockResolvedValue(randomSkill),
            notify: vi.fn(),
          },
        } satisfies MockContext;

        await skillPackResourceReducer("create", {
          getSkillPackResourceSelector: getMockCreatePackSkillResourceSelector,
          ctx: createTestContext(ctx),
          fileSystem,
        });

        expect(ctx.ui.custom).toHaveBeenCalledWith();

        expect(ctx.ui.input).toHaveBeenCalledWith(
          "Which skill do you want to add to the pack?",
        );
      },
    );

    it("deletes a skill in a pack when delete is passed in", async () => {
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
        pathResolver.resolvePackPath(packName),
      );

      expect(getMockCreatePackSkillResourceSelector).toHaveBeenCalledWith(
        "Which skill do you want to delete from the pack?",
        packName,
        ["example"],
      );
      expect(ctx.ui.custom).toHaveBeenCalledWith(
        getMockCreatePackSkillResourceSelector.mock.results[0].value,
      );

      const removeDirectorySpy = vi.spyOn(fileSystem, "removeDirectory");

      expect(removeDirectorySpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(packName, "example"),
      );
    });
  });
  describe.todo("Testing agentPackResourceReducer", () => {});
  describe.todo("Testing promptPackResourceReducer", () => {});
});
