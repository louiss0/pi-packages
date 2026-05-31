import { parsePrompt } from "@code-fixer-23/pi-prompt-parser";
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

    const result = await handlePromptInput({
      text: event.text,
      ui: ctx.ui,
      readPromptFile: (path) => readFile(path, "utf-8"),
      getCommands: () => pi.getCommands(),
    });

    return result;
  });

  pi.on("before_agent_start", () => {
    widgetController.setStatusToUnguarding();
  });

  pi.on("turn_end", () => {
    widgetController.setStatusToReady();
  });

  pi.events.emit("pi-prompt-guard:loaded", { name: "@code-fixer-23/pi-prompt-guard" });
}

type PromptCommand = {
  name: string;
  description?: string;
  source: string;
  sourceInfo: {
    path: string;
  };
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

  const [unparsedCommandName] = text.split(/\s+/, 1);
  const commandName = unparsedCommandName?.replace(/^\/+/, "");

  if (!commandName) {
    return { action: "continue" };
  }

  const promptCommands = getCommands().filter((command) => command.source === "prompt");
  const promptCommand = promptCommands.find((command) => command.name === commandName);

  if (!promptCommand) {
    return { action: "continue" };
  }

  const markdown = await readPromptFile(promptCommand.sourceInfo.path);
  const parsedPrompt = parsePrompt(markdown);

  if (parsedPrompt instanceof Error) {
    ui.notify(parsedPrompt.message, "error");
    return { action: "handled" };
  }

  return { action: "continue" };
}

class WidgetController {
  #ui: ExtensionUIContext;

  readonly #key = "pi-prompt-guard";

  get #widgetTitle() {
    return this.#key
      .split("-")
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(" ");
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
