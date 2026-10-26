/** Production child assembly + Pi 1.3.0's real direct/nested tool pipeline. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRegistry,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { defaultDefinition } from "#src/agents/definition";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import {
  createSubagentSession,
  type SubagentSessionDeps,
} from "#src/lifecycle/create-subagent-session";
import { buildAgentPrompt } from "#src/session/prompts";
import { makeModel } from "#test/helpers/make-model";
import {
  getSubagentsService,
  publishSubagentsService,
  type SubagentsService,
  unpublishSubagentsService,
} from "#src/service/service";

const packageEntry = fileURLToPath(
  new URL("../../extensions/index.ts", import.meta.url),
);

function echoTool(
  name: string,
  executions: Map<string, number>,
  exposure: ToolDefinition["exposure"] = "direct",
): ToolDefinition {
  return {
    name,
    exposure,
    label: name,
    description: "Offline capability fixture",
    parameters: Type.Object({}),
    async execute() {
      executions.set(name, (executions.get(name) ?? 0) + 1);
      return {
        content: [{ type: "text", text: `executed:${name}` }],
        details: undefined,
      };
    },
  };
}

async function childFixture(directory: string) {
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  await runtime.setRuntimeApiKey("anthropic", "offline-test-key");
  const settings = SettingsManager.inMemory();
  let extension: ExtensionAPI | undefined;
  const discoveredService = getSubagentsService();
  const publicationChecks: boolean[] = [];
  const executions = new Map<string, number>();
  const deps: SubagentSessionDeps = {
    io: {
      detectEnv: async () => ({
        isGitRepo: false,
        branch: "",
        platform: process.platform,
      }),
      getAgentDir: () => directory,
      deriveSessionDir: () => directory,
      createSessionManager: () => SessionManager.inMemory(directory),
      createSettingsManager: () => settings,
      createLoaderSettingsManager: (parent) => parent,
      createResourceLoader: (options) =>
        new DefaultResourceLoader({
          ...options,
          additionalExtensionPaths: [packageEntry],
          extensionFactories: [
            ...(options.extensionFactories ?? []),
            (pi) => {
              extension = pi;
              publicationChecks.push(
                getSubagentsService() === discoveredService,
              );
              pi.on("session_start", () => {
                publicationChecks.push(
                  getSubagentsService() === discoveredService,
                );
              });
              pi.on("session_shutdown", () => {
                publicationChecks.push(
                  getSubagentsService() === discoveredService,
                );
              });
              pi.registerTool(echoTool("allowed_echo", executions));
              pi.registerTool(echoTool("mcp__fixture__allowed", executions));
              pi.registerTool(
                echoTool("mcp__fixture__secret", executions, "codemode"),
              );
              pi.registerTool(
                echoTool("mcp__fixture__deferred", executions, "deferred"),
              );
              pi.registerTool(
                echoTool("read_mcp_resource", executions, "codemode"),
              );
            },
          ],
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
  return {
    executions,
    publicationChecks,
    async create(tools: string[]) {
      return createSubagentSession(
        {
          snapshot: {
            cwd: directory,
            systemPrompt: "offline",
            activeToolNames: [],
            registeredToolNames: [],
          },
          type: "fixture",
          toolNames: tools,
          model: makeModel(),
          turnPolicy: { kind: "unlimited" },
        },
        deps,
      );
    },
    refresh() {
      if (!extension) throw new Error("Child extension has not loaded");
      extension.registerTool(
        echoTool("mcp__fixture__late", executions, "codemode"),
      );
    },
  };
}

/** Only the external model response is substituted; SDK dispatch and hooks run unchanged. */
async function callTool(
  session: Awaited<ReturnType<typeof createSubagentSession>>["session"],
  name: string,
  args = {},
) {
  let first = true;
  session.agent.streamFunction = (model) => {
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: first
        ? [{ type: "toolCall", id: "capability-call", name, arguments: args }]
        : [{ type: "text", text: "done" }],
      stopReason: first ? "toolUse" : "stop",
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    first = false;
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    return stream;
  };
  await session.prompt("Run the capability probe");
  const result = session.messages.findLast(
    (message) => message.role === "toolResult",
  );
  if (!result || result.role !== "toolResult")
    throw new Error("SDK did not produce a tool result");
  return result;
}

