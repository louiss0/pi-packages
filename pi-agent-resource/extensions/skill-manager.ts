import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

import {
  getPathResolver,
  NodeFileSystem,
  type ResourceFileSystem,
  type ResourcePathResolver,
} from "../shared/filesystem";
import {
  createOptionalSkillForm,
  createRequiredSkillForm,
  parseOptionalSkillFormValues,
  parseRequiredSkillFormValues,
  renderSkillMarkdown,
  SkillEditorOverlay,
  type OptionalSkillFields,
  type RequiredSkillFields,
  type SkillFrontmatterFields,
} from "../shared/resource-components";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import {
  getFilterSubcommandArgumentCompletionFromStringUsingSubLabel,
  SubCommands,
} from "../shared/subcommands";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

const extensionName = "skill-manager";

const PI_DIRECTORY_NAME = ".pi";
const AGENT_DIRECTORY_NAME = "agent";
const SKILLS_DIRECTORY_NAME = "skills";
const SKILL_FILE_NAME = "SKILL.md";
const EXTERNAL_EDITOR_FLAG = "external-skill-editor";
const LOCAL_SKILL_COMMAND_NAME = "resource:local-skill";

export const GLOBAL_SKILLS_DIRECTORY = join(
  homedir(),
  PI_DIRECTORY_NAME,
  AGENT_DIRECTORY_NAME,
  SKILLS_DIRECTORY_NAME,
);
export const LOCAL_SKILLS_DIRECTORY = join(
  PI_DIRECTORY_NAME,
  SKILLS_DIRECTORY_NAME,
);
export const PROJECT_EDITOR_CONFIG_FILE = ".pi-resource.toml";

type SkillEditorMode = "external";
type SkillScope = "global" | "local";
type GetResourceFileSystem = (rootPath?: string) => ResourceFileSystem;
type GetPathResolver = (cwd?: string) => ResourcePathResolver;

export {
  createOptionalSkillForm,
  createRequiredSkillForm,
  parseOptionalSkillFormValues,
  parseRequiredSkillFormValues,
};

export function parseSkillCommandArgument(argument: string) {
  const subcommandResult = SubCommands.parse(argument.trim());

  if (!subcommandResult.success) {
    return {
      success: false as const,
      errorMessage: subcommandResult.errorMessage,
    };
  }

  return {
    success: true as const,
    output: subcommandResult.output,
  };
}

export async function handleCreate(
  ctx: ExtensionCommandContext,
  scope: SkillScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_SKILLS_DIRECTORY)
      : GLOBAL_SKILLS_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const requiredValues = await ctx.ui.custom<
    (RequiredSkillFields & { confirm: boolean }) | null
  >(
    (tui, theme, _kb, done) => createRequiredSkillForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!requiredValues) {
    ctx.ui.notify("Skill creation cancelled", "info");
    return;
  }

  let optionalValues: OptionalSkillFields = {
    license: "",
    compatibility: "",
    allowedTools: "",
  };

  if (requiredValues.confirm) {
    const submittedOptionalValues =
      await ctx.ui.custom<OptionalSkillFields | null>(
        (tui, theme, _kb, done) => createOptionalSkillForm(tui, theme, done),
        formOverlayOptions,
      );

    if (submittedOptionalValues) {
      optionalValues = submittedOptionalValues;
    }
  }

  try {
    const filePath = await createSkillFile(
      {
        name: requiredValues.name,
        description: requiredValues.description,
        ...optionalValues,
      },
      fileSystem,
      pathResolver,
      scope,
    );

    ctx.ui.notify(`Skill created successfully: ${filePath}`);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      ctx.ui.notify(`Skill already exists: ${requiredValues.name}`, "error");
      return;
    }

    throw error;
  }
}

