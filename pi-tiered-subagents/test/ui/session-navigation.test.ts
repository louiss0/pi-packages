import { describe, expect, it, vi } from "vitest";
import { defined, type Patch } from "#src/optional";
import { makeDefinitionLookup } from "#test/ui/helpers/definition-lookup";
import type { PersistedNavigationRun } from "#src/ui/session-navigation";
import {
  fileSnapshotSource,
  listNavigableAgents,
  type NavigationEntry,
} from "#src/ui/session-navigation";
import { fakeSource } from "#test/helpers/transcript-fixtures";
import { makeNavigable } from "#test/ui/helpers/make-navigable";

const registry = makeDefinitionLookup();

/**
 * The single entry a one-record input produces. These cases assert on one
 * entry's shape, so reading it by index would leave every use of it possibly
 * undefined and hide the discriminant narrowing the assertions turn on.
 */
function onlyEntry(entries: NavigationEntry[]): NavigationEntry {
  const [entry] = entries;
  if (entry === undefined) throw new Error("expected exactly one entry");
  return entry;
}

describe("listNavigableAgents", () => {
  it("returns an empty list for no agents", () => {
    expect(listNavigableAgents([], registry, [])).toEqual([]);
  });

  it("makes a session-ready record a live entry", () => {
    const ready = makeNavigable({ id: "ready", transcript: fakeSource() });
    const entries = listNavigableAgents([ready], registry, []);
    expect(entries).toHaveLength(1);
    const entry = onlyEntry(entries);
    expect(entry.kind).toBe("live");
    expect(entry.kind === "live" && entry.source).toBe(ready.transcript);
  });

  it("makes a released record (no live session, has outputFile) a snapshot entry", () => {
    const released = makeNavigable({
      id: "released",
      transcript: undefined,
      outputFile: "/tasks/released-1.jsonl",
      description: "Investigate the bug",
      toolUses: 3,
    });
    const entry = onlyEntry(listNavigableAgents([released], registry, []));
    expect(entry.kind).toBe("snapshot");
    expect(entry.kind === "snapshot" && entry.outputFile).toBe(
      "/tasks/released-1.jsonl",
    );
    expect(entry.label).toBe(
      "Worker (Investigate the bug) · 3 tools · completed · 3.0s · session released (snapshot)",
    );
  });

  it("drops a record with neither a live session nor an outputFile", () => {
    const gone = makeNavigable({
      id: "gone",
      transcript: undefined,
      outputFile: undefined,
    });
    expect(listNavigableAgents([gone], registry, [])).toEqual([]);
  });

  it("builds a label with name, description, tool count, status, and duration", () => {
    const record = makeNavigable({
      type: "worker",
      description: "Investigate the bug",
      toolUses: 3,
      status: "completed",
      startedAt: 1000,
      completedAt: 4000,
    });
    const entry = onlyEntry(listNavigableAgents([record], registry, []));
    // getDisplayName resolves "worker" against the empty registry to its fallback display name.
    expect(entry.label).toBe(
      "Worker (Investigate the bug) · 3 tools · completed · 3.0s",
    );
  });

  describe("heading", () => {
    it("names a live entry's agent, mode, and task", () => {
      const record = makeNavigable({
        type: "worker",
        description: "Investigate the bug",
      });
      const entry = onlyEntry(listNavigableAgents([record], registry, []));
      expect(entry.heading).toEqual({
        name: "Worker",
        description: "Investigate the bug",
      });
    });

    it("names a snapshot entry's agent, mode, and task", () => {
      const released = makeNavigable({
        transcript: undefined,
        outputFile: "/tasks/released-1.jsonl",
        description: "Investigate the bug",
      });
      const entry = onlyEntry(listNavigableAgents([released], registry, []));
      expect(entry.heading).toEqual({
        name: "Worker",
        description: "Investigate the bug",
      });
    });

    it("carries no mode label for a replace-mode agent", () => {
      const entry = onlyEntry(
        listNavigableAgents(
          [makeNavigable({ type: "Explore", description: "Find auth files" })],
          registry,
          [],
        ),
      );
      expect(entry.heading).toEqual({
        name: "Explore",
        description: "Find auth files",
      });
    });
  });

  it("orders live entries before snapshot ones, and persisted runs last", () => {
    const live = makeNavigable({ id: "live-1", transcript: fakeSource() });
    const released = makeNavigable({
      id: "released-1",
      transcript: undefined,
      outputFile: "/tasks/x.jsonl",
    });
    const persisted = persistedRun({
      id: "earlier",
      outputFile: "/tasks/earlier.jsonl",
    });
    const sources = listNavigableAgents([live, released], registry, [
      persisted,
    ]).map((e) => (e.kind === "live" ? e.source : e.outputFile));
    expect(sources).toEqual([
      live.transcript,
      "/tasks/x.jsonl",
      "/tasks/earlier.jsonl",
    ]);
  });

  describe("persisted runs", () => {
    it("lists a persisted run with a transcript as a snapshot entry", () => {
      const entries = listNavigableAgents([], registry, [
        persistedRun({ outputFile: "/tasks/earlier.jsonl" }),
      ]);
      expect(entries).toEqual([
        {
          kind: "snapshot",
          outputFile: "/tasks/earlier.jsonl",
          heading: {
            name: "Worker",
            description: "Earlier task",
          },
          label:
            "Worker (Earlier task) · 7 tools · completed · 3.0s · session released (snapshot)",
        },
      ]);
    });

    it("lists a run the manager still holds once, from the manager", () => {
      const live = makeNavigable({ id: "earlier", transcript: fakeSource() });
      const entries = listNavigableAgents([live], registry, [
        persistedRun({ id: "earlier" }),
      ]);
      expect(entries.map((e) => e.kind)).toEqual(["live"]);
    });

    it("omits a persisted run that recorded no transcript", () => {
      expect(
        listNavigableAgents([], registry, [
          persistedRun({ outputFile: undefined }),
        ]),
      ).toEqual([]);
    });
  });
});

