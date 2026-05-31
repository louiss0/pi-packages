import {
  parseArgumentHint,
  parsePlaceholders,
  parseTemplate,
} from "@code-fixer-23/pi-prompt-parser";
import { type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  let widgetController: WidgetController;

  pi.on("session_start", (_event, ctx) => {
    widgetController = new WidgetController(ctx.ui);
    widgetController.setStatusToReady();
  });

  pi.on("input", async (event, ctx) => {
    widgetController.setStatusToGuarding();

    return handlePromptInput({
      text: event.text,
      ui: ctx.ui,
      readPromptFile: (path) => readFile(path, "utf-8"),
      getCommands: () => pi.getCommands(),
    });
  });

  pi.on("before_agent_start", () => {
    widgetController.setStatusToUnguarding();
  });

  pi.on("turn_end", () => {
    widgetController.setStatusToReady();
  });

  pi.events.emit("pi-prompt-guard:loaded", { name: "@code-fixer-23/pi-prompt-guard" });
}

type PromptArgument = {
  name: string;
  required: boolean;
  position: number;
};

type PromptPlaceholder =
  | { kind: "single"; position: number }
  | { kind: "slice"; start: number; end: number }
  | { kind: "named"; name: "ARGUMENTS" }
  | { kind: "rest" };

type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];

type PromptCommand = Pick<SlashCommandInfo, "name" | "source"> & {
  sourceInfo: Pick<SlashCommandInfo["sourceInfo"], "path">;
};

type PromptInputContext = {
  text: string;
  ui: Pick<ExtensionUIContext, "notify">;
  getCommands: () => PromptCommand[];
  readPromptFile: (path: string) => Promise<string>;
};

export async function handlePromptInput({
  text,
  ui,
  getCommands,
  readPromptFile,
}: PromptInputContext): Promise<{ action: "continue" | "handled" }> {
  if (!text.startsWith("/")) {
    return { action: "continue" };
  }

  const [unparsedCommandName, ...passedArguments] = text.trim().split(/\s+/);
  const commandName = unparsedCommandName?.replace(/^\/+/, "");

  if (!commandName) {
    return { action: "continue" };
  }

  const promptCommands = getCommands().filter((command) => command.source === "prompt");
  const promptCommand = promptCommands.find((command) => command.name === commandName);

  if (!promptCommand) {
    ui.notify(`Prompt not found: /${commandName}`, "error");
    return { action: "handled" };
  }

  const markdown = await readPromptFile(promptCommand.sourceInfo.path);
  const template = parseTemplate(markdown);
  const parsedArguments = parseArgumentHint(template.argumentHint);

  if (parsedArguments instanceof Error) {
    ui.notify(parsedArguments.message, "error");
    return { action: "handled" };
  }

  const parsedPlaceholders = parsePlaceholders(template.content);

  if (parsedPlaceholders instanceof Error) {
    ui.notify(parsedPlaceholders.message, "error");
    return { action: "handled" };
  }

  const validationError = validatePromptArguments({
    commandName,
    passedArguments,
    promptArguments: parsedArguments,
    placeholders: parsedPlaceholders,
  });

  if (validationError) {
    ui.notify(validationError, "error");
    return { action: "handled" };
  }

  return { action: "continue" };
}

type PromptArgumentValidation = {
  commandName: string;
  passedArguments: string[];
  promptArguments: PromptArgument[];
  placeholders: PromptPlaceholder[];
};

export function validatePromptArguments({
  commandName,
  passedArguments,
  promptArguments,
  placeholders,
}: PromptArgumentValidation): string | null {
  const requiredArguments = promptArguments.filter((argument) => argument.required);

  if (passedArguments.length < requiredArguments.length) {
    const missingArguments = requiredArguments
      .slice(passedArguments.length)
      .map((argument) => `<${argument.name}>`)
      .join(" ");

    return `Missing required arguments for /${commandName}: ${missingArguments}`;
  }

  const highestExplicitPosition = placeholders.reduce((highestPosition, placeholder) => {
    if (placeholder.kind === "single") {
      return Math.max(highestPosition, placeholder.position);
    }

    if (placeholder.kind === "slice") {
      return Math.max(highestPosition, placeholder.start);
    }

    return highestPosition;
  }, 0);

  const usesArgumentsPlaceholder = placeholders.some((placeholder) => placeholder.kind === "named");
  const usesRestPlaceholder = placeholders.some((placeholder) => placeholder.kind === "rest");
  const declaredArgumentCount = promptArguments.length;
  const allowedArgumentCount = Math.max(declaredArgumentCount, highestExplicitPosition);

  if (!usesRestPlaceholder && !usesArgumentsPlaceholder && passedArguments.length > allowedArgumentCount) {
    return `Too many arguments for /${commandName}: expected at most ${allowedArgumentCount} but received ${passedArguments.length}`;
  }

  if (highestExplicitPosition > 0 && passedArguments.length < highestExplicitPosition) {
    return `Missing argument for /${commandName}: placeholder requires argument ${highestExplicitPosition}`;
  }

  const invalidSlice = placeholders.find(
    (placeholder) =>
      placeholder.kind === "slice" &&
      placeholder.end !== Number.POSITIVE_INFINITY &&
      placeholder.end < placeholder.start,
  );

  if (invalidSlice?.kind === "slice") {
    return `Invalid placeholder range for /${commandName}: {@:${invalidSlice.start}:${invalidSlice.end}}`;
  }

  return null;
}

class WidgetController {
  #ui: ExtensionUIContext;

  readonly #key = "pi-prompt-guard";

  get #widgetTitle() {
    return this.#key
      .split("-")
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  }

  constructor(ui: ExtensionUIContext) {
    this.#ui = ui;
  }

  #setStatus(status: "guarding" | "ready" | "unguarding") {
    this.#ui.setWidget(this.#key, [
      this.#ui.theme.bold(this.#widgetTitle),
      this.#ui.theme.fg(status === "guarding" ? "warning" : "text", status),
    ]);
  }

  setStatusToGuarding() {
    this.#setStatus("guarding");
  }

  setStatusToReady() {
    this.#setStatus("ready");
  }

  setStatusToUnguarding() {
    this.#setStatus("unguarding");
  }
}
