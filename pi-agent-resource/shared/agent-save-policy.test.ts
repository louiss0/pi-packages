import { validateAgentSavePolicy } from "./agent-save-policy";

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
    [{ tools: "Read,grep" }, "Tools must be a lowercase comma-separated list"],
    [{ tools: ["read"] }, "Tools are required"],
    [{ model: "c" }, "Model must be at least 2 characters"],
    [{ model: "c".repeat(129) }, "Model must be 128 characters or fewer"],
    [{ model: "Claude" }, "Model must be lowercase"],
  ])("preserves the original format and length rule", (change, message) => {
    expect(validateAgentSavePolicy({ ...valid, ...change })).toContain(message);
  });

  it("accepts the original inclusive length boundaries", () => {
    expect(validateAgentSavePolicy({ ...valid, name: "a".repeat(48), description: "b".repeat(1024), model: "c".repeat(128) })).toEqual([]);
  });
});