function persistedRun(
  overrides: Patch<PersistedNavigationRun> = {},
): PersistedNavigationRun {
  // `outputFile` defaults to absent for the same reason makeAgent's
  // `completedAt` does: an override bag cannot unset a defaulted value, and
  // "a run that recorded no transcript" is exactly the absent key.
  return {
    id: "earlier",
    type: "worker",
    description: "Earlier task",
    status: "completed",
    startedAt: 1000,
    completedAt: 4000,
    toolUses: 7,
    outputFile: undefined,
    ...defined(overrides),
  };
}

describe("fileSnapshotSource", () => {
  const SESSION_JSONL = [
    {
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-06-23T00:00:00Z",
      cwd: "/proj",
    },
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-06-23T00:00:01Z",
      message: { role: "user", content: "do the thing" },
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-06-23T00:00:02Z",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  it("reads the file, drops the session header, and returns the parsed messages", async () => {
    const readFile = vi.fn(() => SESSION_JSONL);
    const source = await fileSnapshotSource("/tasks/agent.jsonl", readFile);
    expect(readFile).toHaveBeenCalledWith("/tasks/agent.jsonl");
    expect(source.getMessages()).toEqual([
      { role: "user", content: "do the thing" },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });

  it("is a static snapshot: no subscription, no streaming, no tool definitions", async () => {
    const source = await fileSnapshotSource(
      "/tasks/agent.jsonl",
      () => SESSION_JSONL,
    );
    expect(source.subscribe(() => {})).toBeUndefined();
    expect(source.streaming()).toBeUndefined();
    expect(source.getToolDefinition("read")).toBeUndefined();
  });

  describe("sessionModel", () => {
    it("reports the model and thinking level the session recorded", async () => {
      const jsonl = [
        SESSION_JSONL,
        JSON.stringify({
          type: "model_change",
          id: "c1",
          parentId: "m2",
          timestamp: "2026-06-23T00:00:03Z",
          provider: "anthropic",
          modelId: "claude-sonnet-5",
        }),
        JSON.stringify({
          type: "thinking_level_change",
          id: "c2",
          parentId: "c1",
          timestamp: "2026-06-23T00:00:04Z",
          thinkingLevel: "medium",
        }),
      ].join("\n");
      const source = await fileSnapshotSource(
        "/tasks/agent.jsonl",
        () => jsonl,
      );
      expect(source.sessionModel()).toEqual({
        model: { provider: "anthropic", id: "claude-sonnet-5" },
        thinkingLevel: "medium",
      });
    });

    it("reports the model the last assistant message ran on", async () => {
      const jsonl = [
        SESSION_JSONL,
        JSON.stringify({
          type: "message",
          id: "m3",
          parentId: "m2",
          timestamp: "2026-06-23T00:00:05Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "again" }],
            provider: "openai",
            model: "gpt-6",
          },
        }),
      ].join("\n");
      const source = await fileSnapshotSource(
        "/tasks/agent.jsonl",
        () => jsonl,
      );
      expect(source.sessionModel().model).toEqual({
        provider: "openai",
        id: "gpt-6",
      });
    });

    it("reports no model for a session whose entries name none", async () => {
      const source = await fileSnapshotSource(
        "/tasks/agent.jsonl",
        () => SESSION_JSONL,
      );
      expect(source.sessionModel().model).toBeUndefined();
    });
  });

  it("returns an empty transcript for a header-only file", async () => {
    const headerOnly = JSON.stringify({
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-06-23T00:00:00Z",
      cwd: "/proj",
    });
    const source = await fileSnapshotSource(
      "/tasks/empty.jsonl",
      () => headerOnly,
    );
    expect(source.getMessages()).toEqual([]);
  });
});
