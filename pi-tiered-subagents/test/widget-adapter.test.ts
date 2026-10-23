import { describe, expect, it } from "vitest";
import { AgentWidget } from "#src/ui/agent-widget";
import type { UICtx } from "#src/ui/agent-widget";
import { AgentRegistry } from "#src/agents/registry";
import type { Subagent } from "#src/lifecycle/subagent";
import { createWidgetSource } from "#src/presentation/widget-adapter";
import { createTestSubagent } from "#test/helpers/make-subagent";

function stubTui() {
  return {
    terminal: { columns: 200, rows: 40 },
    mode: "regular" as const,
    requestRender: () => {},
  };
}

function stubTheme() {
  return {
    fg: (_: string, text: string) => text,
    bold: (text: string) => text,
  };
}

describe("AgentWidget — background-only filtering", () => {
  function setup(records: Subagent[]) {
    const manager = { listAgents: () => records };
    const registry = new AgentRegistry(() => ({
      global: { definitions: [], errors: [] },
      project: { definitions: [], errors: [] },
    }));
    const widget = new AgentWidget(createWidgetSource(manager), registry);
    const setWidgetCalls: unknown[] = [];
    let renderFn:
      | ((tui: unknown, theme: unknown) => { render(): string[] })
      | undefined;
    const ui: UICtx = {
      setStatus: () => {},
      setWidget: (_key, content) => {
        setWidgetCalls.push(content);
        if (typeof content === "function")
          renderFn = content as typeof renderFn;
      },
    };
    widget.setUICtx(ui);
    const lastContent = () => setWidgetCalls.at(-1);
    const renderLines = () => renderFn!(stubTui(), stubTheme()).render();
    return { widget, lastContent, renderLines };
  }

  it("does not register the widget when only foreground agents exist", () => {
    const { widget, lastContent } = setup([
      createTestSubagent({
        id: "fg1",
        status: "running",
        completedAt: undefined,
        isBackground: false,
      }),
    ]);
    widget.update();
    expect(lastContent()).toBeUndefined();
  });

  it("renders only background agents when foreground and background agents are mixed", () => {
    const { widget, renderLines } = setup([
      createTestSubagent({
        id: "bg1",
        status: "running",
        completedAt: undefined,
        description: "background task",
        isBackground: true,
      }),
      createTestSubagent({
        id: "fg1",
        status: "running",
        completedAt: undefined,
        description: "foreground task",
        isBackground: false,
      }),
    ]);
    widget.update();
    const text = renderLines().join("\n");
    expect(text).toContain("background task");
    expect(text).not.toContain("foreground task");
  });
});
