import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Container,
  type Focusable,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
} from "@mariozechner/pi-tui";

export class LabelledInput extends Container implements Component {
  #name: string;
  #errorText = new Text("");
  #input = new Input();
  #labelText: Text;
  #theme: Theme;

  invalidate(): void {
    this.#labelText.invalidate();
    this.#input.invalidate();
    this.#errorText.invalidate();
  }

  constructor(name: string, theme: Theme) {
    super();
    this.#name = name;
    this.#labelText = new Text(name);
    this.addChild(this.#labelText);
    this.addChild(this.#input);
    this.addChild(this.#errorText);
    this.addChild(new Spacer(1));
    this.#theme = theme;
  }

  setError(...messages: string[]) {
    this.#errorText.setText(
      messages.map((message) => this.#theme.fg("error", message)).join("\n"),
    );
  }

  clearError() {
    this.#errorText.setText("");
  }

  setFocused(focused: boolean) {
    this.#input.focused = focused;
  }

  setLabelTextPrefix(prefix: string) {
    this.#labelText.setText(this.#theme.fg("accent", `${prefix}${this.#name}`));
  }

  setSelected(selected: boolean) {
    this.setLabelTextPrefix(selected ? "› " : "  ");
  }

  get name() {
    return this.#name;
  }

  get value() {
    return this.#input.getValue();
  }

  handleInput(value: string) {
    this.#input.handleInput(value);
  }
}

export class ConfirmationBox extends Container implements Component {
  #value = false;
  #focused = false;
  #name: string;
  #message: string;
  #theme: Theme;
  #errorText = new Text("");
  constructor(theme: Theme, message: string, name = "confirm") {
    super();
    this.#name = name;
    this.#message = message;
    this.#theme = theme;
    this.addChild(this.#errorText);
  }

  get value() {
    return this.#value;
  }

  setFocused(focused: boolean) {
    this.#focused = focused;
  }

  get name() {
    return this.#name;
  }

  setError(...error: string[]) {
    this.#errorText.setText(
      error.map((message) => this.#theme.fg("error", message)).join("\n"),
    );
  }

  clearError() {
    this.#errorText.setText("");
  }

  confirm() {
    if (this.#value) {
      return;
    }

    this.#value = true;
  }

  toggle() {
    this.#value = !this.#value;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.space)) {
      this.toggle();
    }
  }

  override render(width: number): string[] {
    const prefix = this.#focused ? "> " : "  ";
    const box = this.#theme.fg("accent", ` ${this.#value ? "[x]" : "[ ]"}`);
    const lines = [truncateToWidth(`${prefix}${box} ${this.#message}`, width)];
    const errorLines = this.#errorText.render(width).filter((line) => line.length > 0);

    return [...lines, ...errorLines];
  }

  invalidate(): void {
    this.#errorText.invalidate();
  }
}

export type FormField = Component & {
  setFocused(focused: boolean): void;
  setError(error: string): void;
  clearError(): void;
  setSelected?(selected: boolean): void;
  handleInput(data: string): void;
  name: string;
  value: string | number | boolean;
};

export type Parse<T extends Record<string, string | number | boolean>> = (value: T) =>
  | {
      [key in keyof T]?: string;
    }
  | undefined;

type FormOptions<T extends Record<string, string | number | boolean>> = {
  title: string;
  fields: FormField[];
  parse: Parse<T>;
  footer?: string;
  spacing?: number;
};

export class Form<T extends Record<string, string | number | boolean>>
  extends Container
  implements Focusable
{
  #activeFieldIndex = 0;
  #focused = false;
  #hasValidationErrors = false;
  #fields: FormField[];
  #spacing: number;
  #title: string;
  #footer: string;
  #parse: Parse<T>;

  constructor(
    private tui: TUI,
    private done: (value: T | null) => void,
    options: FormOptions<T>,
  ) {
    super();

    this.#title = options.title;
    this.#footer = options.footer ?? "";
    this.#parse = options.parse;

    this.#fields = options.fields;
    this.#spacing = options.spacing ?? 2;
    const children: Component[] = this.#fields;

    children.forEach((child, index) => {
      this.addChild(child);

      if (index < children.length - 1) {
        this.addChild(new Spacer(this.#spacing));
      }
    });
  }

  get focused() {
    return this.#focused;
  }

  set focused(value: boolean) {
    this.#focused = value;
    this.#syncFieldFocus();
  }

  override render(width: number): string[] {
    const lines = [this.#centerLine(this.#title, width)];
    const fieldLines = super.render(width);

    if (fieldLines.length > 0) {
      lines.push(...this.#spacingLines(), ...fieldLines);
    }

    const footerLines = this.#renderFooterLines(width);

    if (footerLines.length > 0) {
      lines.push(...this.#spacingLines(), ...footerLines);
    }

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) {
      this.#moveFocus(1);
      return;
    }

    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) {
      this.#moveFocus(-1);
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.#fields.length === 0 || this.#activeFieldIndex === this.#fields.length - 1) {
        this.#submit();
        return;
      }

      this.#moveFocus(1);
      return;
    }

    this.#fields[this.#activeFieldIndex]?.handleInput(data);
    this.#revalidateFields();
    this.tui.requestRender();
  }

  #moveFocus(direction: 1 | -1) {
    if (this.#fields.length === 0) {
      this.tui.requestRender();
      return;
    }

    this.#activeFieldIndex =
      (this.#activeFieldIndex + direction + this.#fields.length) % this.#fields.length;
    this.#syncFieldFocus();
    this.tui.requestRender();
  }

  #syncFieldFocus() {
    this.#fields.forEach((field, index) => {
      const isSelected = this.#focused && index === this.#activeFieldIndex;

      field.setFocused(isSelected);
      field.setSelected?.(isSelected);
    });
  }

  #submit() {
    const fields = this.#getValues();
    const parsed = this.#parse(fields);

    if (parsed !== undefined) {
      this.#hasValidationErrors = true;
      this.#syncFieldErrors(parsed);
      this.tui.requestRender();
      return;
    }

    this.#hasValidationErrors = false;
    this.#syncFieldErrors(undefined);
    this.done(fields);
  }

  #revalidateFields() {
    if (!this.#hasValidationErrors) {
      return;
    }

    const parsed = this.#parse(this.#getValues());

    if (parsed === undefined) {
      this.#hasValidationErrors = false;
      this.#syncFieldErrors(undefined);
      return;
    }

    this.#syncFieldErrors(parsed);
  }

  #syncFieldErrors(parsed: ReturnType<Parse<T>> | undefined) {
    this.#fields.forEach((field) => {
      const error = parsed?.[field.name];

      if (error !== undefined) {
        field.setError(error);
        return;
      }

      field.clearError();
    });
  }

  #getValues() {
    const values = this.#fields.reduce((acc, field) => {
      return acc.set(field.name, field.value);
    }, new Map<string, string | number | boolean>());

    return Object.fromEntries(values.entries()) as T;
  }

  #centerLine(text: string, width: number) {
    if (text.length >= width) {
      return truncateToWidth(text, width);
    }

    const leftPaddingWidth = Math.floor((width - text.length) / 2);
    const rightPaddingWidth = width - text.length - leftPaddingWidth;
    return `${" ".repeat(leftPaddingWidth)}${text}${" ".repeat(rightPaddingWidth)}`;
  }

  #spacingLines() {
    return Array.from({ length: this.#spacing }, () => "");
  }

  #renderFooterLines(width: number) {
    if (this.#footer.length === 0) {
      return [];
    }

    return this.#footer
      .split(/\r?\n/)
      .map((line) => truncateToWidth(line, width));
  }
}
