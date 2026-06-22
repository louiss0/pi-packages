import { Picker } from "@code-fixer-23/pi-form-components";

const HISTORY_LIMIT = 100;
const HISTORY_EXCLUSION_PATTERN = "(?i)^\\s*pi\\b";
const PI_COMMAND_PATTERN = /^\s*pi\b/i;

interface HistoryPickerConfigOptions<T extends string> {
  items: T[];
  itemLimit: number;
}

type PickerTheme = ConstructorParameters<typeof Picker<string>>[2];
type PickerTui = ConstructorParameters<typeof Picker<string>>[3];

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

export function getRecentFirstHistoryItems<T extends string>(items: T[]) {
  return [...items].reverse();
}

export class HistoryPicker<T extends string> extends Picker<T> {
  constructor(
    configOptions: HistoryPickerConfigOptions<T>,
    theme: PickerTheme,
    tui: PickerTui,
    done: (value: T | null) => void,
  ) {
    super("history", { title: "Nushell History", ...configOptions }, theme, tui, done);
  }
}
