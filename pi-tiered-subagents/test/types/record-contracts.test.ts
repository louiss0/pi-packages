import { describe, expectTypeOf, it } from "vitest";
import type {
  FamilyProfile,
  ModelCandidate,
  TierProfile,
} from "#src/models/profiles";
import type {
  PersistedRunSummary,
  PersistedSubagentRecord,
} from "#src/persisted-record";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { SubagentsSettings } from "#src/settings";

/**
 * Compile-time contracts for the record modernization.
 *
 * These assertions are checked by `nx typecheck`; the runtime test only keeps
 * the file in the suite so the contracts cannot be deleted without a failure.
 */
describe("record type contracts", () => {
  it("keeps mutable data mutable and read-only data protected", () => {
    const settings: SubagentsSettings = {};
    settings.maxConcurrent = 2;

    const profile: FamilyProfile = {
      family: "gpt",
      group: "size",
      tiers: [],
    };
    // @ts-expect-error a profile is data with a protected family key
    profile.family = "claude";
    // @ts-expect-error its version collection is read-only
    profile.tiers.push({ tier: "sol", size: "L" });

    const candidate: ModelCandidate = { provider: "openai", id: "gpt-6.1-sol" };
    // @ts-expect-error a model identity keeps its provider fixed
    candidate.provider = "anthropic";

    const tier: TierProfile = { tier: "" };
    // @ts-expect-error an absent optional stays absent, not set to undefined
    const explicitUndefined: TierProfile = { ...tier, size: undefined };
    void explicitUndefined;

    const turnBudget: TurnBudget = { used: 1, phase: "within" };
    turnBudget.used = 2;
    turnBudget.maxTurns = 5;

    expectTypeOf<SubagentsSettings["maxConcurrent"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf(turnBudget.used).toEqualTypeOf<number>();
  });

  it("derives validated profile records from the schema shapes", () => {
    expectTypeOf<FamilyProfile["tiers"]>().toEqualTypeOf<
      ReadonlyArray<TierProfile>
    >();
    expectTypeOf<FamilyProfile["group"]>().toEqualTypeOf<
      "size" | "planner-worker"
    >();
  });

  it("keeps persisted records compatible with the validated payloads", () => {
    const full: PersistedSubagentRecord = {
      id: "run-1",
      type: "Explore",
      description: "map",
      status: "completed",
      result: "done",
      error: undefined,
      turnBudget: { maxTurns: 5, used: 2, phase: "within" },
      startedAt: 1000,
      completedAt: 2000,
      outputFile: "/tmp/run.jsonl",
      toolUses: 3,
    };
    const withoutCeiling: PersistedSubagentRecord = {
      ...full,
      turnBudget: { used: 2, phase: "within" },
    };
    const minimalRun: PersistedRunSummary = {
      id: "run-1",
      type: "Explore",
      description: "map",
      status: "queued",
      startedAt: 1000,
      completedAt: undefined,
      toolUses: 0,
      outputFile: undefined,
    };

    expectTypeOf<
      PersistedSubagentRecord["status"]
    >().toEqualTypeOf<SubagentStatus>();
    expectTypeOf<PersistedSubagentRecord["result"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<PersistedSubagentRecord["completedAt"]>().toEqualTypeOf<
      number | undefined
    >();
    const budget: PersistedSubagentRecord["turnBudget"] =
      withoutCeiling.turnBudget;
    void budget;
    void minimalRun;
    expectTypeOf<PersistedRunSummary["completedAt"]>().toEqualTypeOf<
      number | undefined
    >();
  });
});
