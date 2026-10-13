import { Form, type FormComponent } from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  Editor,
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  Text,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  renderAgentMarkdown,
  validateAgentFrontmatter,
  type AgentFieldDefinition,
  type AgentFrontmatter,
  type AgentRuntime,
  type AgentValue,
} from "./agent-contracts";

type FieldMode = {
  label: string;
  value?: AgentValue;
  editor?: "text" | "number" | "entries" | "settings";
};
const DEFAULT: FieldMode = { label: "Use runtime default" };

function modesFor(field: AgentFieldDefinition): FieldMode[] {
  const modes: FieldMode[] = [DEFAULT];
  // These are behavior choices, not questions about YAML storage types.
  if (field.choices && field.kinds.includes("string")) {
    modes.push(...field.choices.map((value) => ({ label: value, value })));
  } else if (field.kinds.includes("string") && !field.kinds.includes("list")) {
    modes.push({ label: "Custom value", editor: "text" });
  }
  if (field.kinds.includes("integer"))
    modes.push({ label: "Set limit", editor: "number" });
  if (field.kinds.includes("list"))
    modes.push({ label: "Specific entries", editor: "entries" });
  if (field.kinds.includes("map"))
    modes.push({ label: "Custom settings", editor: "settings" });
  if (field.kinds.includes("boolean")) {
    // Boolean alternatives to text/settings are runtime shorthands. Most only
    // accept false; the inheritance fields also support true.
    if (field.kinds.every((kind) => kind === "boolean" || kind === "null")) {
      modes.push(
        { label: "Enabled", value: true },
        { label: "Disabled", value: false },
      );
    } else {
      if (
        [
          "extensions",
          "inherit_extensions",
          "skills",
          "inherit_skills",
          "allowed_subagents",
        ].includes(field.key)
      ) {
        modes.push({ label: "Inherit all", value: true });
      }
      modes.push({ label: "Disabled", value: false });
    }
  }
  if (field.kinds.includes("null"))
    modes.push({ label: "Clear value", value: null });
  return modes;
}

