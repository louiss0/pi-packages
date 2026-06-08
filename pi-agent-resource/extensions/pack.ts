import { spawn } from "node:child_process";
import {
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
export const AGENT_COMMAND = "agent";
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

class ExternalEditorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "ExternalEditorError";
    this.cause = cause;
  }
}

export async function openExternalEditor(filePath: string) {
  const { EDITOR } = process.env;

  if (!EDITOR) {
    return new ExternalEditorError("No external editor set");
  }

  const result = await new Promise<number | ExternalEditorError>(
    (resolve, reject) => {
      const [cmd, ...args] = EDITOR.split(" ");
      const child = spawn(cmd, [...args, filePath]);

      child.on("error", (err) =>
        reject(new ExternalEditorError("Failed to use external editor", err)),
      );
      child.on("close", (value) =>
        !value
          ? reject(
              new ExternalEditorError("Something went wrong while closing"),
            )
          : resolve(value),
      );
    },
  );

  if (result instanceof ExternalEditorError) {
    return result;
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
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
        getMuiltiSelectorFactory: getMultiSelectorFactory,
        ctx,
        openExternalEditor,
        pathResolver: getPathResolver(ctx.cwd),
        fileSystem: new NodeFileSystem(),
      });
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${AGENT_COMMAND}`, {
    description: "Manage agents in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue =
            value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${AGENT_COMMAND}:${value}`,
            description: `${capitalizedValue} ${AGENT_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await agentPackResourceReducer(result.output, {
        getMuiltiSelectorFactory: getMultiSelectorFactory,
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
        getMuiltiSelectorFactory: getMultiSelectorFactory,
        ctx,
        openExternalEditor,
        pathResolver: getPathResolver(ctx.cwd),
        fileSystem: new NodeFileSystem(),
      });
    },
  });
}

export function getCreatePackResourceSelector() {
  const resources = [
    `${SKILL_COMMAND}s`,
    `${PROMPT_COMMAND}s`,
    `${AGENT_COMMAND}s`,
  ] as const;
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
    new MultiSelect({ title, items, ...options }, tui, theme, done);
}

type PackCommand = (typeof packCommands.options)[number];

export const examplePromptContent = `---
        name: example
        description: This is an example pack

        ---
        `;

export const exampleSkillContent = `---
        name: example
        description: This is an example pack

        ---
        `;

export const exampleAgentContent = `---
        name: example
        description: This is an example pack
        tools:
        model:
        ---
        `;

async function writePackExampleResources(
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
  packName: string,
  resources: ReadonlyArray<string>,
) {
  for (const resource of resources) {
    if (resource === `${PROMPT_COMMAND}s`) {
      await fileSystem.mkdir(pathResolver.resolvePackPromptPath(packName, ""), {
        recursive: true,
      });
      await fileSystem.writeFile(
        pathResolver.resolvePackPromptPath(packName, "example.md"),
        examplePromptContent,
      );
      continue;
    }

    if (resource === `${SKILL_COMMAND}s`) {
      await fileSystem.mkdir(pathResolver.resolvePackSkillPath(packName, ""), {
        recursive: true,
      });
      const skillPath = pathResolver.resolvePackSkillPath(packName, "example");
      await fileSystem.mkdir(skillPath, { recursive: true });
      await fileSystem.writeFile(
        pathResolver.resolvePackSkillPath(packName, "example/SKILL.md"),
        exampleSkillContent,
      );
      continue;
    }

    if (resource === `${AGENT_COMMAND}s`) {
      await fileSystem.mkdir(pathResolver.resolvePackAgentPath(packName, ""), {
        recursive: true,
      });
      await fileSystem.writeFile(
        pathResolver.resolvePackAgentPath(packName, "example.md"),
        exampleAgentContent,
      );
    }
  }
}

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

        const packPath = deps.pathResolver.resolvePackPath(packName);
        await deps.fileSystem.mkdir(packPath, { recursive: true });
        await writePackExampleResources(
          deps.fileSystem,
          deps.pathResolver,
          packName,
          resources,
        );
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

        const packName = await deps.ctx.ui.input(
          PACK_LABEL,
          "What is the name of the pack you want to delete?",
        );
        if (!packName) {
          return;
        }

        await deps.fileSystem.removeDirectory(
          deps.pathResolver.resolvePackPath(packName),
        );
        deps.ctx.ui.notify(`Pack deleted successfully with name '${packName}'`);
      },
    } satisfies Record<PackCommand, () => Promise<void>>
  )[arg]();
}

export function skillPackResourceReducer(
  arg: PackResourceCommand,
  deps: {
    getMuiltiSelectorFactory: typeof getMultiSelectorFactory;
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

        const skillName = await deps.ctx.ui.input(
          "Which skill do you want to add to the pack?",
        );

        if (!skillName) {
          return;
        }

        const skillPath = deps.pathResolver.resolvePackSkillPath(
          packName,
          skillName,
        );
        await deps.fileSystem.mkdir(skillPath, { recursive: true });
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackSkillPath(
            packName,
            `${skillName}/SKILL.md`,
          ),
          exampleSkillContent,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolveLocalSkillPath(skillName),
          { recursive: true },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveLocalSkillPath(`${skillName}/SKILL.md`),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
          { recursive: true },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackSkillPath(
            packName,
            `${skillName}/SKILL.md`,
          ),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackSkillPath(packName, skillName),
          { recursive: true },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackSkillPath(
            packName,
            `${skillName}/SKILL.md`,
          ),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolveGlobalSkillPath(skillName),
          { recursive: true },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveGlobalSkillPath(`${skillName}/SKILL.md`),
          contentResult.data,
        );
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

export function agentPackResourceReducer(
  arg: PackResourceCommand,
  deps: {
    getMuiltiSelectorFactory: typeof getMultiSelectorFactory;
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
          "What pack do you want to add the agent to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentName = await deps.ctx.ui.input(
          "Which agent do you want to add to the pack?",
        );

        if (!agentName) {
          return;
        }

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackAgentPath(packName, `${agentName}.md`),
          exampleAgentContent,
        );
        deps.ctx.ui.notify(`agent created in pack '${packName}'`);
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
          "What pack has the agent you want to edit?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "What agent do you want to edit?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        await deps.openExternalEditor(
          deps.pathResolver.resolvePackAgentPath(packName, `${agentName}.md`),
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
          "Which pack would you like to move a agent from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "Which agent would you like to move?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackAgentPath(
          packName,
          `${agentName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the agent", "error");
          return;
        }

        await deps.fileSystem.mkdir(deps.pathResolver.resolveLocalAgentPath(), {
          recursive: true,
        });
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveLocalAgentPath(`${agentName}.md`),
          contentResult.data,
        );
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
          "Which pack would you like to move a agent to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveGlobalAgentPath(),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No global agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "Which global agent would you like to move?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveGlobalAgentPath(
          `${agentName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the agent", "error");
          return;
        }

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackAgentPath(packName, `${agentName}.md`),
          contentResult.data,
        );
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
          "Which pack would you like to move a agent to?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolveLocalAgentPath(),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No local agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "Which local agent would you like to move?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolveLocalAgentPath(
          `${agentName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the agent", "error");
          return;
        }

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackAgentPath(packName, `${agentName}.md`),
          contentResult.data,
        );
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
          "Which pack would you like to move a agent from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "Which agent would you like to move?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        const sourcePath = deps.pathResolver.resolvePackAgentPath(
          packName,
          `${agentName}.md`,
        );
        const contentResult = await deps.fileSystem.readFile(sourcePath);

        if (!contentResult.success) {
          deps.ctx.ui.notify("Could not read the agent", "error");
          return;
        }

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolveGlobalAgentPath(),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveGlobalAgentPath(`${agentName}.md`),
          contentResult.data,
        );
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
          "Which pack do you want to delete a agent from?",
          packNamesResult.data,
        );

        if (!packName) {
          return;
        }

        const agentNamesResult = await deps.fileSystem.readDirectoryNames(
          deps.pathResolver.resolvePackAgentPath(packName, ""),
        );

        if (!agentNamesResult.success || agentNamesResult.data.length === 0) {
          deps.ctx.ui.notify("No agents found", "info");
          return;
        }

        const agentName = await deps.ctx.ui.select(
          "Which agent do you want to delete from the pack?",
          agentNamesResult.data.map((name) => name.replace(/\.md$/, "")),
        );

        if (!agentName) {
          return;
        }

        await deps.fileSystem.removeFile(
          deps.pathResolver.resolvePackAgentPath(packName, `${agentName}.md`),
        );
        deps.ctx.ui.notify(`agent deleted from pack '${packName}'`);
      },
    } satisfies PackResourceHandlers
  )[arg]();
}

export function promptPackResourceReducer(
  arg: PackResourceCommand,
  deps: {
    getMuiltiSelectorFactory: typeof getMultiSelectorFactory;
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

        const promptName = await deps.ctx.ui.input(
          "Which prompt do you want to add to the pack?",
        );

        if (!promptName) {
          return;
        }

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackPromptPath(packName, `${promptName}.md`),
          examplePromptContent,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolveLocalPromptPath(),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveLocalPromptPath(`${promptName}.md`),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackPromptPath(packName, `${promptName}.md`),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolvePackPromptPath(packName, ""),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolvePackPromptPath(packName, `${promptName}.md`),
          contentResult.data,
        );
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

        await deps.fileSystem.mkdir(
          deps.pathResolver.resolveGlobalPromptPath(),
          {
            recursive: true,
          },
        );
        await deps.fileSystem.writeFile(
          deps.pathResolver.resolveGlobalPromptPath(`${promptName}.md`),
          contentResult.data,
        );
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
