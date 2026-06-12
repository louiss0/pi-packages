import {
  createExternalEditorFactory,
  MultiSelect,
  MultiSelectConfig,
} from "@code-fixer-23/pi-form-components";
import {
  type ExtensionAPI,
  ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, SelectItem, TUI } from "@earendil-works/pi-tui";
import { picklist, safeParse, summarize } from "valibot";

import {
  getPathResolver,
  NodeFileSystem,
  type ResourceFileSystem,
  type ResourcePathResolver,
} from "../shared/filesystem";
import {
  createOptionalSkillForm,
  createPromptForm,
  createRequiredSkillForm,
  PromptTemplateOverlay,
  renderPromptMarkdown,
  renderSkillMarkdown,
  type OptionalSkillFields,
  type PromptFields,
  type RequiredSkillFields,
} from "../shared/resource-components";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

const PACK_LABEL = "pack";
const ROOT_PACK_COMMAND = `resource:${PACK_LABEL}`;

export const CREATE_COMMAND = "create";
export const EDIT_COMMAND = "edit";
export const DELETE_COMMAND = "delete";
export const packCommands = picklist([CREATE_COMMAND, DELETE_COMMAND]);

export const MOVE_LOCAL_COMMAND = "move-local";
export const MOVE_GLOBAL_COMMAND = "move-global";
export const MOVE_GLOBAL_TO_PACK_COMMAND = "move-global-to-pack";
export const MOVE_LOCAL_TO_PACK_COMMAND = "move-local-to-pack";

export const packOrginaizationCommands = [
  MOVE_LOCAL_COMMAND,
  MOVE_LOCAL_TO_PACK_COMMAND,
  MOVE_GLOBAL_COMMAND,
  MOVE_GLOBAL_TO_PACK_COMMAND,
] as const;

export const SKILL_COMMAND = "skill";
export const PROMPT_COMMAND = "prompt";

const packManagementCommands = [
  CREATE_COMMAND,
  EDIT_COMMAND,
  DELETE_COMMAND,
] as const;
const packResourceCommands = picklist([
  ...packOrginaizationCommands,
  ...packManagementCommands,
]);

type PackResourceCommand = (typeof packResourceCommands.options)[number];

type PackResourceHandlers = Record<PackResourceCommand, () => Promise<void>>;

export const ROOT_PACK_FOLDER_PATH = ".pi/packs/";

