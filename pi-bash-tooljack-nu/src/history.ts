import type { Component, SelectItem, TUI } from "@mariozechner/pi-tui";
import { Container, SelectList, Text } from "@mariozechner/pi-tui";

export const HISTORY_LIMIT = 100;
const HISTORY_EXCLUSION_PATTERN = "(?i)pi";
const HIDDEN_INPUT_PATTERN = /\p{C}/u;
const PI_COMMAND_PATTERN = /\bpi\b/i;

interface HistoryPickerTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

interface HistoryPickerConfigOptions {
  items: SelectItem[];
  itemLimit: number;
  theme: HistoryPickerTheme;
}

interface HistoryPickerRequirementOptions {
  tui: TUI;
  done: (value: string | null) => void;
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

export class HistoryPicker implements Component {
  private readonly container = new Container();
  private readonly filterLabel = new Text();
  private readonly selectList: SelectList;
  private filter = "";

  constructor(
    private readonly configOptions: HistoryPickerConfigOptions,
    private readonly requirementOptions: HistoryPickerRequirementOptions,
  ) {
    this.selectList = new SelectList(
      configOptions.items,
      Math.min(configOptions.items.length, configOptions.itemLimit),
      {
        selectedPrefix: (text) => configOptions.theme.fg("accent", text),
        selectedText: (text) => configOptions.theme.fg("accent", text),
        description: (text) => configOptions.theme.fg("muted", text),
        scrollInfo: (text) => configOptions.theme.fg("dim", text),
        noMatch: (text) => configOptions.theme.fg("warning", text),
      },
    );

    this.container.addChild(
      new Text(configOptions.theme.fg("accent", configOptions.theme.bold("Recent Nushell History"))),
    );
    this.container.addChild(this.filterLabel);
    this.container.addChild(this.selectList);
    this.container.addChild(
      new Text(
        configOptions.theme.fg("dim", "type to filter • ↑↓ navigate • enter execute • esc cancel"),
      ),
    );

    this.selectList.onSelect = (item) => requirementOptions.done(item.value);
    this.selectList.onCancel = () => requirementOptions.done(null);
    this.syncFilter();
  }

  render(width: number) {
    return this.container.render(width);
  }

  invalidate() {
    this.container.invalidate();
  }

  handleInput(data: string) {
    const nextFilter = updateHistoryFilter(this.filter, data);
    if (nextFilter !== this.filter) {
      this.filter = nextFilter;
      this.syncFilter();
      this.requirementOptions.tui.requestRender();
      return;
    }

    this.selectList.handleInput(data);
    this.requirementOptions.tui.requestRender();
  }

  private syncFilter() {
    this.selectList.setFilter(this.filter);
    this.filterLabel.setText(
      this.configOptions.theme.fg(
        "muted",
        `Filter: ${this.filter || `(type to narrow the last ${this.configOptions.itemLimit} commands)`}`,
      ),
    );
  }
}
