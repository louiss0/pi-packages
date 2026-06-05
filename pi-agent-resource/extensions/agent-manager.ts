import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Form, LabelledInput } from "@code-fixer-23/pi-form-components";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { InferOutput, maxLength, minLength, object, pipe, regex, string } from "valibot";
import {
  getNodeResourceFileSystem,
  getPathResolver,
  type PathResolver,
  type ResourceFileSystem,
} from "../shared/filesystem";
import { parseObjectErrors } from "../shared/parse";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import {
  getFilterSubcommandArgumentCompletionFromStringUsingSubLabel,
  SubCommands,
} from "../shared/subcommands";
import { formOverlayOptions } from "../shared/ui";

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
export const LOCAL_AGENT_DIRECTORY = join(PI_DIRECTORY_NAME, AGENTS_DIRECTORY_NAME);
const agentNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const lowerCommaSeparatedToolsPattern = /^[a-z0-9:-]+(?:\s*,\s*[a-z0-9:-]+)*$/;

const AgentFieldsSchema = object({
  name: pipe(
    string(),
    minLength(1, "Name is required"),
    maxLength(48, "Name must be 48 characters or fewer"),
    regex(agentNamePattern, "Name must be lowercase letters, numbers, and dashes only"),
  ),
  description: pipe(
    string(),
    minLength(35, "Description must be at least 35 characters"),
    maxLength(1024, "Description must be 1024 characters or fewer"),
  ),
  tools: pipe(
    string(),
    minLength(1, "Tools are required"),
    regex(lowerCommaSeparatedToolsPattern, "Tools must be a lowercase comma-separated list"),
  ),
  model: pipe(
    string(),
    minLength(2, "Model must be at least 2 characters"),
    maxLength(128, "Model must be 128 characters or fewer"),
    regex(/^[a-z0-9:-]+$/, "Model must be lowercase"),
  ),
});

type AgentFields = InferOutput<typeof AgentFieldsSchema>;
type AgentScope = "global" | "local";
type AgentChoice = {
  path: string;
  label: string;
};

type GetResourceFileSystem = (rootPath?: string) => ResourceFileSystem;
type GetPathResolver = (cwd?: string) => PathResolver;

export function parseAgentFormValues(values: AgentFields) {
  return parseObjectErrors(AgentFieldsSchema, values);
}

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

export function createAgentForm(
  tui: TUI,
  theme: Theme,
  done: (value: AgentFields | null) => void,
) {
  return new Form<AgentFields>(
    {
      title: "Create Agent",
      fields: [
        new LabelledInput("name", theme),
        new LabelledInput("description", theme),
        new LabelledInput("tools", theme),
        new LabelledInput("model", theme),
      ],
      parse: parseAgentFormValues,
      footer:
        "* required | Enter next/submit | Tab switch field | Esc cancel\nUse lowercase values for every field. Separate tools with commas.",
      spacing: 1,
    },
    tui,
    done,
  );
}

async function handleAgentCommand(arg: string, ctx: ExtensionContext, scope: AgentScope) {
  notifyWhenUsingDevelopmentExtension(extensionName, ctx);
  const result = parseAgentCommandArgument(arg);
  if (!result.success) {
    ctx.ui.notify(`Invalid command: ${result.errorMessage}`, "error");
    return;
  }

  if (scope === "local") {
    ctx.ui.notify(
      `Using local agents from ${getAgentDirectory("local", ctx.cwd || process.cwd())}`,
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

function getAgentDirectory(scope: AgentScope, cwd = process.cwd()) {
  return scope === "local" ? join(cwd, LOCAL_AGENT_DIRECTORY) : GLOBAL_AGENT_DIRECTORY;
}

function getAgentRootPath(
  scope: AgentScope,
  pathResolver: PathResolver,
) {
  return scope === "local"
    ? pathResolver.getLocalResourcePath(pathResolver.agentFolder)
    : pathResolver.getGlobalResourcePath(pathResolver.agentFolder);
}

export async function handleCreate(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = getNodeResourceFileSystem,
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(getAgentDirectory(scope, cwd));
  const pathResolver = getResolver(cwd);
  const agentRootPath = getAgentRootPath(scope, pathResolver);
  const values = await ctx.ui.custom<AgentFields | null>(
    (tui, theme, _keyboard, done) => createAgentForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!values) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const filePath = pathResolver.resolvePath(agentRootPath, `${values.name}.md`);

  const directoryResult = await fileSystem.mkdir(agentRootPath, { recursive: true });
  if (!directoryResult.success) {
    ctx.ui.notify(
      getFileSystemErrorMessage("Agent creation failed", directoryResult.error),
      "error",
    );
    return;
  }

  const writeResult = await fileSystem.writeFile(filePath, renderFrontmatter(values));
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
  getFileSystem: GetResourceFileSystem = getNodeResourceFileSystem,
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(getAgentDirectory(scope, cwd));
  const pathResolver = getResolver(cwd);
  const agent = await pickAgent(ctx, "Edit Agent", scope, fileSystem, pathResolver);

  if (!agent) {
    ctx.ui.notify("Agent editing cancelled", "info");
    return;
  }

  const readResult = await fileSystem.readFile(agent.path);
  if (!readResult.success) {
    ctx.ui.notify(getFileSystemErrorMessage("Agent edit failed", readResult.error), "error");
    return;
  }

  const editedContent = await ctx.ui.editor("Edit Agent", readResult.data);

  if (editedContent === undefined) {
    ctx.ui.notify("Agent editing cancelled", "info");
    return;
  }

  const writeResult = await fileSystem.writeFile(agent.path, editedContent);
  if (!writeResult.success) {
    ctx.ui.notify(getFileSystemErrorMessage("Agent edit failed", writeResult.error), "error");
    return;
  }

  ctx.ui.notify("Agent edited");
}

export async function handleDelete(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = getNodeResourceFileSystem,
  getResolver: GetPathResolver = getPathResolver,
) {
  const cwd = ctx.cwd || process.cwd();
  const fileSystem = getFileSystem(getAgentDirectory(scope, cwd));
  const pathResolver = getResolver(cwd);
  const agent = await pickAgent(ctx, "Delete Agent", scope, fileSystem, pathResolver);

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

function renderFrontmatter(values: AgentFields) {
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
  ].join("\n");
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
  pathResolver: PathResolver,
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
  pathResolver: PathResolver,
) {
  const agentRootPath = getAgentRootPath(scope, pathResolver);
  const namesResult = await fileSystem.readDirectoryNames(agentRootPath);

  if (!namesResult.success) {
    return [];
  }

  return namesResult.data.map((name) => ({
    path: pathResolver.resolvePath(agentRootPath, name),
    label: `${scope}: ${basename(name, ".md")}`,
  })) satisfies AgentChoice[];
}
