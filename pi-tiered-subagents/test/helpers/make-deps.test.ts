import { describe, expect, it, vi } from "vitest";
import type { BackgroundManagerDeps } from "#src/tools/background-spawner";
import type { ForegroundManagerDeps } from "#src/tools/foreground-runner";
import { createToolDeps } from "./make-deps";
import { STUB_SNAPSHOT } from "./stub-ctx";
import { TEST_OWNER } from "./owner";
import { UNLIMITED_TURNS } from "#test/helpers/turn-policy";
import { DEFAULT_WRAP_UP_TURNS } from "#src/lifecycle/turn-limits";

describe("createToolDeps", () => {
  describe("manager defaults", () => {
    it("spawn returns 'agent-1'", () => {
      const { manager } = createToolDeps();
      expect(
        manager.spawn(STUB_SNAPSHOT, "general-purpose", "prompt", {
          description: "test",
          turnPolicy: UNLIMITED_TURNS,
          background: { kind: "explicit", isBackground: true },
          owner: TEST_OWNER,
        }),
      ).toEqual({ kind: "accepted", value: "agent-1" });
    });

    it("spawnAndWait resolves to a completed record", async () => {
      const { manager } = createToolDeps();
      const outcome = await manager.spawnAndWait(
        STUB_SNAPSHOT,
        "general-purpose",
        "prompt",
        { description: "test", turnPolicy: UNLIMITED_TURNS, owner: TEST_OWNER },
      );
      expect(outcome.kind).toBe("accepted");
      if (outcome.kind !== "accepted") throw new Error("unreachable");
      expect(outcome.value.status).toBe("completed");
    });

    it("startResume starts a resume on a completed record", () => {
      const { manager } = createToolDeps();
      const start = manager.startResume("id-1", "prompt", { background: true });
      expect(start.kind).toBe("started");
      expect(start.kind === "started" && start.record.status).toBe("completed");
    });

    it("getRecord returns a completed record", () => {
      const { manager } = createToolDeps();
      const record = manager.getRecord("id-1");
      expect(record?.status).toBe("completed");
    });
  });

  describe("other fields", () => {
    it("agentDir is a non-empty string", () => {
      expect(createToolDeps().agentDir).toBeTypeOf("string");
    });

    it("settings.defaultMaxTurns is undefined by default", () => {
      expect(createToolDeps().settings.defaultMaxTurns).toBeUndefined();
    });

    it("settings.maxConcurrent is 4 by default", () => {
      expect(createToolDeps().settings.maxConcurrent).toBe(4);
    });

    it("registry answers agent type lookups without throwing", () => {
      const { registry } = createToolDeps();
      expect(() => registry.select("worker")).not.toThrow();
    });
  });

  describe("override merging", () => {
    it("replaces a top-level field when overridden", () => {
      const deps = createToolDeps({ agentDir: "/custom/dir" });
      expect(deps.agentDir).toBe("/custom/dir");
    });

    it("replaces the manager when overridden", () => {
      const customSpawn = vi.fn().mockReturnValue("custom-id");
      const deps = createToolDeps({
        manager: { ...createToolDeps().manager, spawn: customSpawn },
      });
      deps.manager.spawn(STUB_SNAPSHOT, "t", "p", {
        description: "test",
        turnPolicy: UNLIMITED_TURNS,
        background: { kind: "explicit", isBackground: true },
        owner: TEST_OWNER,
      });
      expect(customSpawn).toHaveBeenCalledOnce();
    });

    it("replaces settings when overridden", () => {
      const deps = createToolDeps({
        settings: {
          defaultMaxTurns: 10,
          wrapUpTurns: DEFAULT_WRAP_UP_TURNS,
          maxConcurrent: 2,
        },
      });
      expect(deps.settings.defaultMaxTurns).toBe(10);
      expect(deps.settings.maxConcurrent).toBe(2);
    });
  });

  describe("structural compatibility", () => {
    it("manager satisfies BackgroundManagerDeps structurally", () => {
      const { manager } = createToolDeps();
      const bgManager: BackgroundManagerDeps = manager;
      expect(bgManager.spawn).toBeTypeOf("function");
      expect(bgManager.getRecord).toBeTypeOf("function");
    });

    it("manager satisfies ForegroundManagerDeps structurally", () => {
      const { manager } = createToolDeps();
      const fgManager: ForegroundManagerDeps = manager;
      expect(fgManager.spawnAndWait).toBeTypeOf("function");
    });
  });
});
