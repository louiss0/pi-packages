import { describe, expect, it, vi } from "vitest";
import type { TranscriptSource } from "#src/ui/session-navigation";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
import {
  liveSource,
  readPersistedNavigationRuns,
  toNavigableSubagent,
} from "#src/presentation/transcript-adapter";
import { handleSubagentsSessions } from "../extensions/index";
import { makeDefinitionLookup } from "#test/ui/helpers/definition-lookup";
import { makeNavigable } from "#test/helpers/make-navigable";
import { makeMenuUI } from "#test/helpers/ui-stubs";

type NavigableSubagent = ReturnType<typeof makeNavigable>;

describe("runtime-to-transcript presentation", () => {
  it("offers a persisted custom entry in the reload picker through the runtime adapter", async () => {
    const ui = makeMenuUI();
    const persisted = readPersistedNavigationRuns([
      {
        type: "custom",
        customType: "subagents:record",
        data: {
          id: "past-run",
          type: "worker",
          description: "Before reload",
          status: "completed",
          result: "done",
          startedAt: 1000,
          completedAt: 4000,
          outputFile: "/tasks/past-run.jsonl",
          toolUses: 5,
        },
      },
    ]);
    await handleSubagentsSessions({
      ui,
      agents: [],
      persisted,
      registry: makeDefinitionLookup(),
      cwd: "/test/cwd",
      readFile: async () => {
        throw new Error("No file should be read before a selection");
      },
    });
    expect(ui.select).toHaveBeenCalledWith("Subagent sessions", [
      "Worker (Before reload) · 5 tools · completed · 3.0s · session released (snapshot)",
    ]);
  });

  it("offers retained sessions live and released sessions as file snapshots", async () => {
    const ui = makeMenuUI();
    const retained = makeNavigable({
      id: "retained",
      description: "Retained child",
      startedAt: 1000,
      completedAt: 4000,
      toolUses: 2,
    });
    const released = makeNavigable({
      id: "released",
      description: "Released child",
      startedAt: 1000,
      completedAt: 4000,
      toolUses: 4,
      isSessionReady: () => false,
      outputFile: "/tasks/released.jsonl",
    });
    await handleSubagentsSessions({
      ui,
      agents: [released, retained].map(toNavigableSubagent),
      persisted: [],
      registry: makeDefinitionLookup(),
      cwd: "/test/cwd",
      readFile: async () => {
        throw new Error("No file should be read before a selection");
      },
    });
    expect(ui.select).toHaveBeenCalledWith("Subagent sessions", [
      "Worker (Retained child) · 2 tools · completed · 3.0s",
      "Worker (Released child) · 4 tools · completed · 3.0s · session released (snapshot)",
    ]);
  });
});

describe("liveSource", () => {
  it("getMessages returns the record's agentMessages", () => {
    const messages = [
      { role: "user", content: "hi" },
    ] as unknown as SessionMessage[];
    const record = makeNavigable({ agentMessages: messages });
    expect(liveSource(record).getMessages()).toBe(messages);
  });

  it("subscribe delegates to subscribeToUpdates and forwards change notifications", () => {
    let captured: ((event: unknown) => void) | undefined;
    const unsub = vi.fn();
    const record = makeNavigable({
      subscribeToUpdates: vi.fn((fn: (event: unknown) => void) => {
        captured = fn;
        return unsub;
      }) as NavigableSubagent["subscribeToUpdates"],
    });
    const onChange = vi.fn();
    const returned = liveSource(record).subscribe(onChange);
    expect(record.subscribeToUpdates).toHaveBeenCalledOnce();
    const event = { type: "turn_end" } as AgentSessionEvent;
    captured?.(event);
    // The event is forwarded, not merely counted: the consumer routes on its
    // type to decide whether a streaming delta or a settled message arrived.
    expect(onChange).toHaveBeenCalledWith(event);
    expect(returned).toBe(unsub);
  });

  it("streaming returns activity state only while running", () => {
    const activeTools = new Map([["k", "read"]]);
    const running = makeNavigable({
      status: "running",
      activeTools,
      responseText: "working",
    });
    expect(liveSource(running).streaming()).toEqual({
      activeTools,
      responseText: "working",
    });

    const completed = makeNavigable({ status: "completed" });
    expect(liveSource(completed).streaming()).toBeUndefined();
  });

  it("sessionModel reads the record's model and thinking level at call time", () => {
    const record: {
      -readonly [K in keyof NavigableSubagent]: NavigableSubagent[K];
    } = makeNavigable();
    const source = liveSource(record);
    expect(source.sessionModel()).toEqual({
      model: undefined,
      thinkingLevel: undefined,
    });
    record.model = { provider: "anthropic", id: "claude-sonnet-5" };
    record.thinkingLevel = "high";
    expect(source.sessionModel()).toEqual({
      model: { provider: "anthropic", id: "claude-sonnet-5" },
      thinkingLevel: "high",
    });
  });

  it("getToolDefinition delegates to the record's getToolDefinition", () => {
    const def = { name: "read" } as unknown as ReturnType<
      TranscriptSource["getToolDefinition"]
    >;
    const record = makeNavigable({ getToolDefinition: vi.fn(() => def) });
    expect(liveSource(record).getToolDefinition("read")).toBe(def);
    expect(record.getToolDefinition).toHaveBeenCalledWith("read");
  });
});
