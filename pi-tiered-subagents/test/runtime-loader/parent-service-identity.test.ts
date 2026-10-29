/** Real parent and child loading must not expose a global runtime or recursive child tools. */
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
const serviceKey = Symbol.for("@code-fixer-23/pi-tiered-subagents:service");
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

it("keeps the runtime private when a real child inherits the extension", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-parent-privacy-"));
  let parent: Awaited<ReturnType<typeof startParentSession>> | undefined;
  let child: Awaited<ReturnType<typeof createInheritingChild>> | undefined;
  const published = () => (globalThis as Record<symbol, unknown>)[serviceKey];
  try {
    parent = await startParentSession(directory);
    expect(parent.extensionRunner.getToolDefinition("subagent")).toBeDefined();
    expect(published()).toBeUndefined();
    child = await createInheritingChild(directory);
    for (const name of ["subagent", "get_subagent_result", "steer_subagent"]) {
      expect(
        child.session.extensionRunner.getToolDefinition(name),
      ).toBeUndefined();
    }
    expect(published()).toBeUndefined();
    await child.dispose();
    expect(published()).toBeUndefined();
  } finally {
    await child?.dispose();
    parent?.dispose();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 60_000);
