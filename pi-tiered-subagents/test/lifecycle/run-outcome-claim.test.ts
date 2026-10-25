import { describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import type { Subagent } from "#src/lifecycle/subagent";
import { WorkspaceGateRegistry } from "#src/scheduling/gate";
import {
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { TEST_OWNER } from "#test/helpers/owner";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";

function registry() {
  return new AgentRegistry(() => ({
    global: { definitions: [], errors: [] },
    project: { definitions: [], errors: [] },
  }));
}

describe("foreground run outcome claim", () => {
  it("withholds an immediately completed foreground outcome from the completion carrier", async () => {
    // The child factory and turn loop both resolve immediately. The completion
    // observer is the same point at which notification delivery decides whether
    // it owes a nudge, so this catches a foreground claim that arrives too late.
    let claimedWhenFinished: boolean | undefined;
    const session = createSubagentSessionStub();
    const manager = new SubagentManager({
      createSubagentSession: vi.fn(async () => toSubagentSession(session)),
      limiter: new ConcurrencyLimiter(() => 1),
      baseCwd: "/repo",
      registry: registry(),
      workspaceGates: new WorkspaceGateRegistry(),
      observer: {
        onSubagentCreated: () => {},
        onSubagentRunStarted: () => {},
        onSubagentRunFinished: (record: Subagent) => {
          claimedWhenFinished = record.claimed;
        },
        onSubagentCompacted: () => {},
      },
    });
    manager.beginOwner(TEST_OWNER.sessionId);

    try {
      const outcome = await manager.spawnAndWait(
        STUB_SNAPSHOT,
        "worker",
        "answer immediately",
        {
          description: "immediate foreground child",
          turnPolicy: UNLIMITED_TURNS,
          owner: TEST_OWNER,
        },
      );

      expect(outcome.kind).toBe("accepted");
      expect(claimedWhenFinished).toBe(true);
    } finally {
      await manager.dispose();
    }
  });
});
