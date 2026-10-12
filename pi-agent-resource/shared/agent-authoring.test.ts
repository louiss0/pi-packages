import { AGENT_PROFILES, type AgentFrontmatter } from "./agent-contracts";
import { askAgentFilename, authorAgentDefinition, isSafeAgentFilename } from "./agent-authoring";

function uiWith(choices: Array<string | undefined>, inputs: Array<string | undefined> = []) {
  return {
    select: vi.fn(async () => choices.shift()),
    input: vi.fn(async () => inputs.shift()),
    editor: vi.fn(async () => "Write a focused report.\nKeep Markdown."),
    notify: vi.fn(),
    confirm: vi.fn(async () => true),
    custom: vi.fn(async <T>() => undefined as T),
  } as any;
}

describe("structured agent authoring", () => {
  const essentials: AgentFrontmatter = {
    name: "reviewer",
    description: "Review the code thoroughly and report any problems",
    tools: "read,grep",
    model: "claude",
  };
  it.each(["../escape", "a/b", "a\\b", ".hidden", "nul", "COM1", "a.md", "", "name:plugin"]) ("rejects unsafe filename %s", (name) => {
    expect(isSafeAgentFilename(name)).toBe(false);
  });
  it("keeps filenames independent of dispatch names", () => {
    expect(isSafeAgentFilename("blubb")).toBe(true);
    expect(isSafeAgentFilename("Mixed_Case-1")).toBe(true);
  });
  it("retries invalid filename input and supports cancellation", async () => {
    const ui = uiWith([], ["../no", "valid"]);
    expect(await askAgentFilename(ui)).toBe("valid");
    expect(ui.notify).toHaveBeenCalled();
    expect(await askAgentFilename(uiWith([], [undefined]))).toBeUndefined();
  });
  it.each(["tintin", "nico"] as const)("requires the four essential fields before saving %s", async (runtime) => {
    const ui = uiWith(["Review and save", "Cancel"]);
    expect(await authorAgentDefinition(ui, runtime, { frontmatter: {}, body: "Prompt" })).toBeUndefined();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Name is required"), "error");
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Tools are required"), "error");
  });
  it("edits Markdown without $EDITOR when essentials are valid", async () => {
    const ui = uiWith(["Prompt body", "Review and save"]);
    const frontmatter = { name: "reviewer", description: "Review the code thoroughly and report any problems", tools: "read,grep", model: "claude" };
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter, body: "" });
    expect(result).toEqual({ frontmatter, body: "Write a focused report.\nKeep Markdown." });
    expect(ui.editor).toHaveBeenCalledWith(expect.stringContaining("Markdown body only"), "");
  });
  it.each([
    [{ name: "Mixed", description: "Review the code thoroughly and report any problems", tools: "read,grep", model: "claude" }, "Name must be lowercase"],
    [{ name: "reviewer", description: "short", tools: "read,grep", model: "claude" }, "Description must be at least 35"],
    [{ name: "reviewer", description: "Review the code thoroughly and report any problems", tools: "Read,write", model: "claude" }, "Tools must be a comma-separated"],
    [{ name: "reviewer", description: "Review the code thoroughly and report any problems", tools: "read,grep", model: "Claude" }, "Model must be lowercase"],
  ])("rejects an invalid essential field on save", async (frontmatter, message) => {
    const ui = uiWith(["Review and save", "Cancel"]);
    expect(await authorAgentDefinition(ui, "tintin", { frontmatter, body: "Prompt" })).toBeUndefined();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining(message), "error");
  });
  it("offers registered Pi tools through a Valibot-backed catalog without overriding manual choices", async () => {
    const ui = uiWith(["Basic settings", 'tools: "read,grep"', "Add registered Pi tool", "Back", "Review and save"]);
    // Mock multiselect to add "write" to existing selection
    ui.custom.mockImplementation(async () => ["read", "grep", "write"]);
    const result = await authorAgentDefinition(ui, "nico", { frontmatter: essentials, body: "Prompt" }, ["read", "write", "Uppercase", "write"]);
    expect(result?.frontmatter.tools).toBe("read,grep,write");
  });
  it("does not accept an arbitrary value returned by the catalog picker", async () => {
    const ui = uiWith(["Basic settings", 'tools: "read,grep"', "Add registered Pi tool", "not_registered", "Back", "Review and save"]);
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter: essentials, body: "Prompt" }, ["read", "write"]);
    expect(result?.frontmatter.tools).toBe("read,grep");
  });
  it("opens the Markdown body automatically after valid basic settings on create", async () => {
    const ui = uiWith(["Basic settings", "Back", "Review and save"]);
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter: essentials, body: "" }, [], "create");
    expect(result?.body).toBe("Write a focused report.\nKeep Markdown.");
    expect(ui.editor).toHaveBeenCalledExactlyOnceWith("Agent system prompt (Markdown body only)", "");
  });
  it("does not open step two until the basic save policy passes", async () => {
    const ui = uiWith(["Basic settings", "Back", "Cancel"]);
    expect(await authorAgentDefinition(ui, "nico", { frontmatter: {}, body: "" }, [], "create")).toBeUndefined();
    expect(ui.editor).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Name is required"), "error");
  });
  it("opens the body before review even when creation skips the basic menu", async () => {
    const ui = uiWith(["Review and save"]);
    const result = await authorAgentDefinition(ui, "nico", { frontmatter: essentials, body: "" }, [], "create");
    expect(ui.editor).toHaveBeenCalledOnce();
    expect(result?.body).toBe("Write a focused report.\nKeep Markdown.");
  });
  it("can revisit metadata without reopening the body, and edits remain menu-driven", async () => {
    const creating = uiWith(["Basic settings", "Back", "Basic settings", "Back", "Review and save"]);
    await authorAgentDefinition(creating, "tintin", { frontmatter: essentials, body: "" }, [], "create");
    expect(creating.editor).toHaveBeenCalledOnce();
    const editing = uiWith(["Basic settings", "Back", "Review and save"]);
    await authorAgentDefinition(editing, "tintin", { frontmatter: essentials, body: "Existing prompt" }, [], "edit");
    expect(editing.editor).not.toHaveBeenCalled();
  });
  it("requires a separate intentional-empty-prompt confirmation", async () => {
    const ui = uiWith(["Review and save", "Cancel"]);
    ui.confirm.mockResolvedValue(false);
    expect(await authorAgentDefinition(ui, "tintin", { frontmatter: { name: "reviewer", description: "Review the code thoroughly and report any problems", tools: "read", model: "claude" }, body: "" })).toBeUndefined();
    expect(ui.confirm).toHaveBeenCalledWith("Empty system prompt", expect.any(String));
  });
  it("edits an optional typed list without treating [] as omission", async () => {
    const ui = uiWith(["Advanced settings", "Context", "skills: omitted", "list", "Done", "Back", "Review and save"]);
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter: essentials, body: "Prompt" });
    expect(result?.frontmatter).toEqual({ ...essentials, skills: [] });
  });
  it("allows explicit false without turning it into native defaults", async () => {
    const field = AGENT_PROFILES.tintin.fields.find((field) => field.key === "enabled");
    if (!field) throw new Error("enabled contract missing");
    const ui = uiWith(["Advanced settings", field.group, "enabled: omitted", "boolean", "false", "Back", "Review and save"]);
    expect((await authorAgentDefinition(ui, "tintin", { frontmatter: essentials, body: "Prompt" }))?.frontmatter).toEqual({ ...essentials, enabled: false });
  });
  it("omits an optional setting only when explicitly requested", async () => {
    const initial: AgentFrontmatter = { ...essentials, skills: "review" };
    const ui = uiWith(["Advanced settings", "Context", 'skills: "review"', "Omit (use runtime default)", "Back", "Review and save"]);
    expect((await authorAgentDefinition(ui, "tintin", { frontmatter: initial, body: "Prompt" }))?.frontmatter).toEqual(essentials);
    expect(initial).toEqual({ ...essentials, skills: "review" });
  });
  it("cancellation never mutates the initial definition", async () => {
    const initial = { frontmatter: { name: "original" }, body: "Prompt" };
    expect(await authorAgentDefinition(uiWith(["Prompt body", "Cancel"]), "tintin", initial)).toBeUndefined();
    expect(initial).toEqual({ frontmatter: { name: "original" }, body: "Prompt" });
  });
});
