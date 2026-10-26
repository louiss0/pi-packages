import { expect, it } from "vitest";
import { collectDefinitions } from "#src/agents/loader";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it.each([
  [
    "invalid recognized field",
    [
      {
        name: "explore.md",
        path: "/agents/explore.md",
        content: "---\nmax_turns: many\n---\n",
      },
    ],
  ],
  [
    "malformed YAML",
    [
      {
        name: "explore.md",
        path: "/agents/explore.md",
        content: "---\ndescription: [broken\n---\n",
      },
    ],
  ],
  [
    "duplicate identifier",
    [
      { name: "explore.md", path: "/agents/explore.md", content: "first" },
      { name: "Explore.md", path: "/agents/Explore.md", content: "second" },
    ],
  ],
])("rejects %s instead of falling back while unrelated agents remain usable", async (_problem, files) => {
  const scope = collectDefinitions(files);
  const h = await createSubagentsHarness({
    scopes: () => ({
      global: { definitions: [], errors: [] },
      project: scope,
    }),
  });
  try {
    const rejected = await h.service.launch("explore", "must not execute");
    expect(rejected).toMatchObject({
      kind: "rejected",
      reason: "configuration",
    });
    if (rejected.kind !== "rejected")
      throw new Error("invalid definition was accepted");
    expect(rejected.message).toContain("explore");
    expect(rejected.message).toContain("/agents/");
    expect(h.service.listAgents()).toEqual([]);
    expect(h.children.children).toHaveLength(0);
    const valid = await h.service.launch("reviewer", "valid unrelated role");
    expect(valid.kind).toBe("accepted");
    const child = await h.children.childBorn(0);
    (await child.runStarted(0)).settle();
    await h.service.waitForAll();
  } finally {
    await h.dispose();
  }
});
