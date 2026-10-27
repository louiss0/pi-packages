/**
 * pi-agents — A pi extension providing focused, in-process autonomous sub-agents.
 *
 * Tools:
 *   Agent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentToolResult,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  getMarkdownTheme,
  loadProjectContextFiles,
  ModelRuntime,
  type ResourceLoader,
  ModelRegistry as SdkModelRegistry,
  SettingsManager as SdkSettingsManager,
  SessionManager,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  loadDefinitionScopes,
  loadDefinitionScopesAsync,
} from "#src/agents/loader";
import {
  AgentRegistry,
  type AgentDefinitionLookup,
} from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import { DefinitionErrorReporter } from "#src/agents/report";
import type { TurnSettings } from "#src/agents/resolver";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import {
  createSubagentSession,
  type SubagentSessionDeps,
} from "#src/lifecycle/create-subagent-session";
import type { RunOutcome } from "#src/lifecycle/subagent-run";
import {
  SubagentManager,
  type ResumeCallOptions,
  type ResumeRefusalReason,
  type ResumeStart,
} from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import {
  type NotificationDetails as NotificationMessageDetails,
  NotificationManager,
  type UpdateDetails as UpdateMessageDetails,
  type WorkspaceNoticeDetails as WorkspaceNoticeMessageDetails,
} from "#src/observation/notification";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderStatusNote,
} from "#src/observation/outcome-delivery";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { defined } from "#src/optional";
import { createSubagentRuntime } from "#src/runtime";
import {
  publishSubagentsService,
  unpublishSubagentsService,
} from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { Subagents } from "#src/service/subagents";
import { WorkspaceGateRegistry } from "#src/scheduling/gate";
import {
  SETTINGS_EXTENSION_NAME,
  SHARED_SETTING_DEFINITIONS,
} from "#src/shared-settings";
import { detectEnv } from "#src/session/env";
import { isChildExtensionLoading } from "#src/session/child-extension-scope";
import type { FamilyProfile } from "#src/models/profile";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import type { RoutingLadders } from "#src/models/router";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import { mergeProfiles, parseUserProfiles } from "#src/models/user-profiles";
import { createExcludedPackagesStorage } from "#src/session/package-exclusions";
import { createProjectContextLoader } from "#src/session/project-context";
import { buildAgentPrompt } from "#src/session/prompts";
import { inheritRegisteredProviders } from "#src/session/provider-inheritance";
import { deriveSubagentSessionDir } from "#src/session/session-dir";
import { SettingsManager } from "#src/settings";
import {
  renderBackgroundLaunch,
  spawnBackground,
} from "#src/tools/background-spawner";
import { runForeground } from "#src/tools/foreground-runner";
import {
  type AgentReport,
  formatAgentReport,
} from "#src/tools/get-result-report";
import {
  buildAgentGuidelines,
  buildDetails,
  buildTypeListText,
  formatLifetimeTokens,
  textResult,
} from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import type { SpawnPresentation } from "#src/tools/spawn-config";
import {
  type GetResultToolOutput,
  getResultOutputSchema,
  steerOutputSchema,
  type SubagentToolOutput,
  subagentOutputSchema,
  withStructured,
} from "#src/tools/structured-output";
import {
  type AgentDetails,
  describeActivity,
  formatDuration,
  formatMs,
  getDisplayName,
  modelLabel,
  type Theme,
} from "#src/ui/display";
import {
  type GetResultDetails,
  PREVIEW_CHARS,
  renderGetResultLines,
} from "#src/ui/get-result-renderer";
import { GLYPHS } from "#src/ui/glyphs";
import {
  fileSnapshotSource,
  listNavigableAgents,
  type TranscriptSource,
} from "#src/ui/session-navigation";
import {
  type SessionNavigatorParams,
  type SessionNavigatorUI,
  TranscriptPane,
} from "#src/ui/session-navigator";
import {
  buildPreviewLines,
  buildStatsParts,
  type NotificationDetails,
  resolveStatusPresentation,
  type UpdateDetails,
  type WorkspaceNoticeDetails,
} from "#src/ui/notification-renderer";
import { renderAgentResult } from "#src/ui/result-renderer";
import type { SessionContext, SteerOutcome, Subagent } from "#src/types";
import { createWidgetSource } from "#src/presentation/widget-adapter";
import {
  readPersistedNavigationRuns,
  toNavigableSubagent,
} from "#src/presentation/transcript-adapter";
import {
  AgentWidget,
  BoundedLines,
  type Component,
  type OverlayOptions,
  Text,
  type TuiMode,
} from "#src/ui/index";

// ---- Parent-tool factories ----
//
// The three model-facing tools keep their execution at the registration site:
// the factories below own it, their private helpers are local functions, and
// the definitions passed to `pi.registerTool` name them directly. Pure deep
// rendering (result-renderer, get-result-renderer) stays in its UI module.

/** Narrow manager slice retained for the Agent tool's resume presentation. */
export interface AgentToolManager {
  startResume: (
    id: string,
    prompt: string,
    options: ResumeCallOptions,
  ) => ResumeStart;
  getRecord: (id: string) => Subagent | undefined;
}

/** Narrow settings accessor — only the fields the Agent tool reads. */
export type AgentToolSettings = TurnSettings & {
  readonly maxConcurrent: number;
};

/** The collaborators the Agent tool registration hands its factory. */
export interface AgentToolDeps {
  manager: AgentToolManager;
  subagents: Subagents;
  settings: AgentToolSettings;
  registry: AgentRegistry;
}

/**
 * Build the Agent tool's execution door.
 *
 * Resume dispatches before any new-launch preparation: continuing an existing
 * child must not load definitions or resolve a model for an unrelated new
 * launch (ARCHITECTURE-SPEC story 72).
 */
