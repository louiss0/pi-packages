import {
  LabelledInput,
  Picker,
  type FormComponent,
} from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Key,
  matchesKey,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AgentValue } from "./agent-contracts";

export type ValueChoice = { label: string; value: AgentValue | undefined };
export type AgentFieldBinding = {
  component: FormComponent;
  changed: boolean;
  handleChange(): void;
  reset(): void;
  readValue(): AgentValue | undefined;
};

/** Domain value mapping only: the library owns selection and rendering. */
export function createAgentChoiceField(
  tui: TUI,
  theme: Theme,
  name: string,
  choices: readonly ValueChoice[],
  initial: AgentValue | undefined,
  onChange: () => void,
): AgentFieldBinding {
  const component = new Picker(
    name,
    {
      items: choices.map((choice) => choice.label),
      itemLimit: 3,
      initialValue: (
        choices.find((choice) => choice.value === initial) ?? choices[0]
      ).label,
      helpText: "↑↓ select value | Type to filter | Tab next field",
    },
    theme,
    tui,
    () => {},
  );
  const binding: AgentFieldBinding = {
    component,
    changed: false,
    handleChange: () => {
      binding.changed = true;
      onChange();
    },
    reset: () => {
      component.setValue(choices[0].label);
      binding.changed = true;
    },
    readValue: () => {
      const choice = choices.find((choice) => choice.label === component.value);
      if (!choice) throw new Error("Select one of the available values");
      return choice.value;
    },
  };
  return binding;
}

/** Text and numeric inputs reuse LabelledInput; only multiline needs an adapter. */
export function createAgentInputField(
  tui: TUI,
  theme: Theme,
  name: string,
  kind: "text" | "number" | "entries" | "json",
  initial: AgentValue | undefined,
  onChange: () => void,
  description: string,
): AgentFieldBinding {
  const text =
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
  const component =
    kind === "entries" || kind === "json"
      ? new AgentMultilineField(name, kind, text, tui, theme, description)
      : new LabelledInput(name, theme, text);
  const binding: AgentFieldBinding = {
    component,
    changed: false,
    handleChange: () => {
      binding.changed = true;
      onChange();
    },
    reset: () => {
      component.setValue("");
      binding.changed = true;
    },
    readValue: () => {
      if (!binding.changed) return initial;
      const text = component.value;
      if (text === "") return undefined;
      if (kind === "text") return text;
      if (kind === "entries") return text.split(/\r?\n/);
      if (kind === "number") {
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
    },
  };
  return binding;
}

/** The form library has no multiline field; adapt Pi's Editor, not a new input. */
class AgentMultilineField implements FormComponent {
  private readonly editor: Editor;
  private readonly error = new Text("");
  private focused = false;
  constructor(
    readonly name: string,
    private kind: "entries" | "json",
    initialText: string,
    tui: TUI,
    private theme: Theme,
    private description: string,
  ) {
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
    this.editor.setText(initialText);
  }
  get value(): string {
    return this.editor.getExpandedText();
  }
  setValue(value: string) {
    this.editor.setText(value);
  }
  capturesInput(data: string) {
    return matchesKey(data, Key.up) || matchesKey(data, Key.down);
  }
  setFocused(value: boolean) {
    this.focused = value;
    this.editor.focused = value;
  }
  setError(messages: string[]) {
    this.error.setText(this.theme.fg("error", messages.join("\n")));
  }
  clearError() {
    this.error.setText("");
  }
  invalidate() {
    this.editor.invalidate();
    this.error.invalidate();
  }
  handleInput(data: string) {
    this.editor.handleInput(data);
  }
  render(width: number) {
    const label = `${this.focused ? "›" : " "} ${this.name} (${this.kind === "entries" ? "one entry per line" : "JSON"})`;
    return [
      ...new Text(this.theme.fg("accent", label)).render(width),
      ...new Text(this.theme.fg("dim", this.description)).render(width),
      ...this.editor.render(width),
      ...this.error.render(width),
    ];
  }
}
