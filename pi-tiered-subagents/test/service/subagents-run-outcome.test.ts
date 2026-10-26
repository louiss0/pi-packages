/**
 * subagents-run-outcome.test.ts — Acceptance and run outcomes, through the
 * Subagents service interface (ARCHITECTURE-SPEC stories 62–64 and 89;
 * behavioral coverage items 2 and 18).
 *
 * Every scenario here crosses the public seam: the real preparer, manager,
 * admission, and lifecycle run underneath, with definition I/O and child
 * execution substituted at their owned adapters. Assertions land on by-value
 * records and recorded lifecycle facts, never on manager internals.
 */

import { describe, expect, it } from "vitest";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

describe("launch acceptance", () => {
  it("accepts without waiting for the child session to exist", async () => {
    const h = await createSubagentsHarness();
    try {
      h.children.pauseCreation();
      const launched = await h.service.launch("worker", "slow to construct");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);

      // Accepted means the manager owns an identified record — not that the
      // SDK session exists yet (story 62).
      expect(h.children.children).toHaveLength(0);
      const record = h.service.getRecord(launched.id);
      expect(record?.status).toBe("running");
      expect(record?.isBackground).toBe(true);

      // The run proceeds once the child is born.
      h.children.resumeCreation();
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.settle("constructed late, still fine");
      await h.service.waitForAll();
      expect(h.service.getRecord(launched.id)?.status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("accepts without waiting for a concurrency slot", async () => {
    const h = await createSubagentsHarness({ concurrency: 1 });
    try {
      const first = await h.service.launch("worker", "holds the slot");
      const second = await h.service.launch("worker", "waits for it");
      if (first.kind !== "accepted" || second.kind !== "accepted")
        throw new Error("both launches should be accepted");

      // The second child was accepted while the first holds the only slot:
      // queued, not rejected, and no extra capacity granted (story 67).
      expect(h.service.getRecord(second.id)?.status).toBe("queued");
      expect(h.children.children).toHaveLength(1);

      const firstChild = await h.children.childBorn(0);
      (await firstChild.runStarted(0)).settle("first done");
      const secondChild = await h.children.childBorn(1);
      (await secondChild.runStarted(0)).settle("second done");
      await h.service.waitForAll();

      expect(h.service.getRecord(first.id)?.status).toBe("completed");
      expect(h.service.getRecord(second.id)?.status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("reports a child that fails construction as an accepted child with an execution failure", async () => {
    const h = await createSubagentsHarness();
    try {
      h.children.failNextCreation(new Error("SDK session construction failed"));
      const launched = await h.service.launch("worker", "doomed child");
      // Acceptance already happened; the failure lands on the run, not on
      // the launch (coverage item 2).
      if (launched.kind !== "accepted")
        throw new Error("the launch was accepted before construction ran");

      await h.service.waitForAll();
      const record = h.service.getRecord(launched.id);
      expect(record?.status).toBe("error");
      expect(record?.error).toBe("SDK session construction failed");
    } finally {
      await h.dispose();
    }
  });
});

describe("run outcomes", () => {
  it("settles run() with the terminal record", async () => {
    const h = await createSubagentsHarness();
    try {
      const running = h.service.run("worker", "compute");
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.advanceTurn();
      run.settle("42");

      const outcome = await running;
      if (outcome.kind !== "settled")
        throw new Error(`expected a settled run, got ${outcome.message}`);
      expect(outcome.record.status).toBe("completed");
      expect(outcome.record.result).toBe("42");
      expect(outcome.record.completedAt).toEqual(expect.any(Number));
      expect(outcome.record.turnBudget?.used).toBe(1);
      expect(outcome.record.isBackground).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("settles run() with an error record when the child fails", async () => {
    const h = await createSubagentsHarness();
    try {
      const running = h.service.run("worker", "compute");
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.fail(new Error("provider reported an error"));

      const outcome = await running;
      if (outcome.kind !== "settled")
        throw new Error(`expected a settled run, got ${outcome.message}`);
      expect(outcome.record.status).toBe("error");
      expect(outcome.record.error).toBe("provider reported an error");
    } finally {
      await h.dispose();
    }
  });

  it("settles with an aborted record when the run exhausts its turn ceiling", async () => {
    const h = await createSubagentsHarness();
    try {
      const running = h.service.run("worker", "compute", { maxTurns: 3 });
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.settleExhausted("partial findings");

      const outcome = await running;
      if (outcome.kind !== "settled")
        throw new Error(`expected a settled run, got ${outcome.message}`);
      expect(outcome.record.status).toBe("aborted");
      expect(outcome.record.result).toBe("partial findings");
      expect(outcome.record.turnBudget).toMatchObject({
        maxTurns: 3,
        phase: "exhausted",
      });
    } finally {
      await h.dispose();
    }
  });
});

describe("outcome claims", () => {
  it("claims a fast foreground outcome before it can settle (story 89)", async () => {
    const h = await createSubagentsHarness();
    try {
      // The child is born and settles in the same turn the test allows it to;
      // the claim must already be in place when the run-finished
      // announcement fires, or a completion carrier would double-deliver.
      const running = h.service.run("worker", "instant");
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);
      run.settle("instant answer");
      await running;

      expect(h.observer.runFinished[0]?.claimed).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("leaves a background outcome unclaimed for the completion carrier", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "background work");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle("background answer");
      await h.service.waitForAll();

      // Nobody claimed this outcome: the notification layer owes the parent
      // a completion nudge for it (coverage item 18).
      expect(h.observer.runFinished[0]?.claimed).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("returns the run it awaited when completion immediately starts a resume", async () => {
    let resumed!: Promise<void>;
    const h = await createSubagentsHarness({
      observer: {
        onSubagentCreated: () => {},
        onSubagentRunStarted: () => {},
        onSubagentRunFinished: (record, kind) => {
          if (kind === "initial")
            resumed = record.resume("follow-up", { background: true });
        },
        onSubagentCompacted: () => {},
      },
    });
    try {
      const running = h.service.run("worker", "initial task");
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle("initial answer");

      const outcome = await running;
      if (outcome.kind !== "settled")
        throw new Error(`expected a settled run, got ${outcome.message}`);

      // `run()` waited for the initial run. A completion observer may start a
      // resume before that wait's continuation runs, but it must not make the
      // foreground caller report the newer run instead.
      expect(outcome.record.status).toBe("completed");
      expect(outcome.record.result).toBe("initial answer");

      (await child.runStarted(1)).settle("follow-up answer");
      await resumed;
    } finally {
      await h.dispose();
    }
  });
});

describe("steer", () => {
  it("delivers a steer to a running child and rejects one to a settled or unknown record", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "steerable work");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      const run = await child.runStarted(0);

      await expect(h.service.steer(launched.id, "focus on src/")).resolves.toBe(
        true,
      );
      expect(child.steered).toEqual(["focus on src/"]);

      await expect(h.service.steer("no-such-id", "hello")).resolves.toBe(false);

      run.settle("done");
      await h.service.waitForAll();
      await expect(h.service.steer(launched.id, "too late")).resolves.toBe(
        false,
      );
    } finally {
      await h.dispose();
    }
  });
});
