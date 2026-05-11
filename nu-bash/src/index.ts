import { spawn } from 'node:child_process';
import {
  type BashOperations,
  CustomEditor,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  truncateTail,
} from '@mariozechner/pi-coding-agent';
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from '@mariozechner/pi-tui';
import { Type } from '@sinclair/typebox';

type BashParams = {
  command: string;
  timeout?: number;
};

const NUSHELL_COMMAND = "nu";
const CANCEL_HINT = "Press Escape to cancel.";
const ENV_VARIABLE_NAMES = Object.keys(process.env).sort();

function getEnvSuggestions(prefix: string): AutocompleteItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return ENV_VARIABLE_NAMES.filter((name) =>
    prefix ? name.toLowerCase().startsWith(normalizedPrefix) : true,
  ).map((name) => ({
    value: name,
    label: name,
    description: 'Environment variable',
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
    const currentLine = lines[cursorLine] ?? '';
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    const envPrefix = textBeforeCursor.match(/\$env(?:\.([A-Za-z0-9_]*))?$/);
    if (envPrefix) {
      const propPrefix = envPrefix[1] ?? '';
      const items = getEnvSuggestions(propPrefix);
      if (items.length > 0) {
        return {
          items,
          prefix: propPrefix,
        };
      }
    }

    const variablePrefix = textBeforeCursor.match(/\$[A-Za-z0-9_]*$/);
    if (variablePrefix && '$env'.startsWith(variablePrefix[0])) {
      return {
        items: [
          {
            value: '$env',
            label: '$env',
            description: 'Nushell environment record',
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
    return this.baseProvider.applyCompletion(
      lines,
      cursorLine,
      cursorCol,
      item,
      prefix,
    );
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

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

const nuOperations: BashOperations = {
  exec(command, cwd, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(NUSHELL_COMMAND, getNuArgs(command), {
        cwd,
        detached: process.platform !== 'win32',
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
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

      options.signal?.addEventListener('abort', abortHandler, { once: true });

      child.stdout?.on('data', options.onData);
      child.stderr?.on('data', options.onData);

      child.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        options.signal?.removeEventListener('abort', abortHandler);
        reject(error);
      });

      child.on('close', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        options.signal?.removeEventListener('abort', abortHandler);

        if (options.signal?.aborted) {
          reject(new Error('aborted'));
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
  return ['-c', command];
}

function formatToolOutput(stdout: string, stderr: string, exitCode: number) {
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (output) {
    return output;
  }

  return `(command exited with code ${exitCode})`;
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
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
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
          Buffer.concat(stdoutChunks).toString('utf-8'),
          Buffer.concat(stderrChunks).toString('utf-8'),
          code ?? 0,
        ),
        code,
      );
    };

    const abortHandler = () => {
      killNushellProcessTree(child.pid);
    };

    signal?.addEventListener('abort', abortHandler, { once: true });

    if (onChunk) {
      onChunk(CANCEL_HINT);
    }

    child.stdout?.on('data', (data) => {
      stdoutChunks.push(Buffer.from(data));
      emitUpdate();
    });

    child.stderr?.on('data', (data) => {
      stderrChunks.push(Buffer.from(data));
      emitUpdate();
    });

    child.on('error', (error) => {
      signal?.removeEventListener('abort', abortHandler);
      reject(error);
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', abortHandler);

      const exitCode = code ?? 1;
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      const truncation = truncateTail(output, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });

      emitUpdate(exitCode);

      resolve({
        output: truncation.content || formatToolOutput('', '', exitCode),
        exitCode,
        cancelled: Boolean(signal?.aborted),
        truncated: truncation.truncated,
      });
    });
  });
}

const nuShellUrl = 'https://www.nushell.sh/';
export default function nuBashExtension(pi: ExtensionAPI) {
  pi.on('session_start', (_, _ctx) => {
    _ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new NuEditor(tui, theme, keybindings),
    );
  });

  pi.registerTool({
    name: 'nu',
    label: 'nushell',
    description:
      'Execute shell commands through Nushell instead of the default bash backend.',
    promptSnippet: 'Run Nushell commands in the current working directory',
    promptGuidelines: [
      'Use this tool for shell work. Commands execute through Nushell via `nu -c`, not bash.',
      `You are a Nushell user If you don't know something, resort to ${nuShellUrl}`,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: "Optional timeout in seconds before the command is aborted",
        }),
      ),
    }),
    async execute(_toolCallId, params: BashParams, signal, onUpdate, ctx) {
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
            content: output ? [{ type: 'text', text: output }] : [],
            details: {
              command: params.command,
              backend: 'nu',
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
            type: 'text',
            text: result.output,
          },
        ],
        details: {
          command: params.command,
          backend: 'nu',
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

  pi.on('user_bash', async () => {
    return {
      operations: nuOperations,
    };
  });
}
