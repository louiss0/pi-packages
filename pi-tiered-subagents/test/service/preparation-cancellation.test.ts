import { expect, it } from "vitest";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it.each([
  "launch",
  "run",
] as const)("%s returns cancelled when definition loading rejects after caller abort", async (door) => {
  const controller = new AbortController();
  const h = await createSubagentsHarness({
    scopes: () => {
      controller.signal.throwIfAborted();
      return {
        global: { definitions: [], errors: [] },
        project: { definitions: [], errors: [] },
      };
    },
  });
  h.pauseDefinitionLoad();
  try {
    const pending = h.service[door]("explore", "cancel during load", {
      signal: controller.signal,
    });
    // Observe both success and failure before releasing the paused loader.
    const observed = pending.then(
      (value) => ({ kind: "returned", value }),
      (error: unknown) => ({ kind: "threw", error }),
    );
    controller.abort(new Error("caller ended"));
    h.resumeDefinitionLoad();
    expect(await observed).toMatchObject({
      kind: "returned",
      value: { kind: "rejected", reason: "cancelled" },
    });
    expect(h.service.listAgents()).toEqual([]);
    expect(h.children.children).toHaveLength(0);
  } finally {
    h.resumeDefinitionLoad();
    await h.dispose();
  }
});

it("does not reinterpret a loader failure as cancellation without an aborted caller", async () => {
  const failure = new Error("unexpected loader failure");
  let fail = false;
  const h = await createSubagentsHarness({
    scopes: () => {
      if (fail) throw failure;
      return {
        global: { definitions: [], errors: [] },
        project: { definitions: [], errors: [] },
      };
    },
  });
  try {
    fail = true;
    await expect(h.service.launch("explore", "loader failed")).rejects.toBe(
      failure,
    );
    expect(h.service.listAgents()).toEqual([]);
  } finally {
    await h.dispose();
  }
});
