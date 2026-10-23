/**
 * The launch seams: what a child actually gets when a request names an agent.
 *
 * The configuration resolver is pure and the domain is unit-tested; this file
 * exercises the two doors a request travels through — the `subagent` tool and
 * the programmatic service — and inspects the resulting child session's tool
 * selection and records.
 */

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
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { Subagents } from "#src/service/subagents";
import { assembleSessionConfig } from "#src/session/session-config";
import type { AssemblerIO } from "#src/session/session-config";
import { AgentTool } from "#src/tools/agent-tool";
import { buildAgentGuidelines, buildTypeListText } from "#src/tools/helpers";
import { resolveSpawnConfig } from "#src/tools/spawn-config";
import { createToolDeps } from "#test/helpers/make-deps";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { makeModel } from "#test/helpers/make-model";
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
    registry,
    reload: () => registry.reload(),
    modelInfo,
    turnSettings: () => ({
      defaultMaxTurns: undefined,
      wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
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
    const tool = new AgentTool(
      deps.manager,
      deps.subagents,
      deps.settings,
      deps.registry,
      deps.agentDir,
    );
    const outcome = await tool
      .toToolDefinition()
      .execute(
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
    const tool = new AgentTool(
      deps.manager,
      deps.subagents,
      deps.settings,
      deps.registry,
      deps.agentDir,
    );
    const outcome = await tool
      .toToolDefinition()
      .execute(
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
      buildSnapshot: vi.fn((inheritContext: boolean) => ({
        ...STUB_SNAPSHOT,
        ...defined({
          parentContext: inheritContext ? "parent conversation" : undefined,
        }),
      })),
      getSessionInfo: vi.fn(() => ({
        parentSessionFile: "/sessions/parent.jsonl",
        parentSessionId: "session-1",
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
    const adapter = new SubagentsServiceAdapter(
      manager,
      new Subagents(manager, runtime, preparer),
    );
    return { adapter, manager, runtime };
  }

  it("starts a debug spawn from the parent's conversation", () => {
    const { adapter, runtime } = makeAdapter({
      ...defaultDefinition("debug", "shipped"),
      inheritContext: true,
    });
    adapter.spawn("debug", "diagnose it");
    expect(runtime.buildSnapshot).toHaveBeenCalledWith(true);
  });

  it("lets the caller ask for a fresh conversation instead", () => {
    const { adapter, runtime } = makeAdapter({
      ...defaultDefinition("debug", "shipped"),
      inheritContext: true,
    });
    adapter.spawn("debug", "diagnose it", { inheritContext: false });
    expect(runtime.buildSnapshot).toHaveBeenCalledWith(false);
  });

  it("starts a specialist with a fresh conversation", () => {
    const { adapter, runtime } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      inheritContext: false,
    });
    adapter.spawn("worker", "do it");
    expect(runtime.buildSnapshot).toHaveBeenCalledWith(false);
  });

  it("rejects an unknown programmatic type before creating a manager record", () => {
    const { adapter, manager } = makeAdapter();

    expect(() => adapter.spawn("unknown-role", "do it")).toThrow(
      /Unknown agent type "unknown-role"/,
    );
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it("rejects a disabled programmatic type before creating a manager record", () => {
    const { adapter, manager } = makeAdapter({
      ...defaultDefinition("worker", "shipped"),
      enabled: false,
    });

    expect(() => adapter.spawn("worker", "do it")).toThrow(/disabled/);
    expect(manager.spawn).not.toHaveBeenCalled();
  });
});

describe("both doors resolve alike", () => {
  it("gives the tool door and the service door the same resolution", () => {
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
      buildSnapshot: vi.fn(() => STUB_SNAPSHOT),
      getSessionInfo: vi.fn(() => ({
        parentSessionFile: "/sessions/parent.jsonl",
        parentSessionId: "session-1",
      })),
    };
    const registry = registryWith("worker", {});
    const preparer = createPreparer(registry, () => ({
      modelRegistry: haikuRegistry,
      ladders,
    }));
    const adapter = new SubagentsServiceAdapter(
      manager,
      new Subagents(manager, runtime, preparer),
    );
    adapter.spawn("worker", "do it", {
      description: "d",
      model: "anthropic/claude-haiku-4-5",
      thinkingLevel: "low",
      inheritContext: false,
      maxTurns: 3,
      foreground: true,
    });

    // The service door hands the shared resolution to the manager exactly as
    // the tool door computed it, so the two cannot disagree about a launch.
    expect(manager.spawn).toHaveBeenCalledWith(
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
        background: { kind: "explicit", isBackground: false },
      }),
    );
    expect(tool.execution.runInBackground).toBe(false);
    expect(tool.execution.inheritContext).toBe(false);
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
