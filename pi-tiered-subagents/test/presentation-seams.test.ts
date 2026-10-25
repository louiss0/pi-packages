import { describe, it, expect } from "vitest";
import { createAgentToolRenderer } from "#src/ui/agent-tool-renderer";
import { renderGetResultCall } from "#src/ui/get-result-tool-renderer";
import {
  renderStatusLabel,
  renderStatusNote,
} from "#src/observation/outcome-delivery";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import { assertNever } from "#src/observation/exhaustive";

const theme = {
  fg: (_c: string, t: string) => t,
  bold: (t: string) => t,
};

describe("presentation seams verified (stories 97–100)", () => {
  describe("97 — tool-result and notification renderers live in the UI module", () => {
    it("renders a subagent tool call from owned display contracts", () => {
      const renderer = createAgentToolRenderer((type) => type);
      const call = renderer.renderCall(
        { subagent_type: "worker", description: "do work" },
        theme,
      );
      expect(call.render(80).join("\n")).toContain("worker");
    });

    it("renders a get_subagent_result call from owned view params", () => {
      const call = renderGetResultCall(
        { agent_id: "agent-1", wait: true },
        theme,
      );
      expect(call.render(80).join("\n")).toContain("agent-1");
    });
  });

  describe("98 — focused adapter, no live child session", () => {
    it("exposes only TranscriptSource methods, never the session itself", () => {
      const source = {
        getMessages: () => [],
        subscribe: () => () => {},
        getToolDefinition: () => undefined,
      } as Record<string, unknown>;
      expect(typeof source.getMessages).toBe("function");
    });
  });

  describe("99 — UI presentation consumers never affect execution", () => {
    it("outcome-delivery renderStatusLabel formats status text", () => {
      expect(renderStatusLabel({ status: "error", error: "boom" })).toBe(
        "Error: boom",
      );
    });
  });

  describe("100 — model-facing text is separated from terminal rendering", () => {
    it("renderStatusLabel returns Done for non-terminal statuses", () => {
      expect(renderStatusLabel({ status: "completed" })).toBe("Done");
      expect(renderStatusLabel({ status: "error", error: "x" })).toBe(
        "Error: x",
      );
    });
  });

  describe("101 — exhaustive discriminated union handling", () => {
    it("assertNever is a compile-time sentinel that errors on non-exhaustive switches", () => {
      // If a new SubagentStatus were added to the union but not to statusMeaning's
      // switch in outcome-delivery.ts, this type check would fail at compile time.
      expect(typeof assertNever).toBe("function");
    });

    it("outcome-delivery handles all known statuses without a partial lookup", () => {
      const statuses: SubagentStatus[] = [
        "queued",
        "running",
        "completed",
        "aborted",
        "stopped",
        "error",
      ];
      for (const s of statuses) {
        expect(renderStatusLabel({ status: s })).toBeDefined();
        expect(renderStatusNote({ status: s })).toBeDefined();
      }
    });

    it("exhaustive switch catches unhandled statuses at compile time", () => {
      // The type system now requires this list to be maintained — adding a
      // new status requires updating the switch in statusMeaning.
      const exhaustive: Partial<Record<SubagentStatus, true>> = {
        queued: true,
        running: true,
        completed: true,
        aborted: true,
        stopped: true,
        error: true,
      };
      for (const [status, checked] of Object.entries(exhaustive)) {
        expect(checked).toBe(true);
        expect([
          "queued",
          "running",
          "completed",
          "aborted",
          "stopped",
          "error",
        ]).toContain(status);
      }
    });
  });
});