function isMapping(value: AgentValue | undefined): value is AgentFrontmatter {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** An optional, schema-directed field embedded inside a section Form. */
class AdvancedField implements FormComponent {
  readonly name: string;
  private readonly modes: FieldMode[];
  private modeIndex = 0;
  private focused = false;
  private readonly input = new Input();
  private readonly editor: Editor;
  private readonly children: AdvancedField[];
  private childIndex = 0;
  private editingChildren = false;
  private choiceIndex = 0;
  private readonly selectedChoices = new Set<string>();
  private readonly initialText: string;
  private readonly error = new Text("");

  constructor(
    private readonly definition: AgentFieldDefinition,
    private readonly initial: AgentValue | undefined,
    tui: TUI,
    private readonly theme: Theme,
  ) {
    this.name = definition.key;
    this.modes = modesFor(definition);
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
    this.children = (definition.children ?? []).map(
      (child) =>
        new AdvancedField(
          child,
          isMapping(initial) ? initial[child.key] : undefined,
          tui,
          theme,
        ),
    );
    if (initial !== undefined) {
      const index = this.modes.findIndex(
        (mode) => !mode.editor && mode !== DEFAULT && mode.value === initial,
      );
      this.modeIndex =
        index >= 0
          ? index
          : this.modes.findIndex((mode) => {
              if (isMapping(initial)) return mode.editor === "settings";
              if (Array.isArray(initial)) return mode.editor === "entries";
              if (typeof initial === "number") return mode.editor === "number";
              if (typeof initial === "string")
                return (
                  mode.editor ===
                  (definition.kinds.includes("list") ? "entries" : "text")
                );
              return false;
            });
      if (this.modeIndex < 0) this.modeIndex = 0;
    }
    const entries = Array.isArray(initial)
      ? initial
      : typeof initial === "string" && definition.kinds.includes("list")
        ? initial
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    this.initialText =
      definition.children && definition.kinds.includes("list")
        ? JSON.stringify(entries, null, 2)
        : definition.kinds.includes("list")
          ? entries.join("\n")
          : isMapping(initial)
            ? JSON.stringify(initial, null, 2)
            : "{}";
    this.editor.setText(this.initialText);
    this.input.setValue(
      typeof initial === "string" || typeof initial === "number"
        ? String(initial)
        : "",
    );
    entries.forEach((value) => {
      if (typeof value === "string") this.selectedChoices.add(value);
    });
  }

  private get mode() {
    return this.modes[this.modeIndex];
  }
  private get choiceList(): readonly string[] | undefined {
    // A mixed scalar/list field may have choices only for the scalar shorthand
    // (toolBudget.block's "*"), not for its freely named list entries.
    return !this.definition.kinds.includes("string") &&
      !this.definition.children
      ? this.definition.choices
      : undefined;
  }
  handleVerticalInput(data: string): boolean {
    if (!this.focused) return false;
    if (this.editingChildren)
      return this.children[this.childIndex].handleVerticalInput(data);
    const multiline =
      (this.mode.editor === "entries" && !this.choiceList) ||
      (this.mode.editor === "settings" &&
        (!this.children.length || this.definition.openMap));
    if (!multiline) return false;
    this.editor.handleInput(data);
    return true;
  }
  // Form values are transport strings; decoding happens during form validation.
  // This getter must never throw, including while JSON/numbers are incomplete.
  get value(): string {
    return JSON.stringify({
      behavior: this.modeIndex,
      input: this.input.getValue(),
      entries: this.editor.getExpandedText(),
      choices: [...this.selectedChoices],
      settings: this.children.map((child) => child.value),
    });
  }

  readValue(): AgentValue | undefined {
    const mode = this.mode;
    if (!mode.editor) return mode.value;
    if (mode.editor === "text") return this.input.getValue();
    if (mode.editor === "number") {
      const text = this.input.getValue();
      const value = Number(text);
      if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(value))
        throw new Error("Enter a safe whole number");
      return value;
    }
    if (
      mode.editor === "settings" &&
      this.children.length &&
      !this.definition.openMap
    ) {
      return Object.fromEntries(
        this.children.flatMap((child) => {
          try {
            const value = child.readValue();
            return value === undefined ? [] : [[child.name, value]];
          } catch (error) {
            throw new Error(
              `${child.name}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }),
      );
    }
    if (mode.editor === "entries" && this.choiceList) {
      return [...this.selectedChoices];
    }
    const text = this.editor.getExpandedText();
    // Do not rewrite existing CSV/list/structured representations on a no-op.
    if (
      text === this.initialText &&
      this.initial !== undefined &&
      (mode.editor === "entries"
        ? typeof this.initial === "string" || Array.isArray(this.initial)
        : isMapping(this.initial))
    ) {
      return structuredClone(this.initial);
    }
    if (mode.editor === "entries" && !this.definition.children)
      return text === "" ? [] : text.split(/\r?\n/);
    let value: AgentValue;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error("Enter valid JSON for these structured settings", {
        cause: error,
      });
    }
    if (
      mode.editor === "settings" ? !isMapping(value) : !Array.isArray(value)
    ) {
      throw new Error(
        mode.editor === "settings"
          ? "Settings must be a JSON object"
          : "Entries must be a JSON array",
      );
    }
    return value;
  }

  setFocused(value: boolean) {
    this.focused = value;
    this.input.focused =
      value && (this.mode.editor === "text" || this.mode.editor === "number");
    const nestedSettings =
      this.mode.editor === "settings" &&
      this.children.length > 0 &&
      !this.definition.openMap;
    this.editor.focused =
      value &&
      (this.mode.editor === "entries" || this.mode.editor === "settings") &&
      !nestedSettings &&
      !this.choiceList;
    this.children.forEach((child, index) =>
      child.setFocused(
        value &&
          nestedSettings &&
          this.editingChildren &&
          index === this.childIndex,
      ),
    );
  }
  setError(messages: string[]) {
    this.error.setText(
      messages.map((message) => this.theme.fg("error", message)).join("\n"),
    );
  }
  clearError() {
    this.error.setText("");
  }
  invalidate() {
    this.input.invalidate();
    this.editor.invalidate();
    this.error.invalidate();
    this.children.forEach((child) => child.invalidate());
  }

  handleInput(data: string) {
    if (this.editingChildren) {
      const child = this.children[this.childIndex];
      if (child.editingChildren) child.handleInput(data);
      else if (matchesKey(data, Key.alt("left"))) this.editingChildren = false;
      else if (
        matchesKey(data, Key.alt("down")) ||
        matchesKey(data, Key.alt("up"))
      ) {
        const direction = matchesKey(data, Key.alt("down")) ? 1 : -1;
        this.childIndex =
          (this.childIndex + direction + this.children.length) %
          this.children.length;
      } else child.handleInput(data);
      this.setFocused(this.focused);
      return;
    }
    if (
      matchesKey(data, Key.alt("right")) &&
      this.mode.editor === "settings" &&
      this.children.length &&
      !this.definition.openMap
    ) {
      this.editingChildren = true;
      this.setFocused(this.focused);
      return;
    }
    if (matchesKey(data, Key.ctrl("space"))) {
      this.modeIndex = (this.modeIndex + 1) % this.modes.length;
      this.setFocused(this.focused);
      return;
    }
    if (matchesKey(data, Key.ctrl("r"))) {
      this.modeIndex = 0;
      this.setFocused(this.focused);
      return;
    }
    // Ordinary typing in an omitted input activates its schema's editor.
    if (
      this.mode === DEFAULT &&
      !data.startsWith("\x1b") &&
      data >= " " &&
      !matchesKey(data, Key.space)
    ) {
      const editorIndex = this.modes.findIndex(
        (mode) =>
          mode.editor === "text" ||
          mode.editor === "number" ||
          mode.editor === "entries",
      );
      if (editorIndex >= 0) {
        this.modeIndex = editorIndex;
        this.setFocused(this.focused);
      }
    }
    const mode = this.mode;
    if (!mode.editor) {
      if (
        matchesKey(data, Key.left) ||
        matchesKey(data, Key.right) ||
        matchesKey(data, Key.space)
      ) {
        const direction = matchesKey(data, Key.left) ? -1 : 1;
        this.modeIndex =
          (this.modeIndex + direction + this.modes.length) % this.modes.length;
        this.setFocused(this.focused);
      }
      return;
    }
    if (
      mode.editor === "settings" &&
      this.children.length &&
      !this.definition.openMap
    ) {
      // Alt+Right enters this embedded settings group; no separate dialog.
      return;
    } else if (mode.editor === "entries" && this.choiceList) {
      const choices = this.choiceList;
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        this.choiceIndex =
          (this.choiceIndex +
            (matchesKey(data, Key.left) ? -1 : 1) +
            choices.length) %
          choices.length;
      } else if (matchesKey(data, Key.space)) {
        const choice = choices[this.choiceIndex];
        if (this.selectedChoices.has(choice))
          this.selectedChoices.delete(choice);
        else this.selectedChoices.add(choice);
      }
    } else if (mode.editor === "text" || mode.editor === "number")
      this.input.handleInput(data);
    else this.editor.handleInput(data);
  }

  render(width: number): string[] {
    const heading = new Text(
      this.theme.fg(
        "accent",
        `${this.focused ? "›" : " "} ${this.name}: ${this.mode.label}`,
      ),
    ).render(width);
    const description = new Text(
      this.theme.fg("dim", this.definition.description),
    ).render(width);
    let control: string[] = [];
    const mode = this.mode;
    if (
      mode.editor === "settings" &&
      this.children.length &&
      !this.definition.openMap
    ) {
      control = this.children.flatMap((child) =>
        child.render(Math.max(1, width - 2)).map((line) => `  ${line}`),
      );
    } else if (mode.editor === "entries" && this.choiceList) {
      control = this.choiceList.flatMap((choice, index) =>
        new Text(
          `${this.focused && index === this.choiceIndex ? "›" : " "} [${this.selectedChoices.has(choice) ? "x" : " "}] ${choice}`,
        ).render(width),
      );
    } else if (mode.editor === "text" || mode.editor === "number")
      control = this.input.render(width);
    else if (mode.editor) {
      const hint =
        mode.editor === "entries" && !this.definition.children
          ? "One entry per line (Shift+Enter adds a line)"
          : "Structured settings (JSON)";
      control = [
        ...new Text(this.theme.fg("muted", hint)).render(width),
        ...this.editor.render(width),
      ];
    }
    return [
      ...heading,
      ...description,
      ...control,
      ...this.error.render(width),
    ];
  }
}

/** Advanced fields are rendered together, not through per-field type menus. */
export function createAgentAdvancedForm(
  tui: TUI,
  theme: Theme,
  runtime: AgentRuntime,
  title: string,
  definitions: readonly AgentFieldDefinition[],
  initial: AgentFrontmatter,
  done: (result: AgentFrontmatter | null) => void,
): Component & Focusable {
  const controls = definitions.map(
    (definition) =>
      new AdvancedField(definition, initial[definition.key], tui, theme),
  );
  function collect() {
    const candidate = structuredClone(initial);
    const errors: Record<string, string[]> = {};
    for (const control of controls) {
      try {
        let value = control.readValue();
        // Nico's flat loader treats [] as the literal selector "[]". Its CSV
        // fields support empty text for an intentional empty selection instead.
        if (
          runtime === "nico" &&
          Array.isArray(value) &&
          value.length === 0 &&
          definitions
            .find((definition) => definition.key === control.name)
            ?.kinds.includes("string")
        )
          value = "";
        if (value === undefined) delete candidate[control.name];
        else
          Object.defineProperty(candidate, control.name, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      } catch (error) {
        errors[control.name] = [
          error instanceof Error ? error.message : String(error),
        ];
      }
    }
    const contractErrors = validateAgentFrontmatter(runtime, candidate);
    const reportedErrors = [...contractErrors];
    if (!contractErrors.length && !Object.keys(errors).length) {
      try {
        renderAgentMarkdown(runtime, candidate, "");
      } catch (error) {
        reportedErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    for (const error of reportedErrors) {
      const control = controls.find(
        (field) =>
          error.startsWith(`${field.name}:`) ||
          error.startsWith(`${field.name}.`) ||
          error.startsWith(`${field.name}[`),
      );
      if (control) (errors[control.name] ??= []).push(error);
    }
    return { candidate, errors };
  }
  let validationMessages: string[] = [];
  const form = new Form<Record<string, string>>(
    {
      title: `Advanced settings — ${title}`,
      fields: controls,
      parse: () => {
        const { errors } = collect();
        validationMessages = Object.entries(errors).flatMap(
          ([name, messages]) =>
            messages.map((message) => `${name}: ${message}`),
        );
        return Object.keys(errors).length ? errors : undefined;
      },
      footer:
        "Enter next/apply | Tab switch field | Esc cancel section\nCtrl+Space change behavior | Ctrl+R use runtime default | ←→/Space choose values\nAlt+→ enter nested settings | Alt+← leave | Alt+↑↓ next nested field | Shift+Enter newline",
      spacing: 1,
    },
    tui,
    (values) => done(values === null ? null : collect().candidate),
  );
  form.focused = true;
  let scrollTop = 0;
  // Form itself has no viewport. Keep the active field/cursor visible in a
  // bounded overlay, including when a nested settings group expands.
  return {
    get focused() {
      return form.focused;
    },
    set focused(value: boolean) {
      form.focused = value;
    },
    handleInput: (data: string) => {
      if (
        (matchesKey(data, Key.up) || matchesKey(data, Key.down)) &&
        controls.some((control) => control.handleVerticalInput(data))
      ) {
        tui.requestRender();
        return;
      }
      form.handleInput(data);
    },
    invalidate: () => form.invalidate(),
    render: (width: number) => {
      const lines = form.render(width);
      const height = Math.max(10, Math.floor(tui.terminal.rows * 0.8));
      // Keep a validation summary visible even if the failing field is outside
      // the viewport. Its full errors remain attached to that field as well.
      const errorLines = validationMessages.length
        ? new Text(theme.fg("error", validationMessages[0]))
            .render(width)
            .slice(0, 3)
        : [];
      const footer = [...errorLines, ...lines.slice(-4)];
      const body = lines.slice(1, -4);
      const available = height - footer.length - 1;
      if (body.length <= available) {
        scrollTop = 0;
        return [lines[0], ...body, ...footer];
      }
      const cursorLine = body.findIndex((line) => line.includes(CURSOR_MARKER));
      let activeLine = cursorLine;
      if (activeLine < 0) {
        for (let index = body.length - 1; index >= 0; index--) {
          if (stripTerminalSequences(body[index]).trimStart().startsWith("›")) {
            activeLine = index;
            break;
          }
        }
      }
      if (activeLine < scrollTop) scrollTop = Math.max(0, activeLine);
      else if (activeLine >= scrollTop + available)
        scrollTop = activeLine - available + 1;
      scrollTop = Math.min(scrollTop, Math.max(0, body.length - available));
      return [
        lines[0],
        ...body.slice(scrollTop, scrollTop + available),
        ...footer,
      ];
    },
  };
}
