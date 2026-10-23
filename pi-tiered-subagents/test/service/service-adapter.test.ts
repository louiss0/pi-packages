import { describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import { defined } from "#src/optional";
import { SubagentState } from "#src/lifecycle/subagent-state";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { RoutingLadders } from "#src/models/router";
import type { ModelInfo } from "#src/agents/resolver";
import type { SubagentsService } from "#src/service/service";
import type { SubagentManagerLike } from "#src/service/service-adapter";
import { Subagents } from "#src/service/subagents";
import type { SubagentsRuntime } from "#src/service/subagents";
import {
  SubagentsServiceAdapter,
  toSubagentRecord,
} from "#src/service/service-adapter";
import { type SessionContext, Subagent } from "#src/types";
import { makeModel } from "#test/helpers/make-model";
import { TEST_OWNER } from "#test/helpers/owner";
import {
  createTestSubagent,
  makeStubExecution,
} from "#test/helpers/make-subagent";
import {
  createMockSession,
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";

describe("toSubagentRecord", () => {
  const baseRecord = (() => {
    const r = createTestSubagent({
      id: "abc-123",
      type: "Explore",
      description: "Check stale TODOs",
      result: "Found 3 stale TODOs",
      toolUses: 5,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
      compactionCount: 1,
    });
    return r;
  })();

  it("includes all serializable fields", () => {
    const result = toSubagentRecord(baseRecord);
    expect(result).toEqual({
      id: "abc-123",
      type: "Explore",
      description: "Check stale TODOs",
      status: "completed",
      isBackground: true,
      result: "Found 3 stale TODOs",
      toolUses: 5,
      startedAt: 1000,
      completedAt: 2000,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
      compactionCount: 1,
      // The fixture never ran, so it has no session to continue.
      resumeRefusal: "no-session",
    });
  });

  it("reports session-released once the retention sweep has freed the session", async () => {
    const agent = createTestSubagent({ sessionReady: true });
    await agent.releaseSession();
    expect(toSubagentRecord(agent).resumeRefusal).toBe("session-released");
  });

  it("omits resumeRefusal when a resume would start", () => {
    expect(
      toSubagentRecord(createTestSubagent({ sessionReady: true })),
    ).not.toHaveProperty("resumeRefusal");
  });

  it("carries a declared question so a consumer can surface it as answerable", () => {
    const result = toSubagentRecord(
      createTestSubagent({ pendingQuestion: "Which config?" }),
    );
    expect(result.pendingQuestion).toBe("Which config?");
  });

  it("omits pendingQuestion when the agent asked nothing", () => {
    expect(toSubagentRecord(createTestSubagent())).not.toHaveProperty(
      "pendingQuestion",
    );
  });

  it("reports the background mode resolved for the agent", () => {
    const result = toSubagentRecord(
      createTestSubagent({ isBackground: false }),
    );
    expect(result.isBackground).toBe(false);
  });

  it("reports turns only through the turn budget", () => {
    const result = toSubagentRecord(
      createTestSubagent({
        turnBudget: { maxTurns: 12, used: 4, phase: "within" },
      }),
    );
    expect(result.turnBudget).toEqual({
      maxTurns: 12,
      used: 4,
      phase: "within",
    });
    expect(result).not.toHaveProperty("turnCount");
    expect(result).not.toHaveProperty("maxTurns");
  });

  it("reports the transcript path when the agent has one", () => {
    const record = createTestSubagent();
    record.attachSession(
      toSubagentSession(
        createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl"),
      ),
    );
    expect(toSubagentRecord(record).outputFile).toBe("/sessions/child.jsonl");
  });

  it("strips live objects and collaborators", () => {
    const record = createTestSubagent({ toolCallId: "tc-1" });
    record.attachSession(
      toSubagentSession(createSubagentSessionStub(createMockSession())),
    );
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("subagentSession");
    expect(result).not.toHaveProperty("abortController");
    expect(result).not.toHaveProperty("promise");
    expect(result).not.toHaveProperty("execution");
    expect(result).not.toHaveProperty("notification");
  });

  it("withholds momentary activity and package-internal bookkeeping", () => {
    const record = createTestSubagent({
      activeTools: ["read", "grep"],
      responseText: "partial answer",
      consumedAt: 5000,
      stoppedWhileQueued: true,
    });
    // The source really carries all four, so the assertions below are not vacuous.
    expect([...record.activeTools.values()]).toEqual(["read", "grep"]);
    expect(record.responseText).toBe("partial answer");
    expect(record.consumedAt).toBe(5000);
    expect(record.stoppedWhileQueued).toBe(true);

    const result = toSubagentRecord(record);

    // Momentary state is reactive by nature and stale the instant it is pulled;
    // consumedAt and stoppedWhileQueued are internal bookkeeping. See
    // docs/decisions/0005-subagent-record-admission-policy.md.
    expect(result).not.toHaveProperty("activeTools");
    expect(result).not.toHaveProperty("responseText");
    expect(result).not.toHaveProperty("consumedAt");
    expect(result).not.toHaveProperty("stoppedWhileQueued");
  });

  it("does not drift when the agent keeps accumulating usage", () => {
    const state = new SubagentState({
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
    });
    const agent = new Subagent({
      id: "usage-1",
      type: "Explore",
      description: "Check stale TODOs",
      isBackground: true,
      ownerGeneration: TEST_OWNER.generation,
      execution: makeStubExecution(),
      state,
    });

    const snapshot = toSubagentRecord(agent);
    state.addUsage({ input: 25, output: 0, cacheWrite: 0 });

    expect(snapshot.lifetimeUsage).toEqual({
      input: 100,
      output: 200,
      cacheWrite: 50,
    });
    expect(agent.lifetimeUsage.input).toBe(125);
  });

  it("does not let a consumer write into the agent's own totals", () => {
    const agent = createTestSubagent({
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
    });

    const snapshot = toSubagentRecord(agent);
    snapshot.lifetimeUsage.input = 999;

    expect(agent.lifetimeUsage.input).toBe(100);
  });

  it("copies the turn budget by value", () => {
    const agent = createTestSubagent({
      turnBudget: { maxTurns: 2, used: 3, phase: "warned" },
    });

    const snapshot = toSubagentRecord(agent);
    expect(snapshot.turnBudget).toEqual({
      maxTurns: 2,
      used: 3,
      phase: "warned",
    });

    snapshot.turnBudget!.used = 99;
    expect(agent.turnBudget?.used).toBe(3);
  });

  it("carries the resolved model decision and the reasoning decision", () => {
    const agent = createTestSubagent({
      execution: {
        ...makeStubExecution(),
        modelSelection: {
          source: "routed",
          reason: "the child's family routed it down a tier",
        },
        thinkingDecision: {
          applicable: true,
          source: "automatic",
          clamped: false,
          reason: "the default reasoning level for the model is low",
        },
      },
    });

    const result = toSubagentRecord(agent);
    expect(result.modelSelection).toEqual({
      source: "routed",
      reason: "the child's family routed it down a tier",
    });
    expect(result.thinkingDecision).toEqual({
      applicable: true,
      source: "automatic",
      clamped: false,
      reason: "the default reasoning level for the model is low",
    });
  });

  it("omits optional fields when undefined on the source", () => {
    const minimal = createTestSubagent({
      id: "min-1",
      description: "test",
      status: "running",
      result: undefined,
      toolUses: 0,
      startedAt: 500,
      completedAt: undefined,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    });
    const result = toSubagentRecord(minimal);
    expect(result).toEqual({
      id: "min-1",
      type: "general-purpose",
      description: "test",
      status: "running",
      isBackground: true,
      toolUses: 0,
      startedAt: 500,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
      compactionCount: 0,
      resumeRefusal: "still-running",
    });
    expect(result).not.toHaveProperty("result");
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("completedAt");
    expect(result).not.toHaveProperty("maxTurns");
    expect(result).not.toHaveProperty("outputFile");
  });
});

/** Minimal SessionContext stub for service-adapter tests. */
function makeStubCtx(): SessionContext {
  return {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "test prompt",
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionId: () => "stub-session",
      getBranch: () => [],
    },
  };
}

/** The routing ladders the adapter reads: no profiles, no strategies. */
const LADDERS: RoutingLadders = {
  profiles: new Map(),
  strategies: new Map(),
};

/**
 * Minimal ServiceRuntimeLike stub for tests.
 * Override `currentCtx` to simulate no active session.
 */
type ServiceTestRuntime = SubagentsRuntime & {
  readonly currentCtx: SessionContext | undefined;
};

function makeRuntimeStub(
  // `Partial<>` rather than `Patch<>`: a caller passes `{ currentCtx: undefined }`
  // to simulate no active session, and the spread must preserve that `undefined`
  // rather than collapse it back to the base value.
  override: Partial<ServiceTestRuntime> = {},
): ServiceTestRuntime {
  return {
    currentCtx: makeStubCtx(),
    captureLaunchInputs: vi.fn(() => ({
      snapshot: STUB_SNAPSHOT,
      parentContext: "parent conversation",
    })),
    getSessionInfo: vi.fn(() => ({
      parentSessionFile: "/sessions/parent.jsonl",
      parentSessionId: "parent-session-123",
    })),
    ...override,
  };
}

function makeServiceAdapter(
  manager: SubagentManagerLike,
  runtime = makeRuntimeStub(),
  registry = new AgentRegistry(() => ({
    global: { definitions: [], errors: [] },
    project: { definitions: [], errors: [] },
  })),
): SubagentsServiceAdapter {
  const preparer = new LaunchPreparer({
    loadScopes: async () => registry.currentScopes(),
    modelInfo: (): ModelInfo => {
      const ctx = runtime.currentCtx;
      if (!ctx) return { ladders: LADDERS };
      return {
        ladders: LADDERS,
        ...defined({
          parentModel: ctx.model,
          modelRegistry: ctx.modelRegistry,
          parentThinkingLevel: ctx.thinkingLevel,
        }),
      };
    },
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
  return new SubagentsServiceAdapter(
    manager,
    new Subagents(manager, runtime, preparer),
  );
}

/**
 * Stub `SubagentManagerLike` for adapter tests.
 *
 * Return type is unannotated so callers retain each stub's `Mock<...>` methods
 * (`mockReturnValue`, `mockImplementation`); configure per-test behavior on the
 * returned object's fields.
 */
function createManagerStub() {
  return {
    spawn: vi.fn<SubagentManagerLike["spawn"]>(() => ({
      kind: "accepted",
      value: "spawned-id",
    })),
    spawnAndWait: vi.fn<SubagentManagerLike["spawnAndWait"]>(async () => ({
      kind: "accepted",
      value: createTestSubagent(),
    })),
    getRecord: vi.fn<SubagentManagerLike["getRecord"]>(),
    listAgents: vi.fn<SubagentManagerLike["listAgents"]>(() => []),
    abort: vi.fn<SubagentManagerLike["abort"]>(() => true),
    waitForAll: vi.fn<SubagentManagerLike["waitForAll"]>(async () => {}),
    hasRunning: vi.fn<SubagentManagerLike["hasRunning"]>(() => false),
    registerWorkspaceProvider: vi.fn<
      SubagentManagerLike["registerWorkspaceProvider"]
    >(() => () => {}),
    resume: vi.fn<SubagentManagerLike["resume"]>(async () => ({
      kind: "resumed",
      record: createTestSubagent(),
    })),
    currentOwner: vi.fn<SubagentManagerLike["currentOwner"]>(() => TEST_OWNER),
  };
}

describe("SubagentsServiceAdapter — getRecord and listAgents", () => {
  const recordA = createTestSubagent({
    id: "a-1",
    type: "Explore",
    description: "task A",
    lifetimeUsage: { input: 10, output: 20, cacheWrite: 5 },
  });

  const recordB = createTestSubagent({
    id: "b-2",
    type: "Plan",
    description: "task B",
    status: "running",
    toolUses: 1,
    startedAt: 3000,
    result: undefined,
    completedAt: undefined,
    lifetimeUsage: { input: 5, output: 10, cacheWrite: 0 },
  });

  function createService(records: Subagent[]): SubagentsService {
    const manager = createManagerStub();
    manager.getRecord.mockImplementation((id) =>
      records.find((r) => r.id === id),
    );
    manager.listAgents.mockImplementation(() =>
      [...records].sort((a, b) => b.startedAt - a.startedAt),
    );
    return makeServiceAdapter(manager);
  }

  it("getRecord returns serialized record for known id", () => {
    const svc = createService([recordA, recordB]);
    const result = svc.getRecord("a-1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("a-1");
    expect(result).not.toHaveProperty("session");
    expect(result).not.toHaveProperty("abortController");
  });

  it("getRecord returns undefined for unknown id", () => {
    const svc = createService([recordA]);
    expect(svc.getRecord("unknown")).toBeUndefined();
  });

  it("listAgents returns serialized records sorted by startedAt descending", () => {
    const svc = createService([recordA, recordB]);
    const list = svc.listAgents();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("b-2");
    expect(list[1]!.id).toBe("a-1");
    // Verify serialization
    expect(list[0]).not.toHaveProperty("session");
    expect(list[1]).not.toHaveProperty("abortController");
  });

  it("gives each listed agent its own resume answer", async () => {
    const resumable = createTestSubagent({
      id: "r-1",
      sessionReady: true,
      startedAt: 2000,
    });
    const released = createTestSubagent({
      id: "x-1",
      sessionReady: true,
      startedAt: 1000,
    });
    await released.releaseSession();

    const [first, second] = createService([resumable, released]).listAgents();

    expect(first!.id).toBe("r-1");
    expect(first).not.toHaveProperty("resumeRefusal");
    expect(second!.id).toBe("x-1");
    expect(second!.resumeRefusal).toBe("session-released");
  });
});

describe("SubagentsServiceAdapter — launch and run", () => {
  it("rejects with no-active-session when currentCtx is undefined", async () => {
    const svc = makeServiceAdapter(
      createManagerStub(),
      makeRuntimeStub({ currentCtx: undefined }),
    );
    const result = await svc.launch("Explore", "do something");

    expect(result).toMatchObject({
      kind: "rejected",
      reason: "no-active-session",
    });
  });

  it("resolves a named model exactly against the session's registry", async () => {
    const registry = {
      find: (provider: string, id: string) =>
        provider === "anthropic" && id === "claude-sonnet-5"
          ? makeModel({ id: "claude-sonnet-5", provider: "anthropic" })
          : undefined,
      getAll: () => [
        makeModel({ id: "claude-sonnet-5", provider: "anthropic" }),
      ],
      getAvailable: () => [
        makeModel({ id: "claude-sonnet-5", provider: "anthropic" }),
      ],
    };
    const mgr = createManagerStub();
    const svc = makeServiceAdapter(
      mgr,
      makeRuntimeStub({
        currentCtx: { ...makeStubCtx(), modelRegistry: registry },
      }),
    );
    const result = await svc.launch("Explore", "check TODOs", {
      model: "anthropic/claude-sonnet-5",
    });

    expect(result).toEqual({ kind: "accepted", id: "spawned-id" });
    expect(mgr.spawn).toHaveBeenCalled();
  });

  it("rejects when a named model cannot be resolved exactly", async () => {
    const registry = {
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    };
    const svc = makeServiceAdapter(
      createManagerStub(),
      makeRuntimeStub({
        currentCtx: { ...makeStubCtx(), modelRegistry: registry },
      }),
    );
    const result = await svc.launch("Explore", "task", {
      model: "bad-model",
    });

    expect(result).toMatchObject({
      kind: "rejected",
      reason: "configuration",
    });
    if (result.kind === "rejected") {
      expect(result.message).toMatch(/provider\/modelId|Model not found/);
    }
  });

  describe("thinking level", () => {
    it("rejects an unrecognized level rather than letting the SDK clamp it to off", async () => {
      const svc = makeServiceAdapter(createManagerStub());

      const result = await svc.launch("Explore", "task", {
        thinkingLevel: "turbo",
      });

      expect(result).toMatchObject({
        kind: "rejected",
        reason: "invalid-thinking",
      });
      if (result.kind === "rejected") {
        expect(result.message).toBe(
          'Invalid thinking level "turbo". Valid levels: off, minimal, low, medium, high, xhigh, max.',
        );
      }
    });

    it("passes a recognized level through to the manager", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);

      await svc.launch("Explore", "task", { thinkingLevel: "xhigh" });

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(),
        "Explore",
        "task",
        expect.objectContaining({ thinkingLevel: "xhigh" }),
      );
    });

    it("leaves the level unset when the caller omits it", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);

      await svc.launch("Explore", "task");

      // No key at all rather than a key holding undefined: "the caller named no
      // level" is what the manager should read, and a present-and-undefined
      // key would say a level was supplied and was nothing.
      const options = mgr.spawn.mock.calls[0]![3];
      expect(options).not.toHaveProperty("thinkingLevel");
    });
  });

  it("delegates to manager.spawn with the resolved model identity", async () => {
    const resolvedModel = makeModel({
      id: "claude-sonnet-5",
      provider: "anthropic",
    });
    const registry = {
      find: (provider: string, id: string) =>
        provider === "anthropic" && id === "claude-sonnet-5"
          ? resolvedModel
          : undefined,
      getAll: () => [resolvedModel],
      getAvailable: () => [resolvedModel],
    };
    const mgr = createManagerStub();
    const svc = makeServiceAdapter(
      mgr,
      makeRuntimeStub({
        currentCtx: { ...makeStubCtx(), modelRegistry: registry },
      }),
    );
    const result = await svc.launch("Explore", "check TODOs", {
      model: "anthropic/claude-sonnet-5",
      maxTurns: 5,
    });
    expect(result).toEqual({ kind: "accepted", id: "spawned-id" });
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      "check TODOs",
      expect.objectContaining({
        modelIdentity: {
          provider: resolvedModel.provider,
          id: resolvedModel.id,
        },
        turnPolicy: { kind: "limited", maxTurns: 5, wrapUpTurns: 2 },
      }),
    );
  });

  it("hands the resolved decision onto the run and settles with the record", async () => {
    const mgr = createManagerStub();
    const svc = makeServiceAdapter(mgr);
    const result = await svc.run("Explore", "task", {
      thinkingLevel: "low",
      inheritContext: false,
      maxTurns: 4,
    });

    expect(mgr.spawnAndWait).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      "task",
      expect.objectContaining({
        modelSelection: expect.objectContaining({ source: "inherited" }),
        thinkingDecision: expect.objectContaining({ source: "request" }),
        turnPolicy: { kind: "limited", maxTurns: 4, wrapUpTurns: 2 },
      }),
    );
    expect(result.kind).toBe("settled");
    if (result.kind === "settled") {
      expect(result.record.type).toBeDefined();
    }
  });

  /**
   * An SDK spawn has no tool call, so `toolCallId` is legitimately absent — but
   * the session identity is not, and permission forwarding routes on
   * `parentSessionId`. Asserted with toEqual rather than objectContaining so a
   * stray toolCallId would fail rather than be absorbed.
   */
  describe("parent session", () => {
    it("passes the runtime's session identity, without a toolCallId", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);

      await svc.launch("Explore", "check TODOs");

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(), // snapshot
        "Explore",
        "check TODOs",
        expect.objectContaining({
          parentSession: {
            parentSessionFile: "/sessions/parent.jsonl",
            parentSessionId: "parent-session-123",
          },
        }),
      );
    });
  });

  /**
   * `launch` is committed to background delivery; `run` is committed to
   * caller-owned foreground settlement. The ambiguous `foreground` flag is
   * gone: the operation itself states the delivery mode (stories 64 and 66).
   */
  describe("delivery mode", () => {
    it("commits launch to background handoff", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);

      await svc.launch("worker", "plan work");

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(),
        "worker",
        "plan work",
        expect.objectContaining({
          background: { kind: "explicit", isBackground: true },
        }),
      );
      expect(mgr.spawnAndWait).not.toHaveBeenCalled();
    });

    it("commits run to foreground settlement through the same preparation", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);

      await svc.run("worker", "plan work");

      expect(mgr.spawnAndWait).toHaveBeenCalledWith(
        expect.anything(),
        "worker",
        "plan work",
        expect.anything(),
      );
      expect(mgr.spawn).not.toHaveBeenCalled();
    });

    it("passes the run signal through so cancelling run stops the work", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);
      const controller = new AbortController();

      await svc.run("worker", "plan work", { signal: controller.signal });

      expect(mgr.spawnAndWait).toHaveBeenCalledWith(
        expect.anything(),
        "worker",
        "plan work",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("detaches the launch signal from accepted background work", async () => {
      const mgr = createManagerStub();
      const svc = makeServiceAdapter(mgr);
      const controller = new AbortController();

      await svc.launch("worker", "plan work", { signal: controller.signal });

      const options = mgr.spawn.mock.calls[0]![3];
      expect(options).not.toHaveProperty("signal");
    });
  });

  it("uses truncated prompt as default description", async () => {
    const mgr = createManagerStub();
    const svc = makeServiceAdapter(mgr);
    const longPrompt = "x".repeat(200);
    await svc.launch("Explore", longPrompt);
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      longPrompt,
      expect.objectContaining({ description: "x".repeat(80) }),
    );
  });

  it("uses provided description over default", async () => {
    const mgr = createManagerStub();
    const svc = makeServiceAdapter(mgr);
    await svc.launch("Explore", "long prompt here", {
      description: "short desc",
    });
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      "long prompt here",
      expect.objectContaining({ description: "short desc" }),
    );
  });
});

