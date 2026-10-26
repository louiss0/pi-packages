/**
 * Positive MCP integration: a child with only resource tools reaches a real
 * stdio MCP server through the production child assembly.
 *
 * This is the counterpart to the capability tests' denial fixtures: it proves
 * the reserved MCP resource tools work against a live transport, not only that
 * a same-named synthetic registration can be denied.
 *
 * It runs as its own process (`pnpm nx run pi-tiered-subagents:mcp-check`)
 * because Pi's built-in MCP extension loads its client lazily through its own
 * module graph, which Vitest's transform pipeline does not reproduce. The
 * check is offline and deterministic: no model call, no network, and the
 * server is a local child process.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { defaultDefinition } from "#src/agents/definition";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import {
  createSubagentSession,
  type SubagentSessionDeps,
} from "#src/lifecycle/create-subagent-session";
import { buildAgentPrompt } from "#src/session/prompts";

const serverEntry = fileURLToPath(
  new URL(
    "../test/runtime-loader/fixtures/mcp-resource-server.mjs",
    import.meta.url,
  ),
);

const directory = await mkdtemp(join(tmpdir(), "pi-mcp-resources-"));
// The fixture server log is the evidence that a real transport started.
const serverLog = join(directory, "mcp-server.log");
// Pi's MCP extension reads mcp.json from the global agent directory; pointing
// that at the fixture keeps an operator's own servers out of this check.
process.env.PI_CODING_AGENT_DIR = directory;
await writeFile(
  join(directory, "mcp.json"),
  JSON.stringify({
    mcpServers: {
      fixture: { command: process.execPath, args: [serverEntry, serverLog] },
    },
  }),
);

try {
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
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
      getAgentDir: () => directory,
      deriveSessionDir: () => directory,
      createSessionManager: () => SessionManager.inMemory(directory),
      createSettingsManager: () => settings,
      createLoaderSettingsManager: (parent) => parent,
      createResourceLoader: (options) =>
        new DefaultResourceLoader({ ...options }),
      createSession: ({
        sessionManager,
        resourceLoader,
        modelRegistry: _ignoredRegistry,
        ...options
      }) => {
        void _ignoredRegistry;
        return createAgentSession({
          ...options,
          sessionManager: sessionManager as SessionManager,
          resourceLoader: resourceLoader as ResourceLoader,
          modelRuntime: runtime,
        });
      },
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

  const child = await createSubagentSession(
    {
      snapshot: {
        cwd: directory,
        systemPrompt: "offline",
        activeToolNames: [],
        registeredToolNames: [],
      },
      type: "fixture",
      toolNames: ["list_mcp_resources", "read_mcp_resource"],
      turnPolicy: { kind: "unlimited" },
    },
    deps,
  );

  try {
    // Pi's MCP extension connects on the event loop after session_start, so the
    // resource tools appear once the transport is up.
    const deadline = Date.now() + 15_000;
    while (
      !child.getToolDefinition("read_mcp_resource") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(
      child.getToolDefinition("list_mcp_resources"),
      "list_mcp_resources was not registered by the MCP built-in",
    );
    const read = child.getToolDefinition("read_mcp_resource");
    assert.ok(read, "read_mcp_resource was not registered by the MCP built-in");

    const context = child.session.extensionRunner.createToolContext(
      "mcp-resource-call",
      undefined,
    );
    const list = child.getToolDefinition("list_mcp_resources");
    assert.ok(list, "list_mcp_resources was not registered");
    const listed = await list.execute(
      "mcp-resource-list",
      {},
      new AbortController().signal,
      undefined,
      context,
    );
    assert.match(JSON.stringify(listed?.content), /fixture:\/\/greeting/);
    const result = await read.execute(
      "mcp-resource-call",
      { server: "fixture", uri: "fixture://greeting" },
      new AbortController().signal,
      undefined,
      context,
    );
    assert.equal(result?.isError, undefined, "reading the resource failed");
    // The server's resource text reaches the model as tool content.
    assert.match(
      JSON.stringify(result?.content),
      /hello from the fixture resource/,
    );

    // The server tool namespace stays unavailable: this child may read
    // resources, not call MCP tools.
    assert.deepEqual(
      child.session
        .getActiveToolNames()
        .filter((name) => name.startsWith("mcp__")),
      [],
    );

    const log = await readFile(serverLog, "utf8");
    assert.match(log, /request initialize/);
    assert.match(log, /request resources\/list/);
    assert.match(log, /request resources\/read/);
    console.log(
      "mcp-check: a real stdio MCP server served a resource-only child",
    );
  } finally {
    await child.dispose();
  }
} finally {
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
