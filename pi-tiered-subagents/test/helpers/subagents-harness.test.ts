import { describe, expect, it } from "vitest";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

describe("createSubagentsHarness", () => {
  it("drives a launch through the real chain to a completed by-value record", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "inspect the repo");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);

      // The child adapter received the prepared launch as execution sees it.
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      expect(run.prompt).toBe("inspect the repo");
      expect(child.params.type).toBe("worker");

      run.settle("found things");
      await h.service.waitForAll();

      const record = h.service.getRecord(launched.id);
      expect(record?.status).toBe("completed");
      expect(record?.result).toBe("found things");
      expect(record?.isBackground).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("drives run() to a settled record the call claimed", async () => {
    const h = await createSubagentsHarness();
    try {
      const running = h.service.run("worker", "answer me");
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.settle("the answer");

      const outcome = await running;
      if (outcome.kind !== "settled")
        throw new Error(`expected a settled run, got ${outcome.message}`);
      expect(outcome.record.status).toBe("completed");
      expect(outcome.record.result).toBe("the answer");
      // The foreground run's outcome was claimed before it could settle (story 89).
      expect(h.observer.runFinished[0]?.claimed).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
