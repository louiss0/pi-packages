import type { SelectItem, TUI } from "@earendil-works/pi-tui";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Picker } from "@code-fixer-23/pi-form-components";
export const HISTORY_LIMIT = 100;
const HISTORY_EXCLUSION_PATTERN = "(?i)^\\s*pi\\b";
const HIDDEN_INPUT_PATTERN = /\p{C}/u;
const PI_COMMAND_PATTERN = /^\s*pi\b/i;

interface HistoryPickerConfigOptions<T extends string> {
  commands: T[];
  itemLimit: number;
}

export function getHistoryQuery(limit = HISTORY_LIMIT) {
  return `history | where command !~ '${HISTORY_EXCLUSION_PATTERN}' | last ${limit} | get command | to json`;
}

export function shouldIncludeHistoryCommand(command: string) {
  return command.length > 0 && !PI_COMMAND_PATTERN.test(command);
}

export function parseHistoryCommands(output: string) {
  const parsedOutput = JSON.parse(output) as unknown;
  if (!Array.isArray(parsedOutput)) {
    return [];
  }

  return parsedOutput.filter(
    (value): value is string => typeof value === "string" && shouldIncludeHistoryCommand(value),
  );
}

export function buildHistoryItems(commands: string[]): SelectItem[] {
  return commands
    .map((command, index) => ({
      value: command,
      label: command,
      description: `${index + 1}`,
    }))
    .reverse();
}

export function updateHistoryFilter(currentFilter: string, input: string) {
  if (input === "\u0015") {
    return "";
  }

  if (input === "\b" || input === "\u007f") {
    return currentFilter.slice(0, -1);
  }

  if (input.length === 1 && !HIDDEN_INPUT_PATTERN.test(input)) {
    return `${currentFilter}${input}`;
  }

  return currentFilter;
}

export class HistoryPicker<T extends string> extends Picker<T> {
  constructor(
    configOptions: HistoryPickerConfigOptions<T>,
    theme: Theme,
    tui: TUI,
    done: (value: T | null) => void,
  ) {
    super({ title: "Nushell History", ...configOptions }, theme, tui, done);
  }
}
