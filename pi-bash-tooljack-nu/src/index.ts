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

    const envPrefix = textBeforeCursor.match(/\$env(?:\.([A-Za-z0-9_]*))?$/);
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

    return this.baseProvider.getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    );
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
      return this.baseProvider.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    }

    const beforeCommandTrigger = line.slice(
      0,
      cursorCol - commandPrefix[0].length,
    );
    const afterCursor = line.slice(cursorCol);
    const newLines = [...lines];

    if (completionItem.requiresClosure) {
      newLines[cursorLine] =
        `${beforeCommandTrigger}${item.value} {|$in| $in }${afterCursor}`;
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
    throw new Error(historyResult.output || "Failed to read Nushell history.");
  }

  return parseHistoryCommands(historyResult.output);
}

async function selectHistoryCommand(ctx: ExtensionContext) {
  const commands = await getRecentHistoryCommands(ctx.cwd);
  if (commands.length === 0) {
    ctx.ui.notify("No Nushell history commands found.", "info");
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

const nushellGuidelines = [
  "Prefer Nushell-native commands over Bash-style text pipelines. Nushell works best when commands pass structured values such as lists, records, and tables instead of plain text.",

  "Do not assume Nushell is Bash. Avoid Bash-only syntax such as test brackets, awk-heavy parsing, sed-heavy parsing, xargs-first workflows, and output redirection with >.",

  "Use `save` for writing pipeline output to a file. Example: `'hello' | save output.txt` instead of `echo 'hello' > output.txt`.",

  "When command output is a string with multiple lines, convert it into a list before processing it. Use `lines` for newline-separated output.",

  "When command output is a delimited string, convert it before filtering or mapping. Use `split row` to create a list and `split column` to create a table.",

  "Use `split words` when a string needs to become a list of shell-like words, but do not use it as a full Bash parser.",

  "Use `str trim` before comparing strings that may contain extra whitespace.",

  "Use `str contains`, `str starts-with`, `str ends-with`, `str replace`, and regex operators instead of piping through grep, sed, or awk when the data is already in Nushell.",

  "Prefer `where` for filtering structured data. Example: `ls | where type == dir` instead of `ls -d */`.",

  "Prefer `get`, `select`, `reject`, `rename`, `insert`, `update`, and `upsert` for shaping records and tables instead of parsing display output.",

  "When iterating over lists or tables, use `each`. Remember that a table is a list of records, so `each` receives one row record at a time.",

  "When a closure inside `each` returns a stream and the result should be flattened, use `each --flatten`.",

  "For recursive file discovery, prefer Nushell glob patterns such as `ls **/*.rs` instead of Bash `find . -name '*.rs'`.",

  "Treat globs and strings differently. Quoted strings like `'*.txt'` or `\"*.txt\"` are literal strings, while bare patterns like `*.txt` may be interpreted as globs by commands that accept globs.",

  "When a string must be used as a glob, convert it explicitly with `into glob`.",

  "When a glob must be treated as literal text, convert it explicitly with `into string` or quote it carefully depending on the target command.",

  "Use `glob` when the agent needs a list of matching paths as data. Example: `glob **/*.nu` returns a list of fully qualified pathnames.",

  "Use `path` subcommands for path manipulation instead of manual string splitting. Use `path split`, `path parse`, `path basename`, `path dirname`, `path join`, and `path expand` as appropriate.",

  "Do not split paths using `/` or `\\` manually. Use `path split` so the command works across platforms.",

  "When a value represents a filesystem path, prefer path-aware commands and path annotations where possible instead of treating the path as a plain string.",

  "Use `open` for reading structured files when possible. Nushell can load formats like JSON, TOML, YAML, CSV, and others into structured data.",

  "After `open`, operate on the structured value directly. Example: `open package.json | get scripts` instead of catting the file and parsing text.",

  "Use `to json`, `to yaml`, `to toml`, or similar format converters when the agent needs to serialize structured data back into text.",

  "Use `from json`, `from yaml`, `from toml`, `from csv`, or similar parsers when external command output returns structured text.",

  "If an external command returns plain text, immediately convert it into Nushell data before processing. Common conversions are `lines`, `split row`, `split column`, `parse`, or `from json`.",

  "Prefer external commands only when Nushell does not provide the needed behavior or when the external tool is the actual target, such as `git`, `npm`, `go`, or `cargo`.",

  "Use `^command` when the agent must force execution of an external command that has the same name as a Nushell command.",

  "Do not rely on Unix-only tools such as grep, sed, awk, find, xargs, tr",

  "For command success and failure, prefer Nushell error handling instead of Bash `$?` habits.",

  "Avoid producing commands that depend on shell-specific quoting tricks. Prefer Nushell lists, records, and variables to build arguments safely.",

  "For key-value text, prefer `parse` or `split column` followed by `rename` so the result becomes a table with meaningful column names.",

  "For JSON output from tools, request JSON from the tool when possible and pipe to `from json` if Nushell does not parse it automatically.",

  "Prefer `http` instead of `curl | jq` for API reads.",

  "Prefer `select field1 field2` instead of `jq '{field1, field2}'` when working with structured records or tables.",

  "Prefer `where name =~ 'pattern'` or `find` over `grep` when filtering Nushell values.",

  "Prefer `str replace` over `sed` for simple string replacements.",

  "Prefer `math`, `length`, `first`, `last`, `sort-by`, `uniq`, and `group-by` over Bash pipelines when working with lists or tables.",

  "Before writing a Nushell command, ask: 'What type is flowing through the pipeline right now: string, list, record, table, path, glob, or binary?'",

  "Do not parse Nushell table display output. The display table is for humans; use the underlying structured values instead.",

  "When in doubt, make the pipeline more explicit: convert strings into lists, lists into tables, tables into selected records, and records into serialized output only at the end.",
];

const nushellRipgrepAdvancedGuidelines = [
  "When using ripgrep with Nushell follow these guidelines",
  `Prefer
    \`rg <argument> --json
     | from json --objects
     | get data
     | filter {|item| [$item.path?, $item.lines?] | all {|it| $it != null  }  }
     | reject submatches
     | to nuon\`
     `,
  "Always use single quotes for Ripgrep arguments",
  "If not using `--json`, use `rg <argument> | lines`",
];

const nushellFileReplacementGuidelines = [
  "Do not use programming language runtimes for ordinary file text replacement.",

  "Use Nushell-native replacement as the default: `open --raw file | str replace --all 'old' 'new' | save --force file`.",

  "Use this Nushell-only candidate search pattern: `glob **/* | where { |f| ($f | path type) == file } | where { |f| open --raw $f | str contains 'old' }`.",

  "Use this Nushell-only replacement pattern: `glob **/* | where { |f| ($f | path type) == file } | where { |f| open --raw $f | str contains 'old' } | each { |f| open --raw $f | str replace --all 'old' 'new' | save --force $f }`.",

  "Prefer filtering candidate files before replacing text so the agent does not rewrite unrelated files.",

  "For structured files such as JSON, TOML, YAML, and CSV, prefer `open`, structured updates, and `save --force` instead of raw text replacement.",
];

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
        const message = formatToolOutput(
          result.stdout,
          result.stderr,
          result.code,
        );

        ctx.ui.notify(
          `Executed: ${command}\n${message}`,
          result.code === 0 ? "info" : "error",
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to execute Nushell history command.";
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
    description:
      "Execute shell commands through Nushell instead of the default bash backend.",
    promptSnippet: "Run Nushell commands in the current working directory",
    promptGuidelines: [
      ...nushellGuidelines,
      ...nushellRipgrepAdvancedGuidelines,
      ...nushellFileReplacementGuidelines,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description:
            "Optional timeout in seconds before the command is aborted",
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
