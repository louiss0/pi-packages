import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAgentAdvancedForm } from "./agent-advanced-form";
import {
  createAgentBasicForm,
  type AgentBasicValues,
} from "./agent-basic-form";
import {
  AGENT_PROFILES,
  renderAgentMarkdown,
  validateAgentFrontmatter,
  type AgentFrontmatter,
  type AgentRuntime,
} from "./agent-contracts";
import { isSafeAgentFilename } from "./agent-filename";
import { validateAgentSavePolicy } from "./agent-save-policy";
import { modalEditorOverlayOptions } from "./ui";
export { isSafeAgentFilename } from "./agent-filename";

type UI = Pick<
  ExtensionContext["ui"],
  "select" | "editor" | "notify" | "confirm" | "custom"
>;
const BASIC_KEYS = new Set(["name", "description", "model", "tools"]);
export type AuthoredAgentDefinition = {
  frontmatter: AgentFrontmatter;
  body: string;
  filename?: string;
};

/** Metadata form → optional advanced forms → Markdown prompt → review/save. */
export async function authorAgentDefinition(
  ui: UI,
  runtime: AgentRuntime,
  initial: { frontmatter: AgentFrontmatter; body: string },
  availableToolNames: readonly string[] = [],
  mode: "create" | "edit" = "edit",
): Promise<AuthoredAgentDefinition | undefined> {
  const profile = AGENT_PROFILES[runtime];
  let frontmatter = structuredClone(initial.frontmatter);
  let body = initial.body;
  let filename = "";
  let includeAdvanced = false;
  const unchangedMetadata = () =>
    mode === "edit" &&
    JSON.stringify(frontmatter) === JSON.stringify(initial.frontmatter);
  ui.notify(
    `${profile.label}: fill in the metadata, then the Markdown prompt. Omitted advanced fields use runtime defaults. Tool selection does not load providers or enforce runtime permissions.`,
    "info",
  );
  for (;;) {
    const metadata = await ui.custom<AgentBasicValues | null>(
      (tui, theme, _bindings, done) =>
        createAgentBasicForm(
          tui,
          theme,
          runtime,
          frontmatter,
          availableToolNames,
          mode,
          done,
          includeAdvanced,
        ),
      modalEditorOverlayOptions,
    );
    if (!metadata) return undefined;
    frontmatter = structuredClone(metadata.frontmatter);
    filename = metadata.filename ?? "";
    includeAdvanced = metadata.advanced;
    const essentialErrors = unchangedMetadata()
      ? []
      : validateAgentSavePolicy(frontmatter);
    if (mode === "create" && !isSafeAgentFilename(filename))
      essentialErrors.push("Use a safe agent filename");
    if (essentialErrors.length) {
      ui.notify(essentialErrors.join("\n"), "error");
      continue;
    }
    if (includeAdvanced) {
      const fields = profile.fields.filter(
        (field) => !BASIC_KEYS.has(field.key),
      );
      const groups = [...new Set(fields.map((field) => field.group))];
      for (;;) {
        const group = await ui.select(
          "Advanced settings — choose a section to fill",
          [...groups, "Done"],
        );
        if (group === undefined) return undefined;
        if (group === "Done") break;
        const definitions = fields.filter((field) => field.group === group);
        if (!definitions.length) continue;
        const edited = await ui.custom<AgentFrontmatter | null>(
          (tui, theme, _bindings, done) =>
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
        if (edited)
          for (const field of definitions) {
            if (Object.hasOwn(edited, field.key))
              frontmatter[field.key] = edited[field.key];
            else delete frontmatter[field.key];
          }
      }
    }
    const contractErrors = validateAgentFrontmatter(runtime, frontmatter);
    if (contractErrors.length) {
      ui.notify(contractErrors.join("\n"), "error");
      continue;
    }
    const prompt = await ui.editor(
      "Agent system prompt (Markdown body only)",
      body,
    );
    if (prompt === undefined) return undefined;
    body = prompt;
    const unchanged = unchangedMetadata() && body === initial.body;
    const errors = unchanged ? [] : validateAgentSavePolicy(frontmatter);
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
    if (
      !body.trim() &&
      !(await ui.confirm(
        "Empty system prompt",
        "Save an intentionally empty prompt? Replace-mode agents will have no authored system instructions.",
      ))
    )
      continue;
    const preview = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n");
    if (
      await ui.confirm(
        "Save agent definition",
        `${profile.label}\n${preview}\nPrompt: ${body.length} characters\nSaving does not launch the subagent.`,
      )
    )
      return mode === "create"
        ? { frontmatter, body, filename }
        : { frontmatter, body };
  }
}
