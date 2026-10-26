import { expect, it, vi } from "vitest";
import type { Workspace } from "#src/lifecycle/workspace";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it("disposes a child arriving after owner shutdown exactly once without starting it", async () => {
  const h = await createSubagentsHarness({ concurrency: 1 });
  h.children.pauseCreation();
  try {
    const launched = await h.service.launch("explore", "late child");
    if (launched.kind !== "accepted") throw new Error("launch refused");
    await vi.waitFor(() =>
      expect(h.service.getRecord(launched.id)?.status).toBe("running"),
    );
    await h.endSession();
    h.children.resumeCreation();
    const late = await h.children.childBorn(0);
    await vi.waitFor(() => expect(late.disposeCount).toBe(1), { timeout: 300 });
    expect(late.runs).toHaveLength(0);
    await h.dispose();
    expect(late.disposeCount).toBe(1);
  } finally {
    h.children.resumeCreation();
    await h.dispose();
  }
});

it("disposes a workspace arriving after shutdown without constructing a child", async () => {
  const h = await createSubagentsHarness();
  const prepared = Promise.withResolvers<Workspace>();
  const entered = Promise.withResolvers<void>();
  const dispose = vi.fn(() => undefined);
  h.service.registerWorkspaceProvider({
    prepare: async () => {
      entered.resolve();
      return prepared.promise;
    },
  });
  try {
    await h.service.launch("worker", "late workspace");
    await entered.promise;
    await h.endSession();
    prepared.resolve({ cwd: "/late-workspace", dispose });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(h.children.children).toHaveLength(0);
    await h.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    prepared.resolve({ cwd: "/late-workspace", dispose });
    await h.dispose();
  }
});