describe("SubagentsServiceAdapter — steer, abort, waitForAll, hasRunning", () => {
  function createSvc(mgr: ReturnType<typeof createManagerStub>) {
    return makeServiceAdapter(mgr);
  }

  describe("abort", () => {
    it("delegates to manager.abort and returns its result", () => {
      const mgr = createManagerStub();
      const svc = createSvc(mgr);
      const result = svc.abort("agent-1");
      expect(mgr.abort).toHaveBeenCalledWith("agent-1");
      expect(result).toBe(true);
    });

    it("returns false when manager returns false", () => {
      const mgr = createManagerStub();
      mgr.abort.mockReturnValue(false);
      const svc = createSvc(mgr);
      expect(svc.abort("unknown")).toBe(false);
    });
  });

  describe("waitForAll", () => {
    it("delegates to manager.waitForAll", async () => {
      const mgr = createManagerStub();
      const svc = createSvc(mgr);
      await svc.waitForAll();
      expect(mgr.waitForAll).toHaveBeenCalled();
    });
  });

  describe("hasRunning", () => {
    it("delegates to manager.hasRunning", () => {
      const mgr = createManagerStub();
      mgr.hasRunning.mockReturnValue(true);
      const svc = createSvc(mgr);
      expect(svc.hasRunning()).toBe(true);
      expect(mgr.hasRunning).toHaveBeenCalled();
    });
  });

  describe("steer", () => {
    it("returns false for non-running agent", async () => {
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(
        createTestSubagent({ id: "a-1", status: "completed" }),
      );
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "hurry")).toBe(false);
    });

    it("returns false for unknown agent", async () => {
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(undefined);
      const svc = createSvc(mgr);
      expect(await svc.steer("unknown", "hurry")).toBe(false);
    });

    it("queues message and returns true when session not ready", async () => {
      const record = createTestSubagent({ id: "a-1", status: "running" });
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(record);
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "do this")).toBe(true);
      expect(record.pendingSteerCount).toBe(1);
    });

    it("delegates to session.steer and returns true when session is ready", async () => {
      const mockSteer = vi.fn(async () => {});
      const record = createTestSubagent({ id: "a-1", status: "running" });
      record.attachSession(
        toSubagentSession(
          createSubagentSessionStub(createMockSession({ steer: mockSteer })),
        ),
      );
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(record);
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "focus on tests")).toBe(true);
      expect(mockSteer).toHaveBeenCalledWith("focus on tests");
    });
  });
});