export function createAgentTool({
  manager,
  subagents,
  settings,
  registry,
}: AgentToolDeps) {
  /**
   * The presentation a resume reports under, without preparing a launch.
   *
   * The caller's own `subagent_type` names the display, as it did when a
   * resume still prepared a launch it never used; the record's type is the
   * fallback for a caller that names none.
   */
  function resumeDetailBase(
    id: string,
    params: Record<string, unknown>,
  ): SpawnPresentation["detailBase"] {
    const recordType = manager.getRecord(id)?.type;
    const type =
      (params.subagent_type as string | undefined) ?? recordType ?? id;
    const definition = registry.find(type);
    const prompt = params.prompt as string;
    return {
      displayName: definition?.displayName ?? type,
      description:
        (params.description as string | undefined) ?? prompt.slice(0, 80),
      subagentType: type,
    };
  }

  /**
   * Continue an existing agent's session with a new prompt, returning its
   * resumed outcome directly to the parent. The resumed run is in the
   * foreground, so it streams its progress inline as a foreground spawn does.
   */
  async function resumeExisting(
    id: string,
    prompt: string,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    // The manager owns whether a resume happens; this door owns only how the
    // answer is worded. Resuming commits this call to delivering the outcome,
    // so it claims it — nothing else announces what is already being returned.
    const start = manager.startResume(id, prompt, {
      background: false,
      signal: signal ?? new AbortController().signal,
      claimOutcome: true,
    });
    if (start.kind === "refused") {
      return withStructured(
        {
          ...textResult(resumeRefusalMessage(start.reason, id)),
          isError: true,
        },
        {
          outcome: "rejected",
          reason: start.reason,
          agentId: id,
        },
      );
    }
    const record = start.record;
    const stopStream = startProgressStream({
      detailBase,
      onUpdate,
      getRecord: () => record,
    });
    try {
      await record.promise;
    } finally {
      stopStream();
    }
    // Resume-return delivery edge: the resumed outcome is returned directly.
    record.markConsumed();
    const output: SubagentToolOutput = {
      outcome: "completed",
      agentId: record.id,
      agentType: record.type,
      background: false,
      resumed: true,
      status: record.status,
      toolUses: record.toolUses,
      ...defined({ result: record.result, error: record.error }),
    };
    return withStructured(
      textResult(
        `Agent ID: ${record.id}${renderStatusNote(record)}\n\n` +
          renderOutcomeBody(record) +
          renderOutcomeAddenda(record),
        buildDetails(detailBase, record),
      ),
      output,
    );
  }

  /**
   * Start an existing agent's resume and return at once; the completion notice
   * delivers its outcome. Nothing claims the outcome and no tool-call signal is
   * wired, as for a background spawn, and like one it may wait for a
   * concurrency slot, which the launch message reports.
   */
  function resumeInBackground(
    id: string,
    prompt: string,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    const start = manager.startResume(id, prompt, { background: true });
    if (start.kind === "refused") {
      return withStructured(
        {
          ...textResult(resumeRefusalMessage(start.reason, id)),
          isError: true,
        },
        {
          outcome: "rejected",
          reason: start.reason,
          agentId: id,
        },
      );
    }
    const queued = start.record.status === "queued";
    const output: SubagentToolOutput = {
      outcome: "accepted",
      agentId: start.record.id,
      agentType: detailBase.subagentType,
      background: true,
      resumed: true,
      queued,
      ...defined({ outputFile: start.record.outputFile }),
    };
    return withStructured(
      renderBackgroundLaunch(
        defined({
          headline: queued
            ? "Agent resume queued in background."
            : "Agent resumed in background.",
          id: start.record.id,
          displayName: detailBase.displayName,
          description: detailBase.description,
          detailBase,
          outputFile: start.record.outputFile,
          queuePosition: queued
            ? { maxConcurrent: settings.maxConcurrent }
            : undefined,
        }),
      ),
      output,
    );
  }

  async function execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    _ctx: ExtensionContext,
  ) {
    // ---- Resume existing agent ----
    if (params.resume) {
      const id = params.resume as string;
      const detailBase = resumeDetailBase(id, params);
      // Only the caller's explicit flag: an agent file's run_in_background
      // default describes how that type spawns, not how a resume is collected.
      if (params.run_in_background === true) {
        return resumeInBackground(id, params.prompt as string, detailBase);
      }
      return resumeExisting(
        id,
        params.prompt as string,
        signal,
        onUpdate,
        detailBase,
      );
    }

    const prepared = await subagents.prepareLaunch(
      {
        type: params.subagent_type as string,
        prompt: params.prompt as string,
        ...defined({
          description: params.description as string | undefined,
          model: params.model as string | undefined,
          thinking: params.thinking as string | undefined,
          maxTurns: params.max_turns as number | undefined,
          inheritContext: params.inherit_context as boolean | undefined,
          runInBackground: params.run_in_background as boolean | undefined,
        }),
      },
      toolCallId,
      signal,
    );
    if (prepared.kind === "rejected") {
      return withStructured(
        { ...textResult(prepared.message), isError: true },
        {
          outcome: "rejected",
          reason: prepared.reason,
        },
      );
    }
    // Preparation can yield to definition I/O. Match the programmatic door's
    // acceptance boundary: cancellation that arrives after preparation but
    // before manager acceptance must reject without creating a child.
    if (signal?.aborted) {
      return withStructured(
        { ...textResult("Launch cancelled before acceptance."), isError: true },
        { outcome: "rejected", reason: "cancelled" },
      );
    }
    const launch = prepared.value;
    const { config } = launch;

    // ---- Background execution ----
    if (config.execution.runInBackground) {
      return spawnBackground(subagents, { config, launch, settings });
    }

    // ---- Foreground execution — stream progress via onUpdate ----
    return runForeground(subagents, { config, launch }, signal, onUpdate);
  }

  return { execute };
}

/**
 * The operator-facing sentence for each reason a resume is refused.
 *
 * Exhaustive over `ResumeRefusalReason`, so a reason added later fails to
 * compile here rather than falling through to an attempted resume.
 */
function resumeRefusalMessage(
  refusal: ResumeRefusalReason,
  id: string,
): string {
  switch (refusal) {
    case "unknown-agent":
      return `Agent not found: "${id}". Records are cleared at session start/switch, so it may be from a previous session.`;
    case "stale-session":
      return (
        `Agent "${id}" belongs to a session that is no longer active. Its work was cancelled when that ` +
        "session was replaced, so it cannot be resumed from this one."
      );
    case "still-running":
      return (
        `Agent "${id}" is still running; wait for it to finish before resuming. ` +
        "Use steer_subagent to send it a message while it runs."
      );
    case "resume-queued":
      return (
        `Agent "${id}" already has a resume waiting for a concurrency slot; wait for that run ` +
        "to finish before resuming it again (get_subagent_result with wait: true returns when it does)."
      );
    case "session-released":
      return `Agent "${id}" had its session released after its retention window; resume is unavailable, but its result is still retrievable via get_subagent_result.`;
    case "no-session":
      return `Agent "${id}" has no active session to resume.`;
    case "workspace-disposed":
      return (
        `Agent "${id}" ran in an isolated workspace that no longer ` +
        "exists; resume is unavailable because the agent would re-enter a directory that " +
        "has been removed. Spawn a new agent instead — the agent's result records where " +
        "any work was saved."
      );
  }
}

/** Narrow manager slice the result tool reads. */
export interface GetResultToolManager {
  getRecord(id: string): Subagent | undefined;
}

/** The arguments a get_subagent_result call carries. */
export type GetResultParams = {
  agent_id: string;
  wait?: boolean;
  verbose?: boolean;
  /** Seconds; bounds only a `wait: true` call. Absent = wait until the agent settles. */
  timeout?: number;
};

/** What collecting the outcome produced: the run this call reports, and how its wait ended. */
type CollectedOutcome = {
  /** The run whose outcome this call reports: the one it waited on, or the latest. */
  run: RunOutcome;
  /** The bound, in seconds, of a wait that ended at it with the agent still running. */
  waitExpiredAfter?: number;
};

/** setTimeout's ceiling, the same one Pi's bash tool enforces. */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

