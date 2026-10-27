import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LifecycleManager,
  LifecycleRuntime,
} from "../../extensions/index";
import { SessionLifecycleHandler } from "../../extensions/index";

describe("SessionLifecycleHandler", () => {
  let runtime: LifecycleRuntime;
  let manager: LifecycleManager;
  let mockSetSessionContext: ReturnType<
    typeof vi.fn<LifecycleRuntime["setSessionContext"]>
  >;
  let mockClearSessionContext: ReturnType<
    typeof vi.fn<LifecycleRuntime["clearSessionContext"]>
  >;
  let mockClearCompleted: ReturnType<
    typeof vi.fn<LifecycleManager["clearCompleted"]>
  >;
  let mockAbortAll: ReturnType<typeof vi.fn<LifecycleManager["abortAll"]>>;
  let mockDispose: ReturnType<typeof vi.fn<LifecycleManager["dispose"]>>;
  let mockDisposeNotifications: ReturnType<typeof vi.fn<() => void>>;
  let mockUnpublishService: ReturnType<typeof vi.fn<() => void>>;
  let handler: SessionLifecycleHandler;

  beforeEach(() => {
    mockSetSessionContext = vi.fn();
    mockClearSessionContext = vi.fn();
    mockClearCompleted = vi.fn(() => Promise.resolve());
    mockAbortAll = vi.fn();
    mockDispose = vi.fn(() => Promise.resolve());
    mockDisposeNotifications = vi.fn();
    mockUnpublishService = vi.fn();

    runtime = {
      setSessionContext: mockSetSessionContext,
      clearSessionContext: mockClearSessionContext,
    };
    manager = {
      clearCompleted: mockClearCompleted,
      abortAll: mockAbortAll,
      dispose: mockDispose,
      beginOwner: vi.fn(),
      beginOwnerEnd: vi.fn(),
      endOwner: vi.fn(),
    };

    handler = new SessionLifecycleHandler(
      runtime,
      manager,
      mockDisposeNotifications,
      mockUnpublishService,
      (ctx) => (ctx as { id?: string }).id ?? "session-1",
    );
  });

  describe("handleSessionStart", () => {
    it("sets session context and clears completed agents", async () => {
      const ctx = { cwd: "/some/path" };

      await handler.handleSessionStart({}, ctx);

      expect(runtime.setSessionContext).toHaveBeenCalledWith(ctx);
      expect(manager.clearCompleted).toHaveBeenCalled();
    });

    it("sets context before clearing completed", async () => {
      const callOrder: string[] = [];
      mockSetSessionContext.mockImplementation(() => {
        callOrder.push("setSessionContext");
      });
      mockClearCompleted.mockImplementation(() => {
        callOrder.push("clearCompleted");
        return Promise.resolve();
      });

      await handler.handleSessionStart({}, {});

      expect(callOrder).toEqual(["setSessionContext", "clearCompleted"]);
    });

    it("resolves only after the prior session's children have shut down", async () => {
      const cleared = Promise.withResolvers<void>();
      mockClearCompleted.mockReturnValue(cleared.promise);

      let settled = false;
      const pending = handler.handleSessionStart({}, {}).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      cleared.resolve();
      await pending;
      expect(settled).toBe(true);
    });
  });

  describe("handleSessionBeforeSwitch", () => {
    it("does not mutate ownership or retained children before SDK confirmation", async () => {
      await handler.handleSessionBeforeSwitch();

      expect(manager.beginOwnerEnd).not.toHaveBeenCalled();
      expect(manager.clearCompleted).not.toHaveBeenCalled();
    });
  });

  describe("handleSessionShutdown", () => {
    it("calls all cleanup steps", async () => {
      await handler.handleSessionShutdown();

      expect(mockUnpublishService).toHaveBeenCalled();
      expect(mockClearSessionContext).toHaveBeenCalled();
      expect(mockAbortAll).toHaveBeenCalled();
      expect(mockDisposeNotifications).toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it("calls cleanup in correct order", async () => {
      const callOrder: string[] = [];
      mockUnpublishService.mockImplementation(() => {
        callOrder.push("unpublishService");
      });
      mockClearSessionContext.mockImplementation(() => {
        callOrder.push("clearSessionContext");
      });
      mockAbortAll.mockImplementation(() => {
        callOrder.push("abortAll");
      });
      mockDisposeNotifications.mockImplementation(() => {
        callOrder.push("disposeNotifications");
      });
      mockDispose.mockImplementation(() => {
        callOrder.push("dispose");
        return Promise.resolve();
      });

      await handler.handleSessionShutdown();

      // Notifications are torn down before the aborts: a terminal transition
      // fires its nudge synchronously when no parent run is active, and Pi
      // cannot recall a message already handed to it.
      expect(callOrder).toEqual([
        "unpublishService",
        "clearSessionContext",
        "disposeNotifications",
        "abortAll",
        "dispose",
      ]);
    });

    it("resolves only after every child session has shut down", async () => {
      const disposed = Promise.withResolvers<void>();
      mockDispose.mockReturnValue(disposed.promise);

      let settled = false;
      const pending = handler.handleSessionShutdown().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      disposed.resolve();
      await pending;
      expect(settled).toBe(true);
    });
  });
});
