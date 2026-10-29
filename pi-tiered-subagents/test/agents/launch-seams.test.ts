/**
 * The launch seams: what a child actually gets when a request names an agent.
 *
 * The configuration resolver is pure and the domain is unit-tested; this file
 * exercises the two doors a request travels through — the `subagent` tool and
 * the programmatic service — and inspects the resulting child session's tool
 * selection and records.
 */

/**
 * The nth recorded entry of a mock — a call tuple, a result, or an order stamp.
 *
 * Every use is preceded by an assertion that the call happened, so "no call"
 * is a failed expectation rather than something the type system must allow for.
 */
function callAt<T>(values: readonly T[], index = 0): T {
  const value = values[index];
  if (value === undefined)
    throw new Error(`expected entry #${index} to be recorded`);
  return value;
}

import { defined } from "#src/optional";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentDefinition,
  defaultDefinition,
  resolveChildToolNames,
} from "#src/agents/definition";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import type { ModelInfo } from "#src/agents/resolver";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import { SubagentsTestDriver } from "#test/helpers/subagents-driver";
import { Subagents } from "#src/service/subagents";
import { assembleSessionConfig } from "#src/session/session-config";
import type { AssemblerIO } from "#src/session/session-config";
import { createAgentTool } from "../../extensions/index";
import { buildAgentGuidelines, buildTypeListText } from "#src/tools/helpers";
import { resolveSpawnConfig } from "#src/tools/spawn-config";
import { createToolDeps } from "#test/helpers/make-deps";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { makeModel, makeReasoningModel } from "#test/helpers/make-model";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";

/** A registry with one definition file, for the cases that need one. */
function registryWith(
  id: string,
  patch: Record<string, unknown>,
): AgentRegistry {
  return new AgentRegistry(() => ({
    global: {
      definitions: [{ id, patch, path: `${id}.md` }],
      errors: [],
    },
    project: { definitions: [], errors: [] },
  }));
}

function createPreparer(registry: AgentRegistry, modelInfo: () => ModelInfo) {
  return new LaunchPreparer({
    loadScopes: async () => registry.currentScopes(),
    modelInfo,
    turnSettings: () => ({
      defaultMaxTurns: undefined,
      wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
    }),
    childShaping: () => ({
      midRunUpdates: true,
      excludedExtensionPackages: [],
      promptInheritance: {},
    }),
  });
}

/** The assembler's IO, stubbed to the two collaborators it uses. */
const assemblerIO: AssemblerIO = {
  buildAgentPrompt: vi.fn(() => "system prompt"),
  loadProjectContext: vi.fn(() => undefined),
};

/** The model registry the assembler reads. */
const modelRegistry = {
  find: () => undefined,
  getAll: () => [],
  getAvailable: () => [],
};

describe("the tool door", () => {
  it("refuses an unknown agent type instead of running another one", async () => {
    const deps = createToolDeps();
    const tool = createAgentTool({
      manager: deps.manager,
      subagents: deps.subagents,
      settings: deps.settings,
      registry: deps.registry,
    });
    const outcome = await tool.execute(
      "tool-call-1",
      { prompt: "do it", description: "d", subagent_type: "no-such-agent" },
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(outcome)).toContain("Unknown agent type");
  });

  it("refuses a disabled agent type", async () => {
    const deps = createToolDeps({
      registry: registryWith("worker", { enabled: false }),
    });
    const tool = createAgentTool({
      manager: deps.manager,
      subagents: deps.subagents,
      settings: deps.settings,
      registry: deps.registry,
    });
    const outcome = await tool.execute(
      "tool-call-1",
      { prompt: "do it", description: "d", subagent_type: "worker" },
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(outcome)).toContain("is disabled");
  });
});

