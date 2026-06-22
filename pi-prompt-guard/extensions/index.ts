import { type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

import { parseArgumentHint, parsePlaceholders, parseTemplate } from "./internal/prompt-parser";

export default function (pi: ExtensionAPI) {
  let widgetHost: PiPromptGuardWidgetHost;

  pi.on("session_start", (_event, ctx) => {
    widgetHost = new PiPromptGuardWidgetHost(ctx.ui);
  });

  pi.on("input", async (event, ctx) => {
    return handlePromptInput(
      {
        text: event.text,
        ui: ctx.ui,
        readPromptFile: (path) => readFile(path, "utf-8"),
        getCommands: () => pi.getCommands(),
      },
      widgetHost,
    );
  });

  pi.on("before_agent_start", () => {
    widgetHost.setStatusToUnguardingIfItIsGuarding();
  });

  pi.on("turn_end", () => {
    widgetHost.setStatusToReady();
  });

  pi.events.emit("pi-prompt-guard:loaded", {
    name: "@code-fixer-23/pi-prompt-guard",
  });
}

type PromptArgument = Exclude<ReturnType<typeof parseArgumentHint>, Error>;

type PromptPlaceholder = Exclude<ReturnType<typeof parsePlaceholders>, Error>;

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

type TokenizedPromptInput = {
  commandName: string;
  passedArguments: string[];
};

const NON_SKILL_COMMAND_PATTERN = /^\/(?!skill(?:\s|$)).+/;
const QUOTING_GUIDANCE = "If an argument contains spaces, wrap it in single or double quotes.";

export async function handlePromptInput(
  { text, ui, getCommands, readPromptFile }: PromptInputContext,
  widgetHost: GuardWidgetHost,
): Promise<{ action: "continue" | "handled" }> {
  if (!NON_SKILL_COMMAND_PATTERN.test(text.trim())) {
    return { action: "continue" };
  }
  widgetHost.setStatusToGuarding();

  const tokenizedInput = tokenizePromptInput(text);

  if (tokenizedInput instanceof Error) {
    ui.notify(tokenizedInput.message, "error");
    return { action: "handled" };
  }

  const { commandName, passedArguments } = tokenizedInput;

  if (!commandName) {
    return { action: "continue" };
  }

  const promptCommands = getCommands().filter((command) => command.source === "prompt");
  const promptCommand = promptCommands.find((command) => command.name === commandName);

  if (!promptCommand) {
    return { action: "continue" };
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

export function tokenizePromptInput(text: string): TokenizedPromptInput | Error {
  const tokens: string[] = [];
  let currentToken = "";
  let activeQuote: '"' | "'" | null = null;

  for (const character of text.trim()) {
    if (activeQuote) {
      if (character === activeQuote) {
        activeQuote = null;
      } else {
        currentToken += character;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = "";
      }

      continue;
    }

    currentToken += character;
  }

  if (activeQuote) {
    return new Error(`Unterminated quoted argument.\n${QUOTING_GUIDANCE}`);
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  const [unparsedCommandName, ...passedArguments] = tokens;
  const commandName = unparsedCommandName?.replace(/^\/+/, "") ?? "";

  return {
    commandName,
    passedArguments,
  };
}

type PromptArgumentValidation = {
  commandName: string;
  passedArguments: string[];
  promptArguments: PromptArgument;
  placeholders: PromptPlaceholder;
};

export function validatePromptArguments({
  commandName,
  passedArguments,
  promptArguments,
  placeholders,
}: PromptArgumentValidation): string | null {
  const highestExplicitPosition = placeholders.reduce((highestPosition, placeholder) => {
    if (placeholder.kind === "single") {
      return Math.max(highestPosition, placeholder.position);
    }

    if (placeholder.kind === "slice") {
      return Math.max(highestPosition, placeholder.start);
    }

    return highestPosition;
  }, 0);

  const highestFiniteSliceEnd = placeholders.reduce((highestPosition, placeholder) => {
    if (placeholder.kind === "slice" && placeholder.end !== Number.POSITIVE_INFINITY) {
      return Math.max(highestPosition, placeholder.end);
    }

    return highestPosition;
  }, 0);

  const usesArgumentsPlaceholder = placeholders.some(
    (placeholder) => placeholder.kind === "named",
  );
  const usesRestPlaceholder = placeholders.some((placeholder) => placeholder.kind === "rest");
  const declaredArgumentCount = promptArguments.length;
  const requiredArguments = promptArguments.filter((argument) => argument.required);
  const highestReferencedPosition = Math.max(highestExplicitPosition, highestFiniteSliceEnd);

  if (
    !usesArgumentsPlaceholder &&
    !usesRestPlaceholder &&
    highestReferencedPosition > declaredArgumentCount
  ) {
    return `Prompt /${commandName} references argument ${highestReferencedPosition} but only declares ${declaredArgumentCount}.`;
  }

  if (passedArguments.length < requiredArguments.length) {
    const missingArguments = requiredArguments
      .slice(passedArguments.length)
      .map((argument) => `<${argument.name}>`)
      .join(" ");

    return `Missing required arguments for /${commandName}: ${missingArguments}.\n${QUOTING_GUIDANCE}`;
  }

  if (highestExplicitPosition > 0 && passedArguments.length < highestExplicitPosition) {
    return `Missing argument for /${commandName}: placeholder requires argument ${highestExplicitPosition}.\n${QUOTING_GUIDANCE}`;
  }

  const allowedArgumentCount = Math.max(declaredArgumentCount, highestExplicitPosition);

  if (
    !usesRestPlaceholder &&
    !usesArgumentsPlaceholder &&
    passedArguments.length > allowedArgumentCount
  ) {
    return `Too many arguments for /${commandName}: expected at most ${allowedArgumentCount} but received ${passedArguments.length}.\n${QUOTING_GUIDANCE}`;
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

export interface GuardWidgetHost {
  setStatusToGuarding(): void;
  setStatusToReady(): void;
  setStatusToUnguardingIfItIsGuarding(): void;
}

class PiPromptGuardWidgetHost implements GuardWidgetHost {
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

  #status: "guarding" | "ready" | "unguarding" = "ready";

  #setStatus(status: "guarding" | "ready" | "unguarding") {
    this.#status = status;
    this.#ui.setWidget(this.#key, [
      this.#ui.theme.bold(this.#widgetTitle),
      this.#ui.theme.fg(this.#status === "guarding" ? "warning" : "text", this.#status),
    ]);
  }

  setStatusToGuarding() {
    this.#setStatus("guarding");
  }

  setStatusToReady() {
    this.#setStatus("ready");
  }

  setStatusToUnguardingIfItIsGuarding() {
    if (this.#status == "guarding") {
      this.#setStatus("unguarding");
    }
  }
}
