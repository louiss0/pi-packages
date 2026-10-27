import { describe, expect, it, vi } from "vitest";
import {
  type LifecycleManager,
  type LifecycleRuntime,
  SessionLifecycleHandler,
} from "../../extensions/index";

function createHandler(manager: LifecycleManager, calls: string[]) {
  const runtime: LifecycleRuntime = {
    setSessionContext: vi.fn(),
    clearSessionContext: vi.fn(() => calls.push("clear-context")),
  };
  return new SessionLifecycleHandler(
    runtime,
    manager,
    () => calls.push("dispose-notifications"),
    () => calls.push("unpublish"),
    () => "parent",
  );
}

describe("SessionLifecycleHandler cleanup ownership", () => {
  it("shares concurrent shutdown, suppresses delivery before cancellation, and awaits disposal", async () => {
    const calls: string[] = [];
    const disposed = Promise.withResolvers<void>();
    const manager: LifecycleManager = {
      clearCompleted: vi.fn(() => Promise.resolve()),
      beginOwner: vi.fn(),
      beginOwnerEnd: vi.fn(),
      endOwner: vi.fn(() => {
        calls.push("end-owner");
      }),
      abortAll: vi.fn(() => calls.push("abort")),
      dispose: vi.fn(() => {
        calls.push("dispose");
        return disposed.promise;
      }),
    };
    const handler = createHandler(manager, calls);

    const first = handler.handleSessionShutdown();
    const second = handler.handleSessionShutdown();
    expect(first).toBe(second);
    await Promise.resolve();

    expect(calls).toEqual([
      "unpublish",
      "clear-context",
      "end-owner",
      "dispose-notifications",
      "abort",
      "dispose",
    ]);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    disposed.resolve();
    await Promise.all([first, second]);
    expect(manager.endOwner).toHaveBeenCalledOnce();
    expect(manager.abortAll).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("waits for confirmed replacement cleanup before releasing the new owner", async () => {
    const calls: string[] = [];
    const oldOwnerDisposed = Promise.withResolvers<void>();
    const manager: LifecycleManager = {
      clearCompleted: vi.fn(() => {
        calls.push("clear-completed");
        return Promise.resolve();
      }),
      beginOwner: vi.fn(() => {
        calls.push("begin-owner");
        return oldOwnerDisposed.promise;
      }),
      beginOwnerEnd: vi.fn(),
      endOwner: vi.fn(),
      abortAll: vi.fn(),
      dispose: vi.fn(() => Promise.resolve()),
    };
    const handler = createHandler(manager, calls);

    const started = handler.handleSessionStart({}, {});
    await Promise.resolve();
    expect(calls).toEqual(["begin-owner"]);

    oldOwnerDisposed.resolve();
    await started;
    expect(calls).toEqual(["begin-owner", "clear-completed"]);
  });
});
