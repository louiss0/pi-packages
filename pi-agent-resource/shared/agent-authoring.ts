import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { safeParse } from "valibot";
import {
  AGENT_PROFILES,
  renderAgentMarkdown,
  validateAgentFrontmatter,
  type AgentFieldDefinition,
  type AgentFrontmatter,
  type AgentRuntime,
  type AgentValue,
  type AgentValueKind,
} from "./agent-contracts";
import { createAvailableToolSchema, validateAgentSavePolicy, formatToolName } from "./agent-save-policy";
import { MultiSelect } from "@code-fixer-23/pi-form-components";

type UI = Pick<ExtensionContext["ui"], "select" | "input" | "editor" | "notify" | "confirm" | "custom">;
type ValueEdit = { value: AgentValue } | { remove: true };
const BASIC_KEYS = new Set(["name", "description", "model", "tools"]);
const FINISH = "Done";
const BACK = "Back";
const OMIT = "Omit (use runtime default)";
const ADD_PI_TOOL = "Add registered Pi tool";
type ToolCatalog = ReturnType<typeof createAvailableToolSchema>;

export async function pickToolsMultiselect(
  ui: UI,
  title: string,
  available: string[],
  preselected: string[],
  toolCatalog?: ToolCatalog,
): Promise<string[] | undefined> {
  // Build a MultiSelect form field and embed it in a form via ui.custom
  const items = available.map((name) => ({
    value: name,
    label: formatToolName(name),
  }));

  const result = await ui.custom(async (tui, theme) => {
    // Pre-select items that are already chosen
    const initialValues = preselected;
    const list = new MultiSelect(
      "tools",
      {
        title: title || "Choose tools",
        items,
        itemChoiceStyle: "checkbox" as const,
        styles: {
          title: "accent",
          item: {
            selectedPrefix: "✓ ",
            selectedText: (t: string) => `✓ ${t}`,
            description: "",
            scrollInfo: "",
            noMatch: "No matches",
          },
        },
      },
      tui,
      theme,
      (value) => {
        // Done callback receives selected values or null (cancelled)
        if (value === null) return undefined;
        // The value is already the array of selected items'
        // values. We need to format and validate them.
        const formatted = value.map(formatToolName);
        // Validate only newly selected tools against catalog
        if (toolCatalog) {
          const newTools = formatted.filter((f) => !preselected.includes(f));
          const invalid = newTools.filter((f) => !safeParse(toolCatalog, f).success);
          if (invalid.length > 0) {
            // Invalid selection - return original preselected items
            return preselected;
          }
        }
        return formatted;
      },
    );
    return list;
  }, { overlay: true });
  if (result === undefined) return undefined;
  return result;
}

