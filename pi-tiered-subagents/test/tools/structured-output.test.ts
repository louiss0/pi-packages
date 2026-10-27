/**
 * structured-output.test.ts — Story 110: typed tool output contracts.
 *
 * Asserts the three model-facing tools carry schema-matching
 * `structuredContent` for genuinely structured data, that the structured
 * values agree with the model-facing text they free consumers from parsing,
 * and that rejections/errors are honest: expected rejections are structured
 * values, defects are flagged `isError`.
 *
 * The codemode seam this serves is concrete: the SDK's `toScriptValue` hands
 * a script `result.structuredContent` whenever the registered tool declares
 * `outputSchema`. Validating every door's payload against the declared
 * `def.outputSchema` — not an imported copy — proves what a script receives.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { defined } from "#src/optional";
import {
  createAgentTool,
  createGetResultTool,
  createSteerTool,
  type GetResultParams,
  type GetResultToolManager,
  type SteerToolEvents,
  type SteerToolManager,
} from "../../extensions/index";
import {
  getResultOutputSchema,
  steerOutputSchema,
  subagentOutputSchema,
} from "#src/tools/structured-output";
import type { Subagent } from "#src/types";
import { AgentRegistry } from "#src/agents/registry";
import {
  createToolDeps,
  mockResumeRefusal,
  mockResumeStart,
} from "#test/helpers/make-deps";
import {
  createTestSubagent,
  makeStubExecution,
} from "#test/helpers/make-subagent";
import {
  createMockSession,
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";
import { registeredTool } from "#test/helpers/registered-tools";
import { textOf } from "#test/helpers/text-of";

// ---- Shared helpers ----

/** The structured payload a result carries, failing loudly when it carries none. */
function structuredOf(result: { structuredContent?: unknown }): unknown {
  if (result.structuredContent === undefined) {
    throw new Error("expected structuredContent on the tool result");
  }
  return result.structuredContent;
}

/** A result's structured payload, asserted against the tool's declared output schema. */
function checkedOutput(
  def: { outputSchema?: unknown },
  result: { structuredContent?: unknown },
): Record<string, unknown> {
  const output = structuredOf(result);
  if (def.outputSchema === undefined) {
    throw new Error("expected the tool definition to declare outputSchema");
  }
  // Check's type parameter wants a TSchema; the definitions under test declare
  // one, and a regression that drops it fails the throw above rather than here.
  expect(Check(def.outputSchema as Parameters<typeof Check>[0], output)).toBe(
    true,
  );
  return output as Record<string, unknown>;
}

/**
 * A result's isError flag; optional on the SDK's result type, absent on most
 * doors. `content` is named so the parameter is not a weak type.
 */
function isErrorOf(result: {
  content: unknown;
  isError?: boolean;
}): boolean | undefined {
  return result.isError;
}

const testRegistry = new AgentRegistry(() => ({
  global: { definitions: [], errors: [] },
  project: { definitions: [], errors: [] },
}));

// ---- Schema declarations ----

describe("tool definitions declare output schemas", () => {
  it("subagent declares the subagent output schema", () => {
    const def = registeredTool("subagent");
    expect(def.outputSchema).toBe(subagentOutputSchema);
  });

  it("get_subagent_result declares the get-result output schema", () => {
    const def = registeredTool("get_subagent_result");
    expect(def.outputSchema).toBe(getResultOutputSchema);
  });

  it("steer_subagent declares the steer output schema", () => {
    const def = registeredTool("steer_subagent");
    expect(def.outputSchema).toBe(steerOutputSchema);
  });

  it("each schema is a JSON object schema naming its required keys", () => {
    expect(subagentOutputSchema.type).toBe("object");
    expect(subagentOutputSchema.required).toEqual(["outcome"]);
    expect(getResultOutputSchema.required).toEqual(["found", "agentId"]);
    expect(steerOutputSchema.required).toEqual(["agentId", "outcome"]);
  });
});

// ---- subagent ----

