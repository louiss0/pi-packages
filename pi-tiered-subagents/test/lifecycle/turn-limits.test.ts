/**
 * turn-limits.test.ts
 *
 * Tests for normalizeMaxTurns — the pure turn-limit helper extracted from
 * agent-runner.ts into its own focused home (issue #265).
 *
 * The setter/getter behaviour (clamping, unlimited-marker) is also exercised by:
 *   - test/runtime.test.ts — instance isolation and defaults
 *   - test/lifecycle/subagent-session.test.ts — turn-loop limit integration
 */
import { describe, expect, it } from "vitest";
import {
  normalizeMaxTurns,
  resolveTurnPolicy,
  type TurnBudgetPhase,
  TurnBudgetTracker,
  type TurnPolicy,
  wrappedUpAtTurnLimit,
} from "#src/lifecycle/turn-limits";

/** A limited policy, so a test reads as a budget rather than as a type name. */
function limited(maxTurns: number, wrapUpTurns = 2): TurnPolicy {
  return { kind: "limited", maxTurns, wrapUpTurns };
}

/** The policy of a run nothing sets a ceiling on. */
const UNLIMITED: TurnPolicy = { kind: "unlimited" };

describe("normalizeMaxTurns", () => {
  it("treats undefined as unlimited", () => {
    expect(normalizeMaxTurns(undefined)).toBeUndefined();
  });

  it("treats 0 as unlimited", () => {
    expect(normalizeMaxTurns(0)).toBeUndefined();
  });

  it("keeps positive values", () => {
    expect(normalizeMaxTurns(7)).toBe(7);
  });

  it("raises negative values to the minimum of 2", () => {
    expect(normalizeMaxTurns(-3)).toBe(2);
  });

  it("raises 1 to the minimum of 2: one turn to work, one to answer", () => {
    expect(normalizeMaxTurns(1)).toBe(2);
  });

  it("accepts boundary value 2", () => {
    expect(normalizeMaxTurns(2)).toBe(2);
  });

  it("handles large values unchanged", () => {
    expect(normalizeMaxTurns(10_000)).toBe(10_000);
  });
});

describe("resolveTurnPolicy", () => {
  describe("the ceiling", () => {
    it("takes the resolved request/definition ceiling over the default", () => {
      expect(
        resolveTurnPolicy({ resolvedMaxTurns: 3, defaultMaxTurns: 9 }),
      ).toEqual({ kind: "limited", maxTurns: 3, wrapUpTurns: 2 });
    });

    it("falls back to the operator default when nothing else names one", () => {
      expect(resolveTurnPolicy({ defaultMaxTurns: 9 })).toEqual({
        kind: "limited",
        maxTurns: 9,
        wrapUpTurns: 2,
      });
    });

    it("is unlimited when nothing sets one", () => {
      expect(resolveTurnPolicy({})).toEqual({ kind: "unlimited" });
    });

    it("treats 0 as a deliberate unlimited, not as an absent value", () => {
      expect(
        resolveTurnPolicy({ resolvedMaxTurns: 0, defaultMaxTurns: 9 }),
      ).toEqual({ kind: "unlimited" });
    });

    it("raises a ceiling below the minimum to it", () => {
      expect(resolveTurnPolicy({ resolvedMaxTurns: 1 })).toEqual({
        kind: "limited",
        maxTurns: 2,
        wrapUpTurns: 2,
      });
    });
  });

  describe("the wrap-up turns", () => {
    it("takes the requested count", () => {
      expect(
        resolveTurnPolicy({ resolvedMaxTurns: 5, wrapUpTurns: 3 }),
      ).toEqual({ kind: "limited", maxTurns: 5, wrapUpTurns: 3 });
    });

    it("defaults to 2", () => {
      expect(resolveTurnPolicy({ resolvedMaxTurns: 5 })).toMatchObject({
        wrapUpTurns: 2,
      });
    });

    it("raises a requested count below 1 to 1", () => {
      expect(
        resolveTurnPolicy({ resolvedMaxTurns: 5, wrapUpTurns: 0 }),
      ).toMatchObject({ wrapUpTurns: 1 });
    });
  });

  it("carries no wrap-up allowance into an unlimited policy", () => {
    // An unlimited run has no budget to warn about, so a wrap-up phase for it
    // would be a warning nothing could read.
    expect(resolveTurnPolicy({ wrapUpTurns: 3 })).toEqual({
      kind: "unlimited",
    });
  });
});

describe("wrappedUpAtTurnLimit", () => {
  const statuses = [
    "queued",
    "running",
    "completed",
    "aborted",
    "stopped",
    "error",
  ] as const;
  const phases: TurnBudgetPhase[] = ["within", "warned", "exhausted"];

  for (const status of statuses) {
    for (const phase of phases) {
      const expected = status === "completed" && phase === "warned";
      it(`is ${expected} for ${status} with phase ${phase}`, () => {
        expect(
          wrappedUpAtTurnLimit({
            status,
            turnBudget: { maxTurns: 2, used: 3, phase },
          }),
        ).toBe(expected);
      });
    }

    it(`is false for ${status} with no budget`, () => {
      expect(wrappedUpAtTurnLimit({ status })).toBe(false);
    });
  }
});

