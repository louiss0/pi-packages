/**
 * session-ownership.test.ts — Which parent session a request belongs to.
 *
 * The behaviours here are the ones a design can get subtly wrong without
 * anything going obviously red, so each is pinned explicitly:
 *
 *  - a launch belonging to a session that has ended is refused, and leaves
 *    nothing behind;
 *  - `session_before_switch` stops *new* launches without stopping live
 *    children, because Pi may yet abandon the switch (ARCHITECTURE-SPEC 84);
 *  - a switch that took effect cancels the previous session's children
 *    (ARCHITECTURE-SPEC 83);
 *  - a child cannot be resumed from a session that did not ask for it
 *    (ARCHITECTURE-SPEC 73/82).
 */

import { describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import type { LaunchOutcome, SessionOwner } from "#src/lifecycle/session-owner";
import type { Subagent } from "#src/types";
import { WorkspaceGateRegistry } from "#src/scheduling/gate";
import {
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { turnLoopResult } from "#test/helpers/turn-loop-result";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";

const registry = new AgentRegistry(() => ({
  global: { definitions: [], errors: [] },
  project: { definitions: [], errors: [] },
}));

/**
 * A manager whose children never finish on their own, so "still running" is a
 * fact a test can observe rather than a race it has to win.
 *
 * The turn loop resolves against a handle the test keeps, which is what makes
 * the difference between "cancelled by the switch" and "still going" legible.
 */
function createOwnedManager(): {
  manager: SubagentManager;
  hold: () => { promise: Promise<void>; release: () => void };
} {
  let gate: { promise: Promise<void>; release: () => void } = {
    promise: Promise.resolve(),
    release: () => {},
  };
  const manager = new SubagentManager({
    createSubagentSession: async (_params: CreateSubagentSessionParams) => {
      const stub = createSubagentSessionStub();
      stub.runTurnLoop.mockImplementation(async () => {
        await gate.promise;
        return turnLoopResult({ responseText: "done" });
      });
      return toSubagentSession(stub) as SubagentSession;
    },
    limiter: new ConcurrencyLimiter(() => 4),
    baseCwd: "/repo",
    registry,
    workspaceGates: new WorkspaceGateRegistry(),
  });
  return {
    manager,
    hold: () => {
      const held = Promise.withResolvers<void>();
      gate = { promise: held.promise, release: held.resolve };
      return gate;
    },
  };
}

const BASE_CONFIG = {
  description: "d",
  turnPolicy: UNLIMITED_TURNS,
  background: { kind: "explicit", isBackground: true },
} as const;

function spawn(
  manager: SubagentManager,
  owner: SessionOwner | undefined,
): LaunchOutcome<string> {
  return manager.spawn(STUB_SNAPSHOT, "explore", "test", {
    ...BASE_CONFIG,
    owner: owner!,
  });
}

describe("launch acceptance and session ownership", () => {
  it("refuses a launch when no session is active", () => {
    const { manager } = createOwnedManager();

    // No `beginOwner` has run: there is no session for the request to belong
    // to, so there is nothing to accept it against.
    expect(manager.currentOwner()).toBeUndefined();
    expect(spawn(manager, manager.currentOwner())).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
    expect(manager.listAgents()).toEqual([]);
  });

  it("accepts a launch carrying the current session's token", () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");

    const outcome = spawn(manager, manager.currentOwner());
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(manager.getRecord(outcome.value)).toBeDefined();
  });

  it("refuses a launch stamped with a previous session's token", () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const stale = manager.currentOwner();

    // A replacement session starts; the token the old one issued is now past.
    manager.beginOwner("session-2");

    expect(spawn(manager, stale)).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
  });

  it("never reuses a generation, even when Pi hands back the same session id", () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const first = manager.currentOwner();

    manager.beginOwner("session-1");

    // Same id, new generation: the earlier token must not compare equal, or a
    // launch prepared before a restart could be accepted by the session after.
    const second = manager.currentOwner();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.generation).not.toBe(first?.generation);
    expect(spawn(manager, first)).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
  });
});

