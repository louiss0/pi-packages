import { describe, expect, it } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import type { TurnLoopResult } from "#src/lifecycle/subagent-session";
import { GetResultTool } from "#src/tools/get-result-tool";
import type { Subagent } from "#src/types";
import {
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import {
  createTestSubagent,
  makeStubExecution,
} from "#test/helpers/make-subagent";
import { STUB_CTX } from "#test/helpers/stub-ctx";
import { textOf } from "#test/helpers/text-of";
import { turnLoopResult } from "#test/helpers/turn-loop-result";

const registry = new AgentRegistry(() => ({
  global: { definitions: [], errors: [] },
  project: { definitions: [], errors: [] },
}));

describe("run-associated result wait", () => {
  it("reports the run it began observing when completion immediately starts a resume", async () => {
    const resumed = Promise.withResolvers<TurnLoopResult>();
    const session = createSubagentSessionStub();
    session.runTurnLoop
      .mockResolvedValueOnce(turnLoopResult({ responseText: "first result" }))
      .mockReturnValueOnce(resumed.promise);

    const record = createTestSubagent({
      status: "running",
      completedAt: undefined,
      execution: makeStubExecution({
        createSubagentSession: async () => toSubagentSession(session),
        // This runs during the terminal transition, before the waiter's
        // promise continuation. It models a concurrent resume from completion
        // handling rather than relying on timing delays.
        observer: {
          onRunFinished: (agent, kind) => {
            if (kind === "initial")
              void agent.resume("continue", { background: true });
          },
        },
      }),
    });
    record.start();
    const tool = new GetResultTool(
      {
        getRecord: (id: string): Subagent | undefined =>
          id === record.id ? record : undefined,
      },
      registry,
    );

    const result = await tool.execute(
      "call-1",
      { agent_id: record.id, wait: true },
      new AbortController().signal,
      undefined,
      STUB_CTX,
    );

    expect(textOf(result)).toContain("first result");
    expect(textOf(result)).not.toContain("second result");
    expect(record.status).toBe("running");

    resumed.resolve(turnLoopResult({ responseText: "second result" }));
    await record.promise;
  });
});
