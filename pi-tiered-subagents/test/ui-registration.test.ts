/**
 * Story 93: load the runtime's actual source entry with Pi's loader, then use
 * the registrations it produces. No UI-module or extension-factory mocks.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  initTheme,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionError,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const entry = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected runtime UI registration");
  return value;
}

describe("runtime-loaded UI registrations (offline SDK)", () => {
  let directory: string;
  let runner: ExtensionRunner | undefined;
  let sessions: SessionManager | undefined;
  const errors: ExtensionError[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-ui-registration-"));
    const agentDir = join(directory, "agent");
    await mkdir(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    // The extension's settings use the host process cwd, as a real Pi launch
    // does. Isolate that factory-time capture without changing the process cwd.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      const models = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const loaded = await discoverAndLoadExtensions(
        [entry],
        directory,
        agentDir,
      );
      sessions = SessionManager.inMemory(directory);
      runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime,
        directory,
        sessions,
        new ModelRegistry(models),
      );
      runner.onError((error) => errors.push(error));
      expect(loaded.errors).toEqual([]);
      expect(
        loaded.extensions.map((extension) => extension.resolvedPath),
      ).toEqual([entry]);
      initTheme(undefined, false);
    } finally {
      cwd.mockRestore();
    }
  }, 30_000);

  afterAll(async () => {
    try {
      if (runner) {
        await runner.emit({ type: "session_shutdown", reason: "quit" });
        expect(errors).toEqual([]);
      }
    } finally {
      runner?.invalidate();
      vi.unstubAllEnvs();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  it("loads completion rendering from the runtime entry alone", () => {
    const runtime = required(runner);
    const renderer = required(
      runtime.getMessageRenderer("subagent-notification"),
    );
    const component = required(
      renderer(
        {
          role: "custom",
          customType: "subagent-notification",
          content: "Child finished",
          display: true,
          details: {
            description: "Loaded UI completion",
            status: "completed",
            toolUses: 2,
            totalTokens: 300,
            durationMs: 1000,
            resultPreview: "Source-loaded child result",
          },
          timestamp: 0,
        },
        { expanded: true, outputPad: 0 },
        runtime.getUIContext().theme,
      ),
    );
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("Loaded UI completion");
    expect(rendered).toContain("Source-loaded child result");
  });

  it.each([
    {
      customType: "subagent-update",
      details: {
        description: "Loaded update",
        message: "Investigation continues",
      },
      expected: "Investigation continues",
    },
    {
      customType: "subagent-workspace-notice",
      details: {
        description: "Loaded workspace",
        notice: "Worktree retained for inspection",
      },
      expected: "Worktree retained for inspection",
    },
  ])("loads $customType rendering from the same runtime entry", ({
    customType,
    details,
    expected,
  }) => {
    const runtime = required(runner);
    const renderer = required(runtime.getMessageRenderer(customType));
    const component = required(
      renderer(
        {
          role: "custom",
          customType,
          details,
          content: expected,
          display: true,
          timestamp: 0,
        },
        { expanded: true, outputPad: 0 },
        runtime.getUIContext().theme,
      ),
    );
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain(details.description);
    expect(rendered).toContain(expected);
  });

  it.each([
    {
      name: "subagent",
      args: { subagent_type: "worker", description: "Source-loaded task" },
      title: "Worker",
      details: {
        displayName: "Worker",
        description: "Source-loaded task",
        subagentType: "worker",
        toolUses: 3,
        tokens: "100 token",
        durationMs: 1000,
        status: "completed",
      },
    },
    {
      name: "get_subagent_result",
      args: { agent_id: "child-1", wait: true },
      title: "Get Agent Result",
      details: {
        agentId: "child-1",
        displayName: "Worker",
        status: "completed",
        description: "Source-loaded task",
        toolUses: 3,
        tokens: "100 token",
        contextPercent: null,
        compactionCount: 0,
        duration: "1.0s",
        verbose: false,
      },
    },
  ])("attaches working call/result renderers to $name", ({
    name,
    args,
    title,
    details,
  }) => {
    const runtime = required(runner);
    const tool = required(runtime.getToolDefinition(name));
    const renderCall = required(tool.renderCall);
    const renderResult = required(tool.renderResult);
    const theme = runtime.getUIContext().theme;
    const context = {
      args,
      toolCallId: "registered-call",
      invalidate: () => {},
      lastComponent: undefined,
      state: {},
      cwd: directory,
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: true,
      showImages: false,
      isError: false,
      durationMs: 1000,
      outputPad: 0,
    } satisfies Parameters<typeof renderCall>[2];
    expect(renderCall(args, theme, context).render(120).join("\n")).toContain(
      title,
    );
    const result = renderResult(
      {
        content: [{ type: "text", text: "Source-loaded result body" }],
        details,
      },
      { expanded: true, isPartial: false },
      theme,
      context,
    );
    expect(result.render(120).join("\n")).toContain(
      "Source-loaded result body",
    );
  });

  it("opens the settings view through the runtime's registered command", async () => {
    const runtime = required(runner);
    const select = vi.fn<ExtensionUIContext["select"]>(async () => undefined);
    runtime.setUIContext({ ...runtime.getUIContext(), select }, "tui");
    const command = required(runtime.getCommand("subagents:settings"));
    await command.handler("", runtime.createCommandContext());
    expect(select.mock.calls[0]?.slice(0, 2)).toEqual([
      "Settings",
      expect.arrayContaining([
        expect.stringMatching(/^Max concurrency \(current: /),
        expect.stringMatching(/^Default max turns \(current: /),
      ]),
    ]);
  });

  it("opens recorded transcripts through the runtime's registered command", async () => {
    const runtime = required(runner);
    required(sessions).appendCustomEntry("subagents:record", {
      id: "previous-child",
      type: "worker",
      description: "Previous session task",
      status: "completed",
      result: "done",
      startedAt: 1000,
      completedAt: 4000,
      outputFile: join(directory, "previous-child.jsonl"),
      toolUses: 5,
    });
    const select = vi.fn<ExtensionUIContext["select"]>(async () => undefined);
    runtime.setUIContext({ ...runtime.getUIContext(), select }, "tui");
    const command = required(runtime.getCommand("subagents:sessions"));
    await command.handler("", runtime.createCommandContext());
    expect(select.mock.calls[0]?.slice(0, 2)).toEqual([
      "Subagent sessions",
      [
        "Worker (Previous session task) · 5 tools · completed · 3.0s · session released (snapshot)",
      ],
    ]);
  });
});
