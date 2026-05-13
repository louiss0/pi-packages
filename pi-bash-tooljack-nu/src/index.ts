import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  BashOperations,
  CustomEditor,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionContext,
  formatSize,
  truncateTail,
} from "@mariozechner/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SelectItem,
} from "@mariozechner/pi-tui";
import { Container, SelectList, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const NUSHELL_COMMAND = "nu";
const CANCEL_HINT = "Press Escape to cancel.";
const HISTORY_LIMIT = 15;
const ENV_VARIABLE_NAMES = Object.keys(process.env).sort();

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

    return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    return this.baseProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
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

async function getRecentHistoryCommands(cwd: string) {
  const historyResult = await executeNushellCommand(
    `history | last ${HISTORY_LIMIT}| where command !~ '(?i)pi'  | get command | to json`,
    cwd,
  );

  if (historyResult.exitCode !== 0) {
    throw new Error(historyResult.output || "Failed to read Nushell history.");
  }

  const parsedOutput = JSON.parse(historyResult.output) as unknown;
  if (!Array.isArray(parsedOutput)) {
    return [];
  }

  return parsedOutput.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

async function selectHistoryCommand(ctx: ExtensionContext) {
  const commands = await getRecentHistoryCommands(ctx.cwd);
  if (commands.length === 0) {
    ctx.ui.notify("No Nushell history commands found.", "info");
    return null;
  }

  const items: SelectItem[] = commands
    .map((command, index) => ({
      value: command,
      label: command,
      description: `${index + 1}`,
    }))
    .reverse();

  return ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Recent Nushell History"))));

      const selectList = new SelectList(items, Math.min(items.length, HISTORY_LIMIT), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter execute • esc cancel")));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "70%",
      },
    },
  );
}

function timestampedFileName(baseName: string) {
  const now = new Date();

  const pad = (n: number) => String(n).padStart(2, "0");

  const timestamp =
    `${now.getFullYear()}-` +
    `${pad(now.getMonth() + 1)}-` +
    `${pad(now.getDate())}_` +
    `${pad(now.getHours())}-` +
    `${pad(now.getMinutes())}-` +
    `${pad(now.getSeconds())}`;

  return `${baseName}_${timestamp}.txt`;
}