export async function handleEdit(
  ctx: ExtensionCommandContext,
  requestedEditMode?: SkillEditorMode,
  scope: SkillScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_SKILLS_DIRECTORY)
      : GLOBAL_SKILLS_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const skillPath = await pickSkillPath(
    ctx,
    "Edit Skill",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!skillPath) {
    ctx.ui.notify("Skill edit cancelled", "info");
    return;
  }

  const currentContentResult = await readSkillFile(skillPath, fileSystem);
  if (!currentContentResult.success) {
    ctx.ui.notify(
      `Skill edit failed: ${currentContentResult.error.message}`,
      "error",
    );
    return;
  }

  const editMode = await resolveSkillEditMode(
    requestedEditMode,
    ctx.cwd || process.cwd(),
    fileSystem,
  );

  if (editMode === "external") {
    const editor = process.env.VISUAL || process.env.EDITOR;

    if (!editor) {
      ctx.ui.notify("Set $VISUAL or $EDITOR to edit skills", "error");
      return;
    }

    await openExternalEditor(editor, skillPath);
  } else {
    const editedContent = await ctx.ui.custom<string | undefined>(
      (tui, theme, _kb, done) =>
        new SkillEditorOverlay(tui, theme, currentContentResult.data, done),
      modalEditorOverlayOptions,
    );

    if (editedContent === undefined) {
      ctx.ui.notify("Skill edit cancelled", "info");
      return;
    }

    const writeResult = await fileSystem.writeFile(skillPath, editedContent);
    if (!writeResult.success) {
      ctx.ui.notify(`Skill edit failed: ${writeResult.error.message}`, "error");
      return;
    }
  }

  ctx.ui.notify("Skill updated. Reloading skills...", "info");
  await ctx.reload();
}

export async function handleDelete(
  ctx: ExtensionCommandContext,
  scope: SkillScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_SKILLS_DIRECTORY)
      : GLOBAL_SKILLS_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const skillPath = await pickSkillPath(
    ctx,
    "Delete Skill",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!skillPath) {
    ctx.ui.notify("Skill deletion cancelled", "info");
    return;
  }

  const skillDirectory = dirname(skillPath);
  const deleteResult = await fileSystem.removeDirectory(skillDirectory);
  if (!deleteResult.success) {
    ctx.ui.notify(
      `Skill deletion failed: ${deleteResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(`Skill deleted successfully: ${skillDirectory}`);
}

async function resolveSkillEditMode(
  requestedEditMode?: SkillEditorMode,
  cwd = process.cwd(),
  fileSystem: ResourceFileSystem = new NodeFileSystem(),
) {
  if (requestedEditMode) {
    return requestedEditMode;
  }

  const projectConfig = await readProjectEditorConfig(cwd, fileSystem);
  return projectConfig.skillEditor ?? "pi";
}

async function readProjectEditorConfig(
  cwd = process.cwd(),
  fileSystem: ResourceFileSystem = new NodeFileSystem(),
) {
  const configResult = await fileSystem.readFile(
    join(cwd, PROJECT_EDITOR_CONFIG_FILE),
  );

  if (!configResult.success) {
    return { skillEditor: undefined };
  }

  let isInSkillSection = false;

  for (const line of configResult.data.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("[") && trimmedLine.endsWith("]")) {
      isInSkillSection = trimmedLine === "[skill]";
      continue;
    }

    if (!isInSkillSection) {
      continue;
    }

    const editorMatch = trimmedLine.match(/^editor\s*=\s*"(external)"$/);
    if (editorMatch) {
      return { skillEditor: editorMatch[1] as SkillEditorMode };
    }
  }

  return { skillEditor: undefined };
}

async function createSkillFile(
  fields: SkillFrontmatterFields,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
  scope: SkillScope,
) {
  const skillDirectory =
    scope === "local"
      ? pathResolver.resolveLocalSkillPath(fields.name)
      : pathResolver.resolveGlobalSkillPath(fields.name);
  const skillPath = join(skillDirectory, SKILL_FILE_NAME);
  const directoryResult = await fileSystem.mkdir(skillDirectory, {
    recursive: true,
  });
  if (!directoryResult.success) {
    throw directoryResult.error;
  }

  const existingSkillResult = await fileSystem.readFile(skillPath);
  if (existingSkillResult.success) {
    throw Object.assign(new Error(`Skill already exists: ${fields.name}`), {
      code: "EEXIST",
    });
  }

  const writeResult = await fileSystem.writeFile(
    skillPath,
    renderSkillMarkdown(fields),
  );
  if (!writeResult.success) {
    throw writeResult.error;
  }

  return skillPath;
}

function isAlreadyExistsError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function pickSkillPath(
  ctx: ExtensionContext,
  title: string,
  scope: SkillScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const skillNames = await listSkillNames(scope, fileSystem, pathResolver);

  if (skillNames.length === 0) {
    ctx.ui.notify("No skills found", "info");
    return null;
  }

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const items: SelectItem[] = skillNames.map((skillName) => ({
      value: skillName,
      label: skillName,
    }));

    const selectList = new SelectList(items, Math.min(items.length, 8), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    selectList.onSelect = (item) =>
      done(
        scope === "local"
          ? pathResolver.resolveLocalSkillPath(
              join(item.value, SKILL_FILE_NAME),
            )
          : pathResolver.resolveGlobalSkillPath(
              join(item.value, SKILL_FILE_NAME),
            ),
      );
    selectList.onCancel = () => done(null);

    const container = new Container();
    container.addChild(new Text(theme.fg("accent", title)));
    container.addChild(new Spacer(1));
    container.addChild(selectList);
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("dim", "^v navigate | enter select | esc cancel")),
    );

    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    } satisfies Component;
  }, formOverlayOptions);
}

async function listSkillNames(
  scope: SkillScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const entriesResult = await fileSystem.readDirectoryEntries(
    scope === "local"
      ? pathResolver.resolveLocalSkillPath()
      : pathResolver.resolveGlobalSkillPath(),
  );

  if (!entriesResult.success) {
    return [];
  }

  return entriesResult.data
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function openExternalEditor(editor: string, filePath: string) {
  const editorCommand = parseExternalEditorCommand(editor);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      editorCommand.command,
      [...editorCommand.args, filePath],
      {
        stdio: "inherit",
        shell: false,
      },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Editor exited with code ${code ?? "unknown"}`));
    });
  });
}

