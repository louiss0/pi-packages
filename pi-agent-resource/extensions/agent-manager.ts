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
  createAgentForm,
  type AgentFields,
  parseAgentFormValues,
  renderAgentFrontmatter,
} from "../shared/resource-components";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import {
  getFilterSubcommandArgumentCompletionFromStringUsingSubLabel,
  SubCommands,
} from "../shared/subcommands";
import { formOverlayOptions, modalEditorOverlayOptions } from "../shared/ui";

const extensionName = "agent-manager";
const PI_DIRECTORY_NAME = ".pi";
const AGENT_DIRECTORY_NAME = "agent";
const AGENTS_DIRECTORY_NAME = "agents";
const LOCAL_AGENT_COMMAND_NAME = "resource:local-agent";

export const GLOBAL_AGENT_DIRECTORY = join(
  homedir(),
  PI_DIRECTORY_NAME,
  AGENT_DIRECTORY_NAME,
  AGENTS_DIRECTORY_NAME,
);
export const LOCAL_AGENT_DIRECTORY = join(
  PI_DIRECTORY_NAME,
  AGENTS_DIRECTORY_NAME,
);
type AgentScope = "global" | "local";
type AgentChoice = {
  path: string;
  label: string;
};

type GetResourceFileSystem = (rootPath?: string) => ResourceFileSystem;
type GetPathResolver = (cwd?: string) => ResourcePathResolver;

export { createAgentForm, parseAgentFormValues };

export function parseAgentCommandArgument(argument: string) {
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

async function handleAgentCommand(
  arg: string,
  ctx: ExtensionContext,
  scope: AgentScope,
) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  const result = parseAgentCommandArgument(arg);
  if (!result.success) {
    ctx.ui.notify(`Invalid command: ${result.errorMessage}`, "error");
    return;
  }

  if (scope === "local") {
    const cwd = ctx.cwd || process.cwd();
    ctx.ui.notify(
      `Using local agents from ${join(cwd, LOCAL_AGENT_DIRECTORY)}`,
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
  pi.registerCommand("resource:agent", {
    description: "This is for managing global agents",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("agent"),
    handler: async (arg, ctx) => handleAgentCommand(arg, ctx, "global"),
  });

  pi.registerCommand(LOCAL_AGENT_COMMAND_NAME, {
    description: "This is for managing project agents",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("agent"),
    handler: async (arg, ctx) => handleAgentCommand(arg, ctx, "local"),
  });
};

export async function handleCreate(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_AGENT_DIRECTORY)
      : GLOBAL_AGENT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const agentRootPath =
    scope === "local"
      ? pathResolver.resolveLocalAgentPath()
      : pathResolver.resolveGlobalAgentPath();
  const values = await ctx.ui.custom<AgentFields | null>(
    (tui, theme, _keyboard, done) => createAgentForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!values) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const filePath =
    scope === "local"
      ? pathResolver.resolveLocalAgentPath(`${values.name}.md`)
      : pathResolver.resolveGlobalAgentPath(`${values.name}.md`);

  const directoryResult = await fileSystem.mkdir(agentRootPath, {
    recursive: true,
  });
  if (!directoryResult.success) {
    ctx.ui.notify(
      getFileSystemErrorMessage("Agent creation failed", directoryResult.error),
      "error",
    );
    return;
  }

  const writeResult = await fileSystem.writeFile(
    filePath,
    renderAgentFrontmatter(values),
  );
  if (!writeResult.success) {
    ctx.ui.notify(
      getFileSystemErrorMessage("Agent creation failed", writeResult.error),
      "error",
    );
    return;
  }

  ctx.ui.notify("Agent created");
}

export async function handleEdit(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_AGENT_DIRECTORY)
      : GLOBAL_AGENT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const agent = await pickAgent(
    ctx,
    "Edit Agent",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!agent) {
    ctx.ui.notify("Agent editing cancelled", "info");
    return;
  }

  const readResult = await fileSystem.readFile(agent.path);
  if (!readResult.success) {
    ctx.ui.notify(
      getFileSystemErrorMessage("Agent edit failed", readResult.error),
      "error",
    );
    return;
  }

  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    ctx.ui.notify("Set $VISUAL or $EDITOR to edit agents", "error");
    return;
  }

  const result = await ctx.ui.custom<Error | { changed: boolean }>(
    createExternalEditorFactory(editor, agent.path),
    modalEditorOverlayOptions,
  );

  if (result instanceof Error) {
    ctx.ui.notify(result.message, "error");
    return;
  }

  ctx.ui.notify("Agent edited");
}

export async function handleDelete(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(
    scope === "local"
      ? join(cwd, LOCAL_AGENT_DIRECTORY)
      : GLOBAL_AGENT_DIRECTORY,
  );
  const pathResolver = getResolver(cwd);
  const agent = await pickAgent(
    ctx,
    "Delete Agent",
    scope,
    fileSystem,
    pathResolver,
  );

  if (!agent) {
    ctx.ui.notify("Agent deleting cancelled", "info");
    return;
  }

  const deleteResult = await fileSystem.removeFile(agent.path);
  if (!deleteResult.success) {
    ctx.ui.notify(
      getFileSystemErrorMessage("Agent delete failed", deleteResult.error),
      "error",
    );
    return;
  }

  ctx.ui.notify("Agent deleted");
}

function getFileSystemErrorMessage(action: string, error: unknown) {
  if (error instanceof Error) {
    return `${action}: ${error.message}`;
  }

  return action;
}

async function pickAgent(
  ctx: ExtensionContext,
  title: string,
  scope: AgentScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const choices = await listAgentChoices(scope, fileSystem, pathResolver);

  if (choices.length === 0) {
    ctx.ui.notify("No agents found", "info");
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

async function listAgentChoices(
  scope: AgentScope,
  fileSystem: ResourceFileSystem,
  pathResolver: ResourcePathResolver,
) {
  const agentRootPath =
    scope === "local"
      ? pathResolver.resolveLocalAgentPath()
      : pathResolver.resolveGlobalAgentPath();
  const namesResult = await fileSystem.readDirectoryNames(agentRootPath);

  if (!namesResult.success) {
    return [];
  }

  return namesResult.data.map((name) => ({
    path:
      scope === "local"
        ? pathResolver.resolveLocalAgentPath(name)
        : pathResolver.resolveGlobalAgentPath(name),
    label: `${scope}: ${basename(name, ".md")}`,
  })) satisfies AgentChoice[];
}
