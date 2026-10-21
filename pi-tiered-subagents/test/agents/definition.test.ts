import { describe, expect, it } from "vitest";
import {
  type AgentDefinition,
  type AgentDefinitionPatch,
  defaultDefinition,
  isSubagentTool,
  mergeDefinition,
  normalizeAgentId,
  resolveChildToolNames,
} from "#src/agents/definition";

/** A base definition to layer patches onto. */
const BASE: AgentDefinition = {
  id: "reviewer",
  displayName: "Reviewer",
  description: "Independent assessment of a scoped change",
  instructions: "Assess the change.",
  tools: { kind: "explicit", names: ["read", "grep", "find"] },
  model: "anthropic/claude-sonnet-5",
  thinking: "medium",
  maxTurns: 12,
  inheritContext: false,
  runInBackground: true,
  enabled: true,
  origin: "shipped",
};

describe("mergeDefinition", () => {
  it("keeps every inherited value when the patch says nothing", () => {
    const merged = mergeDefinition(BASE, {}, "global");
    expect(merged).toEqual({ ...BASE, origin: "global" });
  });

  it("replaces a value the patch names", () => {
    const merged = mergeDefinition(
      BASE,
      { description: "A different description" },
      "global",
    );
    expect(merged.description).toBe("A different description");
    expect(merged.displayName).toBe("Reviewer");
  });

  it("clears an inherited model when the patch clears it", () => {
    const merged = mergeDefinition(BASE, { model: null }, "project");
    expect(merged.model).toBeUndefined();
  });

  it("clears an inherited thinking level when the patch clears it", () => {
    const merged = mergeDefinition(BASE, { thinking: null }, "project");
    expect(merged.thinking).toBeUndefined();
  });

  it("keeps the tool restrictions when the patch names no tools", () => {
    const merged = mergeDefinition(BASE, { description: "Other" }, "global");
    expect(merged.tools).toEqual({
      kind: "explicit",
      names: ["read", "grep", "find"],
    });
  });

  it("replaces the tool selection with an explicit list", () => {
    const merged = mergeDefinition(
      BASE,
      { tools: { kind: "explicit", names: ["read"] } },
      "project",
    );
    expect(merged.tools).toEqual({ kind: "explicit", names: ["read"] });
  });

  it("keeps an empty tool list empty rather than treating it as inherit", () => {
    const merged = mergeDefinition(
      BASE,
      { tools: { kind: "explicit", names: [] } },
      "project",
    );
    expect(merged.tools).toEqual({ kind: "explicit", names: [] });
  });

  it("replaces the tool selection with inheritance when the patch says inherit", () => {
    const merged = mergeDefinition(
      BASE,
      { tools: { kind: "inherit" } },
      "project",
    );
    expect(merged.tools).toEqual({ kind: "inherit" });
  });

  it("does not concatenate tool lists across layers", () => {
    const global = mergeDefinition(
      BASE,
      { tools: { kind: "explicit", names: ["read", "grep"] } },
      "global",
    );
    const project = mergeDefinition(
      global,
      { tools: { kind: "explicit", names: ["find"] } },
      "project",
    );
    expect(project.tools).toEqual({ kind: "explicit", names: ["find"] });
  });

  it("inherits the instructions when the body is empty", () => {
    const merged = mergeDefinition(BASE, { instructions: "" }, "global");
    expect(merged.instructions).toBe("Assess the change.");
  });

  it("replaces the instructions when the body is not empty", () => {
    const merged = mergeDefinition(
      BASE,
      { instructions: "Do it differently." },
      "project",
    );
    expect(merged.instructions).toBe("Do it differently.");
  });

  it("clears the instructions when the patch clears them", () => {
    const merged = mergeDefinition(BASE, { instructions: null }, "project");
    expect(merged.instructions).toBe("");
  });

  it("records the layer the definition came from", () => {
    expect(mergeDefinition(BASE, {}, "project").origin).toBe("project");
  });

  it("resets a cleared required field to its default", () => {
    const merged = mergeDefinition(
      BASE,
      { displayName: null, enabled: null },
      "project",
    );
    expect(merged.displayName).toBe("reviewer");
    expect(merged.enabled).toBe(true);
  });
});

describe("defaultDefinition", () => {
  it("inherits the parent's tools and starts a fresh conversation", () => {
    const definition = defaultDefinition("custom", "global");
    expect(definition.tools).toEqual({ kind: "inherit" });
    expect(definition.inheritContext).toBe(false);
    expect(definition.runInBackground).toBe(true);
    expect(definition.enabled).toBe(true);
  });
});

describe("resolveChildToolNames", () => {
  it("takes the parent's active tools when the selection inherits", () => {
    expect(
      resolveChildToolNames({ kind: "inherit" }, ["read", "bash", "edit"]),
    ).toEqual(["read", "bash", "edit"]);
  });

  it("takes the named tools when the selection is explicit", () => {
    expect(
      resolveChildToolNames({ kind: "explicit", names: ["read", "grep"] }, [
        "read",
        "bash",
        "edit",
      ]),
    ).toEqual(["read", "grep"]);
  });

  it("keeps an explicit tool the parent does not have active", () => {
    expect(
      resolveChildToolNames({ kind: "explicit", names: ["grep"] }, ["read"]),
    ).toEqual(["grep"]);
  });

  it("strips the subagent-management tools from an inherited selection", () => {
    expect(
      resolveChildToolNames({ kind: "inherit" }, [
        "read",
        "subagent",
        "get_subagent_result",
        "steer_subagent",
        "bash",
      ]),
    ).toEqual(["read", "bash"]);
  });

  it("strips the subagent-management tools from an explicit selection", () => {
    expect(
      resolveChildToolNames(
        { kind: "explicit", names: ["read", "subagent"] },
        [],
      ),
    ).toEqual(["read"]);
  });

  it("gives an explicitly empty selection no tools at all", () => {
    expect(
      resolveChildToolNames({ kind: "explicit", names: [] }, ["read"]),
    ).toEqual([]);
  });
});

describe("isSubagentTool", () => {
  it("names the tools this package registers", () => {
    expect(isSubagentTool("subagent")).toBe(true);
    expect(isSubagentTool("get_subagent_result")).toBe(true);
    expect(isSubagentTool("steer_subagent")).toBe(true);
    expect(isSubagentTool("read")).toBe(false);
  });
});

describe("normalizeAgentId", () => {
  it("lowercases and trims an identifier", () => {
    expect(normalizeAgentId("  Reviewer ")).toBe("reviewer");
  });
});

describe("AgentDefinitionPatch", () => {
  it("accepts a patch that names nothing", () => {
    const patch: AgentDefinitionPatch = {};
    expect(patch).toEqual({});
  });
});
