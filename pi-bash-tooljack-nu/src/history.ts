import type { SelectItem } from "@mariozechner/pi-tui";

export const HISTORY_LIMIT = 100;
const HISTORY_EXCLUSION_PATTERN = "(?i)pi";

export function getHistoryQuery(limit = HISTORY_LIMIT) {
  return `history | where command !~ '${HISTORY_EXCLUSION_PATTERN}' | last ${limit} | get command | to json`;
}

export function parseHistoryCommands(output: string) {
  const parsedOutput = JSON.parse(output) as unknown;
  if (!Array.isArray(parsedOutput)) {
    return [];
  }

  return parsedOutput.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
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

  if (input.length === 1 && !/\p{C}/u.test(input)) {
    return `${currentFilter}${input}`;
  }

  return currentFilter;
}
