import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";

import {
  agentPackResourceReducer,
  exampleAgentContent,
  examplePromptContent,
  exampleSkillContent,
  getCreatePackResourceSelector,
  getMultiSelectorFactory,
  openExternalEditor,
  promptPackResourceReducer,
  rootPackResourceReducer,
  skillPackResourceReducer,
} from "./pack";
import {
  MemoryFileSystem,
  PathResolver,
  type ResourcePathResolver,
} from "../shared/filesystem";

type MockContext =
  | Partial<ExtensionCommandContext>
  | { ui: Partial<ExtensionCommandContext["ui"]> };

type PackResourceReducer = typeof skillPackResourceReducer;

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

  const result = await factory(
    {} as TUI,
    {} as Theme,
    {} as KeybindingsManager,
    (nextValue) => {
      value = nextValue;
    },
  );

  result.handleInput?.("data");

  if (value === undefined) {
    throw new Error("Custom UI factory did not call done()");
  }

  return value;
};

const mockGetMultiSelectorFactory = vi.fn<typeof getMultiSelectorFactory>(
  () => {
    return (_tui, _theme, _keybindingsManager, done) => {
      return {
        handleInput: vi.fn((data) => done(data)),
        invalidate: vi.fn(),
        render: vi.fn(),
      };
    };
  },
);

function createPathResolver() {
  const pathResolver = new PathResolver("/workspace", "/test-home");

  return {
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
    resolveGlobalSkillPath: vi.fn((path) =>
      pathResolver.resolveGlobalSkillPath(path),
    ),
    resolveLocalSkillPath: vi.fn((path) =>
      pathResolver.resolveLocalSkillPath(path),
    ),
    resolveGlobalAgentPath: vi.fn((path) =>
      pathResolver.resolveGlobalAgentPath(path),
    ),
    resolveLocalAgentPath: vi.fn((path) =>
      pathResolver.resolveLocalAgentPath(path),
    ),
    resolveGlobalPromptPath: vi.fn((path) =>
      pathResolver.resolveGlobalPromptPath(path),
    ),
    resolveLocalPromptPath: vi.fn((path) =>
      pathResolver.resolveLocalPromptPath(path),
    ),
  } satisfies ResourcePathResolver;
}

const mockOpenExternalEditor = vi.fn<typeof openExternalEditor>();

