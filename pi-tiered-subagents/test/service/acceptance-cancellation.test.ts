import { expect, it, vi } from "vitest";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it.each([
  "launch",
  "run",
] as const)("%s refuses caller cancellation between completed preparation and acceptance", async (door) => {
  const h = await createSubagentsHarness();
  const controller = new AbortController();
  const prepare = h.subagents.prepareLaunch.bind(h.subagents);
  // Gate only the handoff: parsing, resolution, ownership, and preparation
  // all run unchanged. No fake prepared plan or manager substitutes.
  vi.spyOn(h.subagents, "prepareLaunch").mockImplementation(async (...args) => {
    const prepared = await prepare(...args);
    expect(prepared.kind).toBe("prepared");
    controller.abort();
    return prepared;
  });
  try {
    const outcome = await h.service[door]("explore", "cancel at handoff", {
      signal: controller.signal,
    });
    expect(outcome).toMatchObject({ kind: "rejected", reason: "cancelled" });
    expect(h.service.listAgents()).toEqual([]);
    expect(h.children.children).toHaveLength(0);
  } finally {
    await h.dispose();
  }
});

it("does not cancel accepted background work when its caller aborts", async () => {
  const h = await createSubagentsHarness();
  const controller = new AbortController();
  try {
    const accepted = await h.service.launch("explore", "manager-owned child", {
      signal: controller.signal,
    });
    if (accepted.kind !== "accepted") throw new Error("launch refused");
    const child = await h.children.childBorn(0);
    const run = await child.runStarted(0);
    controller.abort();
    expect(run.signal?.aborted).toBe(false);
    expect(h.service.getRecord(accepted.id)?.status).toBe("running");
    run.settle("completed independently");
    await h.service.waitForAll();
    expect(h.service.getRecord(accepted.id)?.status).toBe("completed");
  } finally {
    await h.dispose();
  }
});
