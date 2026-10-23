/**
 * The nth recorded entry of a mock — a call tuple, a result, or an order stamp.
 *
 * Every use is preceded by an assertion that the call happened, so "no call"
 * is a failed expectation rather than something the type system must allow for.
 */
function callAt<T>(values: readonly T[], index = 0): T {
  const value = values[index];
  if (value === undefined)
    throw new Error(`expected entry #${index} to be recorded`);
  return value;
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateSessionOptions,
  ResourceLoaderOptions,
} from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { STUB_CTX, STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  createAgentLookup,
  createChildLifecycleMock,
  createFactorySession,
  createSubagentSessionDeps,
  createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

/**
 * The context a custom tool's `execute` receives, derived from the call it
 * feeds so the stub fits whichever context type the installed SDK declares.
 */
type ExecuteCtx = Parameters<
  NonNullable<CreateSessionOptions["customTools"]>[number]["execute"]
>[4];

/** Mock AgentConfigLookup. */
const mockAgentLookup = createAgentLookup();

let io: ReturnType<typeof createSubagentSessionIO>;

const exec = vi.fn();

beforeEach(() => {
  io = createSubagentSessionIO();
});

/** Arrange: build a factory session and wire it as the created session. Returns it for assertions. */
function arrangeFactory() {
  const session = createFactorySession();
  io.createSession.mockResolvedValue({ session });
  return session;
}

/** The standard deps bag for the default `io`/`exec`/`registry` wiring. */
function defaultDeps() {
  return createSubagentSessionDeps({ io, exec, registry: mockAgentLookup });
}

describe("createSubagentSession — assembly", () => {
  let session: ReturnType<typeof createFactorySession>;

  beforeEach(() => {
    session = createFactorySession();
    io.createSession.mockResolvedValue({ session });
  });

  it("returns a born-complete SubagentSession wrapping the created session", async () => {
    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(sub).toBeInstanceOf(SubagentSession);
    expect(sub.session).toBe(session);
  });

  it("enforces the ceiling the door resolved, without merging another default", async () => {
    // The door already resolved request → definition → operator default. The
    // session enforces that decision; a definition or setting that says
    // something else must not re-decide the budget here.
    const sub = await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        turnPolicy: { kind: "limited", maxTurns: 4, wrapUpTurns: 3 },
      },
      createSubagentSessionDeps({
        io,
        exec,
        registry: createAgentLookup({ maxTurns: 7 }),
      }),
    );

    const result = await sub.runTurnLoop("go", {});

    expect(result.turnBudget).toEqual({
      maxTurns: 4,
      used: 0,
      phase: "within",
    });
  });

  it("does not limit a run the door resolved as unlimited", async () => {
    const sub = await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        turnPolicy: UNLIMITED_TURNS,
      },
      createSubagentSessionDeps({
        io,
        exec,
        registry: createAgentLookup({ maxTurns: 7 }),
      }),
    );

    const result = await sub.runTurnLoop("go", {});

    expect(result.turnBudget).toEqual({ used: 0, phase: "within" });
  });

  it("exposes the persisted session file as outputFile", async () => {
    const sub = await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(sub.outputFile).toBe("/sessions/child.jsonl");
  });

  it("binds extensions before returning", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(session.bindExtensions).toHaveBeenCalledTimes(1);
    expect(session.bindExtensions).toHaveBeenCalledWith({});
  });

  it("passes the effective cwd and agentDir to the loader, settings, and session", async () => {
    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        turnPolicy: UNLIMITED_TURNS,
        cwd: "/tmp/worktree",
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.getAgentDir).toHaveBeenCalledTimes(1);
    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/worktree",
        agentDir: "/mock/agent-dir",
      }),
    );
    expect(io.createSettingsManager).toHaveBeenCalledWith(
      "/tmp/worktree",
      "/mock/agent-dir",
    );
    expect(io.createSessionManager).toHaveBeenCalledWith(
      "/tmp/worktree",
      "/mock/session-dir/tasks",
    );
    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/worktree",
        agentDir: "/mock/agent-dir",
      }),
    );
  });

  it("gives the resource loader the derived settings view, not the session's own", async () => {
    const sessionSettings = { marker: "session" };
    const loaderSettings = { marker: "loader" };
    io.createSettingsManager.mockReturnValue(sessionSettings);
    io.createLoaderSettingsManager.mockReturnValue(loaderSettings);

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    // No capture on this path: the second argument is present-but-undefined,
    // telling the factory to read the current setting as before.
    expect(io.createLoaderSettingsManager).toHaveBeenCalledWith(
      sessionSettings,
      undefined,
    );
    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({ settingsManager: loaderSettings }),
    );
    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ settingsManager: sessionSettings }),
    );
  });

  it("hands the launch-captured exclusion list to the loader settings view", async () => {
    const sessionSettings = { marker: "session" };
    io.createSettingsManager.mockReturnValue(sessionSettings);

    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        type: "Explore",
        turnPolicy: UNLIMITED_TURNS,
        childShaping: {
          midRunUpdates: true,
          excludedExtensionPackages: ["captured-package"],
          promptInheritance: {},
        },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    // The list travels with the launch: the factory passes it on rather than
    // letting the composition root read the current setting at creation time.
    expect(io.createLoaderSettingsManager).toHaveBeenCalledWith(
      sessionSettings,
      ["captured-package"],
    );
  });

  it("creates the session's settings manager exactly once and reuses it", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.createSettingsManager).toHaveBeenCalledTimes(1);
    expect(io.createLoaderSettingsManager).toHaveBeenCalledTimes(1);
  });

  it("suppresses AGENTS.md/CLAUDE.md/APPEND_SYSTEM.md for subagents", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    expect(io.createResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noContextFiles: true,
        appendSystemPromptOverride: expect.any(Function),
      }),
    );
    const loaderOpts = callAt(io.createResourceLoader.mock.calls)[0];
    expect(loaderOpts.appendSystemPromptOverride()).toEqual([]);
  });

  it("calls newSession with parentSession when parentSessionId is provided", async () => {
    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        turnPolicy: UNLIMITED_TURNS,
        type: "Explore",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-id-123",
        },
      },
      createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
    );

    const sm = callAt(io.createSessionManager.mock.results).value;
    expect(sm.newSession).toHaveBeenCalledWith({
      parentSession: "parent-id-123",
    });
  });
});

