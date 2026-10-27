import { merge, type Patch } from "#src/optional";
import { describe, expect, it } from "vitest";
import {
  type PersistedSubagentRecord,
  readPersistedRuns,
  type SessionEntryLike,
  SUBAGENT_RECORD_ENTRY,
  toPersistedRecord,
} from "#src/persisted-record";
import { SUBAGENT_STATUSES } from "#src/lifecycle/subagent-state";
import { createTestSubagent } from "#test/helpers/make-subagent";

function persistedRecord(
  overrides: Patch<PersistedSubagentRecord> = {},
): PersistedSubagentRecord {
  return merge(
    {
      id: "run-1",
      type: "Explore",
      description: "map the module",
      status: "completed",
      result: "done",
      error: undefined,
      turnBudget: undefined,
      startedAt: 1000,
      completedAt: 4000,
      outputFile: "/tasks/run-1.jsonl",
      toolUses: 7,
    },
    overrides,
  );
}

function recordEntry(data: unknown): SessionEntryLike {
  return { type: "custom", customType: SUBAGENT_RECORD_ENTRY, data };
}

describe("toPersistedRecord", () => {
  it("copies the persisted fields off the record, and no others", () => {
    const turnBudget = { maxTurns: 5, used: 2, phase: "within" } as const;
    const record = createTestSubagent({
      id: "agent-9",
      type: "Explore",
      description: "map the module",
      status: "error",
      result: "partial",
      error: "boom",
      turnBudget,
      startedAt: 1000,
      completedAt: 2500,
      toolUses: 7,
      sessionReady: true,
      outputFile: "/tasks/a.jsonl",
    });

    expect(toPersistedRecord(record)).toStrictEqual({
      id: "agent-9",
      type: "Explore",
      description: "map the module",
      status: "error",
      result: "partial",
      error: "boom",
      turnBudget,
      startedAt: 1000,
      completedAt: 2500,
      outputFile: "/tasks/a.jsonl",
      toolUses: 7,
    });
  });
});

