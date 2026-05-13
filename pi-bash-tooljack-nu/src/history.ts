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

export class HistoryPicker {
  private readonly container = new Container();
  private readonly filterLabel = new Text();
  private filter = "";

  constructor(
    private readonly items: SelectItem[],
    private readonly itemLimit: number,
  ) {}

  createComponent(tui: TUI, done: (value: string | null) => void, theme: HistoryPickerTheme): Component {
    const selectList = new SelectList(this.items, Math.min(this.items.length, this.itemLimit), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    this.container.addChild(new Text(theme.fg("accent", theme.bold("Recent Nushell History"))));
    this.container.addChild(this.filterLabel);
    this.container.addChild(selectList);
    this.container.addChild(
      new Text(theme.fg("dim", "type to filter • ↑↓ navigate • enter execute • esc cancel")),
    );

    this.syncFilter(selectList, theme);
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    return {
      render: (width) => this.container.render(width),
      invalidate: () => {
        this.container.invalidate();
      },
      handleInput: (data) => {
        const nextFilter = updateHistoryFilter(this.filter, data);
        if (nextFilter !== this.filter) {
          this.filter = nextFilter;
          this.syncFilter(selectList, theme);
          tui.requestRender();
          return;
        }

        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  }

  private syncFilter(selectList: SelectList, theme: HistoryPickerTheme) {
    selectList.setFilter(this.filter);
    this.filterLabel.setText(
      theme.fg(
        "muted",
        `Filter: ${this.filter || `(type to narrow the last ${this.itemLimit} commands)`}`,
      ),
    );
  }
}
