import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefinitionScope } from "#src/agents/loader";

const projectAgents = fileURLToPath(
  new URL("../../../.pi/agents", import.meta.url),
);

describe("the project's explorer agent", () => {
  it("can save its findings to a file", () => {
    const scope = loadDefinitionScope(projectAgents);
    expect(scope.errors).toEqual([]);
    const explorer = scope.definitions.find((entry) => entry.id === "explorer");
    expect(explorer).toBeDefined();
    if (!explorer) return;
    expect(explorer.patch.tools).toEqual({
      kind: "explicit",
      names: expect.arrayContaining([
        "read",
        "grep",
        "find",
        "ls",
        "write",
        "edit",
      ]),
    });
    expect(explorer.patch.instructions?.toLowerCase()).toContain("save");
  });
});
