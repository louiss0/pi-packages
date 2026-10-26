/**
 * Parent service identity across a real child's loading and disposal.
 *
 * The parent here is a real Pi session: its resource loader loads this
 * package's source extension, which publishes the service on `session_start`.
 * The child is then built by the production assembly factory with this
 * package's extension in its own load path, which is the case that used to
 * replace the parent's service.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { defaultDefinition } from "#src/agents/definition";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import {
  createSubagentSession,
  type SubagentSessionDeps,
} from "#src/lifecycle/create-subagent-session";
import { buildAgentPrompt } from "#src/session/prompts";
import { getSubagentsService } from "#src/service/service";
import { makeModel } from "#test/helpers/make-model";

const packageEntry = fileURLToPath(
  new URL("../../extensions/index.ts", import.meta.url),
);

async function startParentSession(agentDir: string) {
  const services = await createAgentSessionServices({
    cwd: agentDir,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    modelRuntime: await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    }),
    resourceLoaderOptions: {
      additionalExtensionPaths: [packageEntry],
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  });
  const created = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(agentDir),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  await created.session.bindExtensions({});
  return created.session;
}

/** A child whose own load path names this package, as an inherited child can. */
async function createInheritingChild(agentDir: string) {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const settings = SettingsManager.inMemory();
  const deps: SubagentSessionDeps = {
    io: {
      detectEnv: async () => ({
        isGitRepo: false,
        branch: "",
        platform: process.platform,
      }),
      getAgentDir: () => agentDir,
      deriveSessionDir: () => agentDir,
      createSessionManager: () => SessionManager.inMemory(agentDir),
      createSettingsManager: () => settings,
      createLoaderSettingsManager: (parent) => parent,
      createResourceLoader: (options) =>
        new DefaultResourceLoader({
          ...options,
          additionalExtensionPaths: [packageEntry],
        }),
      createSession: ({
        sessionManager,
        resourceLoader,
        modelRegistry: _registry,
        ...options
      }) =>
        createAgentSession({
          ...options,
          sessionManager: sessionManager as SessionManager,
          resourceLoader: resourceLoader as ResourceLoader,
          modelRuntime: runtime,
        }),
      assemblerIO: { buildAgentPrompt, loadProjectContext: () => undefined },
    },
    exec: async () => ({ code: 1, stdout: "", stderr: "offline" }),
    registry: {
      select: () => ({
        ok: true,
        definition: defaultDefinition("fixture", "project"),
      }),
      find: () => undefined,
      list: () => [],
    },
    modelRegistry: () => new ModelRegistry(runtime),
    lifecycle: createChildLifecyclePublisher(() => undefined),
    resolvePromptInheritance: () => "full",
  };
  return createSubagentSession(
    {
      snapshot: {
        cwd: agentDir,
        systemPrompt: "offline",
        activeToolNames: [],
        registeredToolNames: [],
      },
      type: "fixture",
      toolNames: [],
      model: makeModel(),
      turnPolicy: { kind: "unlimited" },
    },
    deps,
  );
}

it("keeps the real parent service through a child that inherits this extension", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-parent-service-"));
  let parent: Awaited<ReturnType<typeof startParentSession>> | undefined;
  let child: Awaited<ReturnType<typeof createInheritingChild>> | undefined;
  try {
    parent = await startParentSession(directory);
    const service = getSubagentsService();
    expect(service).toBeDefined();
    if (!service) throw new Error("the parent extension did not publish");
    // The published object is a working service, not a placeholder.
    expect(service.listAgents()).toEqual([]);
    expect(service.getRecord("not-an-agent")).toBeUndefined();

    child = await createInheritingChild(directory);
    expect(getSubagentsService()).toBe(service);

    // The child's own work never appears in the parent's service.
    expect(service.listAgents()).toEqual([]);

    await child.dispose();
    expect(getSubagentsService()).toBe(service);
    expect(service.getRecord("not-an-agent")).toBeUndefined();
  } finally {
    await child?.dispose();
    parent?.dispose();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 60_000);