describe("SubagentsServiceAdapter — resume", () => {
  function createSvc(mgr: ReturnType<typeof createManagerStub>) {
    return makeServiceAdapter(mgr);
  }

  it("delegates to manager.resume with the caller's prompt, resuming in the background", async () => {
    const mgr = createManagerStub();
    await createSvc(mgr).resume("a-1", "use the staging config");

    expect(mgr.resume).toHaveBeenCalledWith("a-1", "use the staging config", {
      background: true,
      claimOutcome: undefined,
      signal: undefined,
    });
  });

  it("forwards the caller's delivery claim and signal", async () => {
    const mgr = createManagerStub();
    const signal = new AbortController().signal;

    await createSvc(mgr).resume("a-1", "continue", {
      claimOutcome: true,
      signal,
    });

    expect(mgr.resume).toHaveBeenCalledWith("a-1", "continue", {
      background: true,
      claimOutcome: true,
      signal,
    });
  });

  it("reports a refusal verbatim, so a consumer can word its own message", async () => {
    const mgr = createManagerStub();
    mgr.resume.mockResolvedValue({
      kind: "refused",
      reason: "session-released",
    });

    expect(await createSvc(mgr).resume("a-1", "continue")).toEqual({
      kind: "refused",
      reason: "session-released",
    });
  });

  it("returns the resumed agent by value, never the live record", async () => {
    const mgr = createManagerStub();
    const record = createTestSubagent({
      id: "a-1",
      type: "Explore",
      description: "task A",
      result: "Resumed output.",
      toolUses: 5,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
    });
    mgr.resume.mockResolvedValue({ kind: "resumed", record });

    expect(await createSvc(mgr).resume("a-1", "continue")).toEqual({
      kind: "resumed",
      record: {
        id: "a-1",
        type: "Explore",
        description: "task A",
        status: "completed",
        isBackground: true,
        result: "Resumed output.",
        toolUses: 5,
        startedAt: 1000,
        completedAt: 2000,
        lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
        compactionCount: 0,
        resumeRefusal: "no-session",
      },
    });
  });
});

describe("SubagentsServiceAdapter — registerWorkspaceProvider", () => {
  it("delegates to manager.registerWorkspaceProvider and returns its disposer", () => {
    const disposer = vi.fn();
    const mgr = createManagerStub();
    mgr.registerWorkspaceProvider.mockReturnValue(disposer);
    const svc = makeServiceAdapter(mgr);
    const provider: WorkspaceProvider = {
      prepare: vi.fn(async () => undefined),
    };

    const result = svc.registerWorkspaceProvider(provider);

    expect(mgr.registerWorkspaceProvider).toHaveBeenCalledWith(provider);
    expect(result).toBe(disposer);
  });
});