describe("subagent structured output", () => {
  function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
      ui: { fake: true },
      ...defined(overrides),
    } as unknown as ExtensionContext;
  }

  async function execute(
    deps: ReturnType<typeof createToolDeps>,
    params: Record<string, unknown>,
    signal = new AbortController().signal,
  ) {
    const tool = createAgentTool({
      manager: deps.manager,
      subagents: deps.subagents,
      settings: deps.settings,
      registry: deps.registry,
    });
    return {
      def: registeredTool("subagent"),
      result: await tool.execute("tc-1", params, signal, vi.fn(), makeCtx()),
    };
  }

  it("a background launch reports the accepted child without parsing", async () => {
    const deps = createToolDeps();
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "bg task",
      subagent_type: "worker",
      run_in_background: true,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "accepted",
      agentId: "agent-1",
      agentType: "worker",
      background: true,
      queued: false,
    });
    // The text still says it; the structured value is what replaces parsing it.
    expect(textOf(result)).toContain("Agent ID: agent-1");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a queued background launch reports the queue wait as a value", async () => {
    const deps = createToolDeps({
      manager: {
        ...createToolDeps().manager,
        getRecord: vi
          .fn()
          .mockReturnValue(createTestSubagent({ status: "queued" })),
      },
    });
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "bg task",
      subagent_type: "worker",
      run_in_background: true,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ outcome: "accepted", queued: true });
    expect(textOf(result)).toContain("queued");
  });

  it("a foreground run reports its settled outcome and result body", async () => {
    const deps = createToolDeps();
    deps.manager.spawnAndWait = vi.fn().mockResolvedValue({
      kind: "accepted",
      value: createTestSubagent({
        result: "Task complete.",
        toolUses: 7,
        startedAt: 1000,
        completedAt: 4000,
      }),
    });
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "fg task",
      subagent_type: "worker",
      run_in_background: false,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "completed",
      agentId: "agent-1",
      agentType: "worker",
      background: false,
      status: "completed",
      result: "Task complete.",
      toolUses: 7,
      durationMs: 3000,
    });
    expect(textOf(result)).toContain("Task complete.");
    expect(textOf(result)).toContain("Agent ID: agent-1");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a failed child run stays a structured outcome value, not a tool error", async () => {
    const deps = createToolDeps();
    deps.manager.spawnAndWait = vi.fn().mockResolvedValue({
      kind: "accepted",
      value: createTestSubagent({
        status: "error",
        result: undefined,
        error: "Out of context",
      }),
    });
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "fg task",
      subagent_type: "worker",
      run_in_background: false,
    });
    const output = checkedOutput(def, result);
    // An accepted child with an execution failure: expected, so a value.
    expect(output).toMatchObject({
      outcome: "completed",
      status: "error",
      error: "Out of context",
    });
    expect(output.result).toBeUndefined();
    expect(textOf(result)).toContain("Agent failed: Out of context");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("an unknown agent type is a structured rejection, not an error", async () => {
    const deps = createToolDeps();
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "task",
      subagent_type: "no-such-agent",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "rejected",
      reason: "unknown-agent",
    });
    expect(output.agentId).toBeUndefined();
    expect(isErrorOf(result)).toBe(true);
  });

  it("rejects cancellation after preparation before acceptance", async () => {
    const deps = createToolDeps();
    const controller = new AbortController();
    const prepared = await deps.subagents.prepareLaunch({
      type: "worker",
      prompt: "do task",
    });
    if (prepared.kind !== "prepared") throw new Error("expected preparation");
    deps.subagents.prepareLaunch = vi.fn(async () => {
      controller.abort();
      return prepared;
    });

    const { def, result } = await execute(
      deps,
      {
        prompt: "do task",
        description: "task",
        subagent_type: "worker",
        run_in_background: true,
      },
      controller.signal,
    );
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ outcome: "rejected", reason: "cancelled" });
    expect(isErrorOf(result)).toBe(true);
    expect(deps.manager.spawn).not.toHaveBeenCalled();
  });

  it("a refused resume reports its structured reason and the agent id", async () => {
    const deps = createToolDeps();
    mockResumeRefusal(deps, "no-session");
    const { def, result } = await execute(deps, {
      prompt: "continue",
      description: "resume",
      subagent_type: "worker",
      resume: "agent-1",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "rejected",
      reason: "no-session",
      agentId: "agent-1",
    });
    expect(textOf(result)).toContain('Agent "agent-1" has no active session');
    expect(isErrorOf(result)).toBe(true);
  });

  it("a foreground resume reports the resumed run's outcome", async () => {
    const deps = createToolDeps();
    mockResumeStart(deps, { result: "Resumed output." });
    const { def, result } = await execute(deps, {
      prompt: "continue",
      description: "resume",
      subagent_type: "worker",
      resume: "agent-1",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "completed",
      agentId: "agent-1",
      resumed: true,
      status: "completed",
      result: "Resumed output.",
    });
    expect(textOf(result)).toContain("Resumed output.");
  });

  it("a background resume reports acceptance without waiting", async () => {
    const deps = createToolDeps();
    mockResumeStart(deps, {});
    const { def, result } = await execute(deps, {
      prompt: "continue",
      description: "resume",
      subagent_type: "worker",
      resume: "agent-1",
      run_in_background: true,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "accepted",
      agentId: "agent-1",
      background: true,
      resumed: true,
    });
    expect(textOf(result)).toContain("Agent ID: agent-1");
  });

  it("a spawn that throws is flagged isError, not worded as an outcome", async () => {
    const deps = createToolDeps({
      manager: {
        ...createToolDeps().manager,
        spawn: vi.fn().mockImplementation(() => {
          throw new Error("spawn failed");
        }),
      },
    });
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "bg task",
      subagent_type: "worker",
      run_in_background: true,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ outcome: "failed", error: "spawn failed" });
    expect(textOf(result)).toContain("spawn failed");
    expect(isErrorOf(result)).toBe(true);
  });

  it("a foreground wait that throws is flagged isError", async () => {
    const deps = createToolDeps();
    deps.manager.spawnAndWait = vi
      .fn()
      .mockRejectedValue(new Error("runner crashed"));
    const { def, result } = await execute(deps, {
      prompt: "do task",
      description: "fg task",
      subagent_type: "worker",
      run_in_background: false,
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      outcome: "failed",
      error: "runner crashed",
    });
    expect(isErrorOf(result)).toBe(true);
  });
});

