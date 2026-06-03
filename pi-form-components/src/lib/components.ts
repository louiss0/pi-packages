import { DynamicBorder, Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
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
} from "@earendil-works/pi-tui";

type MultiSelectConfig<T extends ReadonlyArray<SelectItem>> = {
  title: string;
  items: T;
  spacing?: number;
  itemChoiceStyle?: ItemChoiceStyle;
  styles?: {
    title?: PickerText;
    item?: Record<"selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch", PickerText>;
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
  implements Component
{
  #items: T;
  // MultiSelect owns checked state here. SelectList is only used to render
  // item rows, so MultiSelect also owns the highlighted index.
  #selectedValues: Array<T[number]["value"]> = [];
  #selectedIndex = 0;
  #selectList: SelectList;
  #tui: TUI;
  #theme: Theme;
  #done: (value: Array<T[number]["value"]> | null) => void;
  #styles: {
    title: PickerText;
    item: Record<"selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch", PickerText>;
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
    config: MultiSelectConfig<T>,
    tui: TUI,
    theme: Theme,
    done: (value: Array<T[number]["value"]> | null) => void,
  ) {
    super();
    this.#items = config.items;
    this.#tui = tui;
    this.#theme = theme;
    this.#done = done;

    const { title, spacing = 1, itemChoiceStyle = "checkbox", styles } = config;

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

    this.addChild(new Text(theme.fg(this.#styles.title, theme.bold(title))));

    const listSpacing = Math.max(0, Math.round(spacing) - 1);
    if (listSpacing > 0) {
      this.addChild(new Spacer(listSpacing));
    }

    this.#selectList = this.#createSelectList();
    this.addChild(this.#selectList);
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
    this.#syncSelectList();
    this.#tui.requestRender();
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
  title: string;
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

export class Picker<T extends string> implements Component {
  readonly #container = new Container();
  readonly #filterLabel = new Text();
  readonly #listContainer = new Container();
  #items: Array<T>;
  #itemLimit: number;
  #lazyLoadStep: number;
  #selectList: SelectList | null = null;
  #selectedValue: T | null = null;
  #styles: NonNullable<PickerOptions<T>["styles"]> & {
    item: Record<
      "selectedPrefix" | "selectedText" | "description" | "scrollInfo" | "noMatch",
      PickerText
    >;
  };
  #visibleCount: number;

  constructor(
    config: PickerOptions<T>,
    private readonly theme: PickerTheme,
    private readonly tui: FormTui,
    private readonly done: (value: T | null) => void,
  ) {
    const { items, itemLimit, lazyLoadStep, title, helpText, styles } = {
      title: config.title,
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

    this.#container.addChild(new DynamicBorder((text) => this.theme.fg(styles.border, text)));

    this.#container.addChild(new Text(this.theme.fg(styles.title, this.theme.bold(title))));

    this.#container.addChild(this.#filterLabel);
    this.#container.addChild(this.#listContainer);
    this.#container.addChild(new Text(this.theme.fg(styles.helpText, helpText)));

    this.#container.addChild(new DynamicBorder((text) => this.theme.fg(styles.border, text)));

    this.#syncSelectList();
    this.#syncFilter();
  }

  render(width: number) {
    return this.#container.render(width);
  }

  invalidate() {
    this.#container.invalidate();
  }

  handleInput(data: string) {
    const nextFilter = this.#Filter.updateFilter(this.#Filter.value, data);
    if (nextFilter !== this.#Filter.value) {
      this.#Filter.value = nextFilter;
      this.#syncSelectList();
      this.#syncFilter();
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

    if (this.#selectedValue !== null) {
      const selectedIndex = items.findIndex((item) => item.value === this.#selectedValue);
      if (selectedIndex >= 0) {
        nextSelectList.setSelectedIndex(selectedIndex);
      }
    }

    if (this.#selectList !== null) {
      this.#listContainer.removeChild(this.#selectList);
    }

    this.#selectList = nextSelectList;
    this.#listContainer.addChild(nextSelectList);
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
    this.#syncSelectList();
    this.#syncFilter();
    this.tui.requestRender();
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

export class LabelledInput extends Container implements Component {
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
  #theme: FormTheme;
  #errorText = new Text("");
  constructor(theme: FormTheme, message: string, name = "confirm") {
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

  override invalidate(): void {
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

    return this.#footer.split(/\r?\n/).map((line) => truncateToWidth(line, width));
  }
}
