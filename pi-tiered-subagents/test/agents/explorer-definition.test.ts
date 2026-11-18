import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefinitionScope } from "#src/agents/loader";
import { buildCatalog } from "#src/agents/registry";

const projectAgents = fileURLToPath(
  new URL("../../../.pi/agents", import.meta.url),
);

describe("the project's explore agent", () => {
  it("overrides the shipped specialist with write tools", () => {
    const project = loadDefinitionScope(projectAgents);
    const catalog = buildCatalog({
      global: { definitions: [], errors: [] },
      project,
    });

    expect(catalog.list().map((entry) => entry.id)).toEqual([
      "debug",
      "explore",
      "researcher",
      "reviewer",
      "worker",
    ]);
    const explore = catalog.find("explore");
    expect(explore?.origin).toBe("project");
    expect(explore?.tools).toEqual({
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
    expect(explore?.instructions.toLowerCase()).toContain("save");
  });
});
