import type { FormComponent } from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Input,
  Key,
  matchesKey,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AgentValue } from "./agent-contracts";

export type ValueChoice = { label: string; value: AgentValue | undefined };

/** A directly usable value selector; never asks for a storage type. */
export class AgentChoiceField implements FormComponent {
  private index = 0;
  private focused = false;
  private readonly error = new Text("");
  changed = false;
  constructor(
    readonly name: string,
    private choices: readonly ValueChoice[],
    initial: AgentValue | undefined,
    private theme: Theme,
    private onChange: () => void = () => {},
  ) {
    const index = choices.findIndex((choice) => choice.value === initial);
    if (index >= 0) this.index = index;
  }
  get value(): string {
    return String(this.index);
  }
  readValue() {
    return this.choices[this.index].value;
  }
  reset() {
    this.index = 0;
    this.changed = true;
  }
  capturesInput(data: string) {
    return matchesKey(data, Key.up) || matchesKey(data, Key.down);
  }
  setFocused(value: boolean) {
    this.focused = value;
  }
  setError(messages: string[]) {
    this.error.setText(this.theme.fg("error", messages.join("\n")));
  }
  clearError() {
    this.error.setText("");
  }
  invalidate() {
    this.error.invalidate();
  }
  handleInput(data: string) {
    const direction =
      matchesKey(data, Key.up) || matchesKey(data, Key.left)
        ? -1
        : matchesKey(data, Key.down) ||
            matchesKey(data, Key.right) ||
            matchesKey(data, Key.space)
          ? 1
          : 0;
    if (direction) {
      this.index =
        (this.index + direction + this.choices.length) % this.choices.length;
      this.changed = true;
      this.onChange();
    }
  }
  render(width: number) {
    return [
      ...new Text(
        this.theme.fg(
          "accent",
          `${this.focused ? "›" : " "} ${this.name}: ${this.choices[this.index].label}  (←→/Space)`,
        ),
      ).render(width),
      ...this.error.render(width),
    ];
  }
}

/** Text, number, list and JSON inputs are visible and editable immediately. */
export class AgentInputField implements FormComponent {
  private readonly input = new Input();
  private readonly editor: Editor;
  private readonly error = new Text("");
  private focused = false;
  private readonly initialText: string;
  changed = false;
  constructor(
    readonly name: string,
    private kind: "text" | "number" | "entries" | "json",
    private initial: AgentValue | undefined,
    tui: TUI,
    private theme: Theme,
    private onChange: () => void = () => {},
    private description = "",
  ) {
    this.initialText =
      kind === "json"
        ? initial === undefined || initial === null
          ? ""
          : JSON.stringify(initial, null, 2)
        : kind === "entries"
          ? Array.isArray(initial)
            ? initial.join("\n")
            : typeof initial === "string"
              ? initial
                  .split(",")
                  .map((item) => item.trim())
                  .join("\n")
              : ""
          : typeof initial === "string" || typeof initial === "number"
            ? String(initial)
            : "";
    this.input.setValue(this.initialText);
    this.input.handleInput("\x05");
    this.editor = new Editor(tui, {
      borderColor: (text) => theme.fg("borderAccent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    });
    this.editor.setText(this.initialText);
  }
  private get multiline() {
    return this.kind === "entries" || this.kind === "json";
  }
  get value(): string {
    return this.multiline
      ? this.editor.getExpandedText()
      : this.input.getValue();
  }
  reset() {
    this.input.setValue("");
    this.editor.setText("");
    this.changed = true;
  }
  readValue(): AgentValue | undefined {
    if (!this.changed) return this.initial;
    const text = this.value;
    if (text === "") return undefined;
    if (this.kind === "text") return text;
    if (this.kind === "entries") return text.split(/\r?\n/);
    if (this.kind === "number") {
      const number = Number(text);
      if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(number))
        throw new Error("Enter a safe whole number");
      return number;
    }
    try {
      return JSON.parse(text) as AgentValue;
    } catch (error) {
      throw new Error("Enter valid JSON for these structured settings", {
        cause: error,
      });
    }
  }
  capturesInput(data: string) {
    return (
      this.multiline && (matchesKey(data, Key.up) || matchesKey(data, Key.down))
    );
  }
  setFocused(value: boolean) {
    this.focused = value;
    this.input.focused = value && !this.multiline;
    this.editor.focused = value && this.multiline;
  }
  setError(messages: string[]) {
    this.error.setText(this.theme.fg("error", messages.join("\n")));
  }
  clearError() {
    this.error.setText("");
  }
  invalidate() {
    this.input.invalidate();
    this.editor.invalidate();
    this.error.invalidate();
  }
  handleInput(data: string) {
    const before = this.value;
    if (this.multiline) this.editor.handleInput(data);
    else this.input.handleInput(data);
    if (before !== this.value) {
      this.changed = true;
      this.onChange();
    }
  }
  render(width: number) {
    const label = `${this.focused ? "›" : " "} ${this.name}${this.kind === "entries" ? " (one entry per line)" : this.kind === "json" ? " (JSON)" : ""}`;
    return [
      ...new Text(this.theme.fg("accent", label)).render(width),
      ...new Text(this.theme.fg("dim", this.description)).render(width),
      ...(this.multiline
        ? this.editor.render(width)
        : this.input.render(width)),
      ...this.error.render(width),
    ];
  }
}
