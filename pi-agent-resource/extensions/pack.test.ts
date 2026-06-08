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
  renderAgentFrontmatter,
  renderPromptMarkdown,
  renderSkillMarkdown,
} from "../shared/resource-components";
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

    it("deletes selected packs when delete is passed in", async () => {
      const packNames = ["csharp", "systems"];
      const removeDirectorySpy = vi.spyOn(fileSystem, "removeDirectory");

      fileSystem.seed({
        [pathResolver.resolvePackAgentPath(packNames[0], "example.md")]:
          exampleAgentContent,
        [pathResolver.resolvePackPromptPath(packNames[0], "example.md")]:
          examplePromptContent,
        [pathResolver.resolvePackSkillPath(packNames[0], "example/SKILL.md")]:
          exampleSkillContent,
        [pathResolver.resolvePackAgentPath(packNames[1], "example.md")]:
          exampleAgentContent,
      });

      const ctx = {
        ui: {
          custom: vi.fn().mockResolvedValue([packNames[0]]),
          notify: vi.fn(),
        },
      } satisfies MockContext;

      await rootPackResourceReducer("delete", {
        createPackResourceSelector: getMockCreatePackResourceSelector([]),
        ctx: createTestContext(ctx),
        fileSystem,
        pathResolver,
      });

      expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function));
      expect(removeDirectorySpy).toHaveBeenCalledWith(
        pathResolver.resolvePackPath(packNames[0]),
      );
      expect(removeDirectorySpy).not.toHaveBeenCalledWith(
        pathResolver.resolvePackPath(packNames[1]),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith("Deleted 1 pack(s)");
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
    buildCreateUi: (
      resourceName: string,
    ) => Partial<ExtensionCommandContext["ui"]>;
    exampleContent: string;
    expectCreateUi: (
      ui: Partial<ExtensionCommandContext["ui"]>,
      folders: string[],
      packName: string,
      resourceName: string,
    ) => void;
    getCreateContent: (resourceName: string) => string;
    getCreateFilePath: (packName: string, resourceName: string) => string;
    getDeletePath: (packName: string, resourceName: string) => string;
    getEditFilePath: (packName: string, resourceName: string) => string;
    getGlobalDeletePath: (resourceName: string) => string;
    getGlobalFilePath: (resourceName: string) => string;
    getGlobalRootPath: () => string;
    getLocalDeletePath: (resourceName: string) => string;
    getLocalFilePath: (resourceName: string) => string;
    getLocalRootPath: () => string;
    getPackResourcePath: (packName: string) => string;
    isDirectoryResource: boolean;
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
            notify: vi.fn(),
            select: vi.fn().mockResolvedValue(randomFolder),
            ...config.buildCreateUi(randomResourceName),
          },
        } satisfies MockContext;

        await config.reducer("create", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(""),
        );
        expect(ctx.ui.select).toHaveBeenCalledWith(
          `What pack do you want to add the ${config.kind} to?`,
          folders,
        );
        config.expectCreateUi(
          ctx.ui,
          folders,
          randomFolder,
          randomResourceName,
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getCreateFilePath(randomFolder, randomResourceName),
          config.getCreateContent(randomResourceName),
        );
        expect(ctx.ui.notify).toHaveBeenCalledWith(
          `${config.kind} created in pack '${randomFolder}'`,
        );

        await expect(
          fileSystem.readFile(
            config.getEditFilePath(randomFolder, randomResourceName),
          ),
        ).resolves.toMatchObject({
          data: config.getCreateContent(randomResourceName),
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
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(""),
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
        const removeResourceSpy = config.isDirectoryResource
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
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(readDirectoryNamesSpy).toHaveBeenCalledWith(
          pathResolver.resolvePackPath(""),
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

      test(`moves a ${config.kind} from a pack to the local folder`, async ({
        randomFolder,
        randomResourceName,
      }) => {
        fileSystem.seed({
          [config.getEditFilePath(randomFolder, randomResourceName)]:
            config.exampleContent,
        });

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce(randomResourceName),
          },
        } satisfies MockContext;

        const readFileSpy = vi.spyOn(fileSystem, "readFile");
        const writeFileSpy = vi.spyOn(fileSystem, "writeFile");
        const removeResourceSpy = config.isDirectoryResource
          ? vi.spyOn(fileSystem, "removeDirectory")
          : vi.spyOn(fileSystem, "removeFile");

        await config.reducer("move-local", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `Which pack would you like to move a ${config.kind} from?`,
          [randomFolder],
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `Which ${config.kind} would you like to move?`,
          [randomResourceName],
        );
        expect(readFileSpy).toHaveBeenCalledWith(
          config.getEditFilePath(randomFolder, randomResourceName),
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getLocalFilePath(randomResourceName),
          config.exampleContent,
        );
        expect(removeResourceSpy).toHaveBeenCalledWith(
          config.getDeletePath(randomFolder, randomResourceName),
        );
      });

      test(`moves a ${config.kind} from a pack to the global folder`, async ({
        randomFolder,
        randomResourceName,
      }) => {
        fileSystem.seed({
          [config.getEditFilePath(randomFolder, randomResourceName)]:
            config.exampleContent,
        });

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce(randomResourceName),
          },
        } satisfies MockContext;

        const readFileSpy = vi.spyOn(fileSystem, "readFile");
        const writeFileSpy = vi.spyOn(fileSystem, "writeFile");
        const removeResourceSpy = config.isDirectoryResource
          ? vi.spyOn(fileSystem, "removeDirectory")
          : vi.spyOn(fileSystem, "removeFile");

        await config.reducer("move-global", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `Which pack would you like to move a ${config.kind} from?`,
          [randomFolder],
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `Which ${config.kind} would you like to move?`,
          [randomResourceName],
        );
        expect(readFileSpy).toHaveBeenCalledWith(
          config.getEditFilePath(randomFolder, randomResourceName),
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getGlobalFilePath(randomResourceName),
          config.exampleContent,
        );
        expect(removeResourceSpy).toHaveBeenCalledWith(
          config.getDeletePath(randomFolder, randomResourceName),
        );
      });

      test(`moves a local ${config.kind} into a pack`, async ({
        randomFolder,
        randomResourceName,
      }) => {
        fileSystem.seed({
          [config.getLocalFilePath(randomResourceName)]: config.exampleContent,
          [config.getEditFilePath(randomFolder, "example")]:
            config.exampleContent,
        });

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce(randomResourceName),
          },
        } satisfies MockContext;

        const readFileSpy = vi.spyOn(fileSystem, "readFile");
        const writeFileSpy = vi.spyOn(fileSystem, "writeFile");
        const removeResourceSpy = config.isDirectoryResource
          ? vi.spyOn(fileSystem, "removeDirectory")
          : vi.spyOn(fileSystem, "removeFile");

        await config.reducer("move-local-to-pack", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `Which pack would you like to move a ${config.kind} to?`,
          [randomFolder],
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `Which local ${config.kind} would you like to move?`,
          [randomResourceName],
        );
        expect(readFileSpy).toHaveBeenCalledWith(
          config.getLocalFilePath(randomResourceName),
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getCreateFilePath(randomFolder, randomResourceName),
          config.exampleContent,
        );
        expect(removeResourceSpy).toHaveBeenCalledWith(
          config.getLocalDeletePath(randomResourceName),
        );
      });

      test(`moves a global ${config.kind} into a pack`, async ({
        randomFolder,
        randomResourceName,
      }) => {
        fileSystem.seed({
          [config.getGlobalFilePath(randomResourceName)]: config.exampleContent,
          [config.getEditFilePath(randomFolder, "example")]:
            config.exampleContent,
        });

        const ctx = {
          ui: {
            notify: vi.fn(),
            select: vi
              .fn<ExtensionCommandContext["ui"]["select"]>()
              .mockResolvedValueOnce(randomFolder)
              .mockResolvedValueOnce(randomResourceName),
          },
        } satisfies MockContext;

        const readFileSpy = vi.spyOn(fileSystem, "readFile");
        const writeFileSpy = vi.spyOn(fileSystem, "writeFile");
        const removeResourceSpy = config.isDirectoryResource
          ? vi.spyOn(fileSystem, "removeDirectory")
          : vi.spyOn(fileSystem, "removeFile");

        await config.reducer("move-global-to-pack", {
          ctx: createTestContext(ctx),
          fileSystem,
          getMultiSelectorFactory: mockGetMultiSelectorFactory,
          openExternalEditor: mockOpenExternalEditor,
          pathResolver,
        });

        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          1,
          `Which pack would you like to move a ${config.kind} to?`,
          [randomFolder],
        );
        expect(ctx.ui.select).toHaveBeenNthCalledWith(
          2,
          `Which global ${config.kind} would you like to move?`,
          [randomResourceName],
        );
        expect(readFileSpy).toHaveBeenCalledWith(
          config.getGlobalFilePath(randomResourceName),
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
          config.getCreateFilePath(randomFolder, randomResourceName),
          config.exampleContent,
        );
        expect(removeResourceSpy).toHaveBeenCalledWith(
          config.getGlobalDeletePath(randomResourceName),
        );
      });
    });
  }

  definePackResourceReducerSuite({
    buildCreateUi: (resourceName) => ({
      custom: vi.fn().mockResolvedValueOnce({
        name: resourceName,
        description: "Useful skill description",
        confirm: false,
      }),
    }),
    exampleContent: exampleSkillContent,
    expectCreateUi: (ui) => {
      expect(ui.custom).toHaveBeenCalledTimes(1);
    },
    getCreateContent: (resourceName) =>
      renderSkillMarkdown({
        name: resourceName,
        description: "Useful skill description",
        license: "",
        compatibility: "",
        allowedTools: "",
      }),
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, `${resourceName}/SKILL.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, resourceName),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackSkillPath(packName, `${resourceName}/SKILL.md`),
    getGlobalDeletePath: (resourceName) =>
      pathResolver.resolveGlobalSkillPath(resourceName),
    getGlobalFilePath: (resourceName) =>
      pathResolver.resolveGlobalSkillPath(`${resourceName}/SKILL.md`),
    getGlobalRootPath: () => pathResolver.resolveGlobalSkillPath(""),
    getLocalDeletePath: (resourceName) =>
      pathResolver.resolveLocalSkillPath(resourceName),
    getLocalFilePath: (resourceName) =>
      pathResolver.resolveLocalSkillPath(`${resourceName}/SKILL.md`),
    getLocalRootPath: () => pathResolver.resolveLocalSkillPath(""),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackSkillPath(packName, ""),
    isDirectoryResource: true,
    kind: "skill",
    reducer: skillPackResourceReducer,
  });

  definePackResourceReducerSuite({
    buildCreateUi: (resourceName) => ({
      custom: vi.fn().mockResolvedValueOnce({
        name: resourceName,
        description: "made for careful research and deep code review work",
        tools: "read,write,bash",
        model: "claude",
      }),
    }),
    exampleContent: exampleAgentContent,
    expectCreateUi: (ui) => {
      expect(ui.custom).toHaveBeenCalledTimes(1);
    },
    getCreateContent: (resourceName) =>
      renderAgentFrontmatter({
        name: resourceName,
        description: "made for careful research and deep code review work",
        tools: "read,write,bash",
        model: "claude",
      }),
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackAgentPath(packName, `${resourceName}.md`),
    getGlobalDeletePath: (resourceName) =>
      pathResolver.resolveGlobalAgentPath(`${resourceName}.md`),
    getGlobalFilePath: (resourceName) =>
      pathResolver.resolveGlobalAgentPath(`${resourceName}.md`),
    getGlobalRootPath: () => pathResolver.resolveGlobalAgentPath(""),
    getLocalDeletePath: (resourceName) =>
      pathResolver.resolveLocalAgentPath(`${resourceName}.md`),
    getLocalFilePath: (resourceName) =>
      pathResolver.resolveLocalAgentPath(`${resourceName}.md`),
    getLocalRootPath: () => pathResolver.resolveLocalAgentPath(""),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackAgentPath(packName, ""),
    isDirectoryResource: false,
    kind: "agent",
    reducer: agentPackResourceReducer,
  });

  definePackResourceReducerSuite({
    buildCreateUi: (resourceName) => ({
      custom: vi
        .fn()
        .mockResolvedValueOnce({
          name: resourceName,
          description:
            "This prompt creates a React component with full file output",
          "argument-hint": "<name> [directory]",
        })
        .mockResolvedValueOnce("Write the component template here"),
    }),
    exampleContent: examplePromptContent,
    expectCreateUi: (ui) => {
      expect(ui.custom).toHaveBeenCalledTimes(2);
    },
    getCreateContent: (resourceName) =>
      renderPromptMarkdown(
        {
          name: resourceName,
          description:
            "This prompt creates a React component with full file output",
          "argument-hint": "<name> [directory]",
        },
        "Write the component template here",
      ),
    getCreateFilePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getDeletePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getEditFilePath: (packName, resourceName) =>
      pathResolver.resolvePackPromptPath(packName, `${resourceName}.md`),
    getGlobalDeletePath: (resourceName) =>
      pathResolver.resolveGlobalPromptPath(`${resourceName}.md`),
    getGlobalFilePath: (resourceName) =>
      pathResolver.resolveGlobalPromptPath(`${resourceName}.md`),
    getGlobalRootPath: () => pathResolver.resolveGlobalPromptPath(""),
    getLocalDeletePath: (resourceName) =>
      pathResolver.resolveLocalPromptPath(`${resourceName}.md`),
    getLocalFilePath: (resourceName) =>
      pathResolver.resolveLocalPromptPath(`${resourceName}.md`),
    getLocalRootPath: () => pathResolver.resolveLocalPromptPath(""),
    getPackResourcePath: (packName) =>
      pathResolver.resolvePackPromptPath(packName, ""),
    isDirectoryResource: false,
    kind: "prompt",
    reducer: promptPackResourceReducer,
  });
});
