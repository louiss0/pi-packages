import { array, minLength, picklist, pipe, regex, safeParse, string, transform, trim } from "valibot";
import type { AgentFrontmatter } from "./agent-contracts";

export const DEFAULT_AGENT_TOOLS = "read,write,edit";

// Format a tool name from the catalog as a proper selector for runtime loading.
// If the name contains any character that is not a lowercase letter,
// digit, dash, or underscore, prefix it with 'ext:' so that the Tintin
// loader treats it as an extension selector rather than a plain builtin name.
export function formatToolName(name: string): string {
  if (!/^[a-z0-9\-]+$/.test(name)) return `ext:${name}`;
  return name;
}

// Runtime loaders split tools on commas; Pi and its extensions may register
// underscores, paths and selector prefixes. Keep the CSV boundaries and refuse
// uppercase, but do not require a tool to exist in this parent Pi session.
const toolSelectorSchema = pipe(
  string(),
  trim(),
  minLength(1),
  regex(/^[^,\r\n\p{Lu}\p{Cc}]+$/u),
);
const toolListSchema = pipe(
  string(),
  transform((value) => value.split(",")),
  array(toolSelectorSchema),
);

/** Snapshot of selectable Pi tools, not a save-time or child-runtime allowlist. */
export function createAvailableToolSchema(registeredNames: readonly string[]) {
  const names = [...new Set(registeredNames.filter((name) => {
    const result = safeParse(toolSelectorSchema, name);
    return result.success && result.output === name;
  }))];
  return picklist(names);
}

// Preserve the original agent creation form's essential-field policy. This is
// an authoring rule, not a claim that either runtime requires these fields.
export function validateAgentSavePolicy(frontmatter: AgentFrontmatter): string[] {
  const errors: string[] = [];
  const { name, description, tools, model } = frontmatter;

  if (typeof name !== "string" || !name.length)
    errors.push("Name is required");
  else {
    if (name.length > 48) errors.push("Name must be 48 characters or fewer");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      errors.push("Name must be lowercase letters, numbers, and dashes only");
  }

  if (typeof description !== "string" || description.length < 35)
    errors.push("Description must be at least 35 characters");
  if (typeof description === "string" && description.length > 1024)
    errors.push("Description must be 1024 characters or fewer");

  if (typeof tools !== "string" || !tools.length)
    errors.push("Tools are required");
  else if (!safeParse(toolListSchema, tools).success)
    errors.push("Tools must be a comma-separated list of nonempty selectors without uppercase letters");

  if (typeof model !== "string" || model.length < 2)
    errors.push("Model must be at least 2 characters");
  if (typeof model === "string") {
    if (model.length > 128) errors.push("Model must be 128 characters or fewer");
    if (!/^[a-z0-9:-]+$/.test(model)) errors.push("Model must be lowercase");
  }

  return errors;
}