export function isSafeAgentFilename(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

export async function askAgentFilename(ui: UI): Promise<string | undefined> {
  for (;;) {
    const value = await ui.input("Agent filename (without .md; independent of runtime name)");
    if (value === undefined) return undefined;
    if (isSafeAgentFilename(value)) return value;
    ui.notify("Use 1–128 letters, numbers, dashes or underscores; no paths or reserved device names", "error");
  }
}

function summary(value: AgentValue | undefined): string {
  if (value === undefined) return "omitted";
  const text = JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

async function editList(ui: UI, key: string, initial: AgentValue): Promise<AgentValue[] | undefined> {
  const values: AgentValue[] = Array.isArray(initial) ? [...initial] : [];
  for (;;) {
    const labels = values.map((value, index) => `${index + 1}. ${summary(value)}`);
    const choice = await ui.select(`${key} — ordered list (Done with no items saves [])`, [...labels, "Add item", FINISH]);
    if (choice === undefined) return undefined;
    if (choice === FINISH) return values;
    if (choice === "Add item") {
      const value = await ui.input(`${key}: new text item`);
      if (value !== undefined) values.push(value);
    } else {
      const index = labels.indexOf(choice);
      if (index < 0) continue;
      const action = await ui.select(`${key}[${index}]`, ["Edit item", "Remove item", BACK]);
      if (action === "Remove item") values.splice(index, 1);
      if (action === "Edit item") {
        const value = await ui.input(`${key}[${index}]`, String(values[index]));
        if (value !== undefined) values[index] = value;
      }
    }
  }
}

const OPEN_KINDS: readonly AgentValueKind[] = ["string", "boolean", "integer", "list", "map", "null"];

async function editMap(ui: UI, field: AgentFieldDefinition, initial: AgentValue): Promise<AgentFrontmatter | undefined> {
  const values: AgentFrontmatter = initial !== null && typeof initial === "object" && !Array.isArray(initial) ? structuredClone(initial) : {};
  const children = field.children ?? [];
  for (;;) {
    const definitions = [...children];
    if (field.openMap) {
      for (const key of Object.keys(values)) {
        if (!definitions.some((definition) => definition.key === key)) {
          definitions.push({ key, group: field.group, description: "Provider-specific option", kinds: OPEN_KINDS, openMap: true });
        }
      }
    }
    const labels = definitions.map((child) => `${child.key}: ${summary(values[child.key])}`);
    const choice = await ui.select(`${field.key} — structured mapping`, [...labels, ...(field.openMap ? ["Add key"] : []), FINISH]);
    if (choice === undefined) return undefined;
    if (choice === FINISH) return values;
    let definition = definitions[labels.indexOf(choice)];
    if (choice === "Add key") {
      const key = await ui.input(`${field.key}: option name`);
      if (!key || ["__proto__", "constructor", "prototype"].includes(key)) continue;
      definition = { key, group: field.group, description: "Provider-specific option", kinds: OPEN_KINDS, openMap: true };
    }
    if (!definition) continue;
    const result = await editField(ui, definition, values[definition.key]);
    if (!result) continue;
    if ("remove" in result) delete values[definition.key];
    else Object.defineProperty(values, definition.key, { value: result.value, writable: true, enumerable: true, configurable: true });
  }
}

async function editField(ui: UI, field: AgentFieldDefinition, initial: AgentValue | undefined, toolCatalog?: ToolCatalog): Promise<ValueEdit | undefined> {
  const canAddTool = field.key === "tools" && toolCatalog && toolCatalog.options.length > 0;
  // The contract reads legacy list/null values, but new tools saves require CSV text.
  const kinds = field.key === "tools" ? field.kinds.filter((value) => value === "string") : field.kinds;
  const kind = await ui.select(`${field.key}: ${field.description}\nCurrent: ${summary(initial)}`, [OMIT, ...(canAddTool ? [ADD_PI_TOOL] : []), ...kinds, BACK]);
  if (kind === undefined || kind === BACK) return undefined;
  if (kind === OMIT) return { remove: true };
  if (kind === ADD_PI_TOOL && canAddTool) {
    ui.notify("Select tools from the multiselect; extension names are saved with ext: selectors for Tintin.", "info");
    const initialList = typeof initial === "string" ? initial.split(",").map((v) => v.trim()).filter(Boolean) : [];
    const result = await pickToolsMultiselect(ui, "Registered Pi tools", [...toolCatalog.options].sort(), initialList, toolCatalog);
    if (result === undefined) return undefined;
    return { value: result.join(",") };
  }
  if (kind === "null") return { value: null };
  if (kind === "boolean") {
    const choice = await ui.select(`${field.key}: boolean`, ["true", "false"]);
    return choice === undefined ? undefined : { value: choice === "true" };
  }
  if (kind === "integer") {
    for (;;) {
      const text = await ui.input(`${field.key}: integer`, typeof initial === "number" ? String(initial) : "");
      if (text === undefined) return undefined;
      const value = Number(text);
      if (/^-?\d+$/.test(text) && Number.isSafeInteger(value)) return { value };
      ui.notify("Enter a safe integer", "error");
    }
  }
  if (kind === "list") {
    const value = await editList(ui, field.key, initial ?? []);
    return value === undefined ? undefined : { value };
  }
  if (kind === "map") {
    const value = await editMap(ui, field, initial ?? {});
    return value === undefined ? undefined : { value };
  }
  if (kind === "string") {
    // Empty text is an explicit string, not omission. Lists have their own editor.
    const value = field.choices
      ? await ui.select(`${field.key}: value`, [...field.choices])
      : await ui.input(`${field.key}: text (empty is explicit)`, typeof initial === "string" ? initial : "");
    return value === undefined ? undefined : { value };
  }
  return undefined;
}

async function editGroup(ui: UI, fields: readonly AgentFieldDefinition[], values: AgentFrontmatter, title: string, toolCatalog?: ToolCatalog) {
  for (;;) {
    const labels = fields.map((field) => `${field.key}: ${summary(values[field.key])}`);
    const choice = await ui.select(title, [...labels, BACK]);
    if (choice === undefined || choice === BACK) return;
    const field = fields[labels.indexOf(choice)];
    if (!field) continue;
    const result = await editField(ui, field, values[field.key], toolCatalog);
    if (!result) continue;
    if ("remove" in result) delete values[field.key];
    else values[field.key] = result.value;
  }
}

export async function authorAgentDefinition(
  ui: UI,
  runtime: AgentRuntime,
  initial: { frontmatter: AgentFrontmatter; body: string },
  availableToolNames: readonly string[] = [],
  mode: "create" | "edit" = "edit",
): Promise<{ frontmatter: AgentFrontmatter; body: string } | undefined> {
  const profile = AGENT_PROFILES[runtime];
  const toolCatalog = createAvailableToolSchema(availableToolNames);
  const frontmatter = structuredClone(initial.frontmatter);
  let body = initial.body;
  let bodyStepOpened = false;
  const editBody = async () => {
    bodyStepOpened = true;
    const edited = await ui.editor("Agent system prompt (Markdown body only)", body);
    if (edited !== undefined) body = edited;
  };
  ui.notify(`${profile.label}: name, description, tools and model must pass authoring validation; other omitted settings use runtime defaults. A tool allowlist does not load its provider; nested delegation can expand capabilities. This manager does not enforce runtime permissions.`, "info");
  for (;;) {
    const action = await ui.select(`${profile.label} — agent definition`, ["Basic settings", "Advanced settings", "Prompt body", "Review and save", "Cancel"]);
    if (action === undefined || action === "Cancel") return undefined;
    if (action === "Basic settings") {
      await editGroup(ui, profile.fields.filter((field) => BASIC_KEYS.has(field.key)), frontmatter, "Basic settings", toolCatalog);
      if (mode === "create" && !bodyStepOpened) {
        const errors = validateAgentSavePolicy(frontmatter);
        if (errors.length) ui.notify(errors.join("\n"), "error");
        else await editBody();
      }
    }
    if (action === "Advanced settings") {
      const fields = profile.fields.filter((field) => !BASIC_KEYS.has(field.key));
      const groups = [...new Set(fields.map((field) => field.group))];
      const group = await ui.select("Advanced settings — choose a section", [...groups, BACK]);
      if (group !== undefined && group !== BACK) await editGroup(ui, fields.filter((field) => field.group === group), frontmatter, group);
    }
    if (action === "Prompt body") await editBody();
    if (action === "Review and save") {
      const errors = [...validateAgentSavePolicy(frontmatter), ...validateAgentFrontmatter(runtime, frontmatter)];
      if (errors.length) {
        ui.notify(errors.join("\n"), "error");
        continue;
      }
      try {
        renderAgentMarkdown(runtime, frontmatter, body);
      } catch (error) {
        ui.notify(error instanceof Error ? error.message : String(error), "error");
        continue;
      }
      if (mode === "create" && !bodyStepOpened) await editBody();
      if (!body.trim() && !await ui.confirm("Empty system prompt", "Save an intentionally empty prompt? Replace-mode agents will have no authored system instructions.")) continue;
      const preview = Object.entries(frontmatter).map(([key, value]) => `${key}: ${summary(value)}`).join("\n") || "All frontmatter settings omitted (native defaults)";
      if (await ui.confirm("Save agent definition", `${profile.label}\n${preview}\nPrompt: ${body.length} characters\nThis saves a definition only; runtime loading/execution is separate.`)) return { frontmatter, body };
    }
  }
}
