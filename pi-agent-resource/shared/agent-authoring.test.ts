import { AGENT_PROFILES, type AgentFrontmatter } from "./agent-contracts";
import { askAgentFilename, authorAgentDefinition, isSafeAgentFilename } from "./agent-authoring";

function uiWith(choices: Array<string | undefined>, inputs: Array<string | undefined> = []) {
  return {
    select: vi.fn(async () => choices.shift()),
    input: vi.fn(async () => inputs.shift()),
    editor: vi.fn(async () => "Write a focused report.\nKeep Markdown."),
    notify: vi.fn(),
    confirm: vi.fn(async () => true),
  };
}

describe("structured agent authoring", () => {
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
  it("leaves model and tool defaults omitted and edits Markdown without $EDITOR", async () => {
    const ui = uiWith(["Prompt body", "Review and save"]);
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter: {}, body: "" });
    expect(result).toEqual({ frontmatter: {}, body: "Write a focused report.\nKeep Markdown." });
    expect(ui.editor).toHaveBeenCalledWith(expect.stringContaining("Markdown body only"), "");
  });
  it("requires a separate intentional-empty-prompt confirmation", async () => {
    const ui = uiWith(["Review and save", "Cancel"]);
    ui.confirm.mockResolvedValue(false);
    expect(await authorAgentDefinition(ui, "tintin", { frontmatter: {}, body: "" })).toBeUndefined();
    expect(ui.confirm).toHaveBeenCalledWith("Empty system prompt", expect.any(String));
  });
  it("edits a typed list without treating [] as omission", async () => {
    const ui = uiWith(["Basic settings", "tools: omitted", "list", "Done", "Back", "Review and save"]);
    const result = await authorAgentDefinition(ui, "tintin", { frontmatter: {}, body: "Prompt" });
    expect(result?.frontmatter).toEqual({ tools: [] });
  });
  it("allows explicit false without turning it into native defaults", async () => {
    const field = AGENT_PROFILES.tintin.fields.find((field) => field.key === "enabled");
    if (!field) throw new Error("enabled contract missing");
    const ui = uiWith(["Advanced settings", field.group, "enabled: omitted", "boolean", "false", "Back", "Review and save"]);
    expect((await authorAgentDefinition(ui, "tintin", { frontmatter: {}, body: "Prompt" }))?.frontmatter).toEqual({ enabled: false });
  });
  it("omits a setting only when explicitly requested", async () => {
    const initial: AgentFrontmatter = { model: "anthropic/claude-opus-4-6" };
    const ui = uiWith(["Basic settings", 'model: "anthropic/claude-opus-4-6"', "Omit (use runtime default)", "Back", "Review and save"]);
    expect((await authorAgentDefinition(ui, "tintin", { frontmatter: initial, body: "Prompt" }))?.frontmatter).toEqual({});
    expect(initial).toEqual({ model: "anthropic/claude-opus-4-6" });
  });
  it("cancellation never mutates the initial definition", async () => {
    const initial = { frontmatter: { name: "original" }, body: "Prompt" };
    expect(await authorAgentDefinition(uiWith(["Prompt body", "Cancel"]), "tintin", initial)).toBeUndefined();
    expect(initial).toEqual({ frontmatter: { name: "original" }, body: "Prompt" });
  });
});