/** Build the get_subagent_result tool's execution door. */
export function createGetResultTool(
  manager: GetResultToolManager,
  registry: AgentDefinitionLookup,
) {
  /**
   * The report's machine-readable twin: the same facts the text renders, as
   * values a programmatic caller reads instead of parsing the report's lines.
   */
  function buildStructuredOutput(
    record: Subagent,
    collected: CollectedOutcome,
    verbose: boolean,
  ): GetResultToolOutput {
    const outcome = collected.run;
    return {
      found: true,
      agentId: record.id,
      status: outcome.status,
      displayName: getDisplayName(record.type, registry),
      description: record.description,
      toolUses: record.toolUses,
      compactionCount: record.compactionCount,
      durationMs: (outcome.completedAt ?? Date.now()) - outcome.startedAt,
      resumable: record.resumeRefusal === undefined,
      ...defined({
        model: modelLabel(record.modelIdentity),
        result: outcome.result,
        error: outcome.error,
        contextPercent: record.getContextPercent() ?? undefined,
        resumeRefusal: record.resumeRefusal,
        pendingQuestion: outcome.pendingQuestion,
        stoppedWhileQueued: outcome.stoppedWhileQueued || undefined,
        resumedWhileWaiting: outcome.replaced || undefined,
        waitExpiredAfter: collected.waitExpiredAfter,
        transcriptPath: record.outputFile,
        conversation: verbose ? record.getConversation() : undefined,
      }),
    };
  }

  /**
   * Settle this call's delivery obligation: wait when asked, then mark the
   * outcome collected or release the claim. Reports the run this call holds
   * (the one it waited on, even if a resume replaced it), and whether the wait
   * ended at its bound.
   *
   * A bound only swaps the signal the wait ends on, so a wait that reaches it
   * takes the same path as an interrupted one: the claim is released and the
   * agent keeps running.
   */
  async function collectOutcome(
    record: Subagent,
    params: GetResultParams,
    signal: AbortSignal,
  ): Promise<CollectedOutcome> {
    // Wait for completion if requested. The record owns the decision of whether
    // it is still awaitable — a queued agent counts, because scheduleVia()
    // captures its limiter promise at spawn. A parent interrupt ends the wait
    // without cancelling the agent, leaving the outcome uncollected below.
    //
    // Pull-delivery edge: the parent is collecting the settled outcome here, so
    // mark it consumed. A wait whose run has not settled was abandoned, so it
    // releases the claim it made and lets the nudge announce. The handle drops
    // only this call's claim, so a concurrent carrier's (such as a resume that
    // started as the run settled) is never cleared by this call.
    //
    // A resume that replaced the waited run after it settled leaves this call
    // the only carrier of what that run ended with: its nudge was suppressed by
    // this call's claim. The call holds that run, so it reports and consumes
    // that run's outcome; the resumed run's own delivery is untouched.
    if (params.wait === true) {
      // Capture and claim the observed run as one synchronous operation. The
      // record may point at a resumed run by the time this await continues, but
      // this carrier's claim stays with the run it began observing.
      const observedRun = record.latestRun;
      const claim = observedRun.claim();
      const bound =
        params.timeout === undefined
          ? undefined
          : new WaitBound(signal, params.timeout);
      try {
        const run = await record.waitUntilSettled(bound?.signal ?? signal);
        if (!run.isActive()) {
          run.markConsumed();
          return { run };
        }
        claim.release();
        return bound?.expired
          ? defined({ run, waitExpiredAfter: params.timeout })
          : { run };
      } finally {
        bound?.dispose();
      }
    }
    const run = record.latestRun;
    if (!run.isActive()) run.markConsumed();
    return { run };
  }

  /** The report: outcome fields from the collected run, everything else from the live record. */
  function buildReport(
    record: Subagent,
    verbose: boolean,
    collected: CollectedOutcome,
  ): AgentReport {
    const outcome = collected.run;
    return {
      ...defined({
        id: record.id,
        displayName: getDisplayName(record.type, registry),
        status: outcome.status,
        toolUses: record.toolUses,
        tokens: formatLifetimeTokens(record),
        contextPercent: record.getContextPercent(),
        compactionCount: record.compactionCount,
        duration: formatDuration(outcome.startedAt, outcome.completedAt),
        description: record.description,
        stoppedWhileQueued: outcome.stoppedWhileQueued,
        resumedWhileWaiting: outcome.replaced,
        runUpdates: outcome.runUpdates,
        result: outcome.result,
        error: outcome.error,
        turnBudget: outcome.turnBudget,
        pendingQuestion: outcome.pendingQuestion,
        workspaceNotice: outcome.workspaceNotice,
        conversation: verbose ? record.getConversation() : undefined,
        // Transcript pointer: lets the parent read the full session from disk,
        // and covers verbose after the live session was released (no conversation).
        transcriptPath: record.outputFile,
        waitExpiredAfter: collected.waitExpiredAfter,
        progress: outcome.status === "running" ? progressOf(record) : undefined,
      }),
      // These two stay required-with-a-value: an absent key would read as
      // "resumable" and "model unknown" by omission, which is exactly the
      // fail-open each field is documented to close.
      resumeRefusal: record.resumeRefusal,
      model: modelLabel(record.modelIdentity),
    };
  }

  /**
   * The compact metadata the TUI renders from.
   *
   * Named in full because `helpers.ts` exports a module-level `buildDetails`
   * producing the structurally different `AgentDetails`.
   */
  function buildGetResultDetails(
    record: Subagent,
    outcome: RunOutcome,
    verbose: boolean,
  ): GetResultDetails {
    return defined({
      agentId: record.id,
      displayName: getDisplayName(record.type, registry),
      status: outcome.status,
      description: record.description,
      toolUses: record.toolUses,
      tokens: formatLifetimeTokens(record),
      contextPercent: record.getContextPercent(),
      compactionCount: record.compactionCount,
      duration: formatDuration(outcome.startedAt, outcome.completedAt),
      verbose,
      transcriptPath: record.outputFile,
      preview: buildPreview(outcome.result),
      error: outcome.error,
      turnBudget: outcome.turnBudget,
      modelName: modelLabel(record.modelIdentity),
    });
  }

  async function execute(
    _toolCallId: string,
    params: GetResultParams,
    signal: AbortSignal,
    _onUpdate: unknown,
    _ctx: unknown,
  ) {
    validateTimeout(params.timeout);
    const record = manager.getRecord(params.agent_id);
    if (!record) {
      return withStructured(
        textResult<GetResultDetails>(
          `Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`,
        ),
        { found: false, agentId: params.agent_id },
      );
    }

    const collected = await collectOutcome(record, params, signal);

    const verbose = params.verbose === true;
    return withStructured(
      textResult<GetResultDetails>(
        formatAgentReport(buildReport(record, verbose, collected)),
        buildGetResultDetails(record, collected.run, verbose),
      ),
      buildStructuredOutput(record, collected, verbose),
    );
  }

  return { execute };
}

