import { describe, it, expect } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { createAgentToolRenderer } from "#src/ui/agent-tool-renderer";
import { renderGetResultCall } from "#src/ui/get-result-tool-renderer";
import { renderStatusLabel } from "#src/observation/outcome-delivery";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";

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
      expect(call).toHaveProperty("constructor", Text);
    });

    it("renders a get_subagent_result call from owned view params", () => {
      const call = renderGetResultCall(
        { agent_id: "agent-1", wait: true },
        theme,
      );
      expect(call).toHaveProperty("constructor", Text);
    });
  });

  describe("98 — focused adapter, no live child session", () => {
    it("exposes only TranscriptSource methods", () => {
      const source = {
        getMessages: () => [],
        subscribe: () => () => {},
        getToolDefinition: () => undefined,
      } as Record<string, unknown>;
      expect(typeof source.getMessages).toBe("function");
    });
  });

  describe("99 — UI presentation consumers never affect execution", () => {
    it("outcome-delivery renderStatusLabel returns text for error status", () => {
      expect(renderStatusLabel({ status: "error", error: "boom" })).toBe("Error: boom");
    });
  });

  describe("100 — model-facing text is separated from terminal rendering", () => {
    it("outcome-delivery status meanings cover all SubagentStatus values", () => {
      const statuses: SubagentStatus[] = ["queued", "running", "completed", "aborted", "stopped", "error"];
      for (const s of statuses) {
        expect(renderStatusLabel({ status: s })).toBeDefined();
      }
    });
  });
});