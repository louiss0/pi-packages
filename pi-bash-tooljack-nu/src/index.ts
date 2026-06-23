import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BashOperations,
  CustomEditor,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionContext,
  formatSize,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

import { getCommandSuggestions, type CommandCompletionItem } from "./command";
import {
  getHistoryQuery,
  getRecentFirstHistoryItems,
  HistoryPicker,
  parseHistoryCommands,
} from "./history";

const NUSHELL_COMMAND = "nu";
const CANCEL_HINT = "Press Escape to cancel.";
const ENV_VARIABLE_NAMES = Object.keys(process.env).sort();

type BashToolUpdate = AgentToolResult<undefined>;

function getEnvSuggestions(prefix: string): AutocompleteItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return ENV_VARIABLE_NAMES.filter((name) =>
    prefix ? name.toLowerCase().startsWith(normalizedPrefix) : true,
  ).map((name) => ({
    value: name,
    label: name,
    description: "Environment variable",
  }));
}

class NuAutocompleteProvider implements AutocompleteProvider {
  constructor(private readonly baseProvider: AutocompleteProvider) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    const commandPrefix = textBeforeCursor.match(/#([A-Za-z0-9_:-]*)$/);
    if (commandPrefix) {
      return getCommandSuggestions(commandPrefix[1] ?? "");
    }

    const envPrefix = textBeforeCursor.match(/\$env\.$/);
    if (envPrefix) {
      const propPrefix = envPrefix[1] ?? "";
      const items = getEnvSuggestions(propPrefix);
      if (items.length > 0) {
        return {
          items,
          prefix: propPrefix,
        };
      }
    }

    const variablePrefix = textBeforeCursor.match(/\$[A-Za-z0-9_]*$/);
    if (variablePrefix && "$env".startsWith(variablePrefix[0])) {
      return {
        items: [
          {
            value: "$env",
            label: "$env",
            description: "Nushell environment record",
          },
        ],
        prefix: variablePrefix[0],
      };
    }

    return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    const line = lines[cursorLine] ?? "";
    const textBeforeCursor = line.slice(0, cursorCol);
    const commandPrefix = textBeforeCursor.match(/#([A-Za-z0-9_:-]*)$/);
    const completionItem = item as CommandCompletionItem;

    if (!commandPrefix) {
      return this.baseProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    }

    const beforeCommandTrigger = line.slice(0, cursorCol - commandPrefix[0].length);
    const afterCursor = line.slice(cursorCol);
    const newLines = [...lines];

    if (completionItem.requiresClosure) {
      newLines[cursorLine] = `${beforeCommandTrigger}${item.value} {|$in| $in }${afterCursor}`;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforeCommandTrigger.length + item.value.length + 12,
      };
    }

    newLines[cursorLine] = `${beforeCommandTrigger}${item.value}${afterCursor}`;
    return {
      lines: newLines,
      cursorLine,
      cursorCol: beforeCommandTrigger.length + item.value.length,
    };
  }
}

class NuEditor extends CustomEditor {
  override setAutocompleteProvider(provider: AutocompleteProvider) {
    super.setAutocompleteProvider(new NuAutocompleteProvider(provider));
  }
}

function killNushellProcessTree(pid?: number) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

const nuOperations: BashOperations = {
  exec(command, cwd, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(NUSHELL_COMMAND, getNuArgs(command), {
        cwd,
        detached: process.platform !== "win32",
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let timedOut = false;
      const timeoutHandle = options.timeout
        ? setTimeout(() => {
            timedOut = true;
            killNushellProcessTree(child.pid);
          }, options.timeout * 1000)
        : undefined;

      const abortHandler = () => {
        killNushellProcessTree(child.pid);
      };

      options.signal?.addEventListener("abort", abortHandler, { once: true });

      child.stdout?.on("data", options.onData);
      child.stderr?.on("data", options.onData);

      child.on("error", (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        options.signal?.removeEventListener("abort", abortHandler);
        reject(error);
      });

      child.on("close", (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        options.signal?.removeEventListener("abort", abortHandler);

        if (options.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }

        if (timedOut) {
          reject(new Error(`timeout:${options.timeout}`));
          return;
        }

        resolve({ exitCode: code ?? 1 });
      });
    });
  },
};

function getNuArgs(command: string) {
  return ["-c", command];
}

function formatToolOutput(stdout: string, stderr: string, exitCode: number) {
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (output) {
    return output;
  }

  return `(command exited with code ${exitCode})`;
}

export async function truncateBashToolOutput(output: string, cwd: string) {
  const truncation = truncateTail(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return { output: truncation.content, truncated: false };
  }

  const outputPath = join(cwd, `nu-tool-output_${Date.now()}.txt`);
  await writeFile(outputPath, output);

  return {
    output: `File written to ${outputPath} read that instead!\n Output Lines/Total Lines: ${truncation.outputLines}/${truncation.totalLines}\n          Output Bytes/Total Bytes: ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}\n          `,
    truncated: true,
  };
}

async function getRecentHistoryCommands(cwd: string) {
  const historyResult = await executeNushellCommand(getHistoryQuery(), cwd);

  if (historyResult.exitCode !== 0) {
    throw new Error(historyResult.output || "Failed to read Nushell history");
  }

  return parseHistoryCommands(historyResult.output);
}

