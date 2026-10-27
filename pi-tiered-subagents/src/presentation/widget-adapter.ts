/**
 * Runtime-to-widget projection. This is the only widget seam that reads live
 * record activity; the UI receives copied values and never sees a child session.
 */

import type {
  ModelIdentity,
  WidgetAgent,
  WidgetSource,
} from "#src/ui/view-types";
import { defined } from "#src/optional";

/** The runtime facts this adapter reads, satisfied structurally by Subagent. */
interface WidgetRecord extends Omit<WidgetAgent, "model" | "contextPercent"> {
  readonly isBackground: boolean;
  readonly modelIdentity?: ModelIdentity | undefined;
  getContextPercent(): number | null;
}

/** No manager mutation, session access, or lifecycle policy crosses this seam. */
export interface WidgetRecordSource {
  listAgents(): ReadonlyArray<WidgetRecord>;
}

/**
 * Keep the widget's established background-only audience. The current run's
 * mode is read each time, so foreground/background resume switches still work.
 */
export function createWidgetSource(records: WidgetRecordSource): WidgetSource {
  return {
    listAgents: () =>
      records
        .listAgents()
        .filter((record) => record.isBackground)
        .map(toWidgetAgent),
  };
}

/** Copy every mutable nested value rather than passing a readonly live alias. */
function toWidgetAgent(record: WidgetRecord): WidgetAgent {
  const usage = record.lifetimeUsage;
  const budget = record.turnBudget;
  const model = record.modelIdentity;
  return defined({
    id: record.id,
    type: record.type,
    status: record.status,
    description: record.description,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    compactionCount: record.compactionCount,
    activeTools: new Map(record.activeTools),
    responseText: record.responseText,
    contextPercent: record.getContextPercent(),
    completedAt: record.completedAt,
    error: record.error,
    lifetimeUsage: usage ? { ...usage } : undefined,
    turnBudget: budget ? { ...budget } : undefined,
    model: model ? { provider: model.provider, id: model.id } : undefined,
  });
}