export async function openExternalEditor(
  ctx: ExtensionCommandContext,
  filePath: string,
) {
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    ctx.ui.notify("Set $VISUAL or $EDITOR to edit pack resources", "error");
    return new Error("No external editor set");
  }

  const result = await ctx.ui.custom<Error | { changed: boolean }>(
    createExternalEditorFactory(editor, filePath),
    modalEditorOverlayOptions,
  );

  if (result instanceof Error) {
    ctx.ui.notify(result.message, "error");
    return result;
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  const SPACE_OR_COMMA_RANGE = /[\s,]+/;

  const LOAD_PACK_FLAG = "resource:load-pack";
  pi.registerFlag(LOAD_PACK_FLAG, {
    type: "string",
    description: "Load a pack using the it's name only",
  });

  let packs: ReadonlyArray<string> | undefined;

  pi.on("resources_discover", (event, ctx) => {
    const pathResolver = getPathResolver();

    if (event.reason === "startup") {
      const loadPack = pi.getFlag(LOAD_PACK_FLAG);

      if (typeof loadPack !== "string") {
        return;
      }

      ctx.ui.notify(`Loading pack ${loadPack}`);

      packs = loadPack.split(SPACE_OR_COMMA_RANGE);
    }

    return {
      promptPaths: packs?.map((pack) =>
        pathResolver.resolvePackPromptPath(pack, ""),
      ),
      skillPaths: packs?.map((pack) =>
        pathResolver.resolvePackSkillPath(pack, ""),
      ),
    };
  });

  const SESSION_SUB_COMMAND = "session";
  pi.registerCommand(`${ROOT_PACK_COMMAND}:${SESSION_SUB_COMMAND}:new`, {
    description: `Do a new a session  using one or more packs
    Use commas or spaces to specify how many packs you want to load`,
    handler: async (argument, ctx) => {
      const pathResolver = getPathResolver();

      const nodeFileSystem = new NodeFileSystem();

      if (!argument) {
        const directoriesResult = await nodeFileSystem.readDirectoryNames(
          pathResolver.resolvePackPath(),
        );

        if (!directoriesResult.success) {
          return ctx.ui.notify("No directories found", "error");
        }

        const result = await ctx.ui.custom(
          getMultiSelectorFactory(
            "What packs do you want to load for this session?",
            directoriesResult.data.map((directory) => ({
              value: directory,
              label: directory,
            })),
          ),
        );

        if (!result) {
          return;
        }

        packs = result;

        const sessionResult = await ctx.newSession({
          parentSession: ctx.sessionManager.getSessionFile(),
        });

        if (sessionResult.cancelled) {
          ctx.ui.notify("Session cancelled", "error");
        }

        return;
      }

      packs = argument.split(SPACE_OR_COMMA_RANGE);

      const sessionResult = await ctx.newSession();

      if (sessionResult.cancelled) {
        ctx.ui.notify("Session cancelled", "error");
      }
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${SESSION_SUB_COMMAND}:reload`, {
    description: `Reload a session using one or more packs
    Use commas or spaces to specify how many packs you want to load`,
    handler: async (argument, ctx) => {
      const pathResolver = getPathResolver();

      const nodeFileSystem = new NodeFileSystem();

      if (!argument) {
        const directoriesResult = await nodeFileSystem.readDirectoryNames(
          pathResolver.resolvePackPath(),
        );

        if (!directoriesResult.success) {
          return ctx.ui.notify("No directories found");
        }

        const result = await ctx.ui.custom(
          getMultiSelectorFactory(
            "What packs do you want to load for this session?",
            directoriesResult.data.map((directory) => ({
              value: directory,
              label: directory,
            })),
          ),
        );

        if (!result) {
          return;
        }

        packs = result;

        return await ctx.reload();
      }

      packs = argument.split(SPACE_OR_COMMA_RANGE);

      return await ctx.reload();
    },
  });

  pi.registerCommand(ROOT_PACK_COMMAND, {
    description: "Manage resource packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue =
            value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${PACK_LABEL}:${value}`,
            description: `${capitalizedValue} a ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packCommands, arg);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await rootPackResourceReducer(result.output, {
        createPackResourceSelector: getCreatePackResourceSelector(),
        ctx,
        fileSystem: new NodeFileSystem(),
        pathResolver: getPathResolver(ctx.cwd || process.cwd()),
      });
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${SKILL_COMMAND}`, {
    description: "Manage skills in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue =
            value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${SKILL_COMMAND}:${value}`,
            description: `${capitalizedValue} ${SKILL_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await skillPackResourceReducer(result.output, {
        getMultiSelectorFactory: getMultiSelectorFactory,
        ctx,
        openExternalEditor,
        pathResolver: getPathResolver(ctx.cwd),
        fileSystem: new NodeFileSystem(),
      });
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${PROMPT_COMMAND}`, {
    description: "Manage prompts in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue =
            value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${PROMPT_COMMAND}:${value}`,
            description: `${capitalizedValue} ${PROMPT_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await promptPackResourceReducer(result.output, {
        getMultiSelectorFactory: getMultiSelectorFactory,
        ctx,
        openExternalEditor,
        pathResolver: getPathResolver(ctx.cwd),
        fileSystem: new NodeFileSystem(),
      });
    },
  });
}

export function getCreatePackResourceSelector() {
  const resources = [`${SKILL_COMMAND}s`, `${PROMPT_COMMAND}s`] as const;
  return getMultiSelectorFactory(
    "What resources do you want to pack?",
    resources.map((resource) => ({
      value: resource,
      label: `${PACK_LABEL}:${resource}`,
      description: `Make a ${resource.charAt(0).toUpperCase() + resource.slice(1)} in ${PACK_LABEL}`,
    })),
  );
}

export function getMultiSelectorFactory<T extends ReadonlyArray<SelectItem>>(
  title: string,
  items: MultiSelectConfig<T>["items"],
  options?: Omit<MultiSelectConfig<T>, "items" | "title">,
) {
  return (
    tui: TUI,
    theme: Theme,
    _: KeybindingsManager,
    done: (result: ReadonlyArray<T[number]["value"]> | null) => void,
  ): Component =>
    new MultiSelect(title, { title, items, ...options }, tui, theme, done);
}

type PackCommand = (typeof packCommands.options)[number];

export const examplePromptContent =
  "---\nname: example\ndescription: This is an example pack\n---";

export const exampleAgentContent =
  "---\nname: example\ndescription: This is an example pack\ntools: read,write,bash\nmodel: claude\n---";

export const exampleSkillContent =
  "---\nname: example\ndescription: This is an example pack\n---";

export function rootPackResourceReducer(
  arg: PackCommand,
  deps: {
    createPackResourceSelector: ReturnType<
      typeof getCreatePackResourceSelector
    >;
    ctx: ExtensionCommandContext;
    fileSystem: ResourceFileSystem;
    pathResolver: ResourcePathResolver;
  },
) {
  return (
    {
      [CREATE_COMMAND]: async () => {
        const packName = await deps.ctx.ui.input(
          PACK_LABEL,
          "What is the name of your agent pack?",
        );
        const resources = await deps.ctx.ui.custom(
          deps.createPackResourceSelector,
        );

        if (!packName || !resources || resources.length === 0) {
          return;
        }

        const shouldPrefillSelection = await deps.ctx.ui.select(
          "Do you want to pre-fill the selected pack resources?",
          ["yes", "no"],
        );
        const shouldPrefill = shouldPrefillSelection !== "no";

        const packPath = deps.pathResolver.resolvePackPath(packName);
        await deps.fileSystem.mkdir(packPath, { recursive: true });

        for (const resource of resources) {
          if (resource === `${PROMPT_COMMAND}s`) {
            await deps.fileSystem.mkdir(
              deps.pathResolver.resolvePackPromptPath(packName, ""),
              {
                recursive: true,
              },
            );

            if (!shouldPrefill) {
              await deps.fileSystem.writeFile(
                deps.pathResolver.resolvePackPromptPath(packName, "example.md"),
                examplePromptContent,
              );
              continue;
            }

            const values = await deps.ctx.ui.custom<PromptFields | null>(
              (tui, theme, _keyboard, done) =>
                createPromptForm(tui, theme, done),
              formOverlayOptions,
            );

            if (!values) {
              continue;
            }

            const template = await deps.ctx.ui.custom<string | undefined>(
              (tui, theme, _keyboard, done) =>
                new PromptTemplateOverlay(tui, theme, done),
              modalEditorOverlayOptions,
            );

            if (template === undefined) {
              continue;
            }

            await deps.fileSystem.writeFile(
              deps.pathResolver.resolvePackPromptPath(
                packName,
                `${values.name}.md`,
              ),
              renderPromptMarkdown(values, template),
            );
            continue;
          }

          if (resource === `${SKILL_COMMAND}s`) {
            await deps.fileSystem.mkdir(
              deps.pathResolver.resolvePackSkillPath(packName, ""),
              {
                recursive: true,
              },
            );

            if (!shouldPrefill) {
              const skillPath = deps.pathResolver.resolvePackSkillPath(
                packName,
                "example",
              );
              await deps.fileSystem.mkdir(skillPath, { recursive: true });
              await deps.fileSystem.writeFile(
                deps.pathResolver.resolvePackSkillPath(
                  packName,
                  "example/SKILL.md",
                ),
                exampleSkillContent,
              );
              continue;
            }

            const requiredValues = await deps.ctx.ui.custom<
              (RequiredSkillFields & { confirm: boolean }) | null
            >(
              (tui, theme, _kb, done) =>
                createRequiredSkillForm(tui, theme, done),
              formOverlayOptions,
            );

            if (!requiredValues) {
              continue;
            }

            let optionalValues: OptionalSkillFields = {
              license: "",
              compatibility: "",
              allowedTools: "",
            };

            if (requiredValues.confirm) {
              const submittedOptionalValues =
                await deps.ctx.ui.custom<OptionalSkillFields | null>(
                  (tui, theme, _kb, done) =>
                    createOptionalSkillForm(tui, theme, done),
                  formOverlayOptions,
                );

              if (submittedOptionalValues) {
                optionalValues = submittedOptionalValues;
              }
            }

            const skillPath = deps.pathResolver.resolvePackSkillPath(
              packName,
              requiredValues.name,
            );
            await deps.fileSystem.mkdir(skillPath, { recursive: true });
            await deps.fileSystem.writeFile(
              deps.pathResolver.resolvePackSkillPath(
                packName,
                `${requiredValues.name}/SKILL.md`,
              ),
              renderSkillMarkdown({
                name: requiredValues.name,
                description: requiredValues.description,
                ...optionalValues,
              }),
            );
            continue;
          }
        }

        deps.ctx.ui.notify(`Pack created successfully with name '${packName}'`);
      },
      [DELETE_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );
        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packNames =
          await deps.ctx.ui.custom<ReadonlyArray<string> | null>(
            getMultiSelectorFactory(
              "Which packs do you want to delete?",
              packNamesResult.data.map((packName) => ({
                value: packName,
                label: packName,
                description: `Delete pack '${packName}'`,
              })),
            ),
          );

        if (!packNames || packNames.length === 0) {
          return;
        }

        for (const packName of packNames) {
          await deps.fileSystem.removeDirectory(
            deps.pathResolver.resolvePackPath(packName),
          );
        }

        deps.ctx.ui.notify(`Deleted ${packNames.length} pack(s)`);
      },
    } satisfies Record<PackCommand, () => Promise<void>>
  )[arg]();
}

export function skillPackResourceReducer(
  arg: PackResourceCommand,
  deps: {
    getMultiSelectorFactory: typeof getMultiSelectorFactory;
    ctx: ExtensionCommandContext;
    fileSystem: ResourceFileSystem;
    pathResolver: ResourcePathResolver;
    openExternalEditor: typeof openExternalEditor;
  },
) {
  return (
    {
      [CREATE_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "What pack do you want to add the skill to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const requiredValues = await deps.ctx.ui.custom<
          (RequiredSkillFields & { confirm: boolean }) | null
        >(
          (tui, theme, _kb, done) => createRequiredSkillForm(tui, theme, done),
          formOverlayOptions,
        );

        if (!requiredValues) {
          deps.ctx.ui.notify("Skill creation cancelled", "info");
          return;
        }

        let optionalValues: OptionalSkillFields = {
          license: "",
          compatibility: "",
          allowedTools: "",
        };

        if (requiredValues.confirm) {
          const submittedOptionalValues =
            await deps.ctx.ui.custom<OptionalSkillFields | null>(
              (tui, theme, _kb, done) =>
                createOptionalSkillForm(tui, theme, done),
              formOverlayOptions,
            );

          if (submittedOptionalValues) {
            optionalValues = submittedOptionalValues;
          }
        }

        const skillName = requiredValues.name;
        const skillFilePath = deps.pathResolver.resolvePackSkillPath(
          packName,
          `${skillName}/SKILL.md`,
        );
        const existingSkillResult =
          await deps.fileSystem.readFile(skillFilePath);

        if (existingSkillResult.success) {
          deps.ctx.ui.notify(
            `This skill already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const skillPath = deps.pathResolver.resolvePackSkillPath(
          packName,
          skillName,
        );
        const directoryResult = await deps.fileSystem.mkdir(skillPath, {
          recursive: true,
        });

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack skill", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          skillFilePath,
          renderSkillMarkdown({
            name: requiredValues.name,
            description: requiredValues.description,
            ...optionalValues,
          }),
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack skill", "error");
          return;
        }

        deps.ctx.ui.notify(`skill created in pack '${packName}'`);
      },
      [EDIT_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "What pack has the skill you want to edit?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackSkillPath(packName, ""),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "What skill do you want to edit?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        await deps.openExternalEditor(
          deps.ctx,
          deps.pathResolver.resolvePackSkillPath(
            packName,
            `${skillName}/SKILL.md`,
          ),
        );
      },
      [MOVE_LOCAL_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a skill from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackSkillPath(packName, ""),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "Which skill would you like to move?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackSkillPath(
          packName,
          `${skillName}/SKILL.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the skill", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolveLocalSkillPath(
          `${skillName}/SKILL.md`,
        );
        const existingSkillResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingSkillResult.success) {
          deps.ctx.ui.notify("This local skill already exists", "error");
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolveLocalSkillPath(skillName),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the local skill", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the local skill", "error");
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
        );
      },
      [MOVE_GLOBAL_TO_PACK_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a skill to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveGlobalSkillPath(),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No global skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "Which global skill would you like to move?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveGlobalSkillPath(
          `${skillName}/SKILL.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the skill", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolvePackSkillPath(
          packName,
          `${skillName}/SKILL.md`,
        );
        const existingSkillResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingSkillResult.success) {
          deps.ctx.ui.notify(
            `This skill already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
          { recursive: true },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack skill", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack skill", "error");
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolveGlobalSkillPath(skillName),
        );
      },
      [MOVE_LOCAL_TO_PACK_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a skill to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveLocalSkillPath(),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No local skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "Which local skill would you like to move?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveLocalSkillPath(
          `${skillName}/SKILL.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the skill", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolvePackSkillPath(
          packName,
          `${skillName}/SKILL.md`,
        );
        const existingSkillResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingSkillResult.success) {
          deps.ctx.ui.notify(
            `This skill already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
          { recursive: true },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack skill", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack skill", "error");
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolveLocalSkillPath(skillName),
        );
      },
      [MOVE_GLOBAL_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a skill from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackSkillPath(packName, ""),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "Which skill would you like to move?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackSkillPath(
          packName,
          `${skillName}/SKILL.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the skill", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolveGlobalSkillPath(
          `${skillName}/SKILL.md`,
        );
        const existingSkillResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingSkillResult.success) {
          deps.ctx.ui.notify("This global skill already exists", "error");
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolveGlobalSkillPath(skillName),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the global skill", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the global skill", "error");
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
        );
      },
      [DELETE_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack do you want to delete a skill from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const skillNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackSkillPath(packName, ""),
        );

        if (!skillNamesResult.success || skillNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No skills found", "info");
          return;
        }

        const skillName = await deps.ctx.ui.select(
          "Which skill do you want to delete from the pack?",
          skillNamesResult.data,
        );

        if (!skillName) {
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
        );
        deps.ctx.ui.notify(`skill deleted from pack '${packName}'`);
      },
    } satisfies PackResourceHandlers
  )[arg]();
}

