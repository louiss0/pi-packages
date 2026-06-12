import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createExternalEditorFactory } from "@code-fixer-23/pi-form-components";

import {
  getPathResolver,
  NodeFileSystem,
  type ResourceFileSystem,
  type ResourcePathResolver,
} from "../shared/filesystem";
import {
  createPromptForm,
  parsePromptFormValues,
  type PromptFields,
  renderPromptMarkdown,
} from "../shared/resource-components";
import { editMarkdownWithExternalEditor } from "../shared/external-editor";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import {
  getFilterSubcommandArgumentCompletionFromStringUsingSubLabel,
  SubCommands,
} from "../shared/subcommands";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

const extensionName = "prompt-manager";
const PI_DIRECTORY_NAME = ".pi";
const AGENT_DIRECTORY_NAME = "agent";
const PROMPTS_DIRECTORY_NAME = "prompts";
const LOCAL_PROMPT_COMMAND_NAME = "resource:local-prompt";

export const GLOBAL_PROMPT_DIRECTORY = join(
  homedir(),
  PI_DIRECTORY_NAME,
  AGENT_DIRECTORY_NAME,
  PROMPTS_DIRECTORY_NAME,
);
export const LOCAL_PROMPT_DIRECTORY = join(
  PI_DIRECTORY_NAME,
  PROMPTS_DIRECTORY_NAME,
);
type PromptScope = "global" | "local";
type PromptChoice = {
  path: string;
  deletePath: string;
  label: string;
};

type GetResourceFileSystem = (rootPath?: string) => ResourceFileSystem;
type GetPathResolver = (cwd?: string) => ResourcePathResolver;

export { createPromptForm, parsePromptFormValues };

export function parsePromptCommandArgument(argument: string) {
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

async function handlePromptCommand(
  arg: string,
  ctx: ExtensionContext,
  scope: PromptScope,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  const result = parsePromptCommandArgument(arg);
  if (!result.success) {
    ctx.ui.notify(`Invalid command: ${result.errorMessage}`, "error");
    return;
  }

  if (scope === "local") {
    const cwd = ctx.cwd || process.cwd();
    ctx.ui.notify(
      `Using local prompts from ${join(cwd, LOCAL_PROMPT_DIRECTORY)}`,
      "info",
    );
  }

  switch (result.output) {
    case "create":
      await handleCreate(ctx, scope);
      break;
    case "edit":
      await handleEdit(ctx, scope);
      break;
    case "delete":
      await handleDelete(ctx, scope);
      break;
  }
}

export default (pi: ExtensionAPI) => {
  pi.registerCommand("resource:prompts", {
    description: "This is for managing global prompts",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("prompt"),
    handler: async (arg, ctx) => handlePromptCommand(arg, ctx, "global"),
  });

  pi.registerCommand(LOCAL_PROMPT_COMMAND_NAME, {
    description: "This is for managing project prompts",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("prompt"),
    handler: async (arg, ctx) => handlePromptCommand(arg, ctx, "local"),
  });
};

export async function handleCreate(
  ctx: ExtensionContext,
  scope: PromptScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_PROMPT_DIRECTORY)
      : GLOBAL_PROMPT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const promptRootPath =
    scope === "local"
      ? pathResolver.resolveLocalPromptPath()
      : pathResolver.resolveGlobalPromptPath();
  const values = await ctx.ui.custom<PromptFields | null>(
    (tui, theme, _keyboard, done) => createPromptForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!values) {
    ctx.ui.notify("Prompt creation cancelled", "info");
    return;
  }

  const template = await editMarkdownWithExternalEditor(
    ctx,
    "",
    "prompts",
  );

  if (template instanceof Error) {
    return;
  }

  const filePath =
    scope === "local"
      ? pathResolver.resolveLocalPromptPath(`${values.name}.md`)
      : pathResolver.resolveGlobalPromptPath(`${values.name}.md`);
  const directoryResult = await fileSystem.mkdir(promptRootPath, {
    recursive: true,
  });
  if (!directoryResult.success) {
    ctx.ui.notify(
      `Prompt creation failed: ${directoryResult.error.message}`,
      "error",
    );
    return;
  }

  const writeResult = await fileSystem.writeFile(
    filePath,
    renderPromptMarkdown(values, template),
  );
  if (!writeResult.success) {
    ctx.ui.notify(
      `Prompt creation failed: ${writeResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify("Prompt created");
}

export async function handleEdit(
  ctx: ExtensionContext,
  scope: PromptScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_PROMPT_DIRECTORY)
      : GLOBAL_PROMPT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const prompt = await pickPrompt(
    ctx,
    "Edit Prompt",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!prompt) {
    ctx.ui.notify("Prompt editing cancelled", "info");
    return;
  }

  const contentResult = await fileSystem.readFile(prompt.path);
  if (!contentResult.success) {
    ctx.ui.notify(
      `Prompt edit failed: ${contentResult.error.message}`,
      "error",
    );
    return;
  }

  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    ctx.ui.notify("Set $VISUAL or $EDITOR to edit prompts", "error");
    return;
  }

  const result = await ctx.ui.custom<Error | { changed: boolean }>(
    createExternalEditorFactory(editor, prompt.path),
    modalEditorOverlayOptions,
  );

  if (result instanceof Error) {
    ctx.ui.notify(result.message, "error");
    return;
  }

  ctx.ui.notify("Prompt edited");
}

export async function handleDelete(
  ctx: ExtensionContext,
  scope: PromptScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_PROMPT_DIRECTORY)
      : GLOBAL_PROMPT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const prompt = await pickPrompt(
    ctx,
    "Delete Prompt",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!prompt) {
    ctx.ui.notify("Prompt deleting cancelled", "info");
    return;
  }

  const isGroupedPrompt = prompt.deletePath !== prompt.path;
  const deleteResult = isGroupedPrompt
    ? await fileSystem.removeDirectory(prompt.deletePath)
    : await fileSystem.removeFile(prompt.deletePath);

  if (!deleteResult.success) {
    ctx.ui.notify(
      `Prompt delete failed: ${deleteResult.error.message}`,
      "error",
    );
    return;
  }

  ctx.ui.notify("Prompt deleted");
}

async function pickPrompt(
  ctx: ExtensionContext,
  title: string,
  scope: PromptScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const choices = await listPromptChoices(scope, fileSystem, pathResolver);

  if (choices.length === 0) {
    ctx.ui.notify("No prompts found", "info");
    return null;
  }

  const selectedLabel = await ctx.ui.select(
    title,
    choices.map((choice) => choice.label),
  );

  if (!selectedLabel) {
    return null;
  }

  return choices.find((choice) => choice.label === selectedLabel) ?? null;
}

async function listPromptChoices(
  scope: PromptScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const choices: PromptChoice[] = [];
  const promptRootPath =
    scope === "local"
      ? pathResolver.resolveLocalPromptPath()
      : pathResolver.resolveGlobalPromptPath();

  const entriesResult = await fileSystem.readDirectoryEntries(promptRootPath);

  if (!entriesResult.success) {
    return choices;
  }

  choices.push(
    ...entriesResult.data.map((entry) => {
      const entryPath =
        scope === "local"
          ? pathResolver.resolveLocalPromptPath(entry.name)
          : pathResolver.resolveGlobalPromptPath(entry.name);
      const promptPath = entry.isDirectory()
        ? join(entryPath, "_index.md")
        : entryPath;

      return {
        path: promptPath,
        deletePath: entryPath,
        label: `${scope}: ${basename(entry.name, ".md")}`,
      };
    }),
  );

  return choices;
}
