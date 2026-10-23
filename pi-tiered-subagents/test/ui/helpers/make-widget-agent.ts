import { merge, type Patch } from "#src/optional";
import type { WidgetAgent } from "#src/ui/view-types";

/** A presentation snapshot, with no runtime record, session, or execution state. */
export function makeWidgetAgent(
  overrides: Patch<WidgetAgent> = {},
): WidgetAgent {
  return merge<WidgetAgent>(
    {
      id: "agent-1",
      type: "general-purpose",
      description: "Test task",
      status: "completed",
      startedAt: 1000,
      completedAt: 2000,
      toolUses: 3,
      lifetimeUsage: { input: 500, output: 500, cacheWrite: 0 },
      compactionCount: 0,
      activeTools: new Map(),
      responseText: "",
      contextPercent: null,
    },
    overrides,
  );
}
