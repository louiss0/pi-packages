/** Runtime records and persisted entries projected onto the transcript UI's read-only seam. */

import type {
  AgentSessionEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isRunningStatus } from "#src/lifecycle/subagent-state";
import { readPersistedRuns } from "#src/persisted-record";
import type {
  PersistedRunSummary,
  SessionEntryLike,
} from "#src/persisted-record";
import type {
  NavigableSubagent,
  PersistedNavigationRun,
  SessionMessage,
  TranscriptSource,
} from "#src/ui/session-navigation";

/** The runtime capabilities the adapter reads; none are passed through to the viewer. */
interface TranscriptRecord extends PersistedRunSummary {
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
  readonly agentMessages: readonly SessionMessage[];
  readonly model:
    | { readonly provider: string; readonly id: string }
    | undefined;
  readonly thinkingLevel: string | undefined;
  isSessionReady(): boolean;
  subscribeToUpdates(
    fn: (event: AgentSessionEvent) => void,
  ): (() => void) | undefined;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

/** Capture picker metadata and expose live content only through the reader adapter. */
export function toNavigableSubagent(
  record: TranscriptRecord,
): NavigableSubagent {
  return {
    ...toNavigationRun(record),
    transcript: record.isSessionReady() ? liveSource(record) : undefined,
  };
}

/** A live reader, not a child session: lifecycle and control methods remain in the runtime. */
export function liveSource(record: TranscriptRecord): TranscriptSource {
  return {
    getMessages: () => record.agentMessages,
    subscribe: (onChange) => record.subscribeToUpdates(onChange),
    streaming: () =>
      isRunningStatus(record.status)
        ? { activeTools: record.activeTools, responseText: record.responseText }
        : undefined,
    getToolDefinition: (name) => record.getToolDefinition(name),
    sessionModel: () => ({
      model: record.model
        ? { provider: record.model.provider, id: record.model.id }
        : undefined,
      thinkingLevel: record.thinkingLevel,
    }),
  };
}

/** Validate durable runtime entries before handing plain picker projections to the UI. */
export function readPersistedNavigationRuns(
  entries: readonly SessionEntryLike[],
): PersistedNavigationRun[] {
  return readPersistedRuns(entries).map(toNavigationRun);
}

function toNavigationRun(run: PersistedRunSummary): PersistedNavigationRun {
  return {
    id: run.id,
    type: run.type,
    description: run.description,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    toolUses: run.toolUses,
    outputFile: run.outputFile,
  };
}
