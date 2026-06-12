import {
  DynamicBorder,
  ExtensionCommandContext,
  Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import {
  type Component,
  Container,
  type Focusable,
  Input,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  TUI,
  truncateToWidth,
  KeybindingsManager,
} from "@earendil-works/pi-tui";
import { spawn, spawnSync } from "node:child_process";

export interface FormComponent extends Component {
  setFocused(focused: boolean): void;
  setError(messages: string[]): void;
  clearError(): void;
  handleInput(data: string): void;
  readonly name: string;
  readonly value: string | number | boolean;
}

type EditFileResult = {
  path: string;
  after: string;
  before: string;
  changed: boolean;
  exitCode: number | null;
};

export function createExternalEditor(editorCommand: string, filePath: string) {
  return (
    _t: TUI,
    theme: Theme,
    _ky: KeybindingsManager,
    done: (result: EditFileResult | ExternalEditorError) => void,
  ) => {
    // This function must be called like this for the code to work!
    // The component won't appear
    //! Don't ever try to make this function synchronuous
    (async () => {
      try {
        const parsed = editorCommand.split(" ").filter(Boolean); // filter(Boolean) prevents empty strings

        if (parsed.length === 0) {
          done(new ExternalEditorError(`Invalid editor command: ${editorCommand}`));
          return;
        }

        const before = await fs.readFile(filePath, "utf8");
        const [editor, ...editorArgs] = parsed;

        const FLAGS = ["--wait", "-w"];

        const { stdout: helpOutput } = spawnSync(editor, ["--help"], {
          shell: true,
        });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          const args = [...editorArgs, filePath];

          const waitFlag = FLAGS.find((flag) => helpOutput.includes(flag));

          if (waitFlag && !args.some((arg) => FLAGS.includes(arg))) {
            args.push(waitFlag);
          }

          const child = spawn(editor, args, {
            stdio: "inherit",
            shell: true,
          });

          child.on("error", (error) => reject(new Error("Spawn error", { cause: error })));
          child.on("close", (code) => resolve(code));
        });

        const after = await fs.readFile(filePath, "utf8");

        done({
          path: filePath,
          before,
          after,
          changed: before !== after,
          exitCode,
        });
      } catch (error) {
        done(new ExternalEditorError("Spawn error", error));
      }
    })();

    return new ExternalEditorPopUp(editorCommand, filePath, theme);
  };
}
class ExternalEditorError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ExternalEditorError";
  }
}

class ExternalEditorPopUp extends Container {
  #editorCommand: string;
  constructor(editorCommand: string, filePath: string, theme: Theme) {
    super();

    this.#editorCommand = editorCommand;
    this.addChild(
      new Text(
        [
          theme.bold(`Editing file: ${filePath}`),
          `Editor: ${this.#editorCommand}`,
          theme.fg("warning", "Close the editor to return to Pi."),
        ].join("\n"),
        2,
        2,
      ),
    );
  }
}

export type MultiSelectConfig<T extends ReadonlyArray<SelectItem>> = {
  title?: string;
  items: T;
  spacing?: number;
  itemChoiceStyle?: ItemChoiceStyle;
  styles?: {
    title?: PickerText;
    item?: Record<
      "selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch",
      PickerText
    >;
  };
};
export const itemChoiceStyle = ["checkbox", "radio", "dot", "diamond"] as const;

type ItemChoiceStyle = (typeof itemChoiceStyle)[number];

type ItemStyle = {
  selected: string;
  unselected: string;
};

