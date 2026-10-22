/**
 * The workspace's exclusive slot, exercised through the manager.
 *
 * The rule is about children that may change files competing for the same
 * files. These tests go through the manager — the choke point every front
 * door shares — and watch the children themselves: what ran, when it ran, and
 * what waited.
 */
import { describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "#src/agents/registry";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { WorkspaceGateRegistry } from "#src/scheduling/gate";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import {
  createSubagentSessionStub,
  toSubagentSession,
} from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { turnLoopResult } from "#test/helpers/turn-loop-result";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";

/** The tools a specialist gets, as the shipped definitions give them. */
const READ_ONLY = ["read", "grep", "find", "ls"];

/** A registry whose named specialists get the tools named here. */
function registryWithTools(tools: Record<string, string[]>): AgentRegistry {
  return new AgentRegistry(() => ({
    global: {
      definitions: Object.entries(tools).map(([id, names]) => ({
        id,
        patch: { tools: { kind: "explicit" as const, names } },
        path: `${id}.md`,
      })),
      errors: [],
    },
    project: { definitions: [], errors: [] },
  }));
}

/** A parent whose active tools include a shell — the default in the tests. */
const WRITING_SNAPSHOT = {
  ...STUB_SNAPSHOT,
  activeToolNames: ["read", "bash", "edit"],
};

/**
 * A manager whose children run the given turn loop.
 *
 * Each child's turn loop waits for the gate it is given, so a test can hold
 * one child running while it watches another wait.
 */
function createManager(
  tools: Record<string, string[]>,
  turns: Array<() => Promise<void>>,
  options: { registry?: WorkspaceGateRegistry; maxConcurrent?: number } = {},
) {
  let index = 0;
  const factory = vi.fn(async (_params: CreateSubagentSessionParams) => {
    const turn = turns[index++];
    const stub = createSubagentSessionStub();
    if (turn) {
      stub.runTurnLoop.mockImplementation(async () => {
        await turn();
        return turnLoopResult({ responseText: "done" });
      });
    }
    return toSubagentSession(stub) as SubagentSession;
  });
  const manager = new SubagentManager({
    createSubagentSession: factory,
    limiter: new ConcurrencyLimiter(() => options.maxConcurrent ?? 4),
    baseCwd: "/repo",
    registry: registryWithTools(tools),
    workspaceGates: options.registry ?? registryFor(),
  });
  return { manager, factory };
}

/**
 * A registry the test holds on to, so it can look at the gate the manager
 * uses.
 *
 * One test's children never hold the slot another test's children wait for:
 * every manager gets a registry of its own.
 */
function registryFor(): WorkspaceGateRegistry {
  return new WorkspaceGateRegistry();
}

/** Spawn a background child of the given type. */
function spawnBg(manager: SubagentManager, type: string, prompt: string) {
  return manager.spawn(WRITING_SNAPSHOT, type, prompt, {
    description: prompt,
    turnPolicy: UNLIMITED_TURNS,
    background: { kind: "explicit", isBackground: true },
  });
}

describe("children that may change files", () => {
  it("do not run at the same time", async () => {
    const first = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        started.push("first");
        await first.promise.promise;
      },
      async () => {
        started.push("second");
      },
    ]);

    const id1 = spawnBg(manager, "writer", "first");
    const id2 = spawnBg(manager, "writer", "second");

    // The second child waits for the first to finish.
    await vi.waitFor(() => expect(started).toEqual(["first"]));
    expect(manager.getRecord(id2)!.status).toBe("queued");

    first.promise.resolve();
    await manager.getRecord(id1)!.promise;
    await manager.getRecord(id2)!.promise;

    expect(started).toEqual(["first", "second"]);
  });

  it("run alongside a child that only reads", async () => {
    const writer = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const { manager } = createManager(
      { writer: ["read", "bash"], reader: READ_ONLY },
      [
        async () => {
          started.push("writer");
          await writer.promise.promise;
        },
        async () => {
          started.push("reader");
        },
      ],
    );

    const id1 = spawnBg(manager, "writer", "writer");
    const id2 = spawnBg(manager, "reader", "reader");

    await manager.getRecord(id2)!.promise;
    expect(started).toEqual(["writer", "reader"]);

    writer.promise.resolve();
    await manager.getRecord(id1)!.promise;
  });

  it("are decided by the tools the child really has, not by its name", async () => {
    // A specialist whose tools were narrowed to reading only takes no slot,
    // whatever it is called.
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const { manager } = createManager(
      { writer: ["read", "bash"], narrowed: READ_ONLY },
      [
        async () => {
          started.push("writer");
          await holder.promise.promise;
        },
        async () => {
          started.push("narrowed");
        },
      ],
    );

    const id1 = spawnBg(manager, "writer", "writer");
    const id2 = spawnBg(manager, "narrowed", "narrowed");

    await manager.getRecord(id2)!.promise;
    expect(started).toEqual(["writer", "narrowed"]);

    holder.promise.resolve();
    await manager.getRecord(id1)!.promise;
  });

  it("wait for a foreground child too", async () => {
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        started.push("holder");
        await holder.promise.promise;
      },
      async () => {
        started.push("foreground");
      },
    ]);

    spawnBg(manager, "writer", "holder");
    const pending = manager.spawnAndWait(WRITING_SNAPSHOT, "writer", "now", {
      description: "foreground",
      turnPolicy: UNLIMITED_TURNS,
    });

    await vi.waitFor(() => expect(started).toEqual(["holder"]));

    holder.promise.resolve();
    const record = await pending;
    expect(started).toEqual(["holder", "foreground"]);
    expect(record.status).toBe("completed");
  });

  it("never run a child whose wait for the slot was cancelled", async () => {
    // The parent's signal fires while the child waits for the slot: the child
    // ends its turn without taking the slot, and the holder keeps it.
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const controller = new AbortController();
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        started.push("holder");
        await holder.promise.promise;
      },
      async () => {
        started.push("cancelled");
      },
    ]);

    const id1 = spawnBg(manager, "writer", "holder");
    await vi.waitFor(() => expect(started).toEqual(["holder"]));

    // The second child waits for the slot; its parent's signal fires.
    const id2 = manager.spawn(WRITING_SNAPSHOT, "writer", "cancelled", {
      description: "cancelled",
      turnPolicy: UNLIMITED_TURNS,
      background: { kind: "explicit", isBackground: true },
      signal: controller.signal,
    });
    controller.abort();

    await manager.getRecord(id2)!.promise;
    expect(started).toEqual(["holder"]);

    holder.promise.resolve();
    await manager.getRecord(id1)!.promise;
  });

  it("give the slot up when a child is aborted", async () => {
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        started.push("holder");
        await holder.promise.promise;
      },
      async () => {
        started.push("second");
      },
    ]);

    const id1 = spawnBg(manager, "writer", "holder");
    const id2 = spawnBg(manager, "writer", "second");

    // The waiting child is stopped before it ever runs.
    expect(manager.abort(id2)).toBe(true);
    expect(manager.getRecord(id2)!.status).toBe("stopped");

    holder.promise.resolve();
    await manager.getRecord(id1)!.promise;

    expect(started).toEqual(["holder"]);
  });

  it("give the slot up when a child fails", async () => {
    const started: string[] = [];
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        started.push("failing");
        throw new Error("the child failed");
      },
      async () => {
        started.push("next");
      },
    ]);

    const id1 = spawnBg(manager, "writer", "failing");
    await manager.getRecord(id1)!.promise;
    expect(manager.getRecord(id1)!.status).toBe("error");

    const id2 = spawnBg(manager, "writer", "next");
    await manager.getRecord(id2)!.promise;
    expect(started).toEqual(["failing", "next"]);
  });

  it("take the slot only when the child is about to run", async () => {
    // A child waiting for a concurrency slot holds no workspace slot: it is
    // not running, so it competes with nobody.
    const holder = { promise: Promise.withResolvers<void>() };
    const registry = registryFor();
    const { manager } = createManager(
      { writer: ["read", "bash"] },
      [
        async () => {
          await holder.promise.promise;
        },
        async () => {
          await holder.promise.promise;
        },
        async () => {
          await holder.promise.promise;
        },
      ],
      { registry, maxConcurrent: 2 },
    );
    const gate = registry.gateFor(WRITING_SNAPSHOT.cwd);

    const id1 = spawnBg(manager, "writer", "one");
    const id2 = spawnBg(manager, "writer", "two");
    const id3 = spawnBg(manager, "writer", "three");

    await vi.waitFor(() => expect(gate.holderId).toBe(id1));
    // The second child waits for the slot; the third is still queued for a
    // concurrency slot and never asked for the workspace slot at all.
    expect(gate.waitingCount).toBe(1);

    holder.promise.resolve();
    await manager.getRecord(id1)!.promise;
    await manager.getRecord(id2)!.promise;
    await manager.getRecord(id3)!.promise;
  });

  it("take the slot again for a resumed child", async () => {
    // The first run is over; another child holds the slot; the resume waits
    // for it, because a resumed child may change files just as its first run
    // could.
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    let runs = 0;
    const { manager } = createManager({ writer: ["read", "bash"] }, [
      async () => {
        runs += 1;
        started.push(`run-${runs}`);
      },
      async () => {
        started.push("holder");
        await holder.promise.promise;
      },
    ]);

    const id = spawnBg(manager, "writer", "first");
    await manager.getRecord(id)!.promise;
    await vi.waitFor(() => expect(started).toEqual(["run-1"]));

    const holderId = spawnBg(manager, "writer", "holder");
    await vi.waitFor(() => expect(started).toEqual(["run-1", "holder"]));

    manager.startResume(id, "again", { background: false });
    expect(manager.getRecord(id)!.status).toBe("queued");

    holder.promise.resolve();
    await manager.getRecord(holderId)!.promise;
    await manager.getRecord(id)!.promise;

    await vi.waitFor(() =>
      expect(started).toEqual(["run-1", "holder", "run-2"]),
    );
  });

  it("give the child exactly the tools it was classified by", async () => {
    // The tools are resolved once, at the request, and travel with the
    // child: the runtime and the child cannot disagree about what it may do.
    const { manager, factory } = createManager({ writer: ["read", "bash"] }, [
      async () => {},
    ]);

    const id = spawnBg(manager, "writer", "one");
    await manager.getRecord(id)!.promise;

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ toolNames: ["read", "bash"] }),
    );
  });

  it("share one slot between two parents in the same workspace", async () => {
    // Two managers, no gate of their own: the workspace's own gate is used,
    // so the children of both compete for the same files.
    const cwd = `/shared-${Date.now()}`;
    const holder = { promise: Promise.withResolvers<void>() };
    const started: string[] = [];
    const turns = [
      async () => {
        started.push("first parent");
        await holder.promise.promise;
      },
      async () => {
        started.push("second parent");
      },
    ];
    let index = 0;
    const factory = vi.fn(async () => {
      const turn = turns[index++];
      const stub = createSubagentSessionStub();
      stub.runTurnLoop.mockImplementation(async () => {
        await turn();
        return turnLoopResult({ responseText: "done" });
      });
      return toSubagentSession(stub) as SubagentSession;
    });
    const make = () =>
      new SubagentManager({
        createSubagentSession: factory,
        limiter: new ConcurrencyLimiter(() => 4),
        baseCwd: cwd,
        registry: registryWithTools({ writer: ["read", "bash"] }),
        workspaceGates: gates,
      });

    const gates = new WorkspaceGateRegistry();
    const first = make();
    const second = make();
    const snapshot = { ...WRITING_SNAPSHOT, cwd };

    const id1 = first.spawn(snapshot, "writer", "one", {
      description: "one",
      turnPolicy: UNLIMITED_TURNS,
      background: { kind: "explicit", isBackground: true },
    });
    const id2 = second.spawn(snapshot, "writer", "two", {
      description: "two",
      turnPolicy: UNLIMITED_TURNS,
      background: { kind: "explicit", isBackground: true },
    });

    await vi.waitFor(() => expect(started).toEqual(["first parent"]));

    holder.promise.resolve();
    await first.getRecord(id1)!.promise;
    await second.getRecord(id2)!.promise;

    expect(started).toEqual(["first parent", "second parent"]);
  });
});
