import { describe, it, expect } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { liveSource, toNavigableSubagent } from "#src/presentation/transcript-adapter";
import { createAgentToolRenderer } from "#src/ui/agent-tool-renderer";
import { renderGetResultCall } from "#src/ui/get-result-tool-renderer";
import type { TranscriptRecord } from "#src/presentation/transcript-adapter";

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
      expect(call).toBeInstanceOf(Text);
    });

    it("renders a get_subagent_result call from owned view params", () => {
      const call = renderGetResultCall(
        { agent_id: "agent-1", wait: true },
        theme,
      );
      expect(call).toBeInstanceOf(Text);
    });
  });

  describe("98 — focused adapter, no live child session", () => {
    it("exposes only TranscriptSource methods, never the session itself", () => {
      const record = {
        agentMessages: [{ role: "user", message: "hi" }],
        isSessionReady: () => true,
        subscribeToUpdates: () => () => {},
        getToolDefinition: () => undefined,
      } as unknown as TranscriptRecord;
      const source = liveSource(record);
      expect(typeof source.getMessages).toBe("function");
      expect(typeof source.subscribe).toBe("function");
      expect(typeof source.getToolDefinition).toBe("function");
      // The adapter never passes the live session to the viewer.
      expect((source as Record<string, unknown>)["session"]).toBeUndefined();
    });
  });

  describe("99 — UI presentation consumers never affect execution", () => {
    it("agent-widget update is inert without a registered TUI context", async () => {
      const { AgentWidget } = await import("#src/ui/agent-widget");
      const widget = new AgentWidget(
        { listAgents: () => [] },
        { find: () => undefined },
      );
      // No execution state is created before the widget is mounted.
      expect((widget as Record<string, unknown>)["uiCtx"]).toBeUndefined();
    });
  });

  describe("100 — model-facing text is separated from terminal rendering", () => {
    it("outcome-delivery exposes only pure text formatters", async () => {
      const mod = await import("#src/observation/outcome-delivery");
      const renderStatusLabel = mod.renderStatusLabel;
      const renderStatusNote = mod.renderStatusNote;
      expect(renderStatusLabel({ status: "error", error: "boom" })).toBe("Error: boom");
      expect(renderStatusLabel({ status: "done" })).toBe("Done");
      expect(renderStatusNote({ status: "done" })).toBe("");
    });
  });
});