async function executeNushellCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  onChunk?: (output: string, exitCode?: number) => void,
) {
  return new Promise<{
    output: string;
    exitCode: number;
    cancelled: boolean;
    truncated: boolean;
  }>((resolve, reject) => {
    const child = spawn(NUSHELL_COMMAND, getNuArgs(command), {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const emitUpdate = (code?: number) => {
      if (!onChunk) {
        return;
      }

      onChunk(
        formatToolOutput(
          Buffer.concat(stdoutChunks).toString("utf-8"),
          Buffer.concat(stderrChunks).toString("utf-8"),
          code ?? 0,
        ),
        code,
      );
    };

    const abortHandler = () => {
      killNushellProcessTree(child.pid);
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    if (onChunk) {
      onChunk(CANCEL_HINT);
    }

    child.stdout?.on("data", (data) => {
      stdoutChunks.push(Buffer.from(data));
      emitUpdate();
    });

    child.stderr?.on("data", (data) => {
      stderrChunks.push(Buffer.from(data));
      emitUpdate();
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
      const truncation = truncateTail(output, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });

      emitUpdate(exitCode);

      const fileName = timestampedFileName("nu-tool-output");

      let outputBasedOnTruncation: string;

      if (truncation.truncated) {
        outputBasedOnTruncation = `File written to ${fileName} read that instead!
          Output Lines/Total Lines: ${truncation.outputLines}/${truncation.totalLines}
          Output Bytes/Total Bytes: ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}
          `;
        writeFileSync(fileName, output);
      } else {
        outputBasedOnTruncation = truncation.content;
      }

      resolve({
        output: outputBasedOnTruncation,
        exitCode,
        cancelled: Boolean(signal?.aborted),
        truncated: truncation.truncated,
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

  "Do not rely on Unix-only tools such as grep, sed, awk, find, xargs, tr, or cut unless the task explicitly requires them or the environment is known to provide them.",

  "For command success and failure, prefer Nushell error handling instead of Bash `$?` habits.",

  "Avoid producing commands that depend on shell-specific quoting tricks. Prefer Nushell lists, records, and variables to build arguments safely.",

  "When passing multiple arguments to a command, keep them as separate arguments rather than one joined string whenever possible.",

  "When the agent receives a command as a single string, decide whether it is meant to be executed as text or transformed into data. For data transformation, convert the string using `lines`, `split row`, `split words`, `parse`, or a `from ...` command.",

  "When transforming Bash-like command output, first identify the output shape: newline list, delimiter-separated rows, key-value lines, JSON/YAML/TOML, filesystem paths, or free text.",

  "For newline command output, use: `<command> | lines`.",

  "For comma-separated values, use: `<string> | split row ','` for a list or `<string> | split column ','` for columns.",

  "For whitespace-separated values, use: `<string> | split words`.",

  "For key-value text, prefer `parse` or `split column` followed by `rename` so the result becomes a table with meaningful column names.",

  "For JSON output from tools, request JSON from the tool when possible and pipe to `from json` if Nushell does not parse it automatically.",

  "Prefer `http get` and Nushell-native JSON handling instead of `curl | jq` for simple API reads.",

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
  "Choose ripgrep output mode based on the next Nushell operation. Human-readable output is different from machine-readable output.",

  "Use `rg --json` whenever search results will be filtered, transformed, grouped, ranked, counted, or consumed by additional Nushell commands.",

  "Use plain `rg` output only for direct terminal display intended for humans.",

  "Treat `rg --json` as the canonical structured mode for agents.",

  "Parse `rg --json` output using `from json --objects` because ripgrep emits newline-delimited JSON objects instead of a single JSON array.",

  "Filter ripgrep JSON messages by their `type` field. Common values are `begin`, `match`, `context`, `end`, and `summary`.",

  "Most search workflows should filter to only `match` records after `from json --objects`.",

  "When extracting match text from `rg --json`, use `data.lines.text`.",

  "When extracting file paths from `rg --json`, use `data.path.text`.",

  "When extracting line numbers from `rg --json`, use `data.line_number`.",

  "When extracting exact match spans from `rg --json`, inspect `data.submatches`.",

  "Do not parse standard ripgrep output using fragile string splitting unless the output format is tightly controlled.",

  "Avoid parsing `rg` output with `split column ':'` because file names and matched text may legally contain colons.",

  "Use `rg --files` for fast project file discovery that respects ignore rules.",

  "Convert `rg --files` output into Nushell lists with `lines`.",

  "Use `rg --files-with-matches` when only filenames are needed instead of full search matches.",

  "Use `rg --count` when only per-file match counts are needed.",

  "Use `rg --count-matches` when total individual match counts are needed instead of line counts.",

  "Use `rg -l` or `rg --files-with-matches` for project navigation tasks such as symbol lookup, feature discovery, or implementation tracing.",

  "Prefer `rg -t <type>` over manual extension filtering when ripgrep already supports the desired file type.",

  "Use `rg --type-list` to inspect supported language and file-type mappings before creating custom globs.",

  "Use `-g` globs for search inclusion and exclusion rules that belong directly to ripgrep traversal behavior.",

  "Prefer `-g '*.ts'` or `-g '!dist/**'` over post-filtering file lists when the filtering belongs to filesystem traversal.",

  "Use repeated `-g` flags for layered include and exclude behavior.",

  "Use `rg -uuu` only when intentionally bypassing ignore rules, hidden-file filtering, and binary filtering.",

  "Do not use unrestricted search by default because it can dramatically increase search size and noise.",

  "Use `rg --hidden` when hidden project files such as `.github`, `.env.example`, `.vscode`, or `.config` directories are relevant.",

  "Use `rg --no-ignore` when repository ignore rules are preventing necessary matches.",

  "Use `rg --multiline` only when matches are expected to span lines because multiline search increases memory usage and may reduce performance.",

  "Use `rg --multiline-dotall` when `.` should match newline characters during multiline searches.",

  "Use `--pcre2` only when advanced regex features such as lookbehind or backreferences are required.",

  "Prefer ripgrep's default regex engine for performance unless PCRE2-specific features are necessary.",

  "Use `--fixed-strings` when searching literal text that may contain regex metacharacters.",

  "Use `--smart-case` for user-facing searches where lowercase patterns should become case-insensitive automatically.",

  "Use `--ignore-case` only when unconditional case-insensitive matching is required.",

  "Use `--glob-case-insensitive` when glob matching should ignore filename casing.",

  "Use `rg --sort path` only when deterministic ordering matters more than search speed.",

  "Avoid sorting ripgrep results unless deterministic ordering is required because sorting disables parallel traversal.",

  "Use `rg --stats` during diagnostics or performance analysis workflows.",

  "Use `rg --debug` or `rg --trace` when diagnosing ignored files, glob behavior, or traversal issues.",

  "When piping ripgrep into another streaming command, consider `--line-buffered` for real-time processing workflows.",

  "When searching compressed text assets, use `rg -z` or `rg --search-zip`.",

  "When processing binary-safe pipelines, consider `--null` or `--null-data` for NUL-delimited interoperability.",

  "Do not use ripgrep to parse structured formats such as JSON, YAML, or TOML when Nushell can load them directly using `open` or `from ...` commands.",

  "Prefer Nushell filtering after ripgrep discovery. Let ripgrep discover candidate files and let Nushell transform structured results.",

  "Think of ripgrep as a filesystem-aware search engine and Nushell as the structured data processor that follows it.",
];

const nushellFileReplacementGuidelines = [
  "Do not use programming language runtimes for ordinary file text replacement.",

  "Use Nushell-native replacement as the default: `open --raw file | str replace --all 'old' 'new' | save --force file`.",

  "Do not assume `rg` is installed. Treat `rg` as an optional accelerator for finding candidate files, not as a required replacement tool.",

  "When `rg` is available, use `rg --files-with-matches 'old' | lines` to find files before replacing text.",

  "When `rg` is not available, use Nushell-native discovery such as `glob`, `ls`, `open --raw`, and `str contains` to find candidate files.",

  "Use this Nushell-only candidate search pattern: `glob **/* | where { |f| ($f | path type) == file } | where { |f| open --raw $f | str contains 'old' }`.",

  "Use this Nushell-only replacement pattern: `glob **/* | where { |f| ($f | path type) == file } | where { |f| open --raw $f | str contains 'old' } | each { |f| open --raw $f | str replace --all 'old' 'new' | save --force $f }`.",

  "Prefer filtering candidate files before replacing text so the agent does not rewrite unrelated files.",

  "Avoid replacing text in binary files, dependency directories, generated directories, caches, lock files, and build outputs unless explicitly requested.",

  "Use literal replacement by default. Use regex replacement only when regex behavior is required.",

  "For structured files such as JSON, TOML, YAML, and CSV, prefer `open`, structured updates, and `save --force` instead of raw text replacement.",

  "Only use programming language tooling when the task requires semantic parsing, AST transforms, or language-aware refactoring.",
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
        const message = formatToolOutput(result.stdout, result.stderr, result.code);

        ctx.ui.notify(`Executed: ${command}\n${message}`, result.code === 0 ? "info" : "error");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to execute Nushell history command.";
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
    description: "Execute shell commands through Nushell instead of the default bash backend.",
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
        (output, exitCode) => {
          onUpdate?.({
            content: output ? [{ type: "text", text: output }] : [],
            details: {
              command: params.command,
              backend: "nu",
              cwd: ctx.cwd,
              exitCode,
              streaming: true,
            },
          });
        },
      );

      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
        details: {
          command: params.command,
          backend: "nu",
          cwd: ctx.cwd,
          exitCode: result.exitCode,
          output: result.output,
          killed: result.cancelled,
          truncated: result.truncated,
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
