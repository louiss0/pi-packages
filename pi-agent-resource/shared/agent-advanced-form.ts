import {
  ConfirmationBox,
  Form,
  MultiSelect,
  type FormComponent,
} from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import {
  renderAgentMarkdown,
  validateAgentFrontmatter,
  type AgentFieldDefinition,
  type AgentFrontmatter,
  type AgentRuntime,
  type AgentValue,
} from "./agent-contracts";
import {
  AgentChoiceField,
  AgentInputField,
  type ValueChoice,
} from "./agent-form-fields";
import { agentFormViewport } from "./agent-form-viewport";

function mapping(value: AgentValue | undefined): value is AgentFrontmatter {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
type Node = {
  read(): AgentValue | undefined;
  reset(): void;
  changed(): boolean;
};

/** All inputs, including declared nested fields, are directly fillable. */
export function createAgentAdvancedForm(
  tui: TUI,
  theme: Theme,
  runtime: AgentRuntime,
  title: string,
  definitions: readonly AgentFieldDefinition[],
  initial: AgentFrontmatter,
  done: (result: AgentFrontmatter | null) => void,
): Component & Focusable {
  const fields: FormComponent[] = [];
  const owners = new Map<string, string>();
  function build(
    definition: AgentFieldDefinition,
    path: string,
    value: AgentValue | undefined,
    onChange: () => void = () => {},
  ): Node {
    if (
      definition.kinds.includes("boolean") &&
      definition.kinds.every((kind) => kind === "boolean" || kind === "null")
    ) {
      const checkbox = new ConfirmationBox(
        path,
        theme,
        `${path}${value === undefined ? " (leave untouched for runtime default)" : ""}`,
      );
      if (value === true) checkbox.confirm();
      fields.push(checkbox);
      owners.set(checkbox.name, path);
      let touched = false;
      let omitted = false;
      // Reuse the library's checkbox and input behavior. Only observe changes
      // here to distinguish an untouched optional field from explicit false.
      const handleInput = checkbox.handleInput.bind(checkbox);
      checkbox.handleInput = (data) => {
        const before = checkbox.value;
        handleInput(data);
        if (checkbox.value !== before) {
          touched = true;
          omitted = false;
          onChange();
        }
      };
      return {
        changed: () => touched,
        reset: () => {
          if (checkbox.value) checkbox.toggle();
          touched = true;
          omitted = true;
        },
        read: () =>
          touched
            ? omitted
              ? undefined
              : checkbox.value
            : structuredClone(value),
      };
    }
    let input: AgentInputField | undefined;
    let selector: AgentChoiceField | undefined;
    let list: FormComponent | undefined;
    const children: Array<{ key: string; node: Node }> = [];
    const changed = () => {
      selector?.reset();
      onChange();
    };
    const choices: ValueChoice[] = [
      { label: "Use runtime default", value: undefined },
    ];
    if (definition.choices && definition.kinds.includes("string"))
      choices.push(
        ...definition.choices.map((value) => ({ label: value, value })),
      );
    if (definition.kinds.includes("boolean")) {
      if (
        [
          "extensions",
          "inherit_extensions",
          "skills",
          "inherit_skills",
          "allowed_subagents",
        ].includes(definition.key)
      )
        choices.push({ label: "Inherit all", value: true });
      choices.push({ label: "Disabled", value: false });
    }
    if (
      definition.kinds.includes("null") &&
      (definition.choices || definition.kinds.includes("boolean"))
    )
      choices.push({ label: "Clear value", value: null });
    if (
      definition.kinds.includes("list") &&
      definition.kinds.includes("string")
    )
      choices.push({ label: "No entries", value: [] });
    if (choices.length > 1) {
      selector = new AgentChoiceField(
        `${path}${definition.kinds.includes("list") || definition.kinds.includes("map") || (definition.kinds.includes("string") && !definition.choices) || definition.kinds.includes("integer") ? " behavior" : ""}`,
        choices,
        value,
        theme,
        () => {
          input?.reset();
          children.forEach(({ node }) => node.reset());
          onChange();
        },
      );
      fields.push(selector);
      owners.set(selector.name, path);
    }
    if (
      definition.kinds.includes("map") &&
      definition.children &&
      !definition.openMap
    ) {
      for (const child of definition.children)
        children.push({
          key: child.key,
          node: build(
            child,
            `${path}.${child.key}`,
            mapping(value) ? value[child.key] : undefined,
            changed,
          ),
        });
    } else if (
      definition.kinds.includes("list") &&
      definition.choices &&
      !definition.kinds.includes("string") &&
      !definition.children
    ) {
      const initialValues = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      list = new MultiSelect(
        path,
        {
          items: definition.choices.map((value) => ({ value, label: value })),
          initialValues,
          itemLimit: 6,
        },
        tui,
        theme,
        () => {},
      );
      fields.push(list);
      owners.set(list.name, path);
    } else if (
      definition.kinds.includes("integer") ||
      definition.kinds.includes("list") ||
      definition.kinds.includes("map") ||
      (definition.kinds.includes("string") && !definition.choices)
    ) {
      const kind =
        definition.kinds.includes("map") ||
        (definition.kinds.includes("list") && definition.children)
          ? "json"
          : definition.kinds.includes("list")
            ? "entries"
            : definition.kinds.includes("integer")
              ? "number"
              : "text";
      input = new AgentInputField(
        path,
        kind,
        value,
        tui,
        theme,
        changed,
        definition.description,
      );
      fields.push(input);
      owners.set(input.name, path);
    }
    const listInitial = list?.value;
    const isChanged = (): boolean =>
      Boolean(
        input?.changed ||
          selector?.changed ||
          children.some(({ node }) => node.changed()) ||
          (list && list.value !== listInitial),
      );
    return {
      changed: isChanged,
      reset: () => {
        input?.reset();
        selector?.reset();
        children.forEach(({ node }) => node.reset());
      },
      read: () => {
        if (!isChanged()) return structuredClone(value);
        const selected = selector?.readValue();
        if (selected !== undefined) return selected;
        if (children.length) {
          const entries = children.flatMap(({ key, node }) => {
            try {
              const value = node.read();
              return value === undefined ? [] : [[key, value]];
            } catch (error) {
              throw new Error(
                `${key}: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
            }
          });
          return entries.length ? Object.fromEntries(entries) : undefined;
        }
        if (list) return list.value ? String(list.value).split(",") : undefined;
        return input?.readValue();
      },
    };
  }
  const roots = definitions.map((definition) => ({
    definition,
    node: build(definition, definition.key, initial[definition.key]),
  }));
  let messages: string[] = [];
  function collect() {
    const candidate = structuredClone(initial);
    const errors: Record<string, string[]> = {};
    function report(path: string, message: string) {
      const field =
        fields.find((field) => owners.get(field.name) === path) ??
        fields.find((field) =>
          owners.get(field.name)?.startsWith(`${path}.`),
        ) ??
        fields[0];
      if (field) (errors[field.name] ??= []).push(message);
    }
    for (const { definition, node } of roots) {
      try {
        let value = node.read();
        if (
          runtime === "nico" &&
          Array.isArray(value) &&
          value.length === 0 &&
          definition.kinds.includes("string")
        )
          value = "";
        if (value === undefined) delete candidate[definition.key];
        else
          Object.defineProperty(candidate, definition.key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      } catch (error) {
        report(
          definition.key,
          error instanceof Error ? error.message : String(error),
        );
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
    for (const message of reportedErrors) {
      const path = message.split(":", 1)[0].replace(/\[.*$/, "");
      if (
        definitions.some(
          (field) => path === field.key || path.startsWith(`${field.key}.`),
        )
      )
        report(path, message);
    }
    return { candidate, errors };
  }
  const form = new Form<Record<string, string>>(
    {
      title: `Advanced settings — ${title}`,
      fields,
      parse: () => {
        const { errors } = collect();
        messages = Object.values(errors).flat();
        return messages.length ? errors : undefined;
      },
      footer:
        "Tab switch field | Enter next/apply | Esc cancel section\nLeave optional inputs blank for runtime defaults | Shift+Enter newline",
      spacing: 1,
    },
    tui,
    (values) => done(values === null ? null : collect().candidate),
  );
  form.focused = true;
  return agentFormViewport(form, tui, theme, () => messages);
}