it.each([
  ["codemode", "allowed_echo"],
  ["codemode", "mcp__fixture__allowed"],
])("enforces a child's concrete capabilities %s / %s before and after registry refresh", async (...tools) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-child-capabilities-"));
  let child: Awaited<ReturnType<typeof createSubagentSession>> | undefined;
  try {
    const fixture = await childFixture(directory);
    child = await fixture.create(tools);
    const allowedName = tools[1];
    for (const refreshed of [false, true]) {
      if (refreshed) fixture.refresh();
      const direct = await callTool(child.session, allowedName);
      expect(direct.isError).toBe(false);
      expect(direct.content).toEqual([
        { type: "text", text: `executed:${allowedName}` },
      ]);
      // Positive control: QuickJS really calls the allowed SDK tool.
      const allowed = await callTool(child.session, "codemode", {
        code: `return await tools.${allowedName}({});`,
      });
      expect(allowed.isError).toBe(false);
      expect(allowed.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining(`executed:${allowedName}`),
          }),
        ]),
      );

      for (const tool of [
        "mcp__fixture__secret",
        "mcp__fixture__deferred",
        "read_mcp_resource",
        "mcp__fixture__late",
      ]) {
        const deniedDirect = await callTool(child.session, tool);
        expect(deniedDirect.isError, `${tool} must not execute directly`).toBe(
          true,
        );
        const deniedNested = await callTool(child.session, "codemode", {
          code: `return await tools.${tool}({});`,
        });
        expect(
          deniedNested.isError,
          `${tool} must not execute via codemode`,
        ).toBe(true);
        expect(
          fixture.executions.get(tool),
          `${tool} body must never run`,
        ).toBeUndefined();
      }
      expect(child.session.getCallableToolNames()).toEqual([allowedName]);
    }
  } finally {
    await child?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it("keeps the parent service through actual child extension loading and disposal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-child-service-"));
  const parent = {} as SubagentsService;
  publishSubagentsService(parent);
  let child: Awaited<ReturnType<typeof createSubagentSession>> | undefined;
  try {
    const fixture = await childFixture(directory);
    child = await fixture.create([]);
    expect(getSubagentsService()).toBe(parent);
    await child.session.reload();
    expect(getSubagentsService()).toBe(parent);
    await child.dispose();
    expect(getSubagentsService()).toBe(parent);
    // The unrelated inherited factory and both lifecycle handlers ran.
    expect(fixture.publicationChecks.every(Boolean)).toBe(true);
    expect(fixture.publicationChecks.length).toBeGreaterThanOrEqual(5);
  } finally {
    await child?.dispose();
    unpublishSubagentsService(parent);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each([
  "*",
  "+codemode",
  "-write",
  "mcp__fixture__*",
])("rejects unresolved SDK tool selection syntax %s instead of broadening capabilities", async (selection) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-child-selection-"));
  let child: Awaited<ReturnType<typeof createSubagentSession>> | undefined;
  try {
    const fixture = await childFixture(directory);
    let outcome = "accepted unsafe selection";
    try {
      child = await fixture.create([selection]);
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    }
    expect(outcome).toContain("concrete tool names");
  } finally {
    await child?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it("publishes a legitimate parent only on session start outside child discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-parent-service-"));
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>["session"]
    | undefined;
  unpublishSubagentsService();
  try {
    const settingsManager = SettingsManager.inMemory();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      additionalExtensionPaths: [packageEntry],
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
    });
    await resourceLoader.reload();
    expect(resourceLoader.getExtensions().errors).toEqual([]);
    expect(getSubagentsService()).toBeUndefined();
    ({ session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.inMemory(directory),
    }));
    await session.bindExtensions({});
    expect(getSubagentsService()).toBeDefined();
    const replacement = {} as SubagentsService;
    publishSubagentsService(replacement);
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    expect(getSubagentsService()).toBe(replacement);
  } finally {
    session?.dispose();
    unpublishSubagentsService();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