describe("Pack", () => {
  let fileSystem: MemoryFileSystem;
  let pathResolver: ReturnType<typeof createPathResolver>;

  beforeEach(() => {
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
          handleInput: vi.fn(() => done(choices)),
          invalidate: vi.fn(),
          render: vi.fn(),
        } satisfies Component;
      };
    };

    it("creates a pack when create is passed in", async () => {
      const packName = "front-end";
      const resourceChoices = ["prompts", "skills", "agents"] as const;
      const writeFileSpy = vi.spyOn(fileSystem, "writeFile");

      const ctx = {
        ui: {
          custom: vi.fn(mockCustomUIFactory),
          input: vi.fn().mockResolvedValue(packName),
          notify: vi.fn(),
        },
      } satisfies MockContext;

      const mockCreatePackResourceSelector =
        getMockCreatePackResourceSelector(resourceChoices);

      await rootPackResourceReducer("create", {
        createPackResourceSelector: mockCreatePackResourceSelector,
        ctx: createTestContext(ctx),
        fileSystem,
        pathResolver,
      });

      expect(ctx.ui.input).toHaveBeenCalledWith(
        "pack",
        "What is the name of your agent pack?",
      );
      expect(ctx.ui.custom).toHaveBeenCalledWith(
        mockCreatePackResourceSelector,
      );
      expect(pathResolver.resolvePackPath).toHaveBeenCalledWith(packName);
      expect(writeFileSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPromptPath(packName, "example.md"),
        examplePromptContent,
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackSkillPath(packName, "example/SKILL.md"),
        exampleSkillContent,
      );
      expect(writeFileSpy).toHaveBeenCalledWith(
        pathResolver.resolvePackAgentPath(packName, "example.md"),
        exampleAgentContent,
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack created successfully with name '${packName}'`,
      );
    });

    it("deletes a pack when delete is passed in", async () => {
      const packName = "csharp";
      const removeDirectorySpy = vi.spyOn(fileSystem, "removeDirectory");

      fileSystem.seed({
        [pathResolver.resolvePackAgentPath(packName, "example.md")]:
          exampleAgentContent,
        [pathResolver.resolvePackPromptPath(packName, "example.md")]:
          examplePromptContent,
        [pathResolver.resolvePackSkillPath(packName, "example/SKILL.md")]:
          exampleSkillContent,
      });

      const ctx = {
        ui: {
          input: vi.fn().mockResolvedValue(packName),
          notify: vi.fn(),
        },
      } satisfies MockContext;

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
      expect(removeDirectorySpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath(packName),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Pack deleted successfully with name '${packName}'`,
      );
    });
  });

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
    .extend("randomResourceName", () => {
      const resourceNames = [
        "typescript",
        "react",
        "golang",
        "graphql",
        "docker",
        "oracle",
        "create-react-component",
      ];

      return resourceNames[Math.floor(Math.random() * resourceNames.length)];
    });

  function seedPacksWithResource(
    folderNames: string[],
    getResourcePath: (packName: string, resourceName: string) => string,
    content: string,
  ) {
    const seedMap = folderNames.reduce<Record<string, string>>(
      (filesByPath, folderName) => {
        filesByPath[getResourcePath(folderName, "example")] = content;
        return filesByPath;
      },
      {},
    );

    fileSystem.seed(seedMap);
  }

  function definePackResourceReducerSuite(config: {
    exampleContent: string;
    getCreateFilePath: (packName: string, resourceName: string) => string;
    getDeletePath: (packName: string, resourceName: string) => string;
    getEditFilePath: (packName: string, resourceName: string) => string;
    getPackResourcePath: (packName: string) => string;
    kind: "skill" | "agent" | "prompt";
    reducer: PackResourceReducer;
  }) {
    describe(`Testing ${config.kind}PackResourceReducer`, () => {
      test(`creates a ${config.kind} in a pack when create is passed in`, async ({
        folders,
        randomFolder,
        randomResourceName,
      }) => {
        seedPacksWithResource(
          folders,
          config.getEditFilePath,
          config.exampleContent,
        );

        const readDirectoryNamesSpy = vi.spyOn(
          fileSystem,
          "readDirectoryNames",
        );
        const writeFileSpy = vi.spyOn(fileSystem, "writeFile");

        const ctx = {
          ui: {
            input: vi.fn().mockResolvedValue(randomResourceName),
            notify: vi.fn(),
            select: vi.fn().mockResolvedValue(randomFolder),
          },
        } satisfies MockContext;

        await config.reducer("create", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(),
        );
        expect(ctx.ui.select).toHaveBeenCalledWith(
          `What pack do you want to add the ${config.kind} to?`,
          folders,
        );
        expect(ctx.ui.input).toHaveBeenCalledWith(
          `Which ${config.kind} do you want to add to the pack?`,
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getCreateFilePath(randomFolder, randomResourceName),
          config.exampleContent,
        );
        expect(ctx.ui.notify).toHaveBeenCalledWith(
          `${config.kind} created in pack '${randomFolder}'`,
        );

        await expect(
          fileSystem.readFile(
            config.getEditFilePath(randomFolder, randomResourceName),
          ),
        ).resolves.toMatchObject({
          data: config.exampleContent,
          success: true,
        });
      });

      test(`allows the user to edit a ${config.kind} when the edit command is passed in`, async ({
        folders,
        randomFolder,
      }) => {
        seedPacksWithResource(
          folders,
          config.getEditFilePath,
          config.exampleContent,
        );

        const readDirectoryNamesSpy = vi.spyOn(
          fileSystem,
          "readDirectoryNames",
        );

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce("example"),
          },
        } satisfies MockContext;

        await config.reducer("edit", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(),
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `What pack has the ${config.kind} you want to edit?`,
          folders,
        );
        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          config.getPackResourcePath(randomFolder),
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `What ${config.kind} do you want to edit?`,
          ["example"],
        );
        expect(mockOpenExternalEditor).toHaveBeenCalledWith(
          config.getEditFilePath(randomFolder, "example"),
        );
      });

      test(`deletes a ${config.kind} in a pack when delete is passed in`, async ({
        folders,
        randomFolder,
        randomResourceName,
      }) => {
        fileSystem.seed(
          Object.fromEntries(
            folders.map((folderName) => [
              config.getEditFilePath(folderName, randomResourceName),
              config.exampleContent,
            ]),
          ),
        );

        const readDirectoryNamesSpy = vi.spyOn(
          fileSystem,
          "readDirectoryNames",
        );
        const removeResourceSpy =
          config.kind === "skill"
            ? vi.spyOn(fileSystem, "removeDirectory")
            : vi.spyOn(fileSystem, "removeFile");

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce(randomResourceName),
          },
        } satisfies MockContext;

        await config.reducer("delete", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMuiltiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(),
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `Which pack do you want to delete a ${config.kind} from?`,
          folders,
        );
        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          config.getPackResourcePath(randomFolder),
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `Which ${config.kind} do you want to delete from the pack?`,
          [randomResourceName],
        );
        expect(removeResourceSpy).toHaveBeenCalledWith(
          config.getDeletePath(randomFolder, randomResourceName),
        );
        expect(ctx.ui.notify).toHaveBeenCalledWith(
          `${config.kind} deleted from pack '${randomFolder}'`,
        );
      });
    });
  }

  definePackResourceReducerSuite({
    exampleContent: exampleSkillContent,
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, `${resourceName}/SKILL.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, resourceName),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, `${resourceName}/SKILL.md`),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackSkillPath(packName, ""),
    kind: "skill",
    reducer: skillPackResourceReducer,
  });

  definePackResourceReducerSuite({
    exampleContent: exampleAgentContent,
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackAgentPath(packName, ""),
    kind: "agent",
    reducer: agentPackResourceReducer,
  });

  definePackResourceReducerSuite({
    exampleContent: examplePromptContent,
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackPromptPath(packName, ""),
    kind: "prompt",
    reducer: promptPackResourceReducer,
  });
});