describe("a switch that may not happen", () => {
  it("stops accepting new launches without stopping live children", async () => {
    const { manager, hold } = createOwnedManager();
    const gate = hold();
    manager.beginOwner("session-1");
    const owner = manager.currentOwner();

    const first = spawn(manager, owner);
    if (first.kind !== "accepted") throw new Error("setup launch refused");
    const record = manager.getRecord(first.value)!;
    await vi.waitFor(() => expect(record.status).toBe("running"));

    // `session_before_switch`: the switch is not confirmed yet.
    manager.beginOwnerEnd();

    expect(manager.currentOwner()).toBeUndefined();
    expect(spawn(manager, owner)).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
    // The running child is untouched — a switch may still be abandoned.
    expect(record.status).toBe("running");

    gate.release();
    await record.promise;
  });

  it("restores the session when the same one starts again", async () => {
    const { manager, hold } = createOwnedManager();
    const gate = hold();
    manager.beginOwner("session-1");
    const owner = manager.currentOwner();

    const first = spawn(manager, owner);
    if (first.kind !== "accepted") throw new Error("setup launch refused");
    const record = manager.getRecord(first.value)!;
    await vi.waitFor(() => expect(record.status).toBe("running"));

    manager.beginOwnerEnd();
    // The operator backed out; `session_start` names the same session.
    manager.beginOwner("session-1");

    // A fresh token is issued, but the child from before keeps running: the
    // switch was abandoned, so nothing about it should have changed.
    expect(manager.currentOwner()?.generation).not.toBe(owner?.generation);
    expect(record.status).toBe("running");
    expect(spawn(manager, manager.currentOwner()).kind).toBe("accepted");

    gate.release();
    await record.promise;
  });
});

describe("serialized owner transitions", () => {
  it("installs overlapping replacements in call order and closes acceptance while queued", async () => {
    const cleanup = Promise.withResolvers<void>();
    const child = createSubagentSessionStub();
    child.dispose.mockReturnValue(cleanup.promise);
    const manager = new SubagentManager({
      createSubagentSession: async () =>
        toSubagentSession(child) as SubagentSession,
      limiter: new ConcurrencyLimiter(() => 4),
      baseCwd: "/repo",
      registry,
      workspaceGates: new WorkspaceGateRegistry(),
    });
    manager.beginOwner("session-a");
    const owner = manager.currentOwner()!;
    manager.spawn(STUB_SNAPSHOT, "explore", "held", { ...BASE_CONFIG, owner });
    await vi.waitFor(() => expect(manager.listAgents()).toHaveLength(1));

    manager.beginOwnerEnd();
    const first = manager.beginOwner("session-b");
    const second = manager.beginOwner("session-c");

    expect(manager.currentOwner()).toBeUndefined();
    expect(spawn(manager, owner)).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
    cleanup.resolve();
    await Promise.all([first, second]);
    expect(manager.currentOwner()?.sessionId).toBe("session-c");
  });

  it("serializes an end behind an overlapping replacement", async () => {
    const cleanup = Promise.withResolvers<void>();
    const child = createSubagentSessionStub();
    child.dispose.mockReturnValue(cleanup.promise);
    const manager = new SubagentManager({
      createSubagentSession: async () =>
        toSubagentSession(child) as SubagentSession,
      limiter: new ConcurrencyLimiter(() => 4),
      baseCwd: "/repo",
      registry,
      workspaceGates: new WorkspaceGateRegistry(),
    });
    manager.beginOwner("session-a");
    const owner = manager.currentOwner()!;
    manager.spawn(STUB_SNAPSHOT, "explore", "held", { ...BASE_CONFIG, owner });
    await vi.waitFor(() => expect(manager.listAgents()).toHaveLength(1));

    const replacement = manager.beginOwner("session-b");
    const ending = manager.endOwner();
    expect(manager.currentOwner()).toBeUndefined();
    cleanup.resolve();
    await Promise.all([replacement, ending]);
    expect(manager.currentOwner()).toBeUndefined();
  });
});

