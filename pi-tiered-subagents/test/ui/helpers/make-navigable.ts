import { merge, type Patch } from "#src/optional";
import type { NavigableSubagent } from "#src/ui/session-navigation";
import { fakeSource } from "#test/helpers/transcript-fixtures";

/** Picker metadata plus a narrow transcript reader, not a runtime subagent. */
export function makeNavigable(
  overrides: Patch<NavigableSubagent> = {},
): NavigableSubagent {
  return merge<NavigableSubagent>(
    {
      id: "agent-1",
      type: "worker",
      description: "Test task",
      status: "completed",
      startedAt: 1000,
      completedAt: 4000,
      toolUses: 2,
      outputFile: undefined,
      transcript: fakeSource(),
    },
    overrides,
  );
}
