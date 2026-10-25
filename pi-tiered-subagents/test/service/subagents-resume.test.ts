/**
 * subagents-resume.test.ts — Resume semantics, through the Subagents service
 * interface (ARCHITECTURE-SPEC stories 72–75; behavioral coverage item 13).
 *
 * Resume dispatches before any new-launch preparation: no definition or model
 * is resolved again, the child's captured configuration is retained, and each
 * resumed run gets a fresh turn counter under the captured policy. These
 * scenarios drive `service.resume` with the real manager and preparer
 * underneath; the controllable child proves what execution actually received.
 */

import { describe, expect, it } from "vitest";
import type { LoadedScopes } from "#src/agents/loader";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

/** One global definition file, so a test can edit the catalog between requests. */
function scopesWithWorkerPatch(patch: Record<string, unknown>): LoadedScopes {
  return {
    global: {
      definitions: [{ id: "worker", patch, path: "worker.md" }],
      errors: [],
    },
    project: { definitions: [], errors: [] },
  };
}

describe("resume through the service", () => {
  it("continues the same child with a new prompt — no new preparation, no new session", async () => {
    let scopes = scopesWithWorkerPatch({});
    const h = await createSubagentsHarness({ scopes: () => scopes });
    try {
      const launched = await h.service.launch("worker", "first task", {
        maxTurns: 4,
      });
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle("first answer");
      await h.service.waitForAll();
      expect(h.service.getRecord(launched.id)).not.toHaveProperty(
        "resumeRefusal",
      );

      // The definition is edited and disabled before the resume: continuing
      // accepted work must not re-select it (stories 14 and 72).
      scopes = scopesWithWorkerPatch({
        instructions: "edited later",
        enabled: false,
      });

      const resumed = h.service.resume(launched.id, "keep going");
      const secondRun = await child.runStarted(1);
      expect(secondRun.prompt).toBe("keep going");
      // One child session the whole time: resume retained the captured
      // configuration rather than preparing another spawn.
      expect(h.children.children).toHaveLength(1);
      expect(child.params.definition?.instructions).not.toBe("edited later");
      expect(h.service.getRecord(launched.id)?.status).toBe("running");

      secondRun.settle("second answer");
      const outcome = await resumed;
      if (outcome.kind !== "resumed")
        throw new Error(`expected a resume, got ${outcome.reason}`);
      expect(outcome.record.status).toBe("completed");
      expect(outcome.record.result).toBe("second answer");

      // The edit reaches future requests only: a new launch sees the new catalog.
      const relaunched = await h.service.launch("worker", "new request");
      expect(relaunched.kind).toBe("rejected");
      if (relaunched.kind === "rejected")
        expect(relaunched.reason).toBe("disabled-agent");
    } finally {
      await h.dispose();
    }
  });

  it("starts every resumed run with a fresh turn counter under the captured policy", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "task", {
        maxTurns: 4,
      });
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      const firstRun = await child.runStarted(0);
      firstRun.advanceTurn();
      firstRun.advanceTurn();
      firstRun.settle("first answer");
      await h.service.waitForAll();
      expect(h.service.getRecord(launched.id)?.turnBudget).toEqual({
        maxTurns: 4,
        used: 2,
        phase: "within",
      });

      const resumed = h.service.resume(launched.id, "more work");
      const secondRun = await child.runStarted(1);
      // Story 74: the same ceiling, a fresh counter — the resumed run does not
      // inherit the two turns the first run spent.
      expect(secondRun.budgets[0]).toEqual({
        maxTurns: 4,
        used: 0,
        phase: "within",
      });
      secondRun.advanceTurn();
      secondRun.settle("second answer");
      await resumed;
      expect(h.service.getRecord(launched.id)?.turnBudget).toEqual({
        maxTurns: 4,
        used: 1,
        phase: "within",
      });
    } finally {
      await h.dispose();
    }
  });

  it("refuses a resume of an unknown or still-running agent, with the reason on the record", async () => {
    const h = await createSubagentsHarness();
    try {
      await expect(h.service.resume("no-such-id", "wake up")).resolves.toEqual({
        kind: "refused",
        reason: "unknown-agent",
      });

      const launched = await h.service.launch("worker", "long task");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      await child.runStarted(0);

      // The refusal is a value, resolved promptly — no turn loop is started.
      await expect(h.service.resume(launched.id, "too soon")).resolves.toEqual({
        kind: "refused",
        reason: "still-running",
      });
      // A record answers the same question before the call (story 75).
      expect(h.service.getRecord(launched.id)?.resumeRefusal).toBe(
        "still-running",
      );
      expect(child.runs).toHaveLength(1);

      (await child.runStarted(0)).settle("done");
      await h.service.waitForAll();
    } finally {
      await h.dispose();
    }
  });

  it("reports a resumed run that failed as resumed, with the error on the record", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "task");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle("first answer");
      await h.service.waitForAll();

      const resumed = h.service.resume(launched.id, "retry the flaky part");
      const secondRun = await child.runStarted(1);
      secondRun.fail(new Error("provider failed again"));

      const outcome = await resumed;
      // A failed resumed run is still `resumed`: a turn loop ran (story: the
      // resume vocabulary distinguishes refusal from failure).
      if (outcome.kind !== "resumed")
        throw new Error(`expected a resume, got ${outcome.reason}`);
      expect(outcome.record.status).toBe("error");
      expect(outcome.record.error).toBe("provider failed again");
    } finally {
      await h.dispose();
    }
  });

  it("borns a claimed run when the caller carries the outcome, an unclaimed one otherwise", async () => {
    const h = await createSubagentsHarness();
    try {
      const launched = await h.service.launch("worker", "task");
      if (launched.kind !== "accepted")
        throw new Error(`expected acceptance, got ${launched.message}`);
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle("first answer");
      await h.service.waitForAll();

      // An unclaimed resume is announced like any background completion.
      const announced = h.service.resume(launched.id, "second task");
      (await child.runStarted(1)).settle("second answer");
      await announced;
      expect(
        h.observer.runFinished.find((t) => t.kind === "resume")?.claimed,
      ).toBe(false);

      // A claimed resume announces nothing: the caller delivers the outcome.
      const claimed = h.service.resume(launched.id, "third task", {
        claimOutcome: true,
      });
      (await child.runStarted(2)).settle("third answer");
      await claimed;
      const resumeFinishes = h.observer.runFinished.filter(
        (t) => t.kind === "resume",
      );
      expect(resumeFinishes[1]?.claimed).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