// ---- get_subagent_result ----

describe("get_subagent_result structured output", () => {
  function makeManager(
    records: Map<string, Subagent> = new Map(),
  ): GetResultToolManager {
    return { getRecord: (id: string) => records.get(id) };
  }

  async function execute(
    manager: GetResultToolManager,
    params: GetResultParams,
  ) {
    const tool = createGetResultTool(manager, testRegistry);
    return {
      def: registeredTool("get_subagent_result"),
      result: await tool.execute(
        "tc-1",
        params,
        new AbortController().signal,
        undefined,
        STUB_CTX,
      ),
    };
  }

  it("an unknown agent id is a structured not-found, not an error", async () => {
    const { def, result } = await execute(makeManager(), {
      agent_id: "nope",
    });
    const output = checkedOutput(def, result);
    expect(output).toEqual({ found: false, agentId: "nope" });
    expect(textOf(result)).toContain('Agent not found: "nope"');
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a completed agent's report facts arrive as values", async () => {
    const record = createTestSubagent({
      result: "All done.",
      toolUses: 3,
      startedAt: 1000,
      completedAt: 2000,
    });
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1" },
    );
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      found: true,
      agentId: "agent-1",
      status: "completed",
      result: "All done.",
      description: "Test task",
      toolUses: 3,
      durationMs: 1000,
    });
    // The same facts the text renders, now readable without parsing it.
    const text = textOf(result);
    expect(text).toContain("Agent: agent-1");
    expect(text).toContain("Status: completed");
    expect(text).toContain("All done.");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("reports resumability as a boolean plus the refusal reason", async () => {
    // A passive fixture has no live session, so a resume would be refused.
    const record = createTestSubagent({});
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1" },
    );
    const output = checkedOutput(def, result);
    expect(output.resumable).toBe(false);
    expect(output.resumeRefusal).toBe("no-session");
  });

  it("a session-ready agent reports resumable: true with no refusal", async () => {
    const record = createTestSubagent({ sessionReady: true });
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1" },
    );
    const output = checkedOutput(def, result);
    expect(output.resumable).toBe(true);
    expect(output.resumeRefusal).toBeUndefined();
  });

  it("an errored run's error is a structured value, not a tool error", async () => {
    const record = createTestSubagent({
      status: "error",
      result: undefined,
      error: "Context window exceeded",
    });
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1" },
    );
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      found: true,
      status: "error",
      error: "Context window exceeded",
    });
    expect(textOf(result)).toContain("Context window exceeded");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a wait that ends at its bound says so as a value", async () => {
    const sessionStub = createSubagentSessionStub();
    sessionStub.runTurnLoop.mockReturnValue(new Promise<never>(() => {}));
    const record = createTestSubagent({
      status: "running",
      result: undefined,
      completedAt: undefined,
      execution: makeStubExecution({
        createSubagentSession: async () => toSubagentSession(sessionStub),
      }),
    });
    record.start();
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1", wait: true, timeout: 1 },
    );
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      found: true,
      status: "running",
      waitExpiredAfter: 1,
    });
    expect(textOf(result)).toContain("1s timeout");
    expect(isErrorOf(result)).toBeUndefined();
  }, 10_000);

  it("a verbose call's conversation arrives as a value matching the text", async () => {
    const record = createTestSubagent({});
    const stub = createSubagentSessionStub();
    stub.getConversation.mockReturnValue("user: hi\nassistant: done");
    record.attachSession(toSubagentSession(stub));
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1", verbose: true },
    );
    const output = checkedOutput(def, result);
    expect(output.conversation).toBe("user: hi\nassistant: done");
    expect(textOf(result)).toContain("user: hi\nassistant: done");
  });

  it("a non-verbose call carries no conversation", async () => {
    const record = createTestSubagent({ sessionReady: true });
    const { def, result } = await execute(
      makeManager(new Map([["agent-1", record]])),
      { agent_id: "agent-1" },
    );
    const output = checkedOutput(def, result);
    expect(output.conversation).toBeUndefined();
  });
});

