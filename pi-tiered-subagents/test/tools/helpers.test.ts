import { describe, expect, it } from "vitest";
import {
  type AgentDefinition,
  defaultDefinition,
} from "#src/agents/definition";
import { defined, type Patch } from "#src/optional";
import type { TypeListRegistry } from "#src/tools/helpers";
import {
  buildAgentGuidelines,
  buildDetails,
  buildTypeListText,
  formatLifetimeTokens,
  getModelLabelFromConfig,
  textResult,
} from "#src/tools/helpers";
import type { AgentDetails } from "#src/ui/display";
import { createTestSubagent } from "#test/helpers/make-subagent";

/** Build a minimal TypeListRegistry stub for tests. */
function makeRegistry(opts: {
  definitions?: Patch<AgentDefinition>[];
}): TypeListRegistry {
  const definitions = (opts.definitions ?? []).map(
    (definition) =>
      ({
        ...defaultDefinition(definition.id ?? "agent", "shipped"),
        ...definition,
      }) as AgentDefinition,
  );
  return {
    select: (id: string) => {
      const definition = definitions.find((d) => d.id === id);
      return definition
        ? { ok: true as const, definition }
        : { ok: false as const, error: `Unknown agent type "${id}".` };
    },
    find: (id: string) => definitions.find((d) => d.id === id),
    list: () => definitions,
  };
}

describe("textResult", () => {
  it("wraps a message in the tool result shape", () => {
    const result = textResult("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: undefined,
    });
  });

  it("includes details when provided", () => {
    const details: AgentDetails = {
      displayName: "Agent",
      description: "",
      subagentType: "general-purpose",
      toolUses: 0,
      tokens: "",
      durationMs: 0,
      status: "completed",
    };
    const result = textResult("done", details);
    expect(result.details).toBe(details);
  });
});

describe("formatLifetimeTokens", () => {
  it("returns formatted string when tokens > 0", () => {
    const result = formatLifetimeTokens({
      lifetimeUsage: { input: 500, output: 500, cacheWrite: 0 },
    });
    expect(result).toBe("1.0k token");
  });

  it('returns "" when total is zero', () => {
    const result = formatLifetimeTokens({
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    });
    expect(result).toBe("");
  });

  it("formats large token counts with k suffix", () => {
    const result = formatLifetimeTokens({
      lifetimeUsage: { input: 15000, output: 18800, cacheWrite: 0 },
    });
    expect(result).toBe("33.8k token");
  });
});

describe("getModelLabelFromConfig", () => {
  it("strips provider prefix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("strips trailing date suffix", () => {
    expect(getModelLabelFromConfig("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5",
    );
  });

  it("strips both provider prefix and date suffix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5",
    );
  });

  it("returns the string as-is when no prefix or suffix", () => {
    expect(getModelLabelFromConfig("claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("handles model with multiple slashes", () => {
    expect(getModelLabelFromConfig("provider/sub/model-name")).toBe(
      "model-name",
    );
  });
});

describe("buildTypeListText", () => {
  it("lists the shipped specialists with their descriptions", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          displayName: "Worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- worker: Implements a scoped change");
    expect(result).toContain("Specialists:");
  });

  it("includes model suffix for agents that have a model set", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "explore",
          description: "Fast explorer",
          model: "anthropic/claude-haiku-4-5",
          origin: "shipped",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- explore: Fast explorer (claude-haiku-4-5)");
  });

  it("includes agentDir in the trailing hint line", () => {
    const registry = makeRegistry({});
    const result = buildTypeListText(registry, "/home/user/.pi");
    expect(result).toContain("/home/user/.pi");
  });

  it("adds a Custom agents section when a file-defined agent is present", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
        {
          id: "my-agent",
          description: "My custom agent",
          origin: "global",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("Custom agents:");
    expect(result).toContain("- my-agent: My custom agent");
  });

  it("excludes disabled agents from the list", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
        {
          id: "disabled",
          description: "Disabled agent",
          enabled: false,
          origin: "shipped",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).toContain("- worker: Implements a scoped change");
    expect(result).not.toContain("disabled");
  });

  it("omits the Custom agents section when no file-defined agents exist", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).not.toContain("Custom agents:");
  });

  it("omits the Specialists header when no shipped agents exist", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "my-agent",
          description: "My custom agent",
          origin: "global",
        },
      ],
    });
    const result = buildTypeListText(registry, "/home/.pi");
    expect(result).not.toContain("Specialists:");
  });
});

