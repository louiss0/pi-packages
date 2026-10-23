/**
 * session-navigation.ts — Pure selection and transcript-sourcing for native session navigation.
 *
 * Splits the unit-testable core of the `/subagents:sessions` command from its TUI
 * wiring (`session-navigator.ts`): which subagents are navigable and how a picked
 * agent's transcript is sourced (live reader or persisted file).
 *
 * The `TranscriptSource` seam decouples *how messages are sourced* (live record
 * or a persisted file snapshot) from *how they render* — the renderer
 * (`session-navigator.ts`, which mounts Pi's per-entry components) talks only to
 * this seam. Rendering lives in the SDK/TUI module because the per-entry
 * components require a `TUI`, `cwd`, and markdown theme.
 */

import {
  buildSessionContext,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import type {
  SessionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { formatDuration, getDisplayName } from "./display";
import type { AgentDefinitionLookup, ModelIdentity } from "./display";
import type { AgentStatus } from "./view-types";

/** One message rendered by Pi's public session components. */
export type SessionMessage = SessionContext["messages"][number];

/** Only the session-event fields the transcript renderer observes. */
export interface TranscriptEvent {
  readonly type: string;
  readonly message?: SessionMessage;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Label and transcript pointer for a past run; persistence parsing stays in the runtime. */
export interface PersistedNavigationRun extends LabelFields {
  readonly id: string;
  readonly outputFile: string | undefined;
}

/** A UI projection, never a live child session or runtime record. */
export interface NavigableSubagent extends PersistedNavigationRun {
  /** Narrow reader supplied by the runtime while a live session is retained. */
  readonly transcript: TranscriptSource | undefined;
}

/**
 * A navigable entry plus the label shown in the picker.
 *
 * A `live` entry sources its transcript from a narrow reader; a `snapshot`
 * entry sources it from the persisted session file (the session was released by
 * the retention sweep, but the record and its transcript pointer survive).
 */
export type NavigationEntry =
  | {
      readonly kind: "live";
      readonly label: string;
      readonly heading: EntryHeading;
      readonly source: TranscriptSource;
    }
  | {
      readonly kind: "snapshot";
      readonly label: string;
      readonly heading: EntryHeading;
      readonly outputFile: string;
    };

/** Who produced a transcript, for the pane's header. Fixed for the life of the entry. */
export interface EntryHeading {
  readonly name: string;
  readonly description: string;
}

/** The fields `buildLabel` reads — shared by the live and snapshot (released-session) label paths. */
interface LabelFields {
  readonly type: string;
  readonly description: string;
  readonly status: AgentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
}

/** The model and thinking level a transcript's session runs at. */
export interface SessionModel {
  readonly model: ModelIdentity | undefined;
  readonly thinkingLevel: string | undefined;
}

/** Running-agent streaming state, surfaced by a live source. */
export interface StreamingState {
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
}

/** Liveness-agnostic transcript source consumed by the renderer. */
export interface TranscriptSource {
  /** Current message history. */
  getMessages(): readonly SessionMessage[];
  /**
   * Subscribe to changes; returns an unsubscribe, or undefined for a static
   * snapshot. The session event is forwarded so a consumer can route on it —
   * a streaming delta and a settled message warrant very different work.
   */
  subscribe(
    onChange: (event?: TranscriptEvent) => void,
  ): (() => void) | undefined;
  /** Running-agent streaming state, or undefined when not streaming. */
  streaming(): StreamingState | undefined;
  /** Resolve a registered tool definition by name, for Pi's tool-execution components. */
  getToolDefinition(name: string): ToolDefinition | undefined;
  /** Model and thinking level, read at call time: a live child can switch either mid-run. */
  sessionModel(): SessionModel;
}

/**
 * Label every navigable subagent for the picker: records with a live session
 * source their transcript in-memory (`live`); records whose session the
 * retention sweep released but which retain a transcript pointer source it from
 * disk (`snapshot`). Records with neither are not navigable. Live entries first.
 *
 * `persisted` carries the runs the parent session recorded, which outlive the
 * manager's records across a `/reload` or `/resume`. One the manager no longer
 * holds is listed as a snapshot after the manager's own entries; the manager's
 * record wins for any run it still holds.
 */
export function listNavigableAgents(
  agents: readonly NavigableSubagent[],
  registry: AgentDefinitionLookup,
  persisted: readonly PersistedNavigationRun[],
): NavigationEntry[] {
  const live: NavigationEntry[] = [];
  const snapshots: NavigationEntry[] = [];
  for (const record of agents) {
    const heading = buildHeading(record, registry);
    if (record.transcript) {
      live.push({
        kind: "live",
        source: record.transcript,
        heading,
        label: buildLabel(record, registry),
      });
    } else if (record.outputFile) {
      snapshots.push({
        kind: "snapshot",
        outputFile: record.outputFile,
        heading,
        label: buildLabel(record, registry, true),
      });
    }
  }
  const held = new Set(agents.map((record) => record.id));
  for (const run of persisted) {
    if (held.has(run.id) || !run.outputFile) continue;
    snapshots.push({
      kind: "snapshot",
      outputFile: run.outputFile,
      heading: buildHeading(run, registry),
      label: buildLabel(run, registry, true),
    });
  }
  return [...live, ...snapshots];
}

/**
 * Source a transcript from a persisted child-session JSONL snapshot.
 *
 * For an agent whose live session the retention sweep released: the in-memory
 * message history is gone, but the session file survives on disk (and the
 * record retains its path). Reads the file, drops the `SessionHeader`, and resolves the
 * message list via Pi's own parser. A static snapshot — no subscription, no
 * streaming, no live tool registry. `readFile` is injected so this module makes
 * no `fs` calls.
 */
export async function fileSnapshotSource(
  outputFile: string,
  readFile: (path: string) => string | Promise<string>,
): Promise<TranscriptSource> {
  const entries = parseSessionEntries(await readFile(outputFile));
  const sessionEntries = entries.filter(
    (entry): entry is SessionEntry => entry.type !== "session",
  );
  const { messages, model, thinkingLevel } =
    buildSessionContext(sessionEntries);
  // Pi also reads the model off each assistant message, so a file whose messages
  // predate those fields yields a model object with neither set.
  const recorded: SessionModel = {
    model:
      model?.provider && model.modelId
        ? { provider: model.provider, id: model.modelId }
        : undefined,
    thinkingLevel,
  };
  return {
    getMessages: () => messages,
    subscribe: () => undefined,
    streaming: () => undefined,
    getToolDefinition: () => undefined,
    sessionModel: () => recorded,
  };
}

function buildHeading(
  fields: Pick<LabelFields, "type" | "description">,
  registry: AgentDefinitionLookup,
): EntryHeading {
  return {
    name: getDisplayName(fields.type, registry),
    description: fields.description,
  };
}

function buildLabel(
  fields: LabelFields,
  registry: AgentDefinitionLookup,
  released = false,
): string {
  const name = getDisplayName(fields.type, registry);
  const duration = formatDuration(fields.startedAt, fields.completedAt);
  const marker = released ? " · session released (snapshot)" : "";
  return `${name} (${fields.description}) · ${fields.toolUses} tools · ${fields.status} · ${duration}${marker}`;
}