describe("createSubagentSession — lifecycle ordering", () => {
  let session: ReturnType<typeof createFactorySession>;
  let lifecycle: ReturnType<typeof createChildLifecycleMock>;

  beforeEach(() => {
    session = createFactorySession();
    io.createSession.mockResolvedValue({ session });
    lifecycle = createChildLifecycleMock();
  });

  it("emits spawning before session-created", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.spawning).toHaveBeenCalledOnce();
    const spawnOrder = callAt(lifecycle.spawning.mock.invocationCallOrder);
    const createdOrder = callAt(
      lifecycle.sessionCreated.mock.invocationCallOrder,
    );
    expect(spawnOrder).toBeLessThan(createdOrder);
  });

  it("emits session-created before bindExtensions()", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.sessionCreated).toHaveBeenCalledOnce();
    const createdOrder = callAt(
      lifecycle.sessionCreated.mock.invocationCallOrder,
    );
    const bindOrder = callAt(session.bindExtensions.mock.invocationCallOrder);
    expect(createdOrder).toBeLessThan(bindOrder);
  });

  it("emits bound after bindExtensions()", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.bound).toHaveBeenCalledOnce();
    const bindOrder = callAt(session.bindExtensions.mock.invocationCallOrder);
    const boundOrder = callAt(lifecycle.bound.mock.invocationCallOrder);
    expect(bindOrder).toBeLessThan(boundOrder);
  });

  it("carries the session id and parent session id in bound", async () => {
    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        turnPolicy: UNLIMITED_TURNS,
        type: "Explore",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-session-42",
        },
      },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.bound).toHaveBeenCalledWith({
      sessionId: "child-session-id",
      parentSessionId: "parent-session-42",
    });
  });

  it("carries the session id and parent session id in session-created", async () => {
    io.deriveSessionDir.mockReturnValue("/custom/session/dir");

    await createSubagentSession(
      {
        snapshot: STUB_SNAPSHOT,
        turnPolicy: UNLIMITED_TURNS,
        type: "Explore",
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-session-42",
        },
      },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.sessionCreated).toHaveBeenCalledWith({
      sessionId: "child-session-id",
      parentSessionId: "parent-session-42",
    });
  });

  it("does not emit completed or disposed during creation", async () => {
    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        lifecycle,
      }),
    );

    expect(lifecycle.completed).not.toHaveBeenCalled();
    expect(lifecycle.disposed).not.toHaveBeenCalled();
  });
});

