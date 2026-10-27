/**
 * persisted-record.ts — The `subagents:record` session-entry contract.
 *
 * Each terminal run is appended to the parent session as a custom entry, so the
 * session file outlives the in-memory `SubagentManager` (a `/reload` rebuilds
 * the extension; a `/resume` reopens the file). This module owns the entry's
 * shape on both sides: the writer (`SubagentEventsObserver`) builds it here,
 * and readers parse it here.
 *
 * The payload is validated completely before it is accepted: a malformed field
 * that summary-only parsing used to ignore makes the entry unusable, while the
 * rest of the history still loads. Pi's session-entry envelope is deliberately
 * not strict — only the payload this package wrote is.
 */

import * as v from "valibot";
import { SUBAGENT_STATUSES } from "#src/lifecycle/subagent-state";
import { TURN_BUDGET_PHASES } from "#src/lifecycle/turn-limits";

/** The `customType` every persisted run record is appended under. */
export const SUBAGENT_RECORD_ENTRY = "subagents:record";

/** The budget shape the writer persists; reuses the runtime phase vocabulary. */
const turnBudgetSchema = v.strictObject({
  maxTurns: v.optional(
    v.pipe(v.number(), v.integer(), v.safeInteger(), v.minValue(1)),
  ),
  used: v.pipe(v.number(), v.integer(), v.safeInteger(), v.minValue(0)),
  phase: v.picklist(TURN_BUDGET_PHASES),
});

const timestampSchema = v.pipe(v.number(), v.finite());

/** The complete persisted run payload: every known field, no unknown ones. */
const persistedPayloadSchema = v.pipe(
  v.strictObject({
    id: v.string(),
    type: v.string(),
    description: v.string(),
    status: v.picklist(SUBAGENT_STATUSES),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    turnBudget: v.optional(turnBudgetSchema),
    startedAt: timestampSchema,
    completedAt: v.optional(timestampSchema),
    /** The run's session JSONL, which a reader can open after the live session is gone. */
    outputFile: v.optional(v.string()),
    toolUses: v.pipe(v.number(), v.integer(), v.safeInteger(), v.minValue(0)),
  }),
  v.check(
    (record) =>
      record.completedAt === undefined ||
      record.completedAt >= record.startedAt,
    "a completion time cannot be earlier than its start time",
  ),
);

type PersistedPayload = v.InferOutput<typeof persistedPayloadSchema>;

/**
 * Make serialization-optional keys required in memory.
 *
 * JSON omits an `undefined` value, so a payload that round-trips through the
 * session file may omit these keys. The writer's record keeps them present as
 * `undefined`, which is the contract the observer and its consumers use.
 */
type RequiredUndefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: T[P] | undefined;
};

/** What is appended for each terminal run. */
export type PersistedSubagentRecord = Readonly<
  RequiredUndefined<
    PersistedPayload,
    "result" | "error" | "turnBudget" | "completedAt" | "outputFile"
  >
>;

/** The fields a reader validates and returns: what labels a past run and opens its transcript. */
export type PersistedRunSummary = Pick<
  PersistedSubagentRecord,
  | "id"
  | "type"
  | "description"
  | "status"
  | "startedAt"
  | "completedAt"
  | "toolUses"
  | "outputFile"
>;

/** The session-entry fields the reader inspects; Pi's `SessionEntry` satisfies it. */
export type SessionEntryLike = Readonly<{
  type: string;
  customType?: string;
  data?: unknown;
}>;

/**
 * Build the entry for one terminal run. A `Subagent` satisfies the parameter
 * structurally; copying field by field keeps everything else off the entry.
 */
export function toPersistedRecord(
  record: PersistedSubagentRecord,
): PersistedSubagentRecord {
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    result: record.result,
    error: record.error,
    turnBudget: record.turnBudget,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    outputFile: record.outputFile,
    toolUses: record.toolUses,
  };
}

/**
 * Read every persisted run out of a session's entries, newest first.
 *
 * A resumed run appends a second entry under the same id, so the last one wins.
 * Entries that do not validate are skipped independently, including those
 * written before the entry recorded `toolUses`.
 */
export function readPersistedRuns(
  entries: ReadonlyArray<SessionEntryLike>,
): PersistedRunSummary[] {
  const runs = new Map<string, PersistedRunSummary>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== SUBAGENT_RECORD_ENTRY)
      continue;
    const run = asRunSummary(entry.data);
    if (run) runs.set(run.id, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function asRunSummary(data: unknown): PersistedRunSummary | undefined {
  const parsed = v.safeParse(persistedPayloadSchema, data);
  if (!parsed.success) return undefined;
  const record = parsed.output;
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    toolUses: record.toolUses,
    outputFile: record.outputFile,
  };
}
