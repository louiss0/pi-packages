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
} from "./agent-contracts";
import {
  createAvailableToolSchema,
  validateAgentSavePolicy,
  formatToolName,
} from "./agent-save-policy";
import { MultiSelect } from "@code-fixer-23/pi-form-components";
import { createAgentAdvancedForm } from "./agent-advanced-form";
import { modalEditorOverlayOptions } from "./ui";

type UI = Pick<
  ExtensionContext["ui"],
  "select" | "input" | "editor" | "notify" | "confirm" | "custom"
>;
type ValueEdit = { value: AgentValue } | { remove: true };
const BASIC_KEYS = new Set(["name", "description", "model", "tools"]);
const BACK = "Back";
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

  const selected = new Set(preselected);
  const result = await ui.custom(
    async (tui, theme) => {
      const list = new MultiSelect(
        "tools",
        {
          title: title || "Choose tools",
          items,
          itemChoiceStyle: "checkbox" as const,
          styles: {
            title: "accent",
            item: {
              selectedPrefix: "accent",
              selectedText: "accent",
              description: "muted",
              scrollInfo: "dim",
              noMatch: "warning",
            },
          },
        },
        tui,
        theme,
        (value) => {
          // Done callback receives selected values or null (cancelled)
          if (value === null) return;
          selected.clear();
          value.forEach((v) => selected.add(v));
          if (toolCatalog) {
            const newTools = Array.from(selected).filter(
              (f) => !preselected.includes(f),
            );
            const invalid = newTools.filter(
              (f) => !safeParse(toolCatalog, f).success,
            );
            if (invalid.length > 0) {
              selected.clear();
              preselected.forEach((name) => selected.add(name));
            }
          }
        },
      );
      return list;
    },
    { overlay: true },
  );
  if (result === undefined) return undefined;
  // Support test mock which returns array directly
  if (Array.isArray(result)) {
    selected.clear();
    result.forEach((v) => selected.add(v));
  }
  return Array.from(selected).map(formatToolName);
}

export function isSafeAgentFilename(value: string): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  );
}

export async function askAgentFilename(ui: UI): Promise<string | undefined> {
  for (;;) {
    const value = await ui.input(
      "Agent filename (without .md; independent of runtime name)",
    );
    if (value === undefined) return undefined;
    if (isSafeAgentFilename(value)) return value;
    ui.notify(
      "Use 1–128 letters, numbers, dashes or underscores; no paths or reserved device names",
      "error",
    );
  }
}

function summary(value: AgentValue | undefined): string {
  if (value === undefined) return "omitted";
  const text = JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

async function editField(
  ui: UI,
  field: AgentFieldDefinition,
  initial: AgentValue | undefined,
  toolCatalog?: ToolCatalog,
): Promise<ValueEdit | undefined> {
  if (field.key === "tools") {
    if (!toolCatalog || toolCatalog.options.length === 0) {
      ui.notify("No registered Pi tools are available to select", "info");
      return undefined;
    }
    const initialList =
      typeof initial === "string"
        ? initial
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
    const result = await pickToolsMultiselect(
      ui,
      field.description || "Tools",
      [...toolCatalog.options].sort(),
      initialList,
      toolCatalog,
    );
    return result === undefined ? undefined : { value: result.join(",") };
  }
  // Only the essential text fields use this basic editor. Advanced fields have
  // schema-directed controls in their section form, not storage-type menus.
  const value = await ui.input(
    `${field.key}: ${field.description}`,
    typeof initial === "string" ? initial : "",
  );
  return value === undefined ? undefined : { value };
}

async function editGroup(
  ui: UI,
  fields: readonly AgentFieldDefinition[],
  values: AgentFrontmatter,
  title: string,
  toolCatalog?: ToolCatalog,
) {
  for (;;) {
    const labels = fields.map(
      (field) => `${field.key}: ${summary(values[field.key])}`,
    );
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
    const edited = await ui.editor(
      "Agent system prompt (Markdown body only)",
      body,
    );
    if (edited !== undefined) body = edited;
  };
  ui.notify(
    `${profile.label}: name, description, tools and model must pass authoring validation; other omitted settings use runtime defaults. A tool allowlist does not load its provider; nested delegation can expand capabilities. This manager does not enforce runtime permissions.`,
    "info",
  );
  for (;;) {
    const action = await ui.select(`${profile.label} — agent definition`, [
      "Basic settings",
      "Advanced settings",
      "Prompt body",
      "Review and save",
      "Cancel",
    ]);
    if (action === undefined || action === "Cancel") return undefined;
    if (action === "Basic settings") {
      await editGroup(
        ui,
        profile.fields.filter((field) => BASIC_KEYS.has(field.key)),
        frontmatter,
        "Basic settings",
        toolCatalog,
      );
      if (mode === "create" && !bodyStepOpened) {
        const errors = validateAgentSavePolicy(frontmatter);
        if (errors.length) ui.notify(errors.join("\n"), "error");
        else await editBody();
      }
    }
    if (action === "Advanced settings") {
      const fields = profile.fields.filter(
        (field) => !BASIC_KEYS.has(field.key),
      );
      const groups = [...new Set(fields.map((field) => field.group))];
      const group = await ui.select("Advanced settings — choose a section", [
        ...groups,
        BACK,
      ]);
      if (group !== undefined && group !== BACK) {
        const definitions = fields.filter((field) => field.group === group);
        const edited = await ui.custom<AgentFrontmatter | null>(
          (tui, theme, _keybindings, done) =>
            createAgentAdvancedForm(
              tui,
              theme,
              runtime,
              group,
              definitions,
              frontmatter,
              done,
            ),
          modalEditorOverlayOptions,
        );
        if (edited) {
          for (const field of definitions) {
            if (Object.hasOwn(edited, field.key))
              frontmatter[field.key] = edited[field.key];
            else delete frontmatter[field.key];
          }
        }
      }
    }
    if (action === "Prompt body") await editBody();
    if (action === "Review and save") {
      const errors = [
        ...validateAgentSavePolicy(frontmatter),
        ...validateAgentFrontmatter(runtime, frontmatter),
      ];
      if (errors.length) {
        ui.notify(errors.join("\n"), "error");
        continue;
      }
      try {
        renderAgentMarkdown(runtime, frontmatter, body);
      } catch (error) {
        ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
        continue;
      }
      if (mode === "create" && !bodyStepOpened) await editBody();
      if (
        !body.trim() &&
        !(await ui.confirm(
          "Empty system prompt",
          "Save an intentionally empty prompt? Replace-mode agents will have no authored system instructions.",
        ))
      )
        continue;
      const preview =
        Object.entries(frontmatter)
          .map(([key, value]) => `${key}: ${summary(value)}`)
          .join("\n") || "All frontmatter settings omitted (native defaults)";
      if (
        await ui.confirm(
          "Save agent definition",
          `${profile.label}\n${preview}\nPrompt: ${body.length} characters\nThis saves a definition only; runtime loading/execution is separate.`,
        )
      )
        return { frontmatter, body };
    }
  }
}