// ---- steer_subagent ----

describe("steer_subagent structured output", () => {
  function makeManager(
    records: Map<string, Subagent> = new Map(),
  ): SteerToolManager {
    return { getRecord: (id: string) => records.get(id) };
  }

  function makeEvents(): SteerToolEvents {
    return { emit: vi.fn() };
  }

  async function execute(
    manager: SteerToolManager,
    params: { agent_id: string; message: string },
  ) {
    const tool = createSteerTool(manager, makeEvents());
    return {
      def: registeredTool("steer_subagent"),
      result: await tool.execute(
        "tc-1",
        params,
        new AbortController().signal,
        undefined,
        STUB_CTX,
      ),
    };
  }

  it("an unknown agent id is a structured not-found, not an error", async () => {
    const { def, result } = await execute(makeManager(), {
      agent_id: "nope",
      message: "hi",
    });
    const output = checkedOutput(def, result);
    expect(output).toEqual({ agentId: "nope", outcome: "not-found" });
    expect(textOf(result)).toContain('Agent not found: "nope"');
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("steering a finished agent is a structured rejection carrying its status", async () => {
    const records = new Map([
      ["agent-1", createTestSubagent({ status: "completed" })],
    ]);
    const { def, result } = await execute(makeManager(records), {
      agent_id: "agent-1",
      message: "hi",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({
      agentId: "agent-1",
      outcome: "rejected",
      status: "completed",
    });
    expect(textOf(result)).toContain("not running");
    expect(textOf(result)).toContain("completed");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a steer ahead of the session is a structured queueing", async () => {
    const records = new Map([
      ["agent-1", createTestSubagent({ status: "running" })],
    ]);
    const { def, result } = await execute(makeManager(records), {
      agent_id: "agent-1",
      message: "redirect",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ agentId: "agent-1", outcome: "queued" });
    expect(textOf(result)).toContain("Steering message queued");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a delivered steer reports delivery", async () => {
    const record = createTestSubagent({ status: "running" });
    record.attachSession(
      toSubagentSession(createSubagentSessionStub(createMockSession())),
    );
    const records = new Map([["agent-1", record]]);
    const { def, result } = await execute(makeManager(records), {
      agent_id: "agent-1",
      message: "change plan",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ agentId: "agent-1", outcome: "delivered" });
    expect(textOf(result)).toContain("Steering message sent");
    expect(isErrorOf(result)).toBeUndefined();
  });

  it("a steer that throws is flagged isError, not worded as an outcome", async () => {
    const record = createTestSubagent({ status: "running" });
    const mockSession = createMockSession();
    mockSession.steer.mockRejectedValue(new Error("session closed"));
    record.attachSession(
      toSubagentSession(createSubagentSessionStub(mockSession)),
    );
    const records = new Map([["agent-1", record]]);
    const { def, result } = await execute(makeManager(records), {
      agent_id: "agent-1",
      message: "hi",
    });
    const output = checkedOutput(def, result);
    expect(output).toMatchObject({ agentId: "agent-1", outcome: "failed" });
    expect(textOf(result)).toContain("Failed to steer agent: session closed");
    expect(isErrorOf(result)).toBe(true);
  });
});
