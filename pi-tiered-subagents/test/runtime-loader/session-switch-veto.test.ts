/**
 * Pi 1.3.0 session replacement regression.
 *
 * The SDK returns `{ cancelled: true }` from `newSession()` when a
 * `session_before_switch` handler vetoes. It does not emit `session_start`
 * or `session_shutdown` in that path, so the extension must leave its registered tools and accepted child state usable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type {
  SubagentToolOutput,
  GetResultToolOutput,
} from "#src/tools/structured-output";

const packageEntry = fileURLToPath(
  new URL("../../extensions/index.ts", import.meta.url),
);
const vetoEntry = fileURLToPath(
  new URL("./fixtures/veto-session-switch.ts", import.meta.url),
);

interface VetoFixtureControl {
  setVeto(value: boolean): void;
  releaseHeldResponse(): void;
}

const fixtureControlKey = Symbol.for(
  "@code-fixer-23/pi-tiered-subagents:runtime-loader-veto-fixture",
);

function getFixtureControl(): VetoFixtureControl {
  const control = (globalThis as Record<symbol, unknown>)[fixtureControlKey];
  if (!control) throw new Error("veto fixture control was not installed");
  return control as VetoFixtureControl;
}

/** Windows can still hold a session file for a moment after disposal. */
async function removeTempDir(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        // A leftover OS temp directory is not evidence about the behaviour
        // under test, so cleanup never turns a passing assertion into a failure.
        console.warn(`could not remove temp directory ${directory}`, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function createFixtureRuntime(directory: string) {
  return createAgentSessionRuntime(
    async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager: SettingsManager.inMemory(),
        modelRuntime: await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        }),
        resourceLoaderOptions: {
          additionalExtensionPaths: [packageEntry, vetoEntry],
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent: sessionStartEvent ?? {
          type: "session_start",
          reason: "startup",
        },
      });
      await created.session.bindExtensions({});
      return {
        ...created,
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd: directory,
      agentDir: directory,
      sessionManager: SessionManager.inMemory(directory),
    },
  );
}

async function invoke(
  runtime: Awaited<ReturnType<typeof createFixtureRuntime>>,
  name: string,
  params: Record<string, unknown>,
) {
  const runner = runtime.session.extensionRunner;
  const tool = runner.getToolDefinition(name);
  if (!tool) throw new Error(`missing registered tool ${name}`);
  const result = await tool.execute(
    "fixture-call",
    params,
    new AbortController().signal,
    undefined,
    runner.createToolContext("fixture-call", undefined),
  );
  if (!result?.structuredContent)
    throw new Error(`missing structured result from ${name}`);
  return result.structuredContent;
}

async function launch(
  runtime: Awaited<ReturnType<typeof createFixtureRuntime>>,
  prompt: string,
) {
  const output = (await invoke(runtime, "subagent", {
    prompt,
    description: "offline fixture",
    subagent_type: "explore",
    model: "offline-fixture/offline",
    run_in_background: true,
  })) as SubagentToolOutput;
  expect(output.outcome).toBe("accepted");
  if (!output.agentId)
    throw new Error(`launch failed: ${JSON.stringify(output)}`);
  return output.agentId;
}

async function result(
  runtime: Awaited<ReturnType<typeof createFixtureRuntime>>,
  id: string,
  wait = false,
) {
  return (await invoke(runtime, "get_subagent_result", {
    agent_id: id,
    wait,
  })) as GetResultToolOutput;
}

describe("Pi 1.3.0 vetoed session replacement", () => {
  it("keeps the launch and result tools usable after a veto", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-veto-"));
    const runtime = await createFixtureRuntime(directory);
    try {
      getFixtureControl().setVeto(true);
      const id = await launch(runtime, "offline regression");
      const before = await result(runtime, id, true);
      expect(before.status).toMatch(/^(completed|error|stopped)$/);
      expect(await runtime.newSession()).toEqual({ cancelled: true });
      expect(await result(runtime, id)).toMatchObject({
        found: true,
        agentId: id,
        status: before.status,
      });
      const next = await launch(runtime, "still usable");
      expect((await result(runtime, next, true)).found).toBe(true);
    } finally {
      await runtime.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("executes a child through the SDK and resumes its held session successfully", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-resume-"));
    const runtime = await createFixtureRuntime(directory);
    try {
      getFixtureControl().setVeto(true);
      const id = await launch(runtime, "ask and resume");
      expect(await result(runtime, id, true)).toMatchObject({
        status: "completed",
        pendingQuestion: "What should I do next?",
        result: "offline fixture waiting result",
      });
      const resumed = (await invoke(runtime, "subagent", {
        prompt: "Continue with the answer",
        description: "resume fixture",
        subagent_type: "explore",
        resume: id,
      })) as SubagentToolOutput;
      expect(resumed).toMatchObject({
        outcome: "completed",
        status: "completed",
        result: "offline fixture resumed result",
      });
      expect((await result(runtime, id)).pendingQuestion).toBeUndefined();
    } finally {
      await runtime.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("preserves an active child when replacement is vetoed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-veto-active-"));
    const runtime = await createFixtureRuntime(directory);
    const control = getFixtureControl();
    try {
      control.setVeto(true);
      const id = await launch(runtime, "hold active child");
      await vi.waitFor(async () =>
        expect((await result(runtime, id)).status).toMatch(
          /^(queued|running)$/,
        ),
      );
      expect(await runtime.newSession()).toEqual({ cancelled: true });
      expect(await result(runtime, id)).toMatchObject({
        found: true,
        agentId: id,
      });
      control.releaseHeldResponse();
      expect(await result(runtime, id, true)).toMatchObject({
        status: "completed",
        result: "offline fixture held result",
      });
    } finally {
      control.releaseHeldResponse();
      await runtime.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);

  it("replaces the runtime only after a confirmed session replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-replacement-"));
    const runtime = await createFixtureRuntime(directory);
    try {
      getFixtureControl().setVeto(false);
      const id = await launch(runtime, "confirmed replacement");
      await result(runtime, id, true);
      expect(await runtime.newSession()).toEqual({ cancelled: false });
      expect(await result(runtime, id)).toMatchObject({
        found: false,
        agentId: id,
      });
      const next = await launch(runtime, "new owner works");
      expect((await result(runtime, next, true)).found).toBe(true);
    } finally {
      await runtime.dispose();
      await removeTempDir(directory);
    }
  }, 30_000);
});
