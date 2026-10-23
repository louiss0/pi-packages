import type {
  AgentToolResult,
  ExtensionContext,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { defined } from "#src/optional";
import type { AgentRegistry } from "#src/agents/registry";
import type { TurnSettings } from "#src/agents/resolver";
import type {
  ResumeCallOptions,
  ResumeRefusalReason,
  ResumeStart,
} from "#src/lifecycle/subagent-manager";
import type { Subagents } from "#src/service/subagents";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderStatusNote,
} from "#src/observation/outcome-delivery";
import {
  renderBackgroundLaunch,
  spawnBackground,
} from "#src/tools/background-spawner";
import { runForeground } from "#src/tools/foreground-runner";
import {
  buildAgentGuidelines,
  buildDetails,
  buildTypeListText,
  textResult,
} from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import { renderAgentResult } from "#src/tools/result-renderer";
import type { SpawnPresentation } from "#src/tools/spawn-config";
import type { Subagent } from "#src/types";
import { type AgentDetails, getDisplayName, type Theme } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

// ---- Deps interfaces ----

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

// ---- Class ----

export class AgentTool {
  private readonly typeListText: string;
  private readonly availableTypesText: string;
  private readonly agentGuidelines: string[];

  constructor(
    private readonly manager: AgentToolManager,
    private readonly subagents: Subagents,
    private readonly settings: AgentToolSettings,
    private readonly registry: AgentRegistry,
    private readonly agentDir: string,
  ) {
    this.typeListText = buildTypeListText(registry, agentDir);
    this.availableTypesText = registry.enabledIds().join(", ");
    this.agentGuidelines = buildAgentGuidelines(registry);
  }

  async execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    _ctx: ExtensionContext,
  ) {
    // ---- Resume existing agent ----
    // Resume dispatches before any new-launch preparation: continuing an
    // existing child must not load definitions or resolve a model for an
    // unrelated new launch (ARCHITECTURE-SPEC story 72).
    if (params.resume) {
      const id = params.resume as string;
      const detailBase = this.resumeDetailBase(id, params);
      // Only the caller's explicit flag: an agent file's run_in_background
      // default describes how that type spawns, not how a resume is collected.
      if (params.run_in_background === true) {
        return this.resumeInBackground(id, params.prompt as string, detailBase);
      }
      return this.resumeExisting(
        id,
        params.prompt as string,
        signal,
        onUpdate,
        detailBase,
      );
    }

    const prepared = await this.subagents.prepareLaunch(
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
    if (prepared.kind === "rejected") return textResult(prepared.message);
    const launch = prepared.value;
    const { config } = launch;

    // ---- Background execution ----
    if (config.execution.runInBackground) {
      return spawnBackground(this.subagents, {
        config,
        launch,
        settings: this.settings,
      });
    }

    // ---- Foreground execution — stream progress via onUpdate ----
    return runForeground(this.subagents, { config, launch }, signal, onUpdate);
  }

  /**
   * The presentation a resume reports under, without preparing a launch.
   *
   * The caller's own `subagent_type` names the display, as it did when a
   * resume still prepared a launch it never used; the record's type is the
   * fallback for a caller that names none.
   */
  private resumeDetailBase(
    id: string,
    params: Record<string, unknown>,
  ): SpawnPresentation["detailBase"] {
    const recordType = this.manager.getRecord(id)?.type;
    const type =
      (params.subagent_type as string | undefined) ?? recordType ?? id;
    const definition = this.registry.find(type);
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
  private async resumeExisting(
    id: string,
    prompt: string,
    signal: AbortSignal | undefined,
    onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    // The manager owns whether a resume happens; this door owns only how the
    // answer is worded. Resuming commits this call to delivering the outcome,
    // so it claims it — nothing else announces what is already being returned.
    const start = this.manager.startResume(id, prompt, {
      background: false,
      signal: signal ?? new AbortController().signal,
      claimOutcome: true,
    });
    if (start.kind === "refused") {
      return textResult(resumeRefusalMessage(start.reason, id));
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
    return textResult(
      `Agent ID: ${record.id}${renderStatusNote(record)}\n\n` +
        renderOutcomeBody(record) +
        renderOutcomeAddenda(record),
      buildDetails(detailBase, record),
    );
  }

  /**
   * Start an existing agent's resume and return at once; the completion notice
   * delivers its outcome. Nothing claims the outcome and no tool-call signal is
   * wired, as for a background spawn, and like one it may wait for a
   * concurrency slot, which the launch message reports.
   */
  private resumeInBackground(
    id: string,
    prompt: string,
    detailBase: SpawnPresentation["detailBase"],
  ) {
    const start = this.manager.startResume(id, prompt, { background: true });
    if (start.kind === "refused") {
      return textResult(resumeRefusalMessage(start.reason, id));
    }
    const queued = start.record.status === "queued";
    return renderBackgroundLaunch(
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
          ? { maxConcurrent: this.settings.maxConcurrent }
          : undefined,
      }),
    );
  }

  toToolDefinition() {
    const typeListText = this.typeListText;
    const availableTypesText = this.availableTypesText;
    const agentDir = this.agentDir;
    const registry = this.registry;

    const guidelines = [
      "- For parallel work, use run_in_background: true on each agent. Foreground calls run sequentially — only one executes at a time.",
      ...this.agentGuidelines,
      "- Provide clear, detailed prompts so the agent can work autonomously.",
      "- Subagent results are returned as text — summarize them for the user.",
      "- Use run_in_background for work you don't need immediately. You will be notified when it completes.",
      "- Use resume with an agent ID to continue a previous agent's work, or to answer an agent that ended its turn with a question.",
      "- Use steer_subagent to send mid-run messages to a running background agent.",
      '- Use model to specify a different model, named exactly as "provider/modelId" (for example "anthropic/claude-sonnet-5").',
      "- Use thinking to control extended thinking level.",
      "- Use inherit_context if the agent needs the parent conversation history.",
    ].join("\n");

    return defineTool({
      name: "subagent" as const,
      label: "Subagent",
      promptSnippet:
        "Launch a specialized agent for complex, multi-step tasks.",
      description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The subagent tool launches specialized agents that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:
${typeListText}

Guidelines:
${guidelines}
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
          description: `The type of specialized agent to use. Available types: ${availableTypesText}. Custom agents from .pi/agents/<name>.md (project) or ${agentDir}/agents/<name>.md (global) are also available. An unknown or disabled type is rejected, not replaced.`,
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

      // ---- Custom rendering: inline subagent results ----

      renderCall(args: Record<string, unknown>, theme: Theme) {
        const displayName = args.subagent_type
          ? getDisplayName(args.subagent_type as string, registry)
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
      ) {
        const details = result.details;
        if (!details) {
          const text =
            result.content[0]?.type === "text" ? result.content[0].text : "";
          return new Text(text, 0, 0);
        }
        const resultText =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        return new Text(
          renderAgentResult(details, resultText, expanded, isPartial, theme),
          0,
          0,
        );
      },

      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
        onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
        ctx: ExtensionContext,
      ) => this.execute(toolCallId, params, signal, onUpdate, ctx),
    });
  }
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
