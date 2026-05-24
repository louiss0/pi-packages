import type { Component, SelectItem, TUI } from "@earendil-works/pi-tui";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder, ThemeColor } from "@earendil-works/pi-coding-agent";

export const HISTORY_LIMIT = 100;
const HISTORY_EXCLUSION_PATTERN = "(?i)^\\s*pi\\b";
const HIDDEN_INPUT_PATTERN = /\p{C}/u;
const PI_COMMAND_PATTERN = /^\s*pi\b/i;

interface HistoryPickerTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
}

interface HistoryPickerConfigOptions {
  commands: string[];
  itemLimit: number;
}

interface HistoryPickerRequirementOptions {
  theme: HistoryPickerTheme;
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
    (value): value is string =>
      typeof value === "string" && shouldIncludeHistoryCommand(value),
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
  readonly #container = new Container();
  readonly #filterLabel = new Text();
  readonly #selectList: SelectList;
  #filter = "";

  #borderColorTheme: Extract<ThemeColor, `border${string}`> = "borderAccent";

  constructor(
    private readonly configOptions: HistoryPickerConfigOptions,
    private readonly requirementOptions: HistoryPickerRequirementOptions,
  ) {
    const items = configOptions.commands
      .map((command, index) => ({
        value: command,
        label: command,
        description: `${index + 1}`,
      }))
      .reverse();

    this.#selectList = new SelectList(
      items,
      Math.min(items.length, configOptions.itemLimit),
      {
        selectedPrefix: (text) => requirementOptions.theme.fg("accent", text),
        selectedText: (text) => requirementOptions.theme.fg("accent", text),
        description: (text) => requirementOptions.theme.fg("muted", text),
        scrollInfo: (text) => requirementOptions.theme.fg("dim", text),
        noMatch: (text) => requirementOptions.theme.fg("warning", text),
      },
    );

    this.#container.addChild(
      new DynamicBorder((text) =>
        requirementOptions.theme.fg(this.#borderColorTheme, text),
      ),
    );

    this.#container.addChild(
      new Text(
        requirementOptions.theme.fg(
          "accent",
          requirementOptions.theme.bold("Recent Nushell History"),
        ),
      ),
    );

    this.#container.addChild(this.#filterLabel);
    this.#container.addChild(this.#selectList);
    this.#container.addChild(
      new Text(
        requirementOptions.theme.fg(
          "dim",
          "type to filter • ↑↓ navigate • enter execute • esc cancel",
        ),
      ),
    );

    this.#container.addChild(
      new DynamicBorder((text) =>
        requirementOptions.theme.fg(this.#borderColorTheme, text),
      ),
    );

    this.#selectList.onSelect = (item) => requirementOptions.done(item.value);
    this.#selectList.onCancel = () => requirementOptions.done(null);
    this.#syncFilter();
  }

  render(width: number) {
    return this.#container.render(width);
  }

  invalidate() {
    this.#container.invalidate();
  }

  handleInput(data: string) {
    const nextFilter = updateHistoryFilter(this.#filter, data);
    if (nextFilter !== this.#filter) {
      this.#filter = nextFilter;
      this.#syncFilter();
      this.requirementOptions.tui.requestRender();
      return;
    }

    this.#selectList.handleInput(data);
    this.requirementOptions.tui.requestRender();
  }

  #syncFilter() {
    this.#selectList.setFilter(this.#filter);
    this.#filterLabel.setText(
      this.requirementOptions.theme.fg(
        "muted",
        `Filter: ${this.#filter || `(type to narrow the last ${this.configOptions.itemLimit} commands)`}`,
      ),
    );
  }
}
