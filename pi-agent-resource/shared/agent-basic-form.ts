import {
  ConfirmationBox,
  Form,
  LabelledInput,
  MultiSelect,
} from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import type { AgentFrontmatter, AgentRuntime } from "./agent-contracts";
import { isSafeAgentFilename } from "./agent-filename";
import { agentFormViewport } from "./agent-form-viewport";
import {
  createAvailableToolSchema,
  DEFAULT_AGENT_TOOLS,
  formatToolName,
  validateAgentSavePolicy,
} from "./agent-save-policy";

export type AgentBasicValues = {
  frontmatter: AgentFrontmatter;
  filename?: string;
  advanced: boolean;
};
export function createAgentBasicForm(
  tui: TUI,
  theme: Theme,
  runtime: AgentRuntime,
  initial: AgentFrontmatter,
  available: readonly string[],
  mode: "create" | "edit",
  done: (value: AgentBasicValues | null) => void,
  includeAdvanced = false,
): Component & Focusable {
  const initialText = (key: string) =>
    typeof initial[key] === "string" ? (initial[key] as string) : "";
  const saved =
    typeof initial.tools === "string"
      ? initial.tools
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : Array.isArray(initial.tools)
        ? initial.tools.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
  const catalog = createAvailableToolSchema([
    ...DEFAULT_AGENT_TOOLS.split(","),
    ...available,
  ]);
  const selector = (name: string) =>
    catalog.options.includes(name) ? formatToolName(name, runtime) : name;
  const selected = saved.map(selector);
  const choices = [
    ...new Set([
      ...catalog.options.map((name) => formatToolName(name, runtime)),
      ...selected,
    ]),
  ];
  const tools = new MultiSelect(
    "tools",
    {
      items: choices.map((value) => ({ value, label: value })),
      initialValues: selected,
      itemLimit: 6,
      itemChoiceStyle: "checkbox",
    },
    tui,
    theme,
    () => {},
  );
  const advanced = new ConfirmationBox(
    "advanced",
    theme,
    "Include advanced settings",
  );
  if (includeAdvanced) advanced.confirm();
  const fields = [
    new LabelledInput("name", theme, initialText("name")),
    new LabelledInput("description", theme, initialText("description")),
    new LabelledInput("model", theme, initialText("model")),
    tools,
    advanced,
  ];
  type Raw = Record<string, string | boolean>;
  let messages: string[] = [];
  function candidate(values: Raw) {
    const frontmatter = structuredClone(initial);
    const unchanged =
      ["name", "description", "model"].every(
        (key) => values[key] === initialText(key),
      ) && values.tools === selected.join(",");
    if (!unchanged) {
      for (const key of ["name", "description", "model", "tools"])
        frontmatter[key] = String(values[key]);
    }
    return {
      frontmatter,
      filename: mode === "create" ? String(values.name) : undefined,
      advanced: Boolean(values.advanced),
    };
  }
  const form = new Form<Raw>(
    {
      title:
        mode === "create"
          ? "Create subagent — metadata"
          : "Edit subagent — metadata",
      fields,
      parse: (values) => {
        const result = candidate(values);
        // An unchanged legacy definition is readable without a forced rewrite.
        const unchanged =
          mode === "edit" &&
          JSON.stringify(result.frontmatter) === JSON.stringify(initial);
        const errors: Record<string, string[]> = {};
        messages = unchanged ? [] : validateAgentSavePolicy(result.frontmatter);
        for (const message of messages) {
          const key = message.toLowerCase().split(" ")[0];
          (errors[key] ??= []).push(message);
        }
        if (
          result.filename !== undefined &&
          !isSafeAgentFilename(result.filename)
        ) {
          const message =
            "Name must be safe for a filename: letters, numbers, dashes or underscores; no paths or reserved device names";
          (errors.name ??= []).push(message);
          messages.push(message);
        }
        return messages.length ? errors : undefined;
      },
      footer:
        "Tab switch field | Enter next/continue | Esc cancel\nTools: ↑↓ navigate, Space toggle",
      spacing: 1,
    },
    tui,
    (values) => done(values === null ? null : candidate(values)),
  );
  form.focused = true;
  return agentFormViewport(form, tui, theme, () => messages);
}
