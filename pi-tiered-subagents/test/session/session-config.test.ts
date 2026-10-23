import type { Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { defined, type Patch } from "#src/optional";
import type { AgentDefinition } from "#src/agents/definition";
import type { AgentDefinitionLookup } from "#src/agents/registry";
import type {
  AssemblerContext,
  AssemblerIO,
} from "#src/session/session-config";
import { makeModel } from "#test/helpers/make-model";

const mockSelect = vi.fn(
  (_id: string): { ok: true; definition: AgentDefinition } => ({
    ok: true,
    definition: {
      id: "explore",
      displayName: "Explore",
      description: "Fast codebase exploration agent",
      instructions: "You are Explore.",
      tools: { kind: "explicit", names: ["read"] },
      inheritContext: false,
      runInBackground: true,
      enabled: true,
      origin: "shipped",
    },
  }),
);
const mockFind = vi.fn((_id: string): AgentDefinition | undefined =>
  mockSelect("").ok ? mockSelect("").definition : undefined,
);
const mockBuildAgentPrompt: Mock<AssemblerIO["buildAgentPrompt"]> = vi.fn(
  () => "assembled system prompt",
);

/** Mock registry injected into assembleSessionConfig instead of module-level free functions. */
const mockAgentLookup: AgentDefinitionLookup = {
  select: mockSelect,
  find: mockFind,
  list: vi.fn(() => []),
};

import { assembleSessionConfig } from "#src/session/session-config";

const mockEnv = { isGitRepo: false, branch: "", platform: "linux" };

const mockRegistry = {
  find: vi.fn((): Model<any> | undefined => undefined),
  getAll: vi.fn((): Model<any>[] => []),
  getAvailable: vi.fn((): Model<any>[] => []),
};

const ctx: AssemblerContext = {
  cwd: "/tmp",
  parentSystemPrompt: "parent prompt",
  modelRegistry: mockRegistry,
  activeToolNames: ["read", "bash"],
};

const mockLoadProjectContext: Mock<AssemblerIO["loadProjectContext"]> = vi.fn(
  () => undefined,
);

/** IO stubs injected into assembleSessionConfig in place of module-level imports. */
const mockIO = {
  buildAgentPrompt: mockBuildAgentPrompt,
  loadProjectContext: mockLoadProjectContext,
};

/** The Explore agent config used across the model/thinking resolution tests. */
function exploreConfig(
  overrides: Patch<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "explore",
    displayName: "Explore",
    description: "test",
    instructions: "prompt",
    tools: { kind: "explicit", names: ["read"] },
    inheritContext: false,
    runInBackground: true,
    enabled: true,
    origin: "shipped",
    ...defined(overrides),
  };
}

beforeEach(() => {
  mockSelect.mockClear();
  mockFind.mockClear();
  mockBuildAgentPrompt.mockClear();
  mockLoadProjectContext.mockClear();
  mockRegistry.find.mockReset();
  mockRegistry.getAll.mockClear();
  mockRegistry.getAvailable.mockClear();
});

describe("assembleSessionConfig — default agent shape", () => {
  it("returns correct shape for Explore agent with defaults", () => {
    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.effectiveCwd).toBe("/tmp");
    expect(result.systemPrompt).toBe("assembled system prompt");
    expect(result.toolNames).toEqual(["read"]);
    expect(result.model).toBeUndefined();
    expect(result.thinkingLevel).toBeUndefined();
  });

  it("uses options.cwd as effectiveCwd when provided", () => {
    const result = assembleSessionConfig(
      "Explore",
      ctx,
      { cwd: "/tmp/worktree" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.effectiveCwd).toBe("/tmp/worktree");
  });

  it("falls back to ctx.cwd when options.cwd is not set", () => {
    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.effectiveCwd).toBe("/tmp");
  });

  it("systemPrompt reflects the parentSystemPrompt passed to buildAgentPrompt", () => {
    mockBuildAgentPrompt.mockImplementationOnce(
      (_config, _cwd, _env, inherited) =>
        `assembled:${inherited?.systemPrompt}`,
    );

    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.systemPrompt).toBe("assembled:parent prompt");
  });

  it("forwards the parent's cwd alongside its system prompt", () => {
    // The prompt builder needs the parent's cwd to redact the footer that text
    // claims — the child's own cwd is a separate argument.
    assembleSessionConfig(
      "Explore",
      ctx,
      { cwd: "/worktree" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      { name: "explore", instructions: "You are Explore." },
      "/worktree",
      mockEnv,
      {
        systemPrompt: "parent prompt",
        cwd: "/tmp",
        strategy: "full",
        portablePrompt: undefined,
      },
      mockLoadProjectContext,
    );
  });
});