/** A successful turn that ran a tool, so the agent loop continues. */
const WORKING_TURN = { failed: false, ranTools: true };
/** A successful turn with no tool calls: the agent's final answer. */
const ANSWER_TURN = { failed: false, ranTools: false };
/** A turn whose response errored or was aborted. */
const FAILED_TURN = { failed: true, ranTools: false };

/** Run `n` working turns through the tracker, returning each turn's action. */
function work(tracker: TurnBudgetTracker, n: number) {
  return Array.from({ length: n }, () => tracker.onTurnEnd(WORKING_TURN));
}

describe("TurnBudgetTracker", () => {
  describe("counting", () => {
    it("starts with no turns used", () => {
      expect(new TurnBudgetTracker(limited(5, 2)).budget).toEqual({
        used: 0,
        maxTurns: 5,
        phase: "within",
      });
    });

    it("counts successful turns, with or without tool calls", () => {
      const tracker = new TurnBudgetTracker(limited(10, 2));
      tracker.onTurnEnd(WORKING_TURN);
      tracker.onTurnEnd(ANSWER_TURN);
      expect(tracker.budget.used).toBe(2);
    });

    it("does not count a turn whose response failed", () => {
      const tracker = new TurnBudgetTracker(limited(10, 2));
      tracker.onTurnEnd(WORKING_TURN);
      expect(tracker.onTurnEnd(FAILED_TURN)).toBeUndefined();
      expect(tracker.budget.used).toBe(1);
    });

    it("reports the turns left before the ceiling", () => {
      const tracker = new TurnBudgetTracker(limited(5, 2));
      work(tracker, 2);
      expect(tracker.remaining).toBe(3);
    });
  });

  describe("warning", () => {
    it("warns once, after the turn that leaves wrapUpTurns turns", () => {
      const tracker = new TurnBudgetTracker(limited(5, 2));
      expect(work(tracker, 4)).toEqual([
        undefined,
        undefined,
        "warn",
        undefined,
      ]);
      expect(tracker.budget).toEqual({ used: 4, maxTurns: 5, phase: "warned" });
    });

    it("defers the warning past a turn that ran no tools", () => {
      const tracker = new TurnBudgetTracker(limited(6, 3));
      work(tracker, 2);
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
      expect(tracker.budget.phase).toBe("within");
      expect(tracker.onTurnEnd(WORKING_TURN)).toBe("warn");
    });

    it("does not warn before the first turn when turns remain beyond the reserve", () => {
      const tracker = new TurnBudgetTracker(limited(5, 2));
      expect(tracker.warnBeforeFirstTurn()).toBe(false);
      expect(tracker.budget.phase).toBe("within");
    });

    it("warns before the first turn when the reserve covers the whole budget", () => {
      const tracker = new TurnBudgetTracker(limited(2, 2));
      expect(tracker.warnBeforeFirstTurn()).toBe(true);
      expect(tracker.budget.phase).toBe("warned");
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
    });

    it("warns before the first turn when the reserve exceeds the budget", () => {
      const tracker = new TurnBudgetTracker(limited(2, 3));
      expect(tracker.warnBeforeFirstTurn()).toBe(true);
    });
  });

  describe("ceiling", () => {
    it("stops after the ceiling turn when that turn ran tools", () => {
      const tracker = new TurnBudgetTracker(limited(3, 1));
      expect(work(tracker, 3)).toEqual([undefined, "warn", "stop"]);
      expect(tracker.budget).toEqual({
        used: 3,
        maxTurns: 3,
        phase: "exhausted",
      });
    });

    it("lets a ceiling turn with no tool calls end the run on its own", () => {
      const tracker = new TurnBudgetTracker(limited(3, 1));
      work(tracker, 2);
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
      expect(tracker.budget).toEqual({ used: 3, maxTurns: 3, phase: "warned" });
    });
  });

  describe("turn start", () => {
    it("lets a turn start within the budget", () => {
      const tracker = new TurnBudgetTracker(limited(3, 1));
      work(tracker, 2);
      expect(tracker.onTurnStart()).toBeUndefined();
    });

    it("stops a turn starting past the ceiling", () => {
      const tracker = new TurnBudgetTracker(limited(3, 1));
      work(tracker, 2);
      tracker.onTurnEnd(ANSWER_TURN);
      expect(tracker.onTurnStart()).toBe("stop");
      expect(tracker.budget.phase).toBe("exhausted");
    });

    it("does not stop twice once the ceiling turn already stopped the run", () => {
      const tracker = new TurnBudgetTracker(limited(3, 1));
      work(tracker, 3);
      expect(tracker.onTurnStart()).toBeUndefined();
    });
  });

  describe("unlimited", () => {
    it("counts turns but never warns or stops", () => {
      const tracker = new TurnBudgetTracker(UNLIMITED);
      expect(tracker.warnBeforeFirstTurn()).toBe(false);
      expect(work(tracker, 50).every((action) => action === undefined)).toBe(
        true,
      );
      expect(tracker.onTurnStart()).toBeUndefined();
      expect(tracker.budget).toEqual({ used: 50, phase: "within" });
      expect(tracker.remaining).toBeUndefined();
    });
  });

  it("hands out a copy of its budget", () => {
    const tracker = new TurnBudgetTracker(limited(5, 2));
    const snapshot = tracker.budget;
    tracker.onTurnEnd(WORKING_TURN);
    expect(snapshot.used).toBe(0);
  });
});
