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
  createAgentChoiceField,
  createAgentInputField,
  type AgentFieldBinding,
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
  const changeHandlers = new Map<string, () => void>();
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
      checkbox.setValue(value === true);
      fields.push(checkbox);
      owners.set(checkbox.name, path);
      let touched = false;
      let omitted = false;
      changeHandlers.set(path, () => {
        touched = true;
        omitted = false;
        onChange();
      });
      return {
        changed: () => touched,
        reset: () => {
          checkbox.setValue(false);
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
    let input: AgentFieldBinding | undefined;
    let selector: AgentFieldBinding | undefined;
    let list: FormComponent | undefined;
    let listChanged = false;
    let listOmitted = false;
    let resetList = () => {};
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
      selector = createAgentChoiceField(
        tui,
        theme,
        `${path}${definition.kinds.includes("list") || definition.kinds.includes("map") || (definition.kinds.includes("string") && !definition.choices) || definition.kinds.includes("integer") ? " behavior" : ""}`,
        choices,
        value,
        () => {
          input?.reset();
          children.forEach(({ node }) => node.reset());
          onChange();
        },
      );
      fields.push(selector.component);
      owners.set(selector.component.name, path);
      changeHandlers.set(selector.component.name, selector.handleChange);
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
      const control = new MultiSelect(
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
      list = control;
      fields.push(control);
      owners.set(control.name, path);
      changeHandlers.set(control.name, () => {
        listChanged = true;
        listOmitted = false;
        changed();
      });
      resetList = () => {
        control.setValues([]);
        listChanged = true;
        listOmitted = true;
      };
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
      input = createAgentInputField(
        tui,
        theme,
        path,
        kind,
        value,
        changed,
        definition.description,
      );
      fields.push(input.component);
      owners.set(input.component.name, path);
      changeHandlers.set(input.component.name, input.handleChange);
    }
    const isChanged = (): boolean =>
      Boolean(
        input?.changed ||
          selector?.changed ||
          children.some(({ node }) => node.changed()) ||
          listChanged,
      );
    return {
      changed: isChanged,
      reset: () => {
        input?.reset();
        selector?.reset();
        resetList();
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
        if (list)
          return listOmitted
            ? undefined
            : list.value
              ? String(list.value).split(",")
              : [];
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
  const form = new Form<Record<string, string | boolean>>(
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
      onFieldChange: (name) => changeHandlers.get(name)?.(),
    },
    tui,
    (values) => done(values === null ? null : collect().candidate),
  );
  form.focused = true;
  return agentFormViewport(form, tui, theme, () => messages);
}