describe("createSubagentSession — dispose on creation failure", () => {
  it("disposes the session and emits disposed when bindExtensions throws, then rethrows", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi
      .fn()
      .mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });
    io.deriveSessionDir.mockReturnValue("/custom/session/dir");
    const lifecycle = createChildLifecycleMock();

    await expect(
      createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
        },
        createSubagentSessionDeps({
          io,
          exec,
          registry: mockAgentLookup,
          lifecycle,
        }),
      ),
    ).rejects.toThrow("bind failed");

    // session-created fired, so disposed must fire to avoid a registry leak.
    expect(lifecycle.sessionCreated).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledWith({
      sessionId: "child-session-id",
    });
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("does not emit bound when bindExtensions throws", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi
      .fn()
      .mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });
    const lifecycle = createChildLifecycleMock();

    await expect(
      createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
        },
        createSubagentSessionDeps({
          io,
          exec,
          registry: mockAgentLookup,
          lifecycle,
        }),
      ),
    ).rejects.toThrow("bind failed");

    // The child never ran, so there is nothing to report about what its
    // extensions installed.
    expect(lifecycle.bound).not.toHaveBeenCalled();
  });

  it("shuts down the extensions that did initialize before the bind failed", async () => {
    const session = createFactorySession();
    session.bindExtensions = vi
      .fn()
      .mockRejectedValue(new Error("bind failed"));
    io.createSession.mockResolvedValue({ session });

    await expect(
      createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
        },
        createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
      ),
    ).rejects.toThrow("bind failed");

    expect(session.extensionRunner.emit).toHaveBeenCalledWith({
      type: "session_shutdown",
      reason: "quit",
    });
  });
});

describe("createSubagentSession — recursion guard", () => {
  // A child loads this extension too, so it registers the spawn tools during
  // bindExtensions. They are denied at the SDK boundary, which holds for the
  // child's whole life — a post-bind active-set filter would be undone by the
  // next tool-registry refresh (#725).

  it("denies this extension's spawn tools when creating the child session", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      defaultDeps(),
    );

    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTools: ["subagent", "get_subagent_result", "steer_subagent"],
      }),
    );
  });

  it("leaves the child's active tool set untouched after bind", async () => {
    const session = arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      defaultDeps(),
    );

    expect(session.setActiveToolsByName).not.toHaveBeenCalled();
  });
});

describe("createSubagentSession — the core's own child tools", () => {
  // The SDK applies `tools` as an allowlist *before* building the registry and
  // runs every `customTools` entry through it, so a custom tool whose name is
  // missing from the allowlist is dropped with no error (#725). Both halves are
  // asserted separately so dropping either one fails a test.

  describe("when the run supplies an ask-back recorder", () => {
    it("appends ask_parent to the allowlist the agent declared", async () => {
      arrangeFactory();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
          askParent: vi.fn(),
        },
        defaultDeps(),
      );

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["read", "ask_parent"] }),
      );
    });

    it("passes the ask_parent definition as a custom tool", async () => {
      arrangeFactory();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
          askParent: vi.fn(),
        },
        defaultDeps(),
      );

      const opts = callAt(
        io.createSession.mock.calls,
      )[0] as CreateSessionOptions;
      expect(opts.customTools?.map((tool) => tool.name)).toEqual([
        "ask_parent",
      ]);
    });

    it("appends over an agent that declared no tools at all", async () => {
      arrangeFactory();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
          askParent: vi.fn(),
        },
        createSubagentSessionDeps({
          io,
          exec,
          registry: createAgentLookup({
            tools: { kind: "explicit", names: [] },
          }),
        }),
      );

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["ask_parent"] }),
      );
    });

    it("routes a call on the installed tool to the supplied recorder", async () => {
      arrangeFactory();
      const askParent = vi.fn<(question: string) => void>();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
          askParent,
        },
        defaultDeps(),
      );

      const opts = callAt(
        io.createSession.mock.calls,
      )[0] as CreateSessionOptions;
      await opts.customTools?.[0]?.execute(
        "tc-1",
        { question: "Which config wins?" },
        new AbortController().signal,
        () => {},
        STUB_CTX as ExecuteCtx,
      );
      expect(askParent).toHaveBeenCalledWith("Which config wins?");
    });
  });

  describe("when the run supplies no callbacks", () => {
    it("leaves the agent's declared allowlist alone", async () => {
      arrangeFactory();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
        },
        defaultDeps(),
      );

      expect(io.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ["read"] }),
      );
    });

    it("installs no custom tools", async () => {
      arrangeFactory();

      await createSubagentSession(
        {
          snapshot: STUB_SNAPSHOT,
          type: "Explore",
          turnPolicy: UNLIMITED_TURNS,
        },
        defaultDeps(),
      );

      const opts = callAt(
        io.createSession.mock.calls,
      )[0] as CreateSessionOptions;
      expect(opts.customTools).toEqual([]);
    });
  });
});

