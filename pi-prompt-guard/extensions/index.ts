import { type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  let widgetController: WidgetController;
  pi.on("session_start", (_, ctx) => {
    widgetController = new WidgetController(ctx.ui);
    widgetController.setStatusToReady();
  });

  pi.on("input", async (event, ctx) => {
    widgetController.setStatusToGuarding();
    const promptCommands = pi.getCommands().filter((command) => command.source === "prompt");

    if (!event.text.startsWith("/")) {
      return;
    }

    const [commandName, ...args] = event.text.split(" ");
    const command = promptCommands.find((cmd) => cmd.name === commandName?.replace(/^\/+/, ""));

    if (!command) {
      ctx.ui.notify("No commands found");

      return {
        action: "handled",
      };
    }

    const path = command.sourceInfo.path;
    ctx.ui.notify(`This is the command ${command.name}
      path: ${path}
      ${command.description}
      `);

    const content = await readFile(path, "utf-8");
    ctx.ui.notify(
      `Content:
      ${content}
      `,
    );

    return {
      action: "handled",
    };
  });

  // Status is set to unguarding before each agent start: confirms validity of the prompt
  pi.on("before_agent_start", () => {
    widgetController.setStatusToUnguarding();
  });

  // Status is set to ready after each turn
  pi.on("turn_end", () => {
    widgetController.setStatusToReady();
  });

  // Let other extensions know the extension is loaded
  pi.events.emit("pi-prompt-guard:loaded", { name: "@code-fixer-23/pi-prompt-guard" });
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
