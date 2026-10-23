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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  getAgentDir,
  loadProjectContextFiles,
  ModelRuntime,
  type ResourceLoader,
  ModelRegistry as SdkModelRegistry,
  SettingsManager as SdkSettingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadDefinitionScopes } from "#src/agents/loader";
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
import { GetResultTool } from "#src/tools/get-result-tool";
import { SteerTool } from "#src/tools/steer-tool";
import { AgentWidget } from "#src/ui/agent-widget";
import {
  createNotificationRenderer,
  createUpdateRenderer,
  createWorkspaceNoticeRenderer,
} from "#src/ui/notification-renderer";
import { SessionNavigatorHandler } from "#src/ui/session-navigator";
import { SubagentsSettingsHandler } from "#src/ui/subagents-settings";

export default function (pi: ExtensionAPI) {
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
  const runtime = createSubagentRuntime(() => pi.getActiveTools(), ladders);

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

  // Both caller doors share one preparation authority. Its configuration
  // refresh, parent model view, and operator turn defaults are captured at the
  // request boundary rather than reconstructed independently by each adapter.
  const launchPreparer = new LaunchPreparer({
    registry,
    reload: () => {
      refreshDefinitions();
      refreshProfiles();
    },
    modelInfo: () => runtime.getModelInfo(),
    turnSettings: () => settings,
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
      createLoaderSettingsManager: (parent) => {
        const excluded = new Set(settings.excludedExtensionPackages);
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
    lifecycle: createChildLifecyclePublisher((channel, data) =>
      pi.events.emit(channel, data),
    ),
    // Resolved here, at the composition root, so the assembly factory stays
    // free of the policy and gets a ready-made settings view — the same shape
    // the extension-exclusion policy reaches it in. It is a resolver rather
    // than a value because only the assembler knows the child's provider.
    resolvePromptInheritance: (provider) =>
      settings.promptInheritanceFor(provider),
    // Read per child rather than once: an MCP server connects in the
    // background, so its tools register after this extension loads.
    listParentToolNames: () => pi.getAllTools().map((tool) => tool.name),
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
  publishSubagentsService(service);

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,
    () => notifications.dispose(),
    unpublishSubagentsService,
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
  const widget = new AgentWidget(manager, registry);
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

  pi.registerTool(
    new AgentTool(
      manager,
      subagents,
      settings,
      registry,
      getAgentDir(),
    ).toToolDefinition(),
  );

  // ---- get_subagent_result tool ----

  pi.registerTool(new GetResultTool(manager, registry).toToolDefinition());

  // ---- steer_subagent tool ----

  pi.registerTool(new SteerTool(manager, pi.events).toToolDefinition());

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
        agents: manager.listAgents(),
        registry,
        cwd: ctx.cwd,
        readFile: (path) => readFileSync(path, "utf8"),
        sessionEntries: ctx.sessionManager.getEntries(),
      });
    },
  });
}