function parseExternalEditorCommand(editor: string) {
  const parts = tokenizeCommandLine(editor);
  const [command, ...args] = parts;

  if (!command) {
    throw new Error("Set $VISUAL or $EDITOR to edit skills");
  }

  return { command, args };
}

function tokenizeCommandLine(commandLine: string) {
  const parts: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    const nextCharacter = commandLine[index + 1];

    if (quote) {
      if (
        character === "\\" &&
        quote === '"' &&
        (nextCharacter === '"' || nextCharacter === "\\")
      ) {
        token += nextCharacter;
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
        continue;
      }

      token += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (token.length > 0) {
        parts.push(token);
        token = "";
      }
      continue;
    }

    if (
      character === "\\" &&
      (nextCharacter === '"' || nextCharacter === "'" || nextCharacter === "\\")
    ) {
      token += nextCharacter;
      index += 1;
      continue;
    }

    token += character;
  }

  if (quote) {
    throw new Error("Unterminated quote in $VISUAL or $EDITOR");
  }

  if (token.length > 0) {
    parts.push(token);
  }

  return parts;
}

async function readSkillFile(filePath: string, fileSystem: ResourceFileSystem) {
  return fileSystem.readFile(filePath);
}

async function handleSkillCommand(
  pi: ExtensionAPI,
  arg: string,
  ctx: ExtensionCommandContext,
  scope: SkillScope,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  const result = parseSkillCommandArgument(arg);

  if (!result.success) {
    ctx.ui.notify(`Invalid command: ${result.errorMessage}`, "error");
    return;
  }

  const editMode =
    pi.getFlag(EXTERNAL_EDITOR_FLAG) === true ? "external" : undefined;

  if (editMode === "external" && result.output !== "edit") {
    ctx.ui.notify(
      `Invalid command: --${EXTERNAL_EDITOR_FLAG} can only be used with edit`,
      "error",
    );
    return;
  }

  if (scope === "local") {
    const cwd = ctx.cwd || process.cwd();
    ctx.ui.notify(
      `Using local skills from ${join(cwd, LOCAL_SKILLS_DIRECTORY)}`,
      "info",
    );
  }

  switch (result.output) {
    case "create":
      await handleCreate(ctx, scope);
      break;
    case "edit":
      await handleEdit(ctx, editMode, scope);
      break;
    case "delete":
      await handleDelete(ctx, scope);
      break;
  }
}

export default (pi: ExtensionAPI) => {
  pi.registerFlag(EXTERNAL_EDITOR_FLAG, {
    description: "Use the external editor for skill edit commands",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("resource:skill", {
    description: "This is for managing global skills",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("skill"),
    handler: async (arg, ctx) => handleSkillCommand(pi, arg, ctx, "global"),
  });

  pi.registerCommand(LOCAL_SKILL_COMMAND_NAME, {
    description: "This is for managing project skills",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("skill"),
    handler: async (arg, ctx) => handleSkillCommand(pi, arg, ctx, "local"),
  });
};
