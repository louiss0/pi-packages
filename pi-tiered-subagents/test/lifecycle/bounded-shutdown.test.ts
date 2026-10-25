import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { WorkspaceGateRegistry } from "#src/scheduling/gate";
import {
  createChildLifecycleMock,
  createFactorySession,
} from "#test/helpers/subagent-session-io";
import {
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";

describe("bounded child shutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds a hung shutdown handler and proceeds to SDK disposal", async () => {
    vi.useFakeTimers();
    const session = createFactorySession();
    session.extensionRunner.emit = vi.fn(
      (): Promise<unknown> => new Promise(() => {}),
    );
    const lifecycle = createChildLifecycleMock();
    const child = new SubagentSession(session as unknown as AgentSession, {
      sessionId: "child",
      sessionDir: "/child",
      agentName: "Explore",
      turnPolicy: UNLIMITED_TURNS,
      lifecycle,
    });

    const disposed = child.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    await disposed;

    expect(session.extensionRunner.emit).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledWith({ sessionId: "child" });
  });

  it("continues with SDK disposal after shutdown rejects", async () => {
    const session = createFactorySession();
    session.extensionRunner.emit = vi.fn(() => Promise.reject(new Error("no")));
    const lifecycle = createChildLifecycleMock();
    const child = new SubagentSession(session as unknown as AgentSession, {
      sessionId: "child",
      sessionDir: "/child",
      agentName: "Explore",
      turnPolicy: UNLIMITED_TURNS,
      lifecycle,
    });

    await child.dispose();

    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
  });

  it("continues disposing owner siblings when one child teardown rejects", async () => {
    const first = createSubagentSessionStub();
    const second = createSubagentSessionStub();
    first.dispose.mockRejectedValueOnce(new Error("first child failed"));
    const sessions = [first, second];
    const manager = new SubagentManager({
      createSubagentSession: vi.fn(
        async (_params: CreateSubagentSessionParams) =>
          toSubagentSession(
            sessions.shift() ??
              (() => {
                throw new Error("unexpected child");
              })(),
          ),
      ),
      limiter: new ConcurrencyLimiter(() => 2),
      baseCwd: "/repo",
      registry: new AgentRegistry(() => ({
        global: { definitions: [], errors: [] },
        project: { definitions: [], errors: [] },
      })),
      workspaceGates: new WorkspaceGateRegistry(),
    });
    await manager.beginOwner("parent");
    const owner = manager.currentOwner();
    if (!owner) throw new Error("expected active owner");
    for (const prompt of ["one", "two"]) {
      manager.spawn(STUB_SNAPSHOT, "explore", prompt, {
        description: prompt,
        turnPolicy: UNLIMITED_TURNS,
        background: { kind: "explicit", isBackground: true },
        owner,
      });
    }
    await vi.waitFor(() => expect(manager.listAgents()).toHaveLength(2));

    await manager.endOwner();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("makes concurrent child disposal wait for the one teardown", async () => {
    const session = createFactorySession();
    const shutdown = Promise.withResolvers<unknown>();
    session.extensionRunner.emit = vi.fn(() => shutdown.promise);
    const lifecycle = createChildLifecycleMock();
    const child = new SubagentSession(session as unknown as AgentSession, {
      sessionId: "child",
      sessionDir: "/child",
      agentName: "Explore",
      turnPolicy: UNLIMITED_TURNS,
      lifecycle,
    });

    const first = child.dispose();
    const second = child.dispose();
    expect(session.dispose).not.toHaveBeenCalled();
    shutdown.resolve(undefined);
    await Promise.all([first, second]);

    expect(session.extensionRunner.emit).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.disposed).toHaveBeenCalledOnce();
  });
});
