import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Editor,
  Key,
  matchesKey,
  Spacer,
  Text,
  type TUI,
} from "@mariozechner/pi-tui";
import {
  InferOutput,
  maxLength,
  minLength,
  object,
  optional,
  pipe,
  regex,
  string,
} from "valibot";
import { Form, LabelledInput } from "@code-fixer-23/pi-form-components";
import { getResourceFileSystem } from "../shared/filesystem";
import { parseObjectErrors } from "../shared/parse";
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
export const LOCAL_PROMPT_DIRECTORY = join(PI_DIRECTORY_NAME, PROMPTS_DIRECTORY_NAME);
const promptNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const argumentHintPattern = /^(?:\s*(?:<[^<>\s]+>|\[[^\[\]\s]+\])\s*)*$/;

const PromptFieldsSchema = object({
  name: pipe(
    string(),
    minLength(3, "Name must be at least 3 characters"),
    maxLength(48, "Name must be 48 characters or fewer"),
    regex(
      promptNamePattern,
      "Name must be lowercase letters, numbers, and dashes only",
    ),
  ),
  description: pipe(
    string(),
    minLength(35, "Description must be at least 35 characters"),
    maxLength(1024, "Description must be 1024 characters or fewer"),
  ),
  "argument-hint": optional(
    pipe(
      string(),
      regex(argumentHintPattern, "Argument hint must use [] or <> tokens"),
    ),
    "",
  ),
});

type PromptFields = InferOutput<typeof PromptFieldsSchema>;
type PromptScope = "global" | "local";
type PromptChoice = {
  path: string;
  deletePath: string;
  label: string;
};

export function parsePromptFormValues(values: PromptFields) {
  return parseObjectErrors(PromptFieldsSchema, values);
}

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

export function createPromptForm(
  tui: TUI,
  theme: Theme,
  done: (value: PromptFields | null) => void,
) {
  return new Form<PromptFields>(tui, done, {
    title: "Create Prompt",
    fields: [
      new LabelledInput("name", theme),
      new LabelledInput("description", theme),
      new LabelledInput("argument-hint", theme),
    ],
    parse: parsePromptFormValues,
    footer:
      "* required | argument-hint is optional | Enter next/submit | Tab switch field | Esc cancel\nTemplate opens in the editor overlay next. Use <> for required hints and [] for optional hints.",
    spacing: 1,
  });
}

class PromptTemplateOverlay extends Container {
  #editor: Editor;
  #done: (value: string | undefined) => void;

  constructor(
    tui: TUI,
    theme: Theme,
    done: (value: string | undefined) => void,
  ) {
    super();
    this.#done = done;
    this.#editor = new Editor(tui, {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    });

    this.#editor.onSubmit = (value) => done(value);

    this.addChild(new Text(theme.fg("accent", "Edit Prompt Template")));
    this.addChild(new Spacer(1));
    this.addChild(this.#editor);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        theme.fg(
          "dim",
          "* required in form | argument-hint optional | Enter submit | Shift+Enter newline | Esc cancel",
        ),
      ),
    );
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.#done(undefined);
      return;
    }

    this.#editor.handleInput(data);
  }
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
    ctx.ui.notify(
      `Using local prompts from ${getPromptDirectory("local", ctx.cwd || process.cwd())}`,
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

function getPromptDirectory(scope: PromptScope, cwd = process.cwd()) {
  return scope === "local" ? join(cwd, LOCAL_PROMPT_DIRECTORY) : GLOBAL_PROMPT_DIRECTORY;
}

export async function handleCreate(ctx: ExtensionContext, scope: PromptScope = "global") {
  const values = await ctx.ui.custom<PromptFields | null>(
    (tui, theme, _keyboard, done) => createPromptForm(tui, theme, done),
    formOverlayOptions,
  );

  if (!values) {
    ctx.ui.notify("Prompt creation cancelled", "info");
    return;
  }

  const template = await ctx.ui.custom<string | undefined>(
    (tui, theme, _keyboard, done) =>
      new PromptTemplateOverlay(tui, theme, done),
    modalEditorOverlayOptions,
  );

  if (template === undefined) {
    ctx.ui.notify("Prompt creation cancelled", "info");
    return;
  }

  const fileSystem = getResourceFileSystem();
  const promptDirectory = getPromptDirectory(scope, ctx.cwd || process.cwd());
  const filePath = join(promptDirectory, `${values.name}.md`);
  await fileSystem.mkdir(promptDirectory, { recursive: true });
  await fileSystem.writeFile(
    filePath,
    `${renderFrontmatter(values)}\n${template}`.trimEnd() + "\n",
    "utf8",
  );
  ctx.ui.notify("Prompt created");
}

export async function handleEdit(ctx: ExtensionContext, scope: PromptScope = "global") {
  const prompt = await pickPrompt(ctx, "Edit Prompt", scope);

  if (!prompt) {
    ctx.ui.notify("Prompt editing cancelled", "info");
    return;
  }

  const fileSystem = getResourceFileSystem();
  const content = await fileSystem.readFile(prompt.path, "utf8");
  const editedContent = await ctx.ui.editor("Edit Prompt", content);

  if (editedContent === undefined) {
    ctx.ui.notify("Prompt editing cancelled", "info");
    return;
  }

  await fileSystem.writeFile(prompt.path, editedContent, "utf8");
  ctx.ui.notify("Prompt edited");
}

export async function handleDelete(ctx: ExtensionContext, scope: PromptScope = "global") {
  const prompt = await pickPrompt(ctx, "Delete Prompt", scope);

  if (!prompt) {
    ctx.ui.notify("Prompt deleting cancelled", "info");
    return;
  }

  const isGroupedPrompt = prompt.deletePath !== prompt.path;

  if (isGroupedPrompt) {
    await getResourceFileSystem().removeDirectory(prompt.deletePath);
  } else {
    await getResourceFileSystem().removeFile(prompt.deletePath);
  }

  ctx.ui.notify("Prompt deleted");
}

function renderFrontmatter(values: PromptFields) {
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
  ].join("\n");
}

async function pickPrompt(ctx: ExtensionContext, title: string, scope: PromptScope) {
  const choices = await listPromptChoices(scope, ctx.cwd || process.cwd());

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

async function listPromptChoices(scope: PromptScope, cwd: string) {
  const directory = getPromptDirectory(scope, cwd);
  const choices: PromptChoice[] = [];

  try {
    const entries = await getResourceFileSystem().readDirectoryEntries(directory);
    choices.push(
      ...entries.map((entry) => {
        const entryPath = join(directory, entry.name);
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
  } catch {
    // Ignore missing directories.
  }

  return choices;
}