export function promptPackResourceReducer(
  arg: PackResourceCommand,
  deps: {
    getMultiSelectorFactory: typeof getMultiSelectorFactory;
    ctx: ExtensionCommandContext;
    fileSystem: ResourceFileSystem;
    pathResolver: ResourcePathResolver;
    openExternalEditor: typeof openExternalEditor;
  },
) {
  return (
    {
      [CREATE_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "What pack do you want to add the prompt to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const values = await deps.ctx.ui.custom<PromptFields | null>(
          (tui, theme, _keyboard, done) => createPromptForm(tui, theme, done),
          formOverlayOptions,
        );

        if (!values) {
          deps.ctx.ui.notify("Prompt creation cancelled", "info");
          return;
        }

        const template = await deps.ctx.ui.custom<string | undefined>(
          (tui, theme, _keyboard, done) =>
            new PromptTemplateOverlay(tui, theme, done),
          modalEditorOverlayOptions,
        );

        if (template === undefined) {
          deps.ctx.ui.notify("Prompt creation cancelled", "info");
          return;
        }

        const promptFilePath = deps.pathResolver.resolvePackPromptPath(
          packName,
          `${values.name}.md`,
        );
        const existingPromptResult =
          await deps.fileSystem.readFile(promptFilePath);

        if (existingPromptResult.success) {
          deps.ctx.ui.notify(
            `This prompt already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack prompt", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          promptFilePath,
          renderPromptMarkdown(values, template),
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack prompt", "error");
          return;
        }

        deps.ctx.ui.notify(`prompt created in pack '${packName}'`);
      },
      [EDIT_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "What pack has the prompt you want to edit?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "What prompt do you want to edit?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        await deps.openExternalEditor(
          deps.ctx,
          deps.pathResolver.resolvePackPromptPath(packName, `${promptName}.md`),
        );
      },
      [MOVE_LOCAL_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a prompt from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "Which prompt would you like to move?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackPromptPath(
          packName,
          `${promptName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the prompt", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolveLocalPromptPath(
          `${promptName}.md`,
        );
        const existingPromptResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingPromptResult.success) {
          deps.ctx.ui.notify("This local prompt already exists", "error");
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolveLocalPromptPath(),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the local prompt", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the local prompt", "error");
          return;
        }

        await deps.fileSystem.removeFile(sourcePath);
      },
      [MOVE_GLOBAL_TO_PACK_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a prompt to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveGlobalPromptPath(),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No global prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "Which global prompt would you like to move?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveGlobalPromptPath(
          `${promptName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the prompt", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolvePackPromptPath(
          packName,
          `${promptName}.md`,
        );
        const existingPromptResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingPromptResult.success) {
          deps.ctx.ui.notify(
            `This prompt already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack prompt", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack prompt", "error");
          return;
        }

        await deps.fileSystem.removeFile(sourcePath);
      },
      [MOVE_LOCAL_TO_PACK_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a prompt to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveLocalPromptPath(),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No local prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "Which local prompt would you like to move?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveLocalPromptPath(
          `${promptName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the prompt", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolvePackPromptPath(
          packName,
          `${promptName}.md`,
        );
        const existingPromptResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingPromptResult.success) {
          deps.ctx.ui.notify(
            `This prompt already exists in pack '${packName}'`,
            "error",
          );
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the pack prompt", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the pack prompt", "error");
          return;
        }

        await deps.fileSystem.removeFile(sourcePath);
      },
      [MOVE_GLOBAL_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack would you like to move a prompt from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "Which prompt would you like to move?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackPromptPath(
          packName,
          `${promptName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the prompt", "error");
          return;
        }

        const destinationPath = deps.pathResolver.resolveGlobalPromptPath(
          `${promptName}.md`,
        );
        const existingPromptResult =
          await deps.fileSystem.readFile(destinationPath);

        if (existingPromptResult.success) {
          deps.ctx.ui.notify("This global prompt already exists", "error");
          return;
        }

        const directoryResult = await deps.fileSystem.mkdir(
          deps.pathResolver.resolveGlobalPromptPath(),
          {
            recursive: true,
          },
        );

        if (!directoryResult.success) {
          deps.ctx.ui.notify("Could not create the global prompt", "error");
          return;
        }

        const writeResult = await deps.fileSystem.writeFile(
          destinationPath,
          contentResult.data,
        );

        if (!writeResult.success) {
          deps.ctx.ui.notify("Could not write the global prompt", "error");
          return;
        }

        await deps.fileSystem.removeFile(sourcePath);
      },
      [DELETE_COMMAND]: async () => {
        const packNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPath(),
        );

        if (!packNamesResult.success || packNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No packs found", "info");
          return;
        }

        const packName = await deps.ctx.ui.select(
          "Which pack do you want to delete a prompt from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const promptNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
        );

        if (!promptNamesResult.success || promptNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No prompts found", "info");
          return;
        }

        const promptName = await deps.ctx.ui.select(
          "Which prompt do you want to delete from the pack?",
          promptNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!promptName) {
          return;
        }

        await deps.fileSystem.removeFile(
          deps.pathResolver.resolvePackPromptPath(packName, `${promptName}.md`),
        );
        deps.ctx.ui.notify(`prompt deleted from pack '${packName}'`);
      },
    } satisfies PackResourceHandlers
  )[arg]();
}