async function selectHistoryCommand(ctx: ExtensionContext) {
  const commands = await getRecentHistoryCommands(ctx.cwd);
  if (commands.length === 0) {
    ctx.ui.notify("No Nushell history commands found", "info");
    return null;
  }

  return ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) =>
      new HistoryPicker(
        {
          items: getRecentFirstHistoryItems(commands),
          itemLimit: 15,
        },
        theme,
        tui,
        done,
      ),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "70%",
      },
    },
  );
}

async function executeNushellCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  onUpdate?: (update: BashToolUpdate) => void,
) {
  return new Promise<{
    output: string;
    exitCode: number;
    cancelled: boolean;
  }>((resolve, reject) => {
    const child = spawn(NUSHELL_COMMAND, getNuArgs(command), {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const emitOutputUpdate = () => {
      if (!onUpdate) {
        return;
      }

      const output = [stdoutChunks, stderrChunks]
        .map((chunks) => Buffer.concat(chunks).toString("utf-8"))
        .filter(Boolean)
        .join("\n")
        .trim();

      onUpdate({
        content: output ? [{ type: "text", text: output }] : [],
        details: undefined,
      });
    };

    const abortHandler = () => {
      killNushellProcessTree(child.pid);
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    if (onUpdate) {
      onUpdate({
        content: [{ type: "text", text: CANCEL_HINT }],
        details: undefined,
      });
    }

    child.stdout?.on("data", (data) => {
      stdoutChunks.push(Buffer.from(data));
      emitOutputUpdate();
    });

    child.stderr?.on("data", (data) => {
      stderrChunks.push(Buffer.from(data));
      emitOutputUpdate();
    });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", abortHandler);
      reject(error);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", abortHandler);

      const exitCode = code ?? 1;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      emitOutputUpdate();

      resolve({
        output,
        exitCode,
        cancelled: Boolean(signal?.aborted),
      });
    });
  });
}

export default function nuBashExtension(pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+h", {
    description: "Show recent Nushell history",
    handler: async (ctx) => {
      try {
        const command = await selectHistoryCommand(ctx);
        if (!command) {
          return;
        }

        const result = await pi.exec(NUSHELL_COMMAND, getNuArgs(command), {
          cwd: ctx.cwd,
        });
        const message = formatToolOutput(result.stdout, result.stderr, result.code);

        ctx.ui.notify(`Executed: ${command}\n${message}`, result.code === 0 ? "info" : "error");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to execute Nushell history command";
        ctx.ui.notify(message, "error");
      }
    },
  });

  pi.on("session_start", (_, _ctx) => {
    _ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new NuEditor(tui, theme, keybindings),
    );
  });

  pi.registerTool({
    name: "bash",
    label: "nushell",
    description: "Execute shell commands through Nushell instead of the default bash backend",
    promptSnippet: "Run Nushell commands in the current working directory",
    promptGuidelines: [
      "Use `;` to chain commands instead of `&&`",
      "When a command produces line-oriented text that should become an array, pipe it to `lines`",
      "Pipe streams to `collect` before storing or reusing their results",
      "Use `from json` when parsing JSON from external commands",
      "Use `to nuon` when serializing Nushell data for storage, debugging, or reuse",
      "When using `each` for side effects only, pipe the result to `ignore`",
      "When replacing file contents, prefer: open -> str replace -> save --force",
      "Prefer Nushell file operations over Python, Node.js, Perl, sed, or other language runtimes for file modifications",
      "When a computed value must be reused multiple times, bind it with `do {|value| ... } value` or a variable",
      "Use at most three positional arguments with `do`; when more data is needed, pass a record instead",
      "Prefer Nushell `http` commands over commands like curl when the response will be processed as structured data",
      "Prefer structured Nushell data over text parsing whenever possible",
      "Use `open` instead of external tools when reading supported file formats",
      "Prefer `where`, `select`, `get`, and `sort-by` over text-processing tools such as awk, grep, cut, or sed",
      "When passing structured data to external tools, explicitly convert it using commands such as `to text`, `to csv`, or `to json`",
      "When capturing output from external tools, convert it back into structured data using commands such as `lines`, `from json`, `from csv`, or `parse`",
      "Instead of `head` use first <int> for files use `open | lines` before it",
      "Instead of `tail` use last <int> for files use `open | lines` before it",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: "Optional timeout in seconds before the command is aborted",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const timeoutSignal = params.timeout
        ? AbortSignal.timeout(params.timeout * 1000)
        : undefined;
      const combinedSignal = timeoutSignal
        ? AbortSignal.any(signal ? [signal, timeoutSignal] : [timeoutSignal])
        : signal;

      const result = await executeNushellCommand(
        params.command,
        ctx.cwd,
        combinedSignal,
        onUpdate,
      );

      const toolOutput = await truncateBashToolOutput(result.output, ctx.cwd);

      return {
        content: [
          {
            type: "text",
            text: toolOutput.output,
          },
        ],
        details: {
          command: params.command,
          backend: "nu",
          cwd: ctx.cwd,
          exitCode: result.exitCode,
          output: toolOutput.output,
          killed: result.cancelled,
          truncated: toolOutput.truncated,
        },
        isError: result.exitCode !== 0,
      };
    },
  });

  pi.on("user_bash", async () => {
    return {
      operations: nuOperations,
    };
  });
}
