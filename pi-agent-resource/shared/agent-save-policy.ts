import type { AgentFrontmatter } from "./agent-contracts";

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
  else if (!/^[a-z0-9:-]+(?:\s*,\s*[a-z0-9:-]+)*$/.test(tools))
    errors.push("Tools must be a lowercase comma-separated list");

  if (typeof model !== "string" || model.length < 2)
    errors.push("Model must be at least 2 characters");
  if (typeof model === "string") {
    if (model.length > 128) errors.push("Model must be 128 characters or fewer");
    if (!/^[a-z0-9:-]+$/.test(model)) errors.push("Model must be lowercase");
  }

  return errors;
}