describe("assembleSessionConfig — model resolution", () => {
  it("returns undefined model when no option, no config model, no parent", () => {
    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBeUndefined();
  });

  it("options.model wins over the parent's captured identity", () => {
    const explicitModel = makeModel({
      provider: "anthropic",
      id: "claude-opus-4",
    });
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ model: "anthropic/claude-haiku-4" }),
    });

    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: { provider: "anthropic", id: "claude-haiku-4" },
      },
      { model: explicitModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(explicitModel);
    // The identity never materializes: the launch's own model won.
    expect(mockRegistry.find).not.toHaveBeenCalled();
  });

  it("materializes the parent's model from the captured identity", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });
    mockRegistry.find.mockReturnValueOnce(parentModel);

    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: { provider: "anthropic", id: "claude-haiku-4" },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
    expect(mockRegistry.find).toHaveBeenCalledWith(
      "anthropic",
      "claude-haiku-4",
    );
  });

  it("fails explicitly when the captured identity can no longer be resolved", () => {
    // The session no longer reports the model the launch was asked under.
    // That is an execution failure, not permission to run another model.
    mockRegistry.find.mockReturnValueOnce(undefined);

    expect(() =>
      assembleSessionConfig(
        "Explore",
        {
          ...ctx,
          parentModelIdentity: { provider: "anthropic", id: "claude-haiku-4" },
        },
        {},
        mockEnv,
        mockAgentLookup,
        mockIO,
      ),
    ).toThrow(/no longer reports/);
  });

  it("uses the model the door resolved", () => {
    // The model is resolved by the door — the request's own choice, the
    // definition's, or the automatic step down the ladder — and the assembler
    // only passes it through, so the two doors cannot resolve differently.
    const resolvedModel = makeModel({
      provider: "anthropic",
      id: "claude-opus-4",
    });

    const result = assembleSessionConfig(
      "Explore",
      ctx,
      { model: resolvedModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(resolvedModel);
  });

  it("falls back to the parent's model when the door resolved none", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    mockRegistry.find.mockReturnValueOnce(parentModel);
    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: {
          provider: parentModel.provider,
          id: parentModel.id,
        },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("falls back to parentModel when config model string is not in registry", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ model: "anthropic/unknown-model" }),
    });

    mockRegistry.find.mockReturnValueOnce(parentModel);
    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: {
          provider: parentModel.provider,
          id: parentModel.id,
        },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("falls back to parentModel when config model is not available (not in getAvailable)", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ model: "anthropic/claude-opus-4" }),
    });
    // The definition's own model does not resolve (the door's job);
    // the child takes the parent's captured identity instead.

    mockRegistry.find.mockReturnValueOnce(parentModel);
    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: {
          provider: parentModel.provider,
          id: parentModel.id,
        },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("falls back to parentModel when config model has no slash", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ model: "claude-opus-4" }),
    }); // no provider/ prefix

    mockRegistry.find.mockReturnValueOnce(parentModel);
    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: {
          provider: parentModel.provider,
          id: parentModel.id,
        },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });

  it("returns parentModel when no config model and no option model", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    mockRegistry.find.mockReturnValueOnce(parentModel);
    const result = assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: {
          provider: parentModel.provider,
          id: parentModel.id,
        },
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.model).toBe(parentModel);
  });
});

describe("assembleSessionConfig — unknown type fallback", () => {
  it("passes resolved config directly to buildAgentPrompt", () => {
    // The registry answers with a definition; the assembler forwards whatever
    // it selects.
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({
        id: "general-purpose",
        description: "General-purpose",
        instructions: "",
      }),
    });

    mockBuildAgentPrompt.mockImplementationOnce(
      (config: { name: string }) => `resolved:${config.name}`,
    );

    const result = assembleSessionConfig(
      "unknown-custom-agent",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.systemPrompt).toBe("resolved:general-purpose");
  });
});