export class MultiSelect<const T extends ReadonlyArray<SelectItem>>
  extends Container
  implements FormComponent
{
  #items: T;
  #name: string;
  // MultiSelect owns checked state here. SelectList is only used to render
  // item rows, so MultiSelect also owns the highlighted index.
  #selectedValues: Array<T[number]["value"]> = [];
  #selectedIndex = 0;
  #selectList: SelectList;
  #tui: TUI;
  #theme: Theme;
  #done: (value: Array<T[number]["value"]> | null) => void;
  #labelText: Text;
  #errorText = new Text("");
  #styles: {
    title: PickerText;
    item: Record<
      "selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch",
      PickerText
    >;
  };

  readonly itemChoiceStyleRecord = Object.freeze({
    checkbox: {
      selected: "[x]",
      unselected: "[ ]",
    },
    radio: {
      selected: "(*)",
      unselected: "( )",
    },
    dot: {
      selected: "●",
      unselected: "○",
    },
    diamond: {
      selected: "◆",
      unselected: "◇",
    },
  } satisfies Record<ItemChoiceStyle, ItemStyle>);

  #itemStyle: ItemStyle;

  constructor(
    name: string,
    config: MultiSelectConfig<T>,
    tui: TUI,
    theme: Theme,
    done: (value: Array<T[number]["value"]> | null) => void,
  ) {
    super();
    this.#name = name;
    this.#items = config.items;
    this.#tui = tui;
    this.#theme = theme;
    this.#done = done;
    this.#labelText = new Text(name);

    const { title = name, spacing = 1, itemChoiceStyle = "checkbox", styles } = config;

    this.#itemStyle = this.itemChoiceStyleRecord[itemChoiceStyle];
    this.#styles = {
      title: styles?.title ?? "accent",
      item: {
        selectedPrefix: styles?.item?.selectedPrefix ?? "accent",
        selectedText: styles?.item?.selectedText ?? "accent",
        description: styles?.item?.description ?? "muted",
        scrollInfo: styles?.item?.scrollInfo ?? "dim",
        noMatch: styles?.item?.noMatch ?? "warning",
      },
    };

    this.addChild(this.#labelText);

    if (title !== name) {
      this.addChild(new Text(theme.fg(this.#styles.title, theme.bold(title))));
    }

    const listSpacing = Math.max(0, Math.round(spacing));
    if (listSpacing > 0) {
      this.addChild(new Spacer(listSpacing));
    }

    this.#selectList = this.#createSelectList();
    this.addChild(this.#selectList);
    this.addChild(this.#errorText);
    this.addChild(new Spacer(1));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.space)) {
      this.#toggleSelectedItem();
      this.#tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.#moveSelection(-1);
      this.#tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.#moveSelection(1);
      this.#tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.#done(null);
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.#done(this.#selectedValues);
      return;
    }
  }

  override invalidate(): void {
    this.#selectedValues = [];
    this.#selectedIndex = 0;
    this.#labelText.invalidate();
    this.#errorText.invalidate();
    this.#syncSelectList();
    this.#tui.requestRender();
  }

  setError(messages: string[]) {
    this.#errorText.setText(
      messages.map((message) => this.#theme.fg("error", message)).join("\n"),
    );
  }

  clearError() {
    this.#errorText.setText("");
  }

  setFocused(focused: boolean) {
    const prefix = focused ? "› " : "  ";
    this.#labelText.setText(this.#theme.fg("accent", `${prefix}${this.#name}`));
  }

  get name() {
    return this.#name;
  }

  get value() {
    return this.#selectedValues.join(",");
  }

  #createSelectList() {
    const selectList = new SelectList(this.#getRenderedItems(), this.#items.length, {
      selectedPrefix: (text) => this.#theme.fg(this.#styles.item.selectedPrefix, text),
      selectedText: (text) => this.#theme.fg(this.#styles.item.selectedText, text),
      description: (text) => this.#theme.fg(this.#styles.item.description, text),
      scrollInfo: (text) => this.#theme.fg(this.#styles.item.scrollInfo, text),
      noMatch: (text) => this.#theme.fg(this.#styles.item.noMatch, text),
    });

    selectList.onCancel = () => this.#done(null);

    return selectList;
  }

  #getRenderedItems(): SelectItem[] {
    return this.#items.map((item) => ({
      ...item,
      label: `${this.#getChoicePrefix(item.value as T[number]["value"])} ${item.label || item.value}`,
    }));
  }

  #getChoicePrefix(value: T[number]["value"]) {
    return this.#selectedValues.includes(value)
      ? this.#itemStyle.selected
      : this.#itemStyle.unselected;
  }

  #toggleSelectedItem() {
    const selectedItem = this.#selectList.getSelectedItem();
    if (selectedItem === null) {
      return;
    }

    const toggledValue = selectedItem.value as T[number]["value"];
    this.#selectedValues = this.#getNextSelectedValues(toggledValue);
    this.#syncSelectList();
  }

  #getNextSelectedValues(toggledValue: T[number]["value"]) {
    const selectedIndex = this.#selectedValues.indexOf(toggledValue);
    if (selectedIndex >= 0) {
      return this.#selectedValues.filter((value) => value !== toggledValue);
    }

    return [...this.#selectedValues, toggledValue];
  }

  #moveSelection(direction: 1 | -1) {
    if (this.#items.length === 0) {
      return;
    }

    this.#selectedIndex =
      (this.#selectedIndex + direction + this.#items.length) % this.#items.length;
    this.#syncSelectList();
  }

  #syncSelectList() {
    const nextSelectList = this.#createSelectList();
    nextSelectList.setSelectedIndex(this.#selectedIndex);

    this.removeChild(this.#selectList);
    this.#selectList = nextSelectList;
    this.addChild(this.#selectList);
  }
}

export type PickerText = Exclude<
  ThemeColor,
  `b${string}` | `t${string}` | `c${string}` | `md${string}` | `u${string}` | `sy${string}`
>;

export interface PickerTheme {
  bold(text: string): string;
  fg(color: ThemeColor, text: string): string;
}

export interface FormTheme {
  fg(color: ThemeColor, text: string): string;
}

export interface FormTui {
  requestRender(): void;
}

type PickerOptions<T extends string> = {
  items: Array<T>;
  itemLimit: number;
  title?: string;
  helpText?: string;
  lazyLoadStep?: number;
  styles?: {
    title?: PickerText;
    helpText?: PickerText;
    item?: Record<
      "selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch",
      PickerText
    >;
    border?: Extract<ThemeColor, `border${string}`>;
  };
};

export class Picker<T extends string> implements FormComponent {
  readonly #container = new Container();
  readonly #filterLabel = new Text();
  readonly #listContainer = new Container();
  readonly #labelText: Text;
  readonly #errorText = new Text("");
  #items: Array<T>;
  #itemLimit: number;
  #lazyLoadStep: number;
  #selectList: SelectList | null = null;
  #selectedIndex = 0;
  #selectedValue: T | null = null;
  #name: string;
  #styles: NonNullable<PickerOptions<T>["styles"]> & {
    item: Record<
      "selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch",
      PickerText
    >;
  };
  #visibleCount: number;

  constructor(
    name: string,
    config: PickerOptions<T>,
    private readonly theme: PickerTheme,
    private readonly tui: FormTui,
    private readonly done: (value: T | null) => void,
  ) {
    this.#name = name;
    this.#labelText = new Text(name);

    const { items, itemLimit, lazyLoadStep, title, helpText, styles } = {
      title: config.title ?? name,
      items: config.items,
      itemLimit: config.itemLimit,
      lazyLoadStep: config.lazyLoadStep ?? config.itemLimit,
      helpText: config.helpText ?? "type to filter • ↑↓ navigate • enter execute • esc cancel",
      styles: {
        helpText: config.styles?.helpText ?? "accent",
        border: config.styles?.border ?? "borderAccent",
        title: config.styles?.title ?? "accent",
        item: {
          selectedPrefix: config.styles?.item?.selectedPrefix ?? "accent",
          selectedText: config.styles?.item?.selectedText ?? "accent",
          description: config.styles?.item?.description ?? "muted",
          scrollInfo: config.styles?.item?.scrollInfo ?? "dim",
          noMatch: config.styles?.item?.noMatch ?? "warning",
        },
      },
    } satisfies PickerOptions<T>;

    this.#items = items;
    this.#itemLimit = itemLimit;
    this.#lazyLoadStep = lazyLoadStep;
    this.#styles = styles;
    this.#visibleCount = Math.min(items.length, itemLimit);

    this.#container.addChild(this.#labelText);
    this.#container.addChild(new DynamicBorder((text) => this.theme.fg(styles.border, text)));

    if (title !== name) {
      this.#container.addChild(new Text(this.theme.fg(styles.title, this.theme.bold(title))));
    }

    this.#container.addChild(this.#filterLabel);
    this.#container.addChild(this.#listContainer);
    this.#container.addChild(new Text(this.theme.fg(styles.helpText, helpText)));

    this.#container.addChild(new DynamicBorder((text) => this.theme.fg(styles.border, text)));
    this.#container.addChild(this.#errorText);
    this.#container.addChild(new Spacer(1));

    this.#syncSelectList();
    this.#syncFilter();
  }

  render(width: number) {
    return this.#container.render(width);
  }

  invalidate() {
    this.#labelText.invalidate();
    this.#errorText.invalidate();
    this.#container.invalidate();
  }

  setError(messages: string[]) {
    this.#errorText.setText(
      messages.map((message) => this.theme.fg("error", message)).join("\n"),
    );
  }

  clearError() {
    this.#errorText.setText("");
  }

  setFocused(focused: boolean) {
    const prefix = focused ? "› " : "  ";
    this.#labelText.setText(this.theme.fg("accent", `${prefix}${this.#name}`));
  }

  get name() {
    return this.#name;
  }

  get value() {
    return this.#selectedValue ?? "";
  }

  handleInput(data: string) {
    const nextFilter = this.#Filter.updateFilter(this.#Filter.value, data);
    if (nextFilter !== this.#Filter.value) {
      this.#Filter.value = nextFilter;
      this.#selectedIndex = 0;
      this.#selectedValue = null;
      this.#syncSelectList();
      this.#syncFilter();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.#moveSelection(-1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.#moveSelection(1);
      this.tui.requestRender();
      return;
    }

    this.#selectList?.handleInput(data);
    this.tui.requestRender();
  }

  #syncFilter() {
    const loadedItemCount = this.#getVisibleItems().length;
    const helperText = this.#Filter.value
      ? this.#Filter.value
      : `(type to narrow ${loadedItemCount} loaded item${loadedItemCount === 1 ? "" : "s"})`;

    this.#filterLabel.setText(this.theme.fg("muted", `Filter: ${helperText}`));
  }

  #createItems(items: Array<T>): SelectItem[] {
    return items.map((command, index) => ({
      value: command,
      label: command,
      description: `${index + 1}`,
    }));
  }

  #createSelectList(items: SelectItem[]) {
    const selectList = new SelectList(items, Math.min(items.length, this.#itemLimit), {
      selectedPrefix: (text) => this.theme.fg(this.#styles.item.selectedPrefix, text),
      selectedText: (text) => this.theme.fg(this.#styles.item.selectedText, text),
      description: (text) => this.theme.fg(this.#styles.item.description, text),
      scrollInfo: (text) => this.theme.fg(this.#styles.item.scrollInfo, text),
      noMatch: (text) => this.theme.fg(this.#styles.item.noMatch, text),
    });

    selectList.onSelect = (item) => this.done(item.value as T);
    selectList.onCancel = () => this.done(null);
    selectList.onSelectionChange = (item) => {
      this.#selectedValue = item.value as T;
      this.#maybeLoadMore(item.value as T);
    };

    return selectList;
  }

  #getVisibleItems() {
    if (this.#Filter.value.length > 0) {
      return this.#items;
    }

    return this.#items.slice(0, this.#visibleCount);
  }

  #syncSelectList() {
    const items = this.#createItems(this.#getVisibleItems());
    const nextSelectList = this.#createSelectList(items);

    nextSelectList.setFilter(this.#Filter.value);
    nextSelectList.setSelectedIndex(this.#selectedIndex);

    const selectedItem = nextSelectList.getSelectedItem();
    this.#selectedValue = (selectedItem?.value as T | undefined) ?? null;

    if (this.#selectList !== null) {
      this.#listContainer.removeChild(this.#selectList);
    }

    this.#selectList = nextSelectList;
    this.#listContainer.addChild(nextSelectList);
  }

  #moveSelection(direction: -1 | 1) {
    const visibleItems = this.#getVisibleItems();

    if (visibleItems.length === 0) {
      return;
    }

    this.#selectedIndex =
      (this.#selectedIndex + direction + visibleItems.length) % visibleItems.length;
    this.#selectedValue = visibleItems[this.#selectedIndex] ?? null;
    this.#maybeLoadMore(this.#selectedValue as T);
    this.#syncSelectList();
  }

  #maybeLoadMore(selectedValue: T) {
    if (this.#Filter.value.length > 0 || this.#visibleCount >= this.#items.length) {
      return;
    }

    const visibleItems = this.#getVisibleItems();
    const lastVisibleItem = visibleItems.at(-1);
    if (lastVisibleItem !== selectedValue) {
      return;
    }

    this.#visibleCount = Math.min(this.#items.length, this.#visibleCount + this.#lazyLoadStep);
    this.#syncFilter();
  }

  #Filter = new (class {
    value = "";
    #HIDDEN_INPUT_PATTERN = /\p{C}/u;
    updateFilter(currentFilter: string, input: string) {
      if (input === "\u0015") {
        return "";
      }

      if (input === "\b" || input === "\u007f") {
        return currentFilter.slice(0, -1);
      }

      if (input.length === 1 && !this.#HIDDEN_INPUT_PATTERN.test(input)) {
        return `${currentFilter}${input}`;
      }

      return currentFilter;
    }
  })();
}