describe("the assembler's tool selection", () => {
  const base = {
    cwd: "/tmp",
    parentSystemPrompt: "parent prompt",
    modelRegistry,
    activeToolNames: ["read", "bash", "subagent"],
  };

  it("gives a child that inherits the parent's active tools", () => {
    const config = assembleSessionConfig(
      "worker",
      { ...base, activeToolNames: ["read", "bash", "edit"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", { tools: { kind: "inherit" } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "bash", "edit"]);
  });

  it("strips the subagent-management tools from an inherited selection", () => {
    const config = assembleSessionConfig(
      "worker",
      { ...base, activeToolNames: ["read", "subagent", "steer_subagent"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", { tools: { kind: "inherit" } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read"]);
  });

  it("gives a restricted specialist exactly the tools it names", () => {
    const config = assembleSessionConfig(
      "reviewer",
      { ...base, activeToolNames: ["read", "bash", "edit", "write"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reviewer", {
        tools: { kind: "explicit", names: ["read", "grep", "find"] },
      }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "grep", "find"]);
  });

  it("gives a specialist a built-in tool the parent does not have active", () => {
    const config = assembleSessionConfig(
      "reviewer",
      { ...base, activeToolNames: ["read"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reviewer", {
        tools: { kind: "explicit", names: ["read", "grep"] },
      }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "grep"]);
  });

  it("gives a child with an empty tool list no tools at all", () => {
    const config = assembleSessionConfig(
      "reader",
      { ...base, activeToolNames: ["read", "bash"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reader", { tools: { kind: "explicit", names: [] } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual([]);
  });

  it("takes the parent's tools captured at request time, not the current ones", () => {
    // The snapshot is the request-time capture; the assembler's context is
    // filled from it, so a later change to the parent does not reach a child
    // that is already queued.
    const snapshotTools = STUB_SNAPSHOT.activeToolNames;
    expect(resolveChildToolNames({ kind: "inherit" }, snapshotTools)).toEqual([
      "read",
      "bash",
    ]);
  });

  it("assembles from the captured definition instead of reselecting mutable registry state", () => {
    const captured = {
      ...defaultDefinition("worker", "shipped"),
      instructions: "captured instructions",
    };
    const config = assembleSessionConfig(
      "worker",
      { ...base, definition: captured },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", { instructions: "replacement instructions" }),
      assemblerIO,
    );

    expect(config.systemPrompt).toBe("system prompt");
    expect(assemblerIO.buildAgentPrompt).toHaveBeenLastCalledWith(
      { name: "worker", instructions: "captured instructions" },
      "/tmp",
      { isGitRepo: false, branch: "", platform: "linux" },
      expect.anything(),
      assemblerIO.loadProjectContext,
    );
  });

  it("takes the prompt-inheritance strategy from the launch capture, not the live resolver", () => {
    const parentModel = makeModel({
      provider: "anthropic",
      id: "claude-sonnet-5",
    });
    const ctx = {
      ...base,
      modelRegistry: {
        find: () => parentModel,
        getAll: () => [parentModel],
      },
      parentModelIdentity: { provider: "anthropic", id: "claude-sonnet-5" },
      childShaping: {
        midRunUpdates: true,
        excludedExtensionPackages: [],
        promptInheritance: { anthropic: "portable" as const },
      },
      // The live resolver says "full"; the capture says "portable". The
      // capture wins: a queued child keeps the policy it was asked under.
      resolvePromptInheritance: () => "full" as const,
    };
    assembleSessionConfig(
      "worker",
      ctx,
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", {}),
      assemblerIO,
    );

    expect(assemblerIO.buildAgentPrompt).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ strategy: "portable" }),
      expect.anything(),
    );
  });
});

describe("the shipped specialists", () => {
  it("starts the debug specialist from the parent's conversation", () => {
    const deps = createToolDeps();
    expect(deps.registry.find("debug")?.inheritContext).toBe(true);
  });

  it("starts every other specialist from a fresh conversation", () => {
    const deps = createToolDeps();
    for (const id of ["explore", "reviewer", "researcher", "worker"]) {
      expect(deps.registry.find(id)?.inheritContext).toBe(false);
    }
  });
});

describe("the service door", () => {
  /** The adapter's collaborators, with a registry the adapter can read. */
  function makeAdapter(definition?: AgentDefinition) {
    const manager = {
      spawn: vi.fn().mockReturnValue({ kind: "accepted", value: "agent-1" }),
      spawnAndWait: vi.fn().mockResolvedValue({
        kind: "accepted",
        value: createTestSubagent(),
      }),
      getRecord: vi.fn(),
      listAgents: vi.fn(() => []),
      abort: vi.fn(),
      waitForAll: vi.fn(),
      hasRunning: vi.fn(() => false),
      registerWorkspaceProvider: vi.fn(),
      resume: vi.fn(),
      currentOwner: vi.fn(() => ({ generation: 1, sessionId: "session-1" })),
    };
    const runtime = {
      currentCtx: {} as never,
      // The capture answers with the request-time facts; attaching the
      // conversation to the snapshot is the seam's decision, from the
      // resolved definition.
      captureLaunchInputs: vi.fn(() => ({
        snapshot: {
          ...STUB_SNAPSHOT,
          registeredToolNames: [
            "read",
            "mcp__github__get_issue",
            "mcp__gitlab__get_issue",
          ],
        },
        parentContext: "parent conversation",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "session-1",
        },
      })),
    };
    const registry = registryWith(
      definition?.id ?? "worker",
      definition
        ? {
            displayName: definition.displayName,
            description: definition.description,
            instructions: definition.instructions,
            tools: definition.tools,
            inheritContext: definition.inheritContext,
            runInBackground: definition.runInBackground,
            enabled: definition.enabled,
            ...defined({
              model: definition.model,
              thinking: definition.thinking,
              maxTurns: definition.maxTurns,
            }),
          }
        : {},
    );
    const preparer = createPreparer(registry, () => ({
      ladders: { profiles: new Map(), strategies: new Map() },
    }));
    const adapter = new SubagentsTestDriver(
      manager,
      new Subagents(manager, runtime, preparer),
    );
    return { adapter, manager, runtime };
  }

  it("attaches the captured conversation for a spawn that inherits it", async () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("debug", "shipped"),
      inheritContext: true,
    });
    await adapter.launch("debug", "diagnose it");

    expect(manager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ parentContext: "parent conversation" }),
      "debug",
      "diagnose it",
      expect.anything(),
    );
  });

  it("leaves the conversation off when the caller asks for a fresh one", async () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("debug", "shipped"),
      inheritContext: true,
    });
    await adapter.launch("debug", "diagnose it", { inheritContext: false });

    const [snapshot] = callAt(vi.mocked(manager.spawn).mock.calls);
    expect(snapshot).not.toHaveProperty("parentContext");
  });

  it("starts a specialist with a fresh conversation", async () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      inheritContext: false,
    });
    await adapter.launch("worker", "do it");

    const [snapshot] = callAt(vi.mocked(manager.spawn).mock.calls);
    expect(snapshot).not.toHaveProperty("parentContext");
  });

  it("expands MCP patterns against request-time registered names before acceptance", async () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      tools: { kind: "explicit", names: ["read", "mcp__github__*"] },
    });

    await adapter.launch("worker", "do it");

    expect(manager.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "worker",
      "do it",
      expect.objectContaining({
        toolNames: ["read", "mcp__github__get_issue"],
      }),
    );
  });

  it.each([
    "*",
    "+codemode",
    "-write",
  ])("rejects unsafe tool selection %s before accepting a launch", async (selection) => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      tools: { kind: "explicit", names: [selection] },
    });

    const result = await adapter.launch("worker", "do it");

    expect(result).toMatchObject({
      kind: "rejected",
      reason: "configuration",
      message: expect.stringContaining("concrete tool names"),
    });
    expect(manager.spawn).not.toHaveBeenCalled();
    expect(manager.spawnAndWait).not.toHaveBeenCalled();
  });

  it("rejects an unknown programmatic type before creating a manager record", async () => {
    const { adapter, manager } = makeAdapter();

    const result = await adapter.launch("unknown-role", "do it");

    expect(result).toMatchObject({
      kind: "rejected",
      reason: "unknown-agent",
    });
    if (result.kind === "rejected") {
      expect(result.message).toContain('Unknown agent type "unknown-role"');
    }
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it("rejects a disabled programmatic type before creating a manager record", async () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      enabled: false,
    });

    const result = await adapter.launch("worker", "do it");

    expect(result).toMatchObject({
      kind: "rejected",
      reason: "disabled-agent",
    });
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it("rejects without a record when the launch signal aborts during preparation", async () => {
    const { adapter, manager } = makeAdapter();
    const controller = new AbortController();
    controller.abort();

    const result = await adapter.launch("worker", "do it", {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ kind: "rejected", reason: "cancelled" });
    expect(manager.spawn).not.toHaveBeenCalled();
  });
});

