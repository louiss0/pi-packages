import { describe, expect, it } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import { resolveSpawnConfig } from "#src/tools/spawn-config";
import { makeModel, makeReasoningModel } from "#test/helpers/make-model";

/** The registry with the shipped specialists and no files. */
const testRegistry = new AgentRegistry(() => ({
  global: { definitions: [], errors: [] },
}));

/** A registry holding one definition file, for the cases that need one. */
function registryWith(
  id: string,
  patch: Record<string, unknown>,
): AgentRegistry {
  return new AgentRegistry(() => ({
    global: {
      definitions: [{ id, patch, path: `${id}.md` }],
      errors: [],
    },
  }));
}

/** Shorthand for building ModelInfo. */
function makeModelInfo(
  overrides: Partial<Parameters<typeof resolveSpawnConfig>[2]> = {},
) {
  return {
    parentModel: makeModel({ id: "claude-sonnet", name: "Claude Sonnet" }),
    modelRegistry: {
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    },
    routing: {
      available: [],
      profiles: new Map(),
      strategies: strategiesByFamily(SHIPPED_STRATEGIES),
    },
    ...overrides,
  };
}

const defaultSettings = { defaultMaxTurns: undefined as number | undefined };

/** The common parameters of a spawn request. */
function params(overrides: Record<string, unknown> = {}) {
  return {
    subagent_type: "worker",
    prompt: "test",
    description: "d",
    ...overrides,
  };
}