/** Throws on a timeout setTimeout cannot honor, worded as Pi's bash tool words it. */
function validateTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      "Invalid timeout: must be a finite number of seconds greater than 0",
    );
  }
  if (timeout > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`,
    );
  }
}

/**
 * Ends a wait at the parent's interrupt or at a deadline, whichever comes first,
 * and remembers whether the deadline was the one that fired.
 */
class WaitBound {
  private readonly controller = new AbortController();
  private readonly detach = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private _expired = false;

  constructor(parent: AbortSignal, seconds: number) {
    this.timer = setTimeout(() => {
      this._expired = true;
      this.controller.abort();
    }, seconds * 1000);
    if (parent.aborted) this.controller.abort();
    else
      parent.addEventListener(
        "abort",
        () => {
          this.controller.abort();
        },
        { once: true, signal: this.detach.signal },
      );
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Whether the deadline, rather than the parent, ended the wait. */
  get expired(): boolean {
    return this._expired;
  }

  /** Clears the deadline and the parent listener, so neither outlives the call. */
  dispose(): void {
    clearTimeout(this.timer);
    this.detach.abort();
  }
}

/**
 * What a running agent is doing and how long since its last session event: the
 * facts the widget shows the human, so the parent can tell a stalled run from a
 * long one.
 */
function progressOf(record: Subagent): AgentReport["progress"] {
  return {
    activity: describeActivity(record.activeTools, record.responseText),
    turns: record.turnBudget?.used,
    sinceLastProgress: formatMs(Date.now() - record.lastProgressAt),
  };
}

/** The first non-empty line of a result body, clipped to the preview budget. */
function buildPreview(result: string | undefined): string | undefined {
  const line = result
    ?.split("\n")
    .find((candidate) => candidate.trim())
    ?.trim();
  if (!line) return undefined;
  return line.length > PREVIEW_CHARS
    ? line.slice(0, PREVIEW_CHARS - 1) + "\u2026"
    : line;
}

/** Narrow manager slice the steer tool reads. */
export interface SteerToolManager {
  getRecord(id: string): Subagent | undefined;
}

/** The extension event bus the steer tool announces on. */
export interface SteerToolEvents {
  emit(name: string, data: unknown): void;
}

/** Build the steer_subagent tool's execution door. */
export function createSteerTool(
  manager: SteerToolManager,
  events: SteerToolEvents,
) {
  /** Render the success message with live state for a delivered steer. */
  function renderDelivered(record: Subagent) {
    const tokens = formatLifetimeTokens(record);
    const contextPercent = record.getContextPercent();
    const stateParts: string[] = [];
    if (tokens) stateParts.push(tokens);
    stateParts.push(
      `${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`,
    );
    if (contextPercent !== null)
      stateParts.push(`context ${Math.round(contextPercent)}% full`);
    if (record.compactionCount)
      stateParts.push(
        `${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`,
      );
    return textResult(
      `Steering message sent to agent ${record.id}. The agent will process it after its current tool execution.\n` +
        `Current state: ${stateParts.join(" · ")}`,
    );
  }

  async function execute(
    _toolCallId: string,
    params: { agent_id: string; message: string },
    _signal: AbortSignal,
    _onUpdate: unknown,
    _ctx: unknown,
  ) {
    const record = manager.getRecord(params.agent_id);
    if (!record) {
      return withStructured(
        textResult(
          `Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`,
        ),
        { agentId: params.agent_id, outcome: "not-found" },
      );
    }

    let outcome: SteerOutcome;
    try {
      outcome = await record.steer(params.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A steer that throws is a defect, not an answer about the agent: flag
      // it as an error so neither the model nor a programmatic caller mistakes
      // it for a steer outcome.
      return withStructured(
        { ...textResult(`Failed to steer agent: ${message}`), isError: true },
        { agentId: params.agent_id, outcome: "failed" },
      );
    }

    switch (outcome.kind) {
      case "rejected":
        return withStructured(
          textResult(
            `Agent "${params.agent_id}" is not running (status: ${outcome.status}). Cannot steer a non-running agent.`,
          ),
          {
            agentId: params.agent_id,
            outcome: "rejected",
            status: outcome.status,
          },
        );
      case "buffered":
        events.emit("subagents:steered", {
          id: record.id,
          message: params.message,
        });
        return withStructured(
          textResult(
            `Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`,
          ),
          { agentId: record.id, outcome: "queued" },
        );
      case "delivered":
        events.emit("subagents:steered", {
          id: record.id,
          message: params.message,
        });
        return withStructured(renderDelivered(record), {
          agentId: record.id,
          outcome: "delivered",
        });
    }
  }

  return { execute };
}

// ---- Tool render callbacks ----

/** Resolve labels through a caller-supplied view, never a runtime registry import. */
export function createAgentToolRenderer(
  resolveDisplayName: (type: string) => string,
) {
  return {
    renderCall(args: Record<string, unknown>, theme: Theme): Component {
      const displayName = args.subagent_type
        ? resolveDisplayName(args.subagent_type as string)
        : "Subagent";
      const desc = (args.description as string | undefined) ?? "";
      return new Text(
        `${GLYPHS.toolCall} ` +
          theme.fg("toolTitle", theme.bold(displayName)) +
          (desc ? "  " + theme.fg("muted", desc) : ""),
        0,
        0,
      );
    },

    renderResult(
      result: AgentToolResult<AgentDetails | undefined>,
      { expanded, isPartial }: ToolRenderResultOptions,
      theme: Theme,
    ): Component {
      const resultText =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      if (!result.details) return new Text(resultText, 0, 0);
      return new Text(
        renderAgentResult(
          result.details,
          resultText,
          expanded,
          isPartial,
          theme,
        ),
        0,
        0,
      );
    },
  };
}

/** Only the call arguments this renderer reads; structurally satisfied by the runtime. */
export type GetResultParamsView = Readonly<{
  agent_id: string;
  wait?: boolean;
  verbose?: boolean;
  timeout?: number;
}>;

export function renderGetResultCall(
  args: GetResultParamsView,
  theme: Theme,
): Component {
  const notes = [waitNote(args), args.verbose === true ? "verbose" : ""]
    .filter(Boolean)
    .join(", ");
  return new Text(
    `${GLYPHS.toolCall} ` +
      theme.fg("toolTitle", theme.bold("Get Agent Result")) +
      "  " +
      theme.fg("muted", args.agent_id) +
      (notes ? " " + theme.fg("muted", `(${notes})`) : ""),
    0,
    0,
  );
}

export function renderGetResultResult(
  result: AgentToolResult<GetResultDetails | undefined>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme,
): Component {
  const reportText =
    result.content[0]?.type === "text" ? result.content[0].text : "";
  if (!result.details) return new Text(reportText, 0, 0);
  return new BoundedLines(
    renderGetResultLines(result.details, reportText, expanded, theme),
  );
}

/** The call row's wait note: the bound when the wait has one. */
function waitNote(args: GetResultParamsView): string {
  if (args.wait !== true) return "";
  return args.timeout === undefined
    ? "waiting"
    : `waiting \u2264${args.timeout}s`;
}

/** Narrow manager surface the session lifecycle hooks call. */
export interface LifecycleManager {
  clearCompleted(): Promise<void>;
  abortAll(): void;
  dispose(): Promise<void>;
  beginOwner(sessionId: string): void | Promise<void>;
  beginOwnerEnd(): void;
  endOwner(): void | Promise<void>;
}

/** Narrow runtime surface the session lifecycle hooks call. */
export interface LifecycleRuntime {
  setSessionContext(ctx: SessionContext): void;
  clearSessionContext(): void;
}

/** Session lifecycle hooks, registered directly with Pi at the extension root. */
export class SessionLifecycleHandler {
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly disposeNotifications: () => void,
    private readonly unpublishService: () => void,
    private readonly sessionIdOf: (ctx: unknown) => string,
  ) {}

  async handleSessionStart(_event: unknown, ctx: unknown): Promise<void> {
    const context = ctx as SessionContext;
    this.runtime.setSessionContext(context);
    await this.manager.beginOwner(this.sessionIdOf(context));
    await this.manager.clearCompleted();
  }

  handleSessionBeforeSwitch(): Promise<void> {
    return Promise.resolve();
  }

  handleSessionShutdown(): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.shutdownOnce();
    return this.shutdownPromise;
  }

  private async shutdownOnce(): Promise<void> {
    this.unpublishService();
    this.runtime.clearSessionContext();
    const ownerEnd = this.manager.endOwner();
    this.disposeNotifications();
    this.manager.abortAll();
    await ownerEnd;
    await this.manager.dispose();
  }
}

/** Narrow widget surface the host-event hooks call. */
export interface EventDrivenWidget {
  setUICtx(ctx: unknown): void;
  onTurnStart(): void;
  dispose(): void;
}

/** Host-event hooks for the live widget. */
export class WidgetEventsHandler {
  constructor(private readonly widget: EventDrivenWidget) {}

  handleSessionStart(_event: unknown, ctx: { ui: unknown }): void {
    this.widget.setUICtx(ctx.ui);
  }

  handleTurnStart(): void {
    this.widget.onTurnStart();
  }

  handleSessionShutdown(): void {
    this.widget.dispose();
  }
}

/** Narrow manager surface the interrupt hook calls. */
export interface InterruptManager {
  abortAll(): number;
}

/** Latches the parent's current run signal and aborts children on ESC. */
export class InterruptHandler {
  private latched: AbortSignal | undefined;
  private detach: (() => void) | undefined;

  constructor(
    private readonly manager: InterruptManager,
    private readonly shouldAbortAll: () => boolean,
  ) {}

  handleTurnStart(ctx: { signal: AbortSignal | undefined }): void {
    const signal = ctx.signal;
    if (signal === this.latched) return;

    this.detach?.();
    this.detach = undefined;
    this.latched = signal;
    if (!signal) return;

    const onAbort = (): void => {
      if (!this.shouldAbortAll()) return;
      this.manager.abortAll();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.detach = () => signal.removeEventListener("abort", onAbort);
  }
}

/** The toast a settings mutation returns for the UI to display. */
export type SettingsToast = {
  message: string;
  level: "info" | "warning";
};

/** Narrow settings surface required by the /subagents:settings command. */
export interface SubagentsSettingsManager {
  readonly maxConcurrent: number;
  readonly defaultMaxTurns: number | undefined;
  readonly wrapUpTurns: number;
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
  readonly abortAllOnInterrupt: boolean;
  readonly midRunUpdates: boolean;
  applyMaxConcurrent(n: number): SettingsToast;
  applyDefaultMaxTurns(n: number): SettingsToast;
  applyWrapUpTurns(n: number): SettingsToast;
  applyConsumedSessionRetentionMinutes(n: number): SettingsToast;
  applyUnconsumedSessionRetentionMinutes(n: number): SettingsToast;
  toggleAbortAllOnInterrupt(): SettingsToast;
  toggleMidRunUpdates(): SettingsToast;
}

/** Narrow UI surface required by the /subagents:settings command. */
export interface SubagentsSettingsUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, defaultValue?: string): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

type SettingDescriptorBase = {
  label: string;
  currentDisplay: (settings: SubagentsSettingsManager) => string | number;
};

type NumericSettingDescriptor = SettingDescriptorBase & {
  kind: "numeric";
  inputTitle: string;
  inputDefault: (settings: SubagentsSettingsManager) => string;
  minimum: number;
  validationMessage: string;
  apply: (settings: SubagentsSettingsManager, n: number) => SettingsToast;
};

type ToggleSettingDescriptor = SettingDescriptorBase & {
  kind: "toggle";
  toggle: (settings: SubagentsSettingsManager) => SettingsToast;
};

type SettingDescriptor = NumericSettingDescriptor | ToggleSettingDescriptor;

const SETTINGS: ReadonlyArray<SettingDescriptor> = [
  {
    kind: "numeric",
    label: "Max concurrency",
    currentDisplay: (settings) => settings.maxConcurrent,
    inputTitle: "Max concurrent background agents",
    inputDefault: (settings) => String(settings.maxConcurrent),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyMaxConcurrent(n),
  },
  {
    kind: "numeric",
    label: "Default max turns",
    currentDisplay: (settings) => settings.defaultMaxTurns ?? "unlimited",
    inputTitle: "Default max turns before wrap-up (0 = unlimited)",
    inputDefault: (settings) => String(settings.defaultMaxTurns ?? 0),
    minimum: 0,
    validationMessage: "Must be 0 (unlimited) or a positive integer.",
    apply: (settings, n) => settings.applyDefaultMaxTurns(n),
  },
  {
    kind: "numeric",
    label: "Wrap-up turns",
    currentDisplay: (settings) => settings.wrapUpTurns,
    inputTitle: "Turns left when a subagent is warned to wrap up",
    inputDefault: (settings) => String(settings.wrapUpTurns),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyWrapUpTurns(n),
  },
  {
    kind: "numeric",
    label: "Consumed-session retention",
    currentDisplay: (settings) =>
      `${settings.consumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain a consumed agent's session",
    inputDefault: (settings) =>
      String(settings.consumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyConsumedSessionRetentionMinutes(n),
  },
  {
    kind: "numeric",
    label: "Unconsumed-session retention",
    currentDisplay: (settings) =>
      `${settings.unconsumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain an unconsumed agent's session (safety cap)",
    inputDefault: (settings) =>
      String(settings.unconsumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyUnconsumedSessionRetentionMinutes(n),
  },
  {
    kind: "toggle",
    label: "Abort all subagents on ESC",
    currentDisplay: (settings) => (settings.abortAllOnInterrupt ? "on" : "off"),
    toggle: (settings) => settings.toggleAbortAllOnInterrupt(),
  },
  {
    kind: "toggle",
    label: "Mid-run updates from background subagents",
    currentDisplay: (settings) => (settings.midRunUpdates ? "on" : "off"),
    toggle: (settings) => settings.toggleMidRunUpdates(),
  },
];

/** Handler for the `/subagents:settings` slash command. */
export async function handleSubagentsSettings(
  settings: SubagentsSettingsManager,
  { ui }: { ui: SubagentsSettingsUI },
): Promise<void> {
  const options = SETTINGS.map(
    (d) => `${d.label} (current: ${d.currentDisplay(settings)})`,
  );
  const choice = await ui.select("Settings", options);
  if (!choice) return;

  const descriptor = SETTINGS.find((d) => choice.startsWith(d.label));
  if (!descriptor) return;

  if (descriptor.kind === "toggle") {
    const toast = descriptor.toggle(settings);
    ui.notify(toast.message, toast.level);
    return;
  }

  const val = await ui.input(
    descriptor.inputTitle,
    descriptor.inputDefault(settings),
  );
  if (!val) return;

  const n = parseInt(val, 10);
  if (n >= descriptor.minimum) {
    const toast = descriptor.apply(settings, n);
    ui.notify(toast.message, toast.level);
  } else {
    ui.notify(descriptor.validationMessage, "warning");
  }
}

const PI_FOOTER_ROWS = 2;
const VIEWPORT_HEIGHT_PCT = 70;

const FULLSCREEN_OVERLAY: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
  margin: { bottom: PI_FOOTER_ROWS },
};

const NOTHING: Component = { render: () => [], invalidate: () => {} };

async function probeTuiMode(ui: SessionNavigatorUI): Promise<TuiMode> {
  const mode = await ui.custom<TuiMode | undefined>(
    (tui, _theme, _keys, done) => {
      done(tui.mode);
      return NOTHING;
    },
  );
  return mode === "fullscreen" ? "fullscreen" : "regular";
}

function viewerMountOptions(mode: TuiMode): {
  overlay: boolean;
  overlayOptions?: OverlayOptions;
} {
  return mode === "fullscreen"
    ? { overlay: true, overlayOptions: FULLSCREEN_OVERLAY }
    : { overlay: false };
}

/** Handler for the `/subagents:sessions` slash command. */
export async function handleSubagentsSessions({
  ui,
  agents,
  registry,
  cwd,
  readFile,
  persisted,
}: SessionNavigatorParams): Promise<void> {
  const entries = listNavigableAgents(agents, registry, persisted);
  if (entries.length === 0) {
    ui.notify("No subagent sessions to view.", "info");
    return;
  }

  const choice = await ui.select(
    "Subagent sessions",
    entries.map((entry) => entry.label),
  );
  const entry = entries.find((candidate) => candidate.label === choice);
  if (!entry) return;

  let source: TranscriptSource;
  try {
    source =
      entry.kind === "live"
        ? entry.source
        : await fileSnapshotSource(entry.outputFile, readFile);
  } catch {
    ui.notify("Could not read the session transcript file.", "error");
    return;
  }
  const markdownTheme = getMarkdownTheme();
  const mode = await probeTuiMode(ui);
  await ui.custom<undefined>(
    (tui, theme, keys, done) =>
      new TranscriptPane({
        tui,
        theme,
        keys,
        source,
        heading: entry.heading,
        done,
        cwd,
        markdownTheme,
      }),
    viewerMountOptions(mode),
  );
}

/** The narrow theme surface the message renderers call. */
export type RendererTheme = {
  fg(color: Parameters<Theme["fg"]>[0], text: string): string;
  bold(text: string): string;
};

type RenderOptions = { expanded: boolean };

/** The shape a registered message renderer satisfies. */
export type MessageRenderer<TDetails> = (
  message: { details?: TDetails },
  options: RenderOptions,
  theme: RendererTheme,
) => Component | undefined;

/** The completion message renderer registered with Pi. */
export function renderNotificationMessage(
  message: { details?: NotificationDetails },
  { expanded }: RenderOptions,
  theme: RendererTheme,
): Component | undefined {
  const d = message.details;
  if (!d) return undefined;

  const { iconGlyph, iconStyle, statusText } = resolveStatusPresentation(d);
  let line = `${theme.fg(iconStyle, iconGlyph)} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

  const parts = buildStatsParts(d);
  if (parts.length) {
    line +=
      "\n  " +
      parts
        .map((p) => theme.fg("dim", p))
        .join(" " + theme.fg("dim", "·") + " ");
  }

  const previewLines = buildPreviewLines(d.resultPreview, expanded);
  if (expanded) {
    for (const l of previewLines) line += "\n" + theme.fg("dim", `  ${l}`);
  } else {
    line +=
      "\n  " + theme.fg("dim", `${GLYPHS.subLine}  ${previewLines[0] ?? ""}`);
  }

  if (d.outputFile) {
    line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
  }

  return new Text(line, 0, 0);
}

/** The mid-run update renderer registered with Pi. */
export function renderUpdateMessage(
  message: { details?: UpdateDetails },
  { expanded }: RenderOptions,
  theme: RendererTheme,
): Component | undefined {
  const d = message.details;
  if (!d) return undefined;

  let line = `${theme.fg("accent", GLYPHS.agentsActive)} ${theme.bold(d.description)} ${theme.fg("dim", "update")}`;
  for (const l of buildPreviewLines(d.message, expanded)) {
    line +=
      "\n  " + theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
  }
  return new Text(line, 0, 0);
}

/** The workspace-notice renderer registered with Pi. */
export function renderWorkspaceNoticeMessage(
  message: { details?: WorkspaceNoticeDetails },
  { expanded }: RenderOptions,
  theme: RendererTheme,
): Component | undefined {
  const d = message.details;
  if (!d) return undefined;

  let line = `${theme.fg("warning", GLYPHS.success)} ${theme.bold(d.description)} ${theme.fg("dim", "workspace")}`;
  for (const l of buildPreviewLines(d.notice.trim(), expanded)) {
    line +=
      "\n  " + theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
  }
  return new Text(line, 0, 0);
}

export default function (pi: ExtensionAPI) {
  // The SDK invokes inherited factories during child resource discovery.
  // This explicit async-local scope distinguishes those loads from another
  // independent parent, before allocating or publishing any runtime state.
  if (isChildExtensionLoading()) return;
  /**
   * Publishes this package's settings to the shared settings extension, so
   * they can be edited where the other extensions' settings are edited.
   *
   * The shared extension has to be loaded first: it keeps the registry this
   * event fills. Without it the settings are still read and written — only
   * the menu that edits them is missing.
   */
  pi.events.emit("pi-extension-settings:register", {
    name: SETTINGS_EXTENSION_NAME,
    settings: [...SHARED_SETTING_DEFINITIONS],
  });

  // ---- Register custom notification renderer ----
  pi.registerMessageRenderer<NotificationMessageDetails>(
    "subagent-notification",
    renderNotificationMessage,
  );
  pi.registerMessageRenderer<UpdateMessageDetails>(
    "subagent-update",
    renderUpdateMessage,
  );
  pi.registerMessageRenderer<WorkspaceNoticeMessageDetails>(
    "subagent-workspace-notice",
    renderWorkspaceNoticeMessage,
  );

  // ---- Family profiles and the routing they drive ----
  /**
   * Tells the parent about a problem the operator has to fix: a profile that
   * cannot be read, or a definition file that cannot be used.
   *
   * A problem is reported once, not once per spawn: the operator can fix it,
   * and the report goes away with it.
   */
  const definitionErrors = new DefinitionErrorReporter((message) => {
    pi.sendMessage({
      customType: "subagent-definitions",
      content: message,
      display: true,
    });
  });

  // The shipped ladders, refined by the operator's profiles: the global layer
  // replaces a family whole, and the project layer replaces a family whole
  // when the project is trusted.
  const strategies = strategiesByFamily(SHIPPED_STRATEGIES);
  const profiles = new Map(
    (SHIPPED_PROFILES as FamilyProfile[]).map((profile) => [
      profile.family,
      profile,
    ]),
  );
  /** The routing ladders the model selection walks. */
  const ladders: RoutingLadders = { profiles, strategies };

  // ---- Runtime: all mutable extension state in one place ----
  // The active tools are read from Pi at request time, so a definition that
  // inherits its tools follows the parent's current selection.
  const runtime = createSubagentRuntime(
    () => pi.getActiveTools(),
    ladders,
    () => pi.getAllTools().map((tool) => tool.name),
  );

  const refreshProfiles = (): void => {
    // The profiles live in the settings file, which the settings module owns:
    // it merges the operator's and the project's layers per family.
    const { profiles: operator, problems } = parseUserProfiles(
      settings.familyProfiles,
    );
    const merged = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      operator,
      [],
      strategies,
    );
    profiles.clear();
    for (const [family, profile] of merged.profiles) {
      profiles.set(family, profile);
    }
    for (const problem of [...problems, ...merged.problems]) {
      definitionErrors.reportNew([problem]);
    }
  };

  // ---- Agent definitions ----
  // Shipped specialists, then the operator's global files, then the project's
  // files. Both file layers load while the extension runs: whether a project's
  // files may be used is Pi's decision about its own resources, and this
  // extension adds no second gate of its own (ARCHITECTURE-SPEC story 36).
  const registry = new AgentRegistry(() =>
    loadDefinitionScopes({
      globalDir: getAgentDir(),
      cwd: process.cwd(),
    }),
  );

  /**
   * Re-reads the definition files and tells the parent about a problem the
   * operator has to fix.
   *
   * A duplicate identifier is reported once per problem, not once per spawn:
   * the operator can delete one of the two files, and the report goes away
   * with it.
   */
  const refreshDefinitions = (): void => {
    registry.reload();
    definitionErrors.reportNew(registry.errors());
  };

  // ---- Notification system ----
  // Owns completion nudges and live-activity cleanup. The widget detects finished
  // agents itself (AgentWidget.update self-seeds), so NotificationManager has no
  // widget dependency — keeping the construction graph a cycle-free DAG.
  const notifications = new NotificationManager((msg, opts) =>
    pi.sendMessage(msg, opts),
  );

  // Gate nudge delivery on the parent's agent run. agent_settled fires exactly
  // once per run (from a finally block, so it also covers error and abort),
  // whereas agent_end fires once per run segment — retries, auto-compaction and
  // followUp continuations each emit one.
  pi.on("agent_start", () => notifications.onParentAgentStart());
  pi.on("agent_settled", () => notifications.onParentAgentSettled());

  // Settings: owns all three in-memory values and handles load/save/emit.
  // onMaxConcurrentChanged is wired to the limiter directly (closure captures by reference).
  const settings = new SettingsManager({
    emit: (event, payload) => pi.events.emit(event, payload),
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    onMaxConcurrentChanged: () => limiter.recheck(),
  });
  settings.load();

  // Both caller doors share one preparation authority. Each preparation loads
  // its own immutable definition catalog asynchronously, so overlapping
  // requests never select through the mutable live registry (stories 29 and
  // 60). Parent model facts and operator defaults are captured at the
  // invocation boundary rather than reconstructed independently by each
  // adapter.
  const launchPreparer = new LaunchPreparer({
    loadScopes: (signal) =>
      loadDefinitionScopesAsync(
        {
          globalDir: getAgentDir(),
          cwd: process.cwd(),
        },
        signal,
      ),
    // Profiles live in files the operator can edit; refresh them at capture
    // time, before preparation can yield, so the request sees the profiles in
    // force when it was made.
    modelInfo: () => {
      refreshProfiles();
      return runtime.getModelInfo();
    },
    turnSettings: () => settings,
    childShaping: () => settings.captureChildShaping(),
  });

  // Observer: receives agent lifecycle notifications and dispatches events/notifications.
  const eventsObserver = new SubagentEventsObserver({
    emit: (channel, data) => pi.events.emit(channel, data),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    notifications,
  });

  // Fan-out observer: lets the widget subscribe as a second lifecycle consumer
  // while the manager keeps its single-observer contract. The widget is added
  // after construction (it needs the manager); the manager consults the observer
  // only at spawn time, so registering late is safe.
  const observer = new CompositeSubagentObserver([eventsObserver]);

  const subagentSessionDeps: SubagentSessionDeps = {
    io: {
      detectEnv,
      getAgentDir,
      createResourceLoader: (opts) => new DefaultResourceLoader(opts),
      deriveSessionDir: deriveSubagentSessionDir,
      createSessionManager: (cwd, dir) => SessionManager.create(cwd, dir),
      createSettingsManager: (cwd, dir) => SdkSettingsManager.create(cwd, dir),
      // The exclusion policy is resolved here, at the composition root, so the
      // assembly factory stays free of it and gets a ready-made settings view.
      createLoaderSettingsManager: (parent, capturedExcluded) => {
        // A launch prepared through the shared seam carries its excluded
        // package list with it (story 56); children of older callers read the
        // current setting, as before.
        const excluded = new Set(
          capturedExcluded ?? settings.excludedExtensionPackages,
        );
        if (excluded.size === 0) return parent;
        return SdkSettingsManager.fromStorage(
          createExcludedPackagesStorage(parent, excluded),
          {
            projectTrusted: parent.isProjectTrusted(),
          },
        );
      },
      // The factory states its collaborators as narrow structural contracts so
      // it can be tested with plain stubs. Here at the composition root the
      // values really are the SDK objects, so widen those three and let every
      // other option type-check against the SDK signature.
      createSession: async ({
        sessionManager,
        resourceLoader,
        modelRegistry,
        ...rest
      }) => {
        // Pi builds the child a fresh ModelRuntime whenever it is not given
        // one, and runtime registrations live on the instance rather than in
        // models.json or auth.json — so the child would lose every provider the
        // parent registered via pi.registerProvider. Build the runtime here
        // instead and replay those registrations onto it. The child keeps its
        // own pool, so a child-loaded extension cannot mutate the parent's
        // (Refs #812). The path derivation mirrors the SDK's own.
        const childRuntime = await ModelRuntime.create({
          authPath: join(rest.agentDir, "auth.json"),
          modelsPath: join(rest.agentDir, "models.json"),
        });
        const childRegistry = new SdkModelRegistry(childRuntime);
        inheritRegisteredProviders(modelRegistry as SdkModelRegistry, {
          registerNative: (provider) => {
            childRegistry.registerProvider(provider);
          },
          registerConfigured: (id, config) => {
            childRegistry.registerProvider(id, config);
          },
        });
        return createAgentSession({
          ...rest,
          sessionManager: sessionManager as SessionManager,
          resourceLoader: resourceLoader as ResourceLoader,
          modelRuntime: childRuntime,
        });
      },
      assemblerIO: {
        buildAgentPrompt,
        // Pi's own discovery, pointed at whichever directory the child runs in.
        loadProjectContext: createProjectContextLoader(
          loadProjectContextFiles,
          getAgentDir(),
        ),
      },
    },
    exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
    registry,
    // The registry is a session-scoped execution collaborator, not launch
    // data. Ownership prevents work from crossing a confirmed session switch;
    // exact captured identities prevent this bridge from rerouting a child.
    modelRegistry: () => {
      const modelRegistry = runtime.currentCtx?.modelRegistry;
      if (!modelRegistry) {
        throw new Error(
          "The parent session ended before the child model could be materialized.",
        );
      }
      return modelRegistry;
    },
    lifecycle: createChildLifecyclePublisher((channel, data) =>
      pi.events.emit(channel, data),
    ),
    // Resolved here, at the composition root, so the assembly factory stays
    // free of the policy and gets a ready-made settings view — the same shape
    // the extension-exclusion policy reaches it in. It is a resolver rather
    // than a value because only the assembler knows the child's provider.
    resolvePromptInheritance: (provider) =>
      settings.promptInheritanceFor(provider),
  };

  // ConcurrencyLimiter: schedules background run thunks FIFO against the limit.
  // It knows nothing about agents or the manager — dependency direction is strictly manager → limiter.
  const limiter = new ConcurrencyLimiter(() => settings.maxConcurrent);

  // The workspace gates of this runtime: one per working directory, so the
  // children of two parents in one directory share the slot that keeps two
  // writers from reaching for the same files at once.
  const workspaceGates = new WorkspaceGateRegistry();

  const manager = new SubagentManager({
    createSubagentSession: (params) =>
      createSubagentSession(params, subagentSessionDeps),
    baseCwd: process.cwd(),
    observer,
    limiter,
    workspaceGates,
    getRunConfig: () => settings,
    getRetentionPolicy: () => settings,
    registry,
    // Every spawn refreshes the definitions and the profiles: both live in
    // files the operator can edit while the session runs.
    reloadDefinitions: () => {
      refreshDefinitions();
      refreshProfiles();
    },
  });

  // Typed service published via Symbol.for() for cross-extension access.
  // Consumers: const { getSubagentsService } = await import("@code-fixer-23/pi-tiered-subagents");
  const subagents = new Subagents(manager, runtime, launchPreparer);
  const service = new SubagentsServiceAdapter(manager, subagents);

  // The manager is told which session owns the work it accepts, so that a
  // replacement can cancel it. Read from the session context, falling back
  // to the file: a session with no id yet is still a distinct session.
  const sessionIdOf = (ctx: unknown): string =>
    (
      ctx as { sessionManager?: { getSessionId?(): string } }
    ).sessionManager?.getSessionId?.() ||
    (
      ctx as { sessionManager?: { getSessionFile?(): string } }
    ).sessionManager?.getSessionFile?.() ||
    "";

  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(createWidgetSource(manager), registry);
  observer.add(widget);

  let shutdownPromise: Promise<void> | undefined;
  const shutdownOnce = async (): Promise<void> => {
    unpublishSubagentsService(service);
    runtime.clearSessionContext();
    const ownerEnd = manager.endOwner();
    notifications.dispose();
    manager.abortAll();
    await ownerEnd;
    await manager.dispose();
  };
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= shutdownOnce();
    return shutdownPromise;
  };

  pi.on("session_start", async (_event, ctx) => {
    // The files behind the settings and the definitions can change while the
    // extension is loaded, so both are re-read once the session exists.
    settings.load();
    refreshProfiles();
    refreshDefinitions();
    publishSubagentsService(service);
    runtime.setSessionContext(ctx);
    await manager.beginOwner(sessionIdOf(ctx));
    await manager.clearCompleted();
  });
  pi.on("session_start", (_event, ctx) => widget.setUICtx(ctx.ui));
  pi.on("session_before_switch", () => Promise.resolve());
  pi.on("session_shutdown", shutdown);
  // Registered after the lifecycle handler on purpose. Pi awaits an extension's
  // handlers for an event in registration order, so the widget is torn down once
  // `abortAll()` and the awaited `manager.dispose()` have finished — no terminal
  // transition is left to drive an `update()` at a half-disposed widget.
  pi.on("session_shutdown", () => widget.dispose());

  // Capture the prompt parts Pi assembled for the parent's turn. This is the
  // only event carrying them — `getSystemPromptOptions()` is attached to a
  // command context, not to the session context the runtime holds — and a spawn
  // renders the parent's portable identity from the latest capture.
  pi.on("before_agent_start", (event) => {
    runtime.setSystemPromptOptions(event.systemPromptOptions);
  });

  // Abort all subagents when the parent agent loop is interrupted (ESC), unless
  // the user has turned that policy off. The predicate is read at abort time.
  let latchedSignal: AbortSignal | undefined;
  let detachSignal: (() => void) | undefined;
  pi.on("turn_start", (_event, ctx) => {
    const signal = ctx.signal;
    if (signal === latchedSignal) return;
    detachSignal?.();
    detachSignal = undefined;
    latchedSignal = signal;
    if (!signal) return;
    const onAbort = (): void => {
      if (settings.abortAllOnInterrupt) manager.abortAll();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    detachSignal = () => signal.removeEventListener("abort", onAbort);
  });
  pi.on("turn_start", () => widget.onTurnStart());

  // ---- Agent tool ----

  // The parent-tool contracts live here, at the registration site: names,
  // descriptions, schemas, render hooks, and execution adapters are read
  // together, while execution and rendering stay in their own modules.
  const typeListText = buildTypeListText(registry, getAgentDir());
  const availableTypesText = registry.enabledIds().join(", ");
  const agentGuidelines = [
    "- For parallel work, use run_in_background: true on each agent. Foreground calls run sequentially — only one executes at a time.",
    ...buildAgentGuidelines(registry),
    "- Provide clear, detailed prompts so the agent can work autonomously.",
    "- Subagent results are returned as text — summarize them for the user.",
    "- Use run_in_background for work you don't need immediately. You will be notified when it completes.",
    "- Use resume with an agent ID to continue a previous agent's work, or to answer an agent that ended its turn with a question.",
    "- Use steer_subagent to send mid-run messages to a running background agent.",
    '- Use model to specify a different model, named exactly as "provider/modelId" (for example "anthropic/claude-sonnet-5").',
    "- Use thinking to control extended thinking level.",
    "- Use inherit_context if the agent needs the parent conversation history.",
  ].join("\n");

  const agentTool = createAgentTool({
    manager,
    subagents,
    settings,
    registry,
  });
  pi.registerTool(
    defineTool({
      name: "subagent" as const,
      label: "Subagent",
      promptSnippet:
        "Launch a specialized agent for complex, multi-step tasks.",
      description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The subagent tool launches specialized agents that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:
${typeListText}

Guidelines:
${agentGuidelines}
`,
      parameters: Type.Object({
        prompt: Type.String({
          description: "The task for the agent to perform.",
        }),
        description: Type.String({
          description:
            "A short (3-5 word) description of the task (shown in UI).",
        }),
        subagent_type: Type.String({
          description: `The type of specialized agent to use. Available types: ${availableTypesText}. Custom agents from .pi/agents/<name>.md (project) or ${getAgentDir()}/agents/<name>.md (global) are also available. An unknown or disabled type is rejected, not replaced.`,
        }),
        model: Type.Optional(
          Type.String({
            description:
              'Optional model override, named exactly as "provider/modelId" (for example "anthropic/claude-sonnet-5"). Omit to use the agent definition\'s own model, or the one this call inherits.',
          }),
        ),
        thinking: Type.Optional(
          Type.String({
            description:
              "Thinking level: off, minimal, low, medium, high, xhigh, max. Overrides the agent definition's own level. A level the chosen model does not support is clamped to one it does, and the result says so.",
          }),
        ),
        max_turns: Type.Optional(
          Type.Number({
            description:
              "Maximum number of agentic turns before stopping. Omit to use the agent's own limit, or unlimited when it declares none.",
            minimum: 1,
          }),
        ),
        run_in_background: Type.Optional(
          Type.Boolean({
            description:
              "Set to true to run in background. Returns agent ID immediately. You will be notified when it completes. Omit to use the agent's own default.",
          }),
        ),
        resume: Type.Optional(
          Type.String({
            description:
              "Optional agent ID to resume from. Continues from previous context. Combine with run_in_background: true to resume without waiting.",
          }),
        ),
        inherit_context: Type.Optional(
          Type.Boolean({
            description:
              "If true, fork parent conversation into the agent. Omit to use the agent's own default, which is fresh context unless it declares otherwise.",
          }),
        ),
      }),
      outputSchema: subagentOutputSchema,
      ...createAgentToolRenderer((type) => getDisplayName(type, registry)),
      execute: (toolCallId, params, signal, onUpdate, ctx) =>
        agentTool.execute(toolCallId, params, signal, onUpdate, ctx),
    }),
  );

  // ---- get_subagent_result tool ----

  const getResultTool = createGetResultTool(manager, registry);
  pi.registerTool(
    defineTool({
      name: "get_subagent_result" as const,
      label: "Get Agent Result",
      promptSnippet:
        "Check status and retrieve results from a background agent.",
      description:
        "Check status and retrieve results from a background agent. Use the agent ID returned by Agent with run_in_background. " +
        "With wait: true and a timeout, the wait ends at the timeout and returns the agent's current progress; " +
        "this does not stop or abort the agent, unlike bash's timeout.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "The agent ID to check.",
        }),
        wait: Type.Optional(
          Type.Boolean({
            description:
              "If true, wait for the agent to complete before returning. Default: false.",
          }),
        ),
        verbose: Type.Optional(
          Type.Boolean({
            description:
              "If true, include the agent's full conversation (messages + tool calls). Default: false.",
          }),
        ),
        timeout: Type.Optional(
          Type.Number({
            description:
              "Seconds to wait when wait is true (optional, no default: wait until the agent finishes). " +
              "An expired wait does not stop the agent; if its progress is unchanged since your last check, do not simply wait again.",
          }),
        ),
      }),
      outputSchema: getResultOutputSchema,
      renderCall: renderGetResultCall,
      renderResult: renderGetResultResult,
      execute: (
        toolCallId: string,
        params: GetResultParams,
        signal: AbortSignal,
        onUpdate: unknown,
        ctx: unknown,
      ) => getResultTool.execute(toolCallId, params, signal, onUpdate, ctx),
    }),
  );

  // ---- steer_subagent tool ----

  const steerTool = createSteerTool(manager, pi.events);
  pi.registerTool(
    defineTool({
      name: "steer_subagent" as const,
      label: "Steer Agent",
      promptSnippet:
        "Send a mid-run message to redirect a running background agent.",
      description:
        "Send a steering message to a running agent. The message will interrupt the agent after its current tool execution " +
        "and be injected into its conversation, allowing you to redirect its work mid-run. Only works on running agents.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "The agent ID to steer (must be currently running).",
        }),
        message: Type.String({
          description:
            "The steering message to send. This will appear as a user message in the agent's conversation.",
        }),
      }),
      outputSchema: steerOutputSchema,
      execute: (
        toolCallId: string,
        params: { agent_id: string; message: string },
        signal: AbortSignal,
        onUpdate: unknown,
        ctx: unknown,
      ) => steerTool.execute(toolCallId, params, signal, onUpdate, ctx),
    }),
  );

  // ---- /subagents:settings command ----

  pi.registerCommand("subagents:settings", {
    description:
      "Configure subagent settings (concurrency, turn limits, retention, interrupt policy)",
    handler: async (_args, ctx) => {
      await handleSubagentsSettings(settings, { ui: ctx.ui });
    },
  });

  // ---- /subagents:sessions command ----

  pi.registerCommand("subagents:sessions", {
    description: "View a subagent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      await handleSubagentsSessions({
        ui: ctx.ui,
        agents: manager.listAgents().map(toNavigableSubagent),
        registry,
        cwd: ctx.cwd,
        readFile: (path) => readFile(path, "utf8"),
        persisted: readPersistedNavigationRuns(ctx.sessionManager.getEntries()),
      });
    },
  });
}