describe("assembleSessionConfig — thinking level", () => {
  it("returns undefined thinkingLevel when neither option nor config sets it", () => {
    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.thinkingLevel).toBeUndefined();
  });

  it("options.thinkingLevel wins over agentConfig.thinking", () => {
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ thinking: "low" }),
    });

    const result = assembleSessionConfig(
      "Explore",
      ctx,
      { thinkingLevel: "high" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.thinkingLevel).toBe("high");
  });

  it("agentConfig.thinking is used when no option is provided", () => {
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ thinking: "medium" }),
    });

    const result = assembleSessionConfig(
      "Explore",
      ctx,
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(result.thinkingLevel).toBe("medium");
  });
});

describe("assembleSessionConfig — prompt inheritance", () => {
  /** The strategy `buildAgentPrompt` was told to use for this assembly. */
  function strategyPassedToPrompt(): string | undefined {
    return mockBuildAgentPrompt.mock.calls[0]?.[3]?.strategy;
  }

  /** The provider `resolvePromptInheritance` was asked about. */
  const resolvePromptInheritance = vi.fn(
    (_provider: string | undefined): "full" | "portable" => "full",
  );

  beforeEach(() => {
    resolvePromptInheritance.mockClear();
    resolvePromptInheritance.mockImplementation(() => "full");
  });

  it("asks about the provider of the child's own resolved model", () => {
    const childModel = makeModel({ provider: "claude-bridge", id: "opus" });

    assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: { provider: "anthropic", id: "sonnet" },
        resolvePromptInheritance,
      },
      { model: childModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(resolvePromptInheritance).toHaveBeenCalledWith("claude-bridge");
  });

  it("asks about the provider named by the model's own string", () => {
    // The door resolved a model whose provider differs from the parent's, and
    // the prompt strategy is keyed on the child's own provider.
    const bridgeModel = makeModel({ provider: "claude-bridge", id: "opus" });
    mockSelect.mockReturnValueOnce({
      ok: true,
      definition: exploreConfig({ model: "claude-bridge/opus" }),
    });

    assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: { provider: "anthropic", id: "sonnet" },
        resolvePromptInheritance,
      },
      { model: bridgeModel },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(resolvePromptInheritance).toHaveBeenCalledWith("claude-bridge");
  });

  it("passes the resolved strategy to the prompt builder", () => {
    resolvePromptInheritance.mockImplementation(() => "portable");
    // The identity's provider keys the strategy without needing the live
    // object; the model itself materializes through the registry bridge.
    mockRegistry.find.mockReturnValueOnce(
      makeModel({ provider: "claude-bridge", id: "opus" }),
    );

    assembleSessionConfig(
      "Explore",
      {
        ...ctx,
        parentModelIdentity: { provider: "claude-bridge", id: "opus" },
        resolvePromptInheritance,
      },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(strategyPassedToPrompt()).toBe("portable");
    expect(resolvePromptInheritance).toHaveBeenCalledWith("claude-bridge");
  });

  it("hands the prompt builder the parent's portable parts", () => {
    assembleSessionConfig(
      "Explore",
      { ...ctx, parentPortablePrompt: "<project_context>…</project_context>" },
      {},
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(mockBuildAgentPrompt.mock.calls[0]?.[3]?.portablePrompt).toBe(
      "<project_context>…</project_context>",
    );
  });

  it("falls back to full when no resolver is supplied", () => {
    assembleSessionConfig("Explore", ctx, {}, mockEnv, mockAgentLookup, mockIO);

    expect(strategyPassedToPrompt()).toBe("full");
  });

  it("relays the project-context loader to the prompt builder", () => {
    // The builder decides whether this child needs its own block, so the
    // assembler must hand the loader over rather than calling it.
    assembleSessionConfig(
      "Explore",
      ctx,
      { cwd: "/workspace" },
      mockEnv,
      mockAgentLookup,
      mockIO,
    );

    expect(mockBuildAgentPrompt.mock.calls[0]?.[4]).toBe(
      mockLoadProjectContext,
    );
    expect(mockLoadProjectContext).not.toHaveBeenCalled();
  });
});
