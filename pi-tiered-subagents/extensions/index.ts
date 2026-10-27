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
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ExtensionAPI,
  getAgentDir,
  loadProjectContextFiles,
  ModelRuntime,
  type ResourceLoader,
  ModelRegistry as SdkModelRegistry,
  SettingsManager as SdkSettingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  loadDefinitionScopes,
  loadDefinitionScopesAsync,
} from "#src/agents/loader";
import { AgentRegistry } from "#src/agents/registry";
import { LaunchPreparer } from "#src/agents/launch-preparer";
import { DefinitionErrorReporter } from "#src/agents/report";
import {
  InterruptHandler,
  SessionLifecycleHandler,
  WidgetEventsHandler,
} from "#src/handlers/index";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import {
  createSubagentSession,
  type SubagentSessionDeps,
} from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import {
  type NotificationDetails,
  NotificationManager,
  type UpdateDetails,
  type WorkspaceNoticeDetails,
} from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
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
import { AgentTool } from "#src/tools/agent-tool";
import {
  GetResultTool,
  type GetResultParams,
} from "#src/tools/get-result-tool";
import { SteerTool } from "#src/tools/steer-tool";
import { buildAgentGuidelines, buildTypeListText } from "#src/tools/helpers";
import {
  getResultOutputSchema,
  steerOutputSchema,
  subagentOutputSchema,
} from "#src/tools/structured-output";
import { createAgentToolRenderer } from "#src/ui/agent-tool-renderer";
import { getDisplayName } from "#src/ui/display";
import {
  renderGetResultCall,
  renderGetResultResult,
} from "#src/ui/get-result-tool-renderer";
import { createWidgetSource } from "#src/presentation/widget-adapter";
import {
  readPersistedNavigationRuns,
  toNavigableSubagent,
} from "#src/presentation/transcript-adapter";
import {
  AgentWidget,
  createNotificationRenderer,
  createUpdateRenderer,
  createWorkspaceNoticeRenderer,
  SessionNavigatorHandler,
  SubagentsSettingsHandler,
} from "#src/ui/index";

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
  pi.registerMessageRenderer<NotificationDetails>(
    "subagent-notification",
    createNotificationRenderer(),
  );
  pi.registerMessageRenderer<UpdateDetails>(
    "subagent-update",
    createUpdateRenderer(),
  );
  pi.registerMessageRenderer<WorkspaceNoticeDetails>(
    "subagent-workspace-notice",
    createWorkspaceNoticeRenderer(),
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

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,
    () => notifications.dispose(),
    () => unpublishSubagentsService(service),
    // The manager is told which session owns the work it accepts, so that a
    // replacement can cancel it. Read from the session context, falling back
    // to the file: a session with no id yet is still a distinct session.
    (ctx) =>
      (
        ctx as { sessionManager?: { getSessionId?(): string } }
      ).sessionManager?.getSessionId?.() ||
      (
        ctx as { sessionManager?: { getSessionFile?(): string } }
      ).sessionManager?.getSessionFile?.() ||
      "",
  );

  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(createWidgetSource(manager), registry);
  observer.add(widget);

  // Give the widget its UI context and its turn ticks. Pi fans an event out to
  // every handler an extension registers for it, so these take their own
  // registrations rather than sharing a lambda with an unrelated concern.
  const widgetEvents = new WidgetEventsHandler(widget);

  pi.on("session_start", (event, ctx) => {
    // The files behind the settings and the definitions can change while the
    // extension is loaded, so both are re-read once the session exists.
    settings.load();
    refreshProfiles();
    refreshDefinitions();
    publishSubagentsService(service);
    return lifecycle.handleSessionStart(event, ctx);
  });
  pi.on("session_start", (event, ctx) =>
    widgetEvents.handleSessionStart(event, ctx),
  );
  pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
  // Registered after the lifecycle handler on purpose. Pi awaits an extension's
  // handlers for an event in registration order, so the widget is torn down once
  // `abortAll()` and the awaited `manager.dispose()` have finished — no terminal
  // transition is left to drive an `update()` at a half-disposed widget.
  pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());

  // Capture the prompt parts Pi assembled for the parent's turn. This is the
  // only event carrying them — `getSystemPromptOptions()` is attached to a
  // command context, not to the session context the runtime holds — and a spawn
  // renders the parent's portable identity from the latest capture.
  pi.on("before_agent_start", (event) => {
    runtime.setSystemPromptOptions(event.systemPromptOptions);
  });

  // Abort all subagents when the parent agent loop is interrupted (ESC), unless
  // the user has turned that policy off. The predicate is read at abort time.
  const interrupt = new InterruptHandler(
    manager,
    () => settings.abortAllOnInterrupt,
  );
  pi.on("turn_start", (_event, ctx) => interrupt.handleTurnStart(ctx));
  pi.on("turn_start", () => widgetEvents.handleTurnStart());

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

  const agentTool = new AgentTool(manager, subagents, settings, registry);
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

  const getResultTool = new GetResultTool(manager, registry);
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

  const steerTool = new SteerTool(manager, pi.events);
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

  const subagentsSettings = new SubagentsSettingsHandler(settings);

  pi.registerCommand("subagents:settings", {
    description:
      "Configure subagent settings (concurrency, turn limits, retention, interrupt policy)",
    handler: async (_args, ctx) => {
      await subagentsSettings.handle({ ui: ctx.ui });
    },
  });

  // ---- /subagents:sessions command ----

  const sessionNavigator = new SessionNavigatorHandler();

  pi.registerCommand("subagents:sessions", {
    description: "View a subagent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      await sessionNavigator.handle({
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