describe("both doors resolve alike", () => {
  it("gives the tool door and the service door the same resolution", async () => {
    // The two doors ask the same question in different words; one resolver
    // answers it, so they cannot drift apart.
    const ladders = {
      profiles: new Map(),
      strategies: strategiesByFamily(SHIPPED_STRATEGIES),
    };
    const haiku = makeModel({
      provider: "anthropic",
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
    });
    const haikuRegistry = {
      find: (provider: string, id: string) =>
        provider === haiku.provider && id === haiku.id ? haiku : undefined,
      getAll: () => [haiku],
      getAvailable: () => [haiku],
    };

    const tool = resolveSpawnConfig(
      {
        prompt: "do it",
        description: "d",
        subagent_type: "worker",
        thinking: "low",
        model: "anthropic/claude-haiku-4-5",
        inherit_context: false,
        max_turns: 3,
        run_in_background: false,
      },
      registryWith("worker", {}),
      defined({ modelRegistry: haikuRegistry, ladders }),
      { defaultMaxTurns: undefined, wrapUpTurns: DEFAULT_WRAP_UP_TURNS },
    );
    if ("error" in tool) throw new Error(tool.error);

    const manager = {
      spawn: vi.fn().mockReturnValue({ kind: "accepted", value: "agent-1" }),
      spawnAndWait: vi.fn().mockResolvedValue({
        kind: "accepted",
        value: createTestSubagent(),
      }),
      getRecord: vi.fn(),
      listAgents: vi.fn(() => []),
      abort: vi.fn(),
      waitForAll: vi.fn(),
      hasRunning: vi.fn(() => false),
      registerWorkspaceProvider: vi.fn(),
      resume: vi.fn(),
      currentOwner: vi.fn(() => ({ generation: 1, sessionId: "session-1" })),
    };
    const runtime = {
      currentCtx: { modelRegistry: haikuRegistry } as never,
      captureLaunchInputs: vi.fn(() => ({
        snapshot: STUB_SNAPSHOT,
        parentContext: "parent conversation",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "session-1",
        },
      })),
    };
    const registry = registryWith("worker", {});
    const preparer = createPreparer(registry, () => ({
      modelRegistry: haikuRegistry,
      ladders,
    }));
    const adapter = new SubagentsTestDriver(
      manager,
      new Subagents(manager, runtime, preparer),
    );
    await adapter.run("worker", "do it", {
      description: "d",
      model: "anthropic/claude-haiku-4-5",
      thinkingLevel: "low",
      inheritContext: false,
      maxTurns: 3,
    });

    // The service door hands the shared resolution to the manager exactly as
    // the tool door computed it, so the two cannot disagree about a launch.
    expect(manager.spawnAndWait).toHaveBeenCalledWith(
      expect.anything(),
      "worker",
      "do it",
      expect.objectContaining({
        description: "d",
        modelSelection: tool.execution.modelSelection,
        turnPolicy: tool.execution.turnPolicy,
        inheritContext: false,
        // The request asked for `low`, but Haiku does not reason, so the
        // resolution carries a decision rather than a level — the same call
        // shape both doors produce.
        thinkingDecision: tool.execution.thinkingDecision,
      }),
    );
    expect(tool.execution.runInBackground).toBe(false);
    expect(tool.execution.inheritContext).toBe(false);
  });
});