export class LabelledInput extends Container implements FormComponent {
  #name: string;
  #errorText = new Text("");
  #input = new Input();
  #labelText: Text;
  #theme: FormTheme;

  constructor(name: string, theme: FormTheme, initialValue = "") {
    super();
    this.#name = name;
    this.#labelText = new Text(name);
    this.#input.setValue(initialValue);
    this.addChild(this.#labelText);
    this.addChild(this.#input);
    this.addChild(this.#errorText);
    this.addChild(new Spacer(1));
    this.#theme = theme;
  }

  override invalidate(): void {
    this.#labelText.invalidate();
    this.#input.invalidate();
    this.#errorText.invalidate();
  }

  setError(messages: string[]) {
    this.#errorText.setText(
      messages.map((message) => this.#theme.fg("error", message)).join("\n"),
    );
  }

  clearError() {
    this.#errorText.setText("");
  }

  setFocused(focused: boolean) {
    this.#input.focused = focused;
    this.setLabelTextPrefix(focused ? "› " : "  ");
  }

  setLabelTextPrefix(prefix: string) {
    this.#labelText.setText(this.#theme.fg("accent", `${prefix}${this.#name}`));
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

export class ConfirmationBox extends Container implements FormComponent {
  #value = false;
  #focused = false;
  #name: string;
  #message: string;
  #theme: FormTheme;
  #errorText = new Text("");
  constructor(name: string, theme: FormTheme, message: string) {
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

  setError(messages: string[]) {
    this.#errorText.setText(
      messages.map((message) => this.#theme.fg("error", message)).join("\n"),
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

  override invalidate(): void {
    this.#errorText.invalidate();
  }
}

export type FormField = FormComponent;

export type Parse<T extends Record<string, string | number | boolean>> = (value: T) =>
  | {
      [key in keyof T]?: string[];
    }
  | undefined;

export interface FormOptions<T extends Record<string, string | number | boolean>> {
  title: string;
  fields: FormField[];
  parse: Parse<T>;
  footer?: string;
  spacing?: number;
}

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
    options: FormOptions<T>,
    private tui: FormTui,
    private done: (value: T | null) => void,
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
      const isFocused = this.#focused && index === this.#activeFieldIndex;

      field.setFocused(isFocused);
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

    return this.#footer.split(/\r?\n/).map((line) => truncateToWidth(line, width));
  }
}