describe("buildAgentGuidelines", () => {
  it("names the shipped specialists and what they are for", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
        {
          id: "reviewer",
          description: "Reviews a scoped change",
          origin: "shipped",
        },
      ],
    });
    expect(buildAgentGuidelines(registry)).toEqual([
      "- Use worker for: Implements a scoped change",
      "- Use reviewer for: Reviews a scoped change",
    ]);
  });

  it("omits a disabled specialist's guideline line", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          origin: "shipped",
        },
        {
          id: "reviewer",
          description: "Reviews a scoped change",
          enabled: false,
          origin: "shipped",
        },
      ],
    });
    expect(buildAgentGuidelines(registry)).toEqual([
      "- Use worker for: Implements a scoped change",
    ]);
  });

  it("names no file-defined agent, because the caller already sees it listed", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "my-agent",
          description: "My custom agent",
          origin: "global",
        },
      ],
    });
    expect(buildAgentGuidelines(registry)).toEqual([]);
  });

  it("returns an empty array when every specialist is disabled", () => {
    const registry = makeRegistry({
      definitions: [
        {
          id: "worker",
          description: "Implements a scoped change",
          enabled: false,
          origin: "shipped",
        },
      ],
    });
    expect(buildAgentGuidelines(registry)).toEqual([]);
  });
});

describe("buildDetails", () => {
  // `defined(...)` strips the explicit `undefined`s: `buildDetails`' `base`
  // parameter type does not accept `| undefined` for `modelName`/`tags`, and
  // `Defined<>` keeps every field optional-but-absent.
  const base = defined({
    displayName: "TestAgent",
    description: "does stuff",
    subagentType: "general-purpose",
    modelName: undefined,
    tags: undefined,
  });
  const record = {
    toolUses: 3,
    startedAt: 1000,
    completedAt: 5000,
    status: "completed",
    error: undefined,
    id: "agent-42",
    lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
  };

  it("maps record fields to AgentDetails shape", () => {
    const details = buildDetails(base, record);
    expect(details.toolUses).toBe(3);
    expect(details.durationMs).toBe(4000);
    expect(details.status).toBe("completed");
    expect(details.agentId).toBe("agent-42");
  });

  it("leaves the turn budget undefined when the record has none", () => {
    expect(buildDetails(base, record).turnBudget).toBeUndefined();
  });

  it("carries the record's turn budget", () => {
    const details = buildDetails(
      base,
      createTestSubagent({
        turnBudget: { maxTurns: 2, used: 3, phase: "warned" },
      }),
    );
    expect(details.turnBudget).toEqual({
      maxTurns: 2,
      used: 3,
      phase: "warned",
    });
  });

  it("applies overrides on top of computed fields", () => {
    const details = buildDetails(base, record, { tokens: "99.9k token" });
    expect(details.tokens).toBe("99.9k token");
  });

  it("uses Date.now() for durationMs when completedAt is absent", () => {
    const openRecord = { ...record, completedAt: undefined };
    const before = Date.now();
    const details = buildDetails(base, openRecord);
    const after = Date.now();
    expect(details.durationMs).toBeGreaterThanOrEqual(
      before - openRecord.startedAt,
    );
    expect(details.durationMs).toBeLessThanOrEqual(
      after - openRecord.startedAt,
    );
  });

  describe("model label", () => {
    const spawnBase = { ...base, modelName: "anthropic/claude-sonnet-5-5" };

    it("labels the model the record runs, over the one resolved at spawn", () => {
      const details = buildDetails(spawnBase, {
        ...record,
        model: { provider: "openai", id: "gpt-5" },
      });
      expect(details.modelName).toBe("openai/gpt-5");
    });

    it("keeps the spawn-time label while the record's model is unknown", () => {
      const details = buildDetails(spawnBase, record);
      expect(details.modelName).toBe("anthropic/claude-sonnet-5-5");
    });
  });
});