describe("automatic model selection at launch", () => {
  it.each([
    ["acme", "wonder-model-9", false],
    ["openai", "gpt-5.4-nano", true],
  ])("keeps %s/%s and lowers effort by the next supported rung", (provider, id, registryHasParent) => {
    const parent = makeReasoningModel({
      provider,
      id,
      thinkingLevelMap: {
        off: "off",
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    });
    const result = resolveSpawnConfig(
      { subagent_type: "worker", prompt: "do it", description: "d" },
      registryWith("worker", {}),
      {
        parentModel: parent,
        parentThinkingLevel: "max",
        modelRegistry: {
          getAll: () => (registryHasParent ? [parent] : []),
          getAvailable: () => (registryHasParent ? [parent] : []),
          find: (candidateProvider, candidateId) =>
            registryHasParent &&
            candidateProvider === provider &&
            candidateId === id
              ? parent
              : undefined,
        },
        ladders: {
          profiles: new Map(SHIPPED_PROFILES.map((p) => [p.family, p])),
          strategies: strategiesByFamily(SHIPPED_STRATEGIES),
        },
      },
      { defaultMaxTurns: undefined, wrapUpTurns: DEFAULT_WRAP_UP_TURNS },
    );
    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;
    expect(result.execution.modelIdentity).toEqual({ provider, id });
    expect(result.execution.thinkingDecision.level).toBe("high");
    expect(result.execution.thinkingDecision.reason).toContain(
      "the parent's model was kept",
    );
  });

  it.each([
    ["reviewer", "claude-opus-4-5"],
    ["worker", "claude-sonnet-4-5"],
    ["researcher", "claude-haiku-4-5"],
  ])("carries the resolved %s identifier into routing", (role, expected) => {
    const available = [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ].map((id) => makeModel({ provider: "anthropic", id }));
    const result = resolveSpawnConfig(
      { subagent_type: role, prompt: "do it", description: "d" },
      registryWith(role, {}),
      {
        parentModel: available[0]!,
        modelRegistry: {
          getAll: () => available,
          getAvailable: () => available,
          find: (provider, id) =>
            available.find((m) => m.provider === provider && m.id === id),
        },
        ladders: {
          profiles: new Map(SHIPPED_PROFILES.map((p) => [p.family, p])),
          strategies: strategiesByFamily(SHIPPED_STRATEGIES),
        },
      },
      { defaultMaxTurns: undefined, wrapUpTurns: DEFAULT_WRAP_UP_TURNS },
    );
    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;
    expect(result.execution.modelIdentity).toEqual({
      provider: "anthropic",
      id: expected,
    });
    expect(result.execution.modelSelection.reason).toContain(role);
  });
});

describe("a specialist refined by a file", () => {
  it("stays a specialist in the tool's list and its guidelines", () => {
    const registry = registryWith("explore", { description: "Local explorer" });
    const list = buildTypeListText(registry, "/home/.pi");
    expect(list).toContain("Specialists:");
    expect(list).toContain("- explore: Local explorer");
    expect(list).not.toContain("Custom agents:");
    expect(buildAgentGuidelines(registry)).toContain(
      "- Use explore for: Local explorer",
    );
  });
});