describe("readPersistedRuns", () => {
  const summary = {
    id: "run-1",
    type: "Explore",
    description: "map the module",
    status: "completed",
    startedAt: 1000,
    completedAt: 4000,
    outputFile: "/tasks/run-1.jsonl",
    toolUses: 7,
  };

  it("returns nothing for no entries", () => {
    expect(readPersistedRuns([])).toEqual([]);
  });

  describe("filtering", () => {
    it("reads only subagents:record custom entries", () => {
      const entries: SessionEntryLike[] = [
        // A valid record shape under another customType must not be read as a run.
        {
          type: "custom",
          customType: "other",
          data: persistedRecord({ id: "foreign" }),
        },
        { type: "message", data: persistedRecord({ id: "message" }) },
        recordEntry(persistedRecord()),
      ];
      expect(readPersistedRuns(entries)).toStrictEqual([summary]);
    });
  });

  describe("repeated ids", () => {
    it("keeps the last entry for an id, so a resumed run reports its latest outcome", () => {
      const entries = [
        recordEntry(persistedRecord({ status: "completed" })),
        recordEntry(persistedRecord({ status: "error", error: "boom" })),
      ];
      expect(readPersistedRuns(entries)).toStrictEqual([
        { ...summary, status: "error" },
      ]);
    });
  });

  describe("validation", () => {
    it("skips an entry written before the entry recorded toolUses", () => {
      const {
        toolUses: _toolUses,
        outputFile: _outputFile,
        ...preUpgrade
      } = persistedRecord();
      expect(readPersistedRuns([recordEntry(preUpgrade)])).toEqual([]);
    });

    it("skips an entry whose status is not a subagent status", () => {
      expect(
        readPersistedRuns([
          recordEntry({ ...persistedRecord(), status: "bogus" }),
        ]),
      ).toEqual([]);
    });

    it("skips an entry with no data", () => {
      expect(readPersistedRuns([recordEntry(undefined)])).toEqual([]);
    });

    it("keeps a run that recorded no transcript", () => {
      const runs = readPersistedRuns([
        recordEntry(
          persistedRecord({ outputFile: undefined, completedAt: undefined }),
        ),
      ]);
      expect(runs).toStrictEqual([
        { ...summary, outputFile: undefined, completedAt: undefined },
      ]);
    });
  });

  describe("complete-entry validation", () => {
    it("accepts a full entry after a JSON round trip", () => {
      const serialized = JSON.parse(JSON.stringify(persistedRecord()));
      expect(readPersistedRuns([recordEntry(serialized)])).toStrictEqual([
        summary,
      ]);
    });

    it("accepts omissions of every serialization-optional field", () => {
      const {
        result: _result,
        error: _error,
        turnBudget: _turnBudget,
        completedAt: _completedAt,
        outputFile: _outputFile,
        ...minimal
      } = persistedRecord();

      expect(readPersistedRuns([recordEntry(minimal)])).toStrictEqual([
        { ...summary, completedAt: undefined, outputFile: undefined },
      ]);
    });

    it.each([
      ["result", 42],
      ["error", 42],
      ["turnBudget", { used: 1, phase: "within", extra: true }],
    ])("rejects a malformed known field: %s", (field, value) => {
      expect(
        readPersistedRuns([
          recordEntry({ ...persistedRecord(), [field]: value }),
        ]),
      ).toEqual([]);
    });

    it("rejects an unknown payload field", () => {
      expect(
        readPersistedRuns([
          recordEntry({ ...persistedRecord(), surprise: true }),
        ]),
      ).toEqual([]);
    });

    it("ignores unrelated session-entry envelope metadata", () => {
      const entry = {
        ...recordEntry(persistedRecord()),
        id: "entry-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      };
      expect(readPersistedRuns([entry])).toStrictEqual([summary]);
    });

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])("rejects a non-finite start timestamp: %s", (startedAt) => {
      expect(
        readPersistedRuns([recordEntry(persistedRecord({ startedAt }))]),
      ).toEqual([]);
    });

    it("rejects a completion time earlier than its start", () => {
      expect(
        readPersistedRuns([
          recordEntry(persistedRecord({ startedAt: 4000, completedAt: 1000 })),
        ]),
      ).toEqual([]);
    });

    it("accepts a completion time equal to its start", () => {
      expect(
        readPersistedRuns([
          recordEntry(persistedRecord({ startedAt: 1000, completedAt: 1000 })),
        ]),
      ).toStrictEqual([{ ...summary, completedAt: 1000 }]);
    });

    it.each([
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])("rejects a malformed tool-use count: %s", (toolUses) => {
      expect(
        readPersistedRuns([recordEntry(persistedRecord({ toolUses }))]),
      ).toEqual([]);
    });

    it("accepts zero tool uses", () => {
      expect(
        readPersistedRuns([recordEntry(persistedRecord({ toolUses: 0 }))]),
      ).toStrictEqual([{ ...summary, toolUses: 0 }]);
    });

    it.each([
      { maxTurns: 5, used: 0, phase: "within" },
      { maxTurns: 5, used: 5, phase: "exhausted" },
      { used: 0, phase: "within" },
    ] as const)("accepts a valid turn budget: %o", (turnBudget) => {
      expect(
        readPersistedRuns([recordEntry(persistedRecord({ turnBudget }))]),
      ).toStrictEqual([summary]);
    });

    it.each([
      { maxTurns: 0, used: 1, phase: "within" },
      { maxTurns: -1, used: 1, phase: "within" },
      { maxTurns: 1.5, used: 1, phase: "within" },
      { maxTurns: 5, used: -1, phase: "within" },
      { maxTurns: 5, used: 1.5, phase: "within" },
      { maxTurns: 5, used: 1, phase: "bogus" },
      { maxTurns: 5, used: 1, phase: "within", extra: true },
      { maxTurns: 5, used: 1, phase: "within", maxTurns_: 1 },
    ])("rejects a malformed turn budget: %o", (turnBudget) => {
      expect(
        readPersistedRuns([
          recordEntry({
            ...persistedRecord(),
            turnBudget,
          }),
        ]),
      ).toEqual([]);
    });

    it("does not infer lifecycle relationships from counts or phase", () => {
      // Used may exceed the ceiling and a phase may disagree with the counts:
      // the budget records events, not a derivable state machine.
      expect(
        readPersistedRuns([
          recordEntry(
            persistedRecord({
              turnBudget: { maxTurns: 2, used: 99, phase: "within" },
            }),
          ),
        ]),
      ).toStrictEqual([summary]);
    });

    it.each(SUBAGENT_STATUSES)("accepts the known status %s", (status) => {
      expect(
        readPersistedRuns([recordEntry(persistedRecord({ status }))]),
      ).toStrictEqual([{ ...summary, status }]);
    });

    it("skips invalid entries independently while keeping valid history", () => {
      const entries = [
        recordEntry(persistedRecord({ id: "first", startedAt: 1000 })),
        recordEntry({ ...persistedRecord(), toolUses: -1 }),
        recordEntry(persistedRecord({ id: "third", startedAt: 3000 })),
      ];
      expect(readPersistedRuns(entries).map((run) => run.id)).toEqual([
        "third",
        "first",
      ]);
    });
  });

  describe("order", () => {
    it("returns runs newest first", () => {
      const entries = [
        recordEntry(persistedRecord({ id: "older", startedAt: 1000 })),
        recordEntry(persistedRecord({ id: "newer", startedAt: 2000 })),
      ];
      expect(readPersistedRuns(entries).map((run) => run.id)).toEqual([
        "newer",
        "older",
      ]);
    });
  });

  it("reads back what toPersistedRecord wrote", () => {
    const record = createTestSubagent({
      id: "round-trip",
      type: "Explore",
      description: "map the module",
      status: "completed",
      startedAt: 1000,
      completedAt: 4000,
      toolUses: 7,
      sessionReady: true,
      outputFile: "/tasks/round-trip.jsonl",
    });
    expect(
      readPersistedRuns([recordEntry(toPersistedRecord(record))]),
    ).toStrictEqual([
      { ...summary, id: "round-trip", outputFile: "/tasks/round-trip.jsonl" },
    ]);
  });
});
