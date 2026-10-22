import { describe, expect, it } from "vitest";
import { WorkspaceGate, workspaceGateFor } from "#src/scheduling/gate";

describe("the workspace's exclusive slot", () => {
  it("is free until a child takes it", () => {
    const gate = new WorkspaceGate();
    expect(gate.holderId).toBeUndefined();
    expect(gate.tryAcquire("a")).toBe(true);
    expect(gate.holderId).toBe("a");
  });

  it("is not taken twice", () => {
    const gate = new WorkspaceGate();
    gate.tryAcquire("a");
    expect(gate.tryAcquire("b")).toBe(false);
    expect(gate.holderId).toBe("a");
  });

  it("goes to the next waiter when it is given up", async () => {
    const gate = new WorkspaceGate();
    gate.tryAcquire("a");
    const waiting = gate.acquire("b");

    expect(gate.waitingCount).toBe(1);
    gate.release("a");

    await expect(waiting).resolves.toBe(true);
    expect(gate.holderId).toBe("b");
  });

  it("ignores a release from a child that does not hold it", () => {
    const gate = new WorkspaceGate();
    gate.tryAcquire("a");
    gate.release("b");
    expect(gate.holderId).toBe("a");
  });

  it("is free again once the holder gives it up", () => {
    const gate = new WorkspaceGate();
    gate.tryAcquire("a");
    gate.release("a");
    expect(gate.holderId).toBeUndefined();
    expect(gate.tryAcquire("b")).toBe(true);
  });

  it("gives up a wait whose signal fired, without taking the slot", async () => {
    const gate = new WorkspaceGate();
    gate.tryAcquire("a");
    const controller = new AbortController();
    const waiting = gate.acquire("b", controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBe(false);
    expect(gate.waitingCount).toBe(0);
    expect(gate.holderId).toBe("a");
  });

  it("is one slot per workspace", () => {
    expect(workspaceGateFor("/repo")).toBe(workspaceGateFor("/repo"));
    expect(workspaceGateFor("/repo")).not.toBe(workspaceGateFor("/other"));
  });
});
