import { safeParse } from "valibot";
import { createAvailableToolSchema, DEFAULT_AGENT_TOOLS, validateAgentSavePolicy } from "./agent-save-policy";

const valid = {
  name: "review-agent",
  description: "a".repeat(35),
  tools: "read, bash:tool",
  model: "claude:high",
};

describe("agent save policy", () => {
  it("requires four essentials but leaves advanced settings optional", () => {
    expect(validateAgentSavePolicy({})).toEqual(expect.arrayContaining([
      "Name is required",
      "Description must be at least 35 characters",
      "Tools are required",
      "Model must be at least 2 characters",
    ]));
    expect(validateAgentSavePolicy(valid)).toEqual([]);
    expect(validateAgentSavePolicy({ ...valid, enabled: false })).toEqual([]);
  });

  it.each([
    [{ name: "a".repeat(49) }, "Name must be 48 characters or fewer"],
    [{ name: "Mixed-Case" }, "Name must be lowercase letters, numbers, and dashes only"],
    [{ description: "a".repeat(34) }, "Description must be at least 35 characters"],
    [{ description: "a".repeat(1025) }, "Description must be 1024 characters or fewer"],
    [{ tools: "Read,grep" }, "Tools must be a comma-separated list of nonempty selectors without uppercase letters"],
    [{ tools: ["read"] }, "Tools are required"],
    [{ model: "c" }, "Model must be at least 2 characters"],
    [{ model: "c".repeat(129) }, "Model must be 128 characters or fewer"],
    [{ model: "Claude" }, "Model must be lowercase"],
  ])("preserves name, description and model rules while rejecting uppercase tools", (change, message) => {
    expect(validateAgentSavePolicy({ ...valid, ...change })).toContain(message);
  });

  it("accepts Pi names and both loaders' selector forms without requiring the parent session to have them", () => {
    expect(DEFAULT_AGENT_TOOLS).toBe("read,write,edit");
    expect(validateAgentSavePolicy({ ...valid, tools: "read,write,edit,echo_session,ext:my-package/tool,mcp:github/search" })).toEqual([]);
    expect(validateAgentSavePolicy({ ...valid, tools: "read,,edit" })).toContain("Tools must be a comma-separated list of nonempty selectors without uppercase letters");
    expect(validateAgentSavePolicy({ ...valid, tools: "read,foo\nbar" })).toContain("Tools must be a comma-separated list of nonempty selectors without uppercase letters");
  });

  it("makes an advisory Valibot picklist from the registered Pi tools", () => {
    const catalog = createAvailableToolSchema(["read", "echo_session", "read", "Uppercase", "bad,selector", "mcp:github/search"]);
    expect(catalog.options).toEqual(["read", "echo_session", "mcp:github/search"]);
    expect(safeParse(catalog, "echo_session").success).toBe(true);
    expect(safeParse(catalog, "other_runtime_tool").success).toBe(false);
    expect(validateAgentSavePolicy({ ...valid, tools: "other_runtime_tool" })).toEqual([]);
  });

  it("accepts the original inclusive length boundaries", () => {
    expect(validateAgentSavePolicy({ ...valid, name: "a".repeat(48), description: "b".repeat(1024), model: "c".repeat(128) })).toEqual([]);
  });
});