describe("a switch that did happen", () => {
  it("cancels the previous session's running children", async () => {
    const { manager, hold } = createOwnedManager();
    const gate = hold();
    manager.beginOwner("session-1");
    const owner = manager.currentOwner();

    const first = spawn(manager, owner);
    if (first.kind !== "accepted") throw new Error("setup launch refused");
    const record = manager.getRecord(first.value)!;
    await vi.waitFor(() => expect(record.status).toBe("running"));

    manager.beginOwnerEnd();
    manager.beginOwner("session-2");

    // The replacement took effect, so the old session's work is stopped rather
    // than left to deliver a result into a session that never asked for it.
    await vi.waitFor(() => expect(record.status).toBe("stopped"));

    gate.release();
    await record.promise;
  });

  it("leaves a settled record retrievable", async () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const outcome = spawn(manager, manager.currentOwner());
    if (outcome.kind !== "accepted") throw new Error("setup launch refused");
    await manager.getRecord(outcome.value)!.promise;

    manager.beginOwnerEnd();
    manager.beginOwner("session-2");

    // Cancellation stops work; it does not delete it. A result already
    // produced stays readable.
    expect(manager.getRecord(outcome.value)?.result).toBe("done");
  });
});

describe("shutdown", () => {
  it("refuses launches once the session is over", () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const owner = manager.currentOwner();

    manager.endOwner();

    expect(manager.currentOwner()).toBeUndefined();
    expect(spawn(manager, owner)).toEqual({
      kind: "rejected",
      reason: "session-ended",
    });
  });

  it("cancels the children it owned", async () => {
    const { manager, hold } = createOwnedManager();
    const gate = hold();
    manager.beginOwner("session-1");

    const outcome = spawn(manager, manager.currentOwner());
    if (outcome.kind !== "accepted") throw new Error("setup launch refused");
    const record = manager.getRecord(outcome.value)!;
    await vi.waitFor(() => expect(record.status).toBe("running"));

    manager.endOwner();

    await vi.waitFor(() => expect(record.status).toBe("stopped"));
    gate.release();
    await record.promise;
  });
});

describe("resume belongs to the session that asked for the child", () => {
  async function settleThenResume(): Promise<{
    manager: SubagentManager;
    id: string;
  }> {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const outcome = spawn(manager, manager.currentOwner());
    if (outcome.kind !== "accepted") throw new Error("setup launch refused");
    await manager.getRecord(outcome.value)!.promise;
    return { manager, id: outcome.value };
  }

  it("resumes a child the current session asked for", async () => {
    const { manager, id } = await settleThenResume();

    expect(manager.startResume(id, "continue", { background: true }).kind).toBe(
      "started",
    );
    await manager.getRecord(id)!.promise;
  });

  it("refuses a resume from a session that did not ask for the child", async () => {
    const { manager, id } = await settleThenResume();

    manager.beginOwnerEnd();
    manager.beginOwner("session-2");

    // The id is known and the child is resumable in itself — but it belongs
    // to the previous session, whose outcomes went to that session's parent.
    expect(manager.startResume(id, "continue", { background: true })).toEqual({
      kind: "refused",
      reason: "stale-session",
    });
  });

  it("refuses the same resume through the awaiting door", async () => {
    const { manager, id } = await settleThenResume();

    manager.beginOwnerEnd();
    manager.beginOwner("session-2");

    // `resume` delegates its admission to `startResume`, so both doors decline
    // the same resume for the same reason.
    await expect(
      manager.resume(id, "continue", { background: true }),
    ).resolves.toEqual({ kind: "refused", reason: "stale-session" });
  });
});

describe("a record knows which session accepted it", () => {
  it("records the generation of the accepting session", async () => {
    const { manager } = createOwnedManager();
    manager.beginOwner("session-1");
    const owner = manager.currentOwner();

    const outcome = spawn(manager, owner);
    if (outcome.kind !== "accepted") throw new Error("setup launch refused");

    const record: Subagent | undefined = manager.getRecord(outcome.value);
    expect(record?.ownerGeneration).toBe(owner?.generation);
  });
});
