import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import {
  InferOutput,
  maxLength,
  minLength,
  object,
  pipe,
  regex,
  string,
} from "valibot";
import { Form, LabelledInput } from "@org/pi-form-components";
import { getResourceFileSystem } from "../shared/filesystem";
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
const LOCAL_AGENT_FLAG = "local-agent";

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

export function createAgentForm(tui: TUI, theme: Theme, done: (value: AgentFields | null) => void) {
  return new Form<AgentFields>(tui, done, {
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
  });
}

export default (pi: ExtensionAPI) => {
  pi.registerFlag(LOCAL_AGENT_FLAG, {
    description: "Use project agents from .pi/agents for agent commands",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("resource:agent", {
    description: "This is for managing agents",
    getArgumentCompletions:
      getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("agent"),
    handler: async (arg, ctx) => {
      notifyWhenUsingDevelopmentExtension(extensionName, ctx);
      const result = parseAgentCommandArgument(arg);
      if (!result.success) {
        ctx.ui.notify(`Invalid command: ${result.errorMessage}`, "error");
        return;
      }

      const scope = pi.getFlag(LOCAL_AGENT_FLAG) === true ? "local" : "global";

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
    },
  });
};

function getAgentDirectory(scope: AgentScope, cwd = process.cwd()) {
  return scope === "local" ? join(cwd, LOCAL_AGENT_DIRECTORY) : GLOBAL_AGENT_DIRECTORY;
}

export async function handleCreate(ctx: ExtensionContext, scope: AgentScope = "global") {
  const values = await ctx.ui.custom<AgentFields | null>(
    (tui, theme, _keyboard, done) => createAgentForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!values) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const fileSystem = getResourceFileSystem();
  const agentDirectory = getAgentDirectory(scope, ctx.cwd || process.cwd());
  const filePath = join(agentDirectory, `${values.name}.md`);
  await fileSystem.mkdir(agentDirectory, { recursive: true });
  await fileSystem.writeFile(filePath, renderFrontmatter(values), "utf8");
  ctx.ui.notify("Agent created");
}

export async function handleEdit(ctx: ExtensionContext, scope: AgentScope = "global") {
  const agent = await pickAgent(ctx, "Edit Agent", scope);

  if (!agent) {
    ctx.ui.notify("Agent editing cancelled", "info");
    return;
  }

  const fileSystem = getResourceFileSystem();
  const content = await fileSystem.readFile(agent.path, "utf8");
  const editedContent = await ctx.ui.editor("Edit Agent", content);

  if (editedContent === undefined) {
    ctx.ui.notify("Agent editing cancelled", "info");
    return;
  }

  await fileSystem.writeFile(agent.path, editedContent, "utf8");
  ctx.ui.notify("Agent edited");
}

export async function handleDelete(ctx: ExtensionContext, scope: AgentScope = "global") {
  const agent = await pickAgent(ctx, "Delete Agent", scope);

  if (!agent) {
    ctx.ui.notify("Agent deleting cancelled", "info");
    return;
  }

  await getResourceFileSystem().removeFile(agent.path);
  ctx.ui.notify("Agent deleted");
}

function renderFrontmatter(values: AgentFields) {
  return ["---", ...Object.entries(values).map(([key, value]) => `${key}: ${value}`), "---", ""]
    .join("\n");
}

async function pickAgent(ctx: ExtensionContext, title: string, scope: AgentScope) {
  const choices = await listAgentChoices(scope, ctx.cwd || process.cwd());

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

async function listAgentChoices(scope: AgentScope, cwd: string) {
  try {
    const directory = getAgentDirectory(scope, cwd);
    const names = await getResourceFileSystem().readDirectoryNames(directory);

    return names.map((name) => ({
      path: join(directory, name),
      label: `${scope}: ${basename(name, ".md")}`,
    })) satisfies AgentChoice[];
  } catch {
    return [];
  }
}