describe("resolveSpawnConfig — type resolution", () => {
  it("resolves a known agent type", () => {
    const result = resolveSpawnConfig(
      params({ subagent_type: "explore" }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result && result.error).toBeFalsy();
    if ("error" in result) return;
    expect(result.identity.subagentType).toBe("explore");
    expect(result.identity.displayName).toBe("Explore");
  });

  it("rejects an unknown agent type rather than running another one", () => {
    const result = resolveSpawnConfig(
      params({ subagent_type: "unknown-type" }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain('Unknown agent type "unknown-type"');
  });

  it("rejects a disabled agent type", () => {
    const registry = registryWith("explore", { enabled: false });
    const result = resolveSpawnConfig(
      params({ subagent_type: "explore" }),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain('Agent "explore" is disabled');
  });

  it("resolves an identifier case-insensitively", () => {
    const result = resolveSpawnConfig(
      params({ subagent_type: "EXPLORE" }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.identity.subagentType).toBe("explore");
  });

  it("uses the display name a definition file sets", () => {
    const registry = registryWith("explore", { displayName: "Scout" });
    const result = resolveSpawnConfig(
      params({ subagent_type: "explore" }),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.identity.displayName).toBe("Scout");
  });
});

describe("resolveSpawnConfig — model resolution", () => {
  it("inherits parent model when no model specified", () => {
    const parentModel = makeModel({
      id: "claude-sonnet",
      name: "Claude Sonnet",
    });
    const result = resolveSpawnConfig(
      params(),
      testRegistry,
      makeModelInfo({ parentModel }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.model).toBe(parentModel);
  });

  it("returns error when user-specified model cannot be resolved", () => {
    const result = resolveSpawnConfig(
      params({ model: "nonexistent-xyz" }),
      testRegistry,
      makeModelInfo({
        modelRegistry: {
          find: () => undefined,
          getAll: () => [],
          getAvailable: () => [],
        },
      }),
      defaultSettings,
    );
    expect("error" in result && result.error).toBeTruthy();
  });
});

describe("resolveSpawnConfig — model label", () => {
  const parentModel = makeModel({
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
  });
  const haiku = makeModel({
    provider: "anthropic",
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
  });
  const registryWithHaiku = {
    find: (provider: string, id: string) =>
      provider === haiku.provider && id === haiku.id ? haiku : undefined,
    getAll: () => [haiku],
    getAvailable: () => [haiku],
  };

  function modelNameFor(
    request: Record<string, unknown>,
    modelInfo: Parameters<typeof resolveSpawnConfig>[2],
  ) {
    const result = resolveSpawnConfig(
      params(request),
      testRegistry,
      modelInfo,
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    return result.presentation.detailBase.modelName;
  }

  it("labels an inherited model even though it matches the parent's", () => {
    expect(modelNameFor({}, makeModelInfo({ parentModel }))).toBe(
      "anthropic/claude-sonnet-5-5",
    );
  });

  it("labels a requested model as provider/id, not its display name", () => {
    expect(
      modelNameFor(
        { model: "anthropic/claude-haiku-4-5" },
        makeModelInfo({ parentModel, modelRegistry: registryWithHaiku }),
      ),
    ).toBe("anthropic/claude-haiku-4-5");
  });

  it("leaves the label unset when no model resolved", () => {
    expect(
      modelNameFor({}, makeModelInfo({ parentModel: undefined })),
    ).toBeUndefined();
  });
});

describe("resolveSpawnConfig — max turns normalization", () => {
  it("normalizes max_turns from params", () => {
    const result = resolveSpawnConfig(
      params({ max_turns: 10 }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(10);
  });

  it("takes the definition's turn ceiling when the request names none", () => {
    const registry = registryWith("worker", { maxTurns: 8 });
    const result = resolveSpawnConfig(
      params(),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(8);
  });

  it("lets the request win over the definition's turn ceiling", () => {
    const registry = registryWith("worker", { maxTurns: 8 });
    const result = resolveSpawnConfig(
      params({ max_turns: 3 }),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(3);
  });

  it("uses settings defaultMaxTurns when no max_turns in params", () => {
    const result = resolveSpawnConfig(params(), testRegistry, makeModelInfo(), {
      defaultMaxTurns: 25,
    });
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(25);
  });

  it("returns undefined effectiveMaxTurns when neither params nor settings specify", () => {
    const result = resolveSpawnConfig(
      params(),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBeUndefined();
  });

  it("advises when the ceiling was raised to the minimum", () => {
    const result = resolveSpawnConfig(
      params({ max_turns: 1 }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.notes.join("\n")).toContain("below the minimum");
  });
});

describe("resolveSpawnConfig — invocation fields", () => {
  it("sets runInBackground from params", () => {
    const result = resolveSpawnConfig(
      params({ run_in_background: true }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.runInBackground).toBe(true);
  });

  it("takes the definition's background mode when the request names none", () => {
    const registry = registryWith("worker", { runInBackground: false });
    const result = resolveSpawnConfig(
      params(),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.runInBackground).toBe(false);
  });

  it("takes the definition's conversation mode when the request names none", () => {
    const registry = registryWith("worker", { inheritContext: true });
    const result = resolveSpawnConfig(
      params(),
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.inheritContext).toBe(true);
  });

  it("takes the definition's thinking level when the request names none", () => {
    const registry = registryWith("worker", { thinking: "low" });
    const result = resolveSpawnConfig(
      params(),
      registry,
      makeModelInfo({ parentModel: makeReasoningModel() }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.thinking).toBe("low");
  });

  it("lets the request's thinking level win over the definition's", () => {
    const registry = registryWith("worker", { thinking: "low" });
    const result = resolveSpawnConfig(
      params({ thinking: "high" }),
      registry,
      makeModelInfo({ parentModel: makeReasoningModel() }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.thinking).toBe("high");
  });

  it("discards the thinking level for a model that does not reason", () => {
    const registry = registryWith("worker", { thinking: "low" });
    const result = resolveSpawnConfig(
      params(),
      registry,
      makeModelInfo({ parentModel: makeModel() }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.thinking).toBeUndefined();
    expect(result.execution.thinkingDecision.applicable).toBe(false);
  });

  it("rejects a thinking level Pi does not know", () => {
    const result = resolveSpawnConfig(
      params({ thinking: "extreme" }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result).toBe(true);
  });
});

describe("resolveSpawnConfig — detailBase and tags", () => {
  it("builds detailBase with description from params", () => {
    const result = resolveSpawnConfig(
      params({ description: "my task" }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.detailBase.description).toBe("my task");
    expect(result.presentation.detailBase.subagentType).toBe("worker");
    expect(result.presentation.detailBase.displayName).toBe("Worker");
  });

  it("includes thinking tag when thinking is set", () => {
    const result = resolveSpawnConfig(
      params({ thinking: "high" }),
      testRegistry,
      makeModelInfo({ parentModel: makeReasoningModel() }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.agentTags).toContain("thinking: high");
  });

  it("tags a background run", () => {
    const result = resolveSpawnConfig(
      params({ run_in_background: true }),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.agentTags).toContain("background");
  });

  it("tags the background default the shipped specialists carry", () => {
    const result = resolveSpawnConfig(
      params(),
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.agentTags).toEqual(["background"]);
  });
});