describe("createSubagentSession — prompt inheritance", () => {
  /** The inherited-prompt argument the assembler handed the prompt builder. */
  function inheritedArgument() {
    return io.assemblerIO.buildAgentPrompt.mock.calls[0]?.[3];
  }

  it("hands the prompt builder the snapshot's portable parts", async () => {
    arrangeFactory();

    await createSubagentSession(
      {
        snapshot: { ...STUB_SNAPSHOT, portablePrompt: "You are a specialist." },
        type: "Explore",
        turnPolicy: UNLIMITED_TURNS,
      },
      defaultDeps(),
    );

    expect(inheritedArgument()?.portablePrompt).toBe("You are a specialist.");
  });

  it("applies the strategy the deps' resolver returns", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: mockAgentLookup,
        resolvePromptInheritance: () => "portable",
      }),
    );

    expect(inheritedArgument()?.strategy).toBe("portable");
  });
});

/** The names of the built-ins the child's resource loader was handed. */
function loadedBuiltinNames(): string[] | undefined {
  const opts = io.createResourceLoader.mock.calls[0]?.[0] as
    | ResourceLoaderOptions
    | undefined;
  return opts?.extensionFactories?.map((extension) =>
    typeof extension === "function" ? "<factory>" : extension.name,
  );
}

describe("createSubagentSession — Pi built-in extensions", () => {
  it("hands the loader the built-ins the agent's tools call for", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      createSubagentSessionDeps({
        io,
        exec,
        registry: createAgentLookup({
          tools: {
            kind: "explicit",
            names: ["read", "codemode", "mcp__github__get_issue"],
          },
        }),
      }),
    );

    expect(loadedBuiltinNames()).toEqual(["codemode", "mcp"]);
  });

  it("hands the loader no built-ins when the agent's tools call for none", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      defaultDeps(),
    );

    expect(loadedBuiltinNames()).toEqual([]);
  });
});

describe("createSubagentSession — MCP tool patterns", () => {
  const PARENT_TOOLS = [
    "read",
    "mcp__github__a",
    "mcp__github__b",
    "mcp__gitlab__c",
  ];

  function depsDeclaring(toolNames: string[], parentTools: string[]) {
    return createSubagentSessionDeps({
      io,
      exec,
      registry: createAgentLookup({
        tools: { kind: "explicit", names: toolNames },
      }),
      listParentToolNames: () => parentTools,
    });
  }

  it("admits the parent's tools a pattern matches, and loads MCP for them", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      depsDeclaring(["read", "mcp__github__*"], PARENT_TOOLS),
    );

    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["read", "mcp__github__a", "mcp__github__b"],
      }),
    );
    expect(loadedBuiltinNames()).toEqual(["mcp"]);
  });

  it("admits nothing and loads no MCP for a pattern the parent's tools do not match", async () => {
    arrangeFactory();

    await createSubagentSession(
      { snapshot: STUB_SNAPSHOT, type: "Explore", turnPolicy: UNLIMITED_TURNS },
      depsDeclaring(["read", "mcp__github__*"], ["read", "mcp__gitlab__c"]),
    );

    expect(io.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tools: ["read"] }),
    );
    expect(loadedBuiltinNames()).toEqual([]);
  });
});
