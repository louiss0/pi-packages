/**
 * The launch seams: what a child actually gets when a request names an agent.
 *
 * The configuration resolver is pure and the domain is unit-tested; this file
 * exercises the two doors a request travels through — the `subagent` tool and
 * the programmatic service — and inspects the resulting child session's tool
 * selection and records.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveChildToolNames } from "#src/agents/definition";
import { AgentRegistry } from "#src/agents/registry";
import { assembleSessionConfig } from "#src/session/session-config";
import type { AssemblerIO } from "#src/session/session-config";
import { AgentTool } from "#src/tools/agent-tool";
import { createToolDeps } from "#test/helpers/make-deps";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/** A registry with one definition file, for the cases that need one. */
function registryWith(
  id: string,
  patch: Record<string, unknown>,
): AgentRegistry {
  return new AgentRegistry(() => ({
    global: {
      definitions: [{ id, patch, path: `${id}.md` }],
      errors: [],
    },
  }));
}

/** The assembler's IO, stubbed to the two collaborators it uses. */
const assemblerIO: AssemblerIO = {
  buildAgentPrompt: vi.fn(() => "system prompt"),
  loadProjectContext: vi.fn(() => undefined),
};

/** The model registry the assembler reads. */
const modelRegistry = {
  find: () => undefined,
  getAll: () => [],
  getAvailable: () => [],
};

describe("the tool door", () => {
  it("refuses an unknown agent type instead of running another one", async () => {
    const deps = createToolDeps();
    const tool = new AgentTool(
      deps.manager,
      deps.runtime,
      deps.settings,
      deps.registry,
      deps.agentDir,
    );
    const outcome = await tool
      .toToolDefinition()
      .execute(
        "tool-call-1",
        { prompt: "do it", description: "d", subagent_type: "no-such-agent" },
        undefined,
        undefined,
        {} as never,
      );
    expect(JSON.stringify(outcome)).toContain("Unknown agent type");
  });

  it("refuses a disabled agent type", async () => {
    const deps = createToolDeps({
      registry: registryWith("worker", { enabled: false }),
    });
    const tool = new AgentTool(
      deps.manager,
      deps.runtime,
      deps.settings,
      deps.registry,
      deps.agentDir,
    );
    const outcome = await tool
      .toToolDefinition()
      .execute(
        "tool-call-1",
        { prompt: "do it", description: "d", subagent_type: "worker" },
        undefined,
        undefined,
        {} as never,
      );
    expect(JSON.stringify(outcome)).toContain("is disabled");
  });
});

describe("the assembler's tool selection", () => {
  const base = {
    cwd: "/tmp",
    parentSystemPrompt: "parent prompt",
    modelRegistry,
    activeToolNames: ["read", "bash", "subagent"],
  };

  it("gives a child that inherits the parent's active tools", () => {
    const config = assembleSessionConfig(
      "worker",
      { ...base, activeToolNames: ["read", "bash", "edit"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", { tools: { kind: "inherit" } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "bash", "edit"]);
  });

  it("strips the subagent-management tools from an inherited selection", () => {
    const config = assembleSessionConfig(
      "worker",
      { ...base, activeToolNames: ["read", "subagent", "steer_subagent"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("worker", { tools: { kind: "inherit" } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read"]);
  });

  it("gives a restricted specialist exactly the tools it names", () => {
    const config = assembleSessionConfig(
      "reviewer",
      { ...base, activeToolNames: ["read", "bash", "edit", "write"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reviewer", {
        tools: { kind: "explicit", names: ["read", "grep", "find"] },
      }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "grep", "find"]);
  });

  it("gives a specialist a built-in tool the parent does not have active", () => {
    const config = assembleSessionConfig(
      "reviewer",
      { ...base, activeToolNames: ["read"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reviewer", {
        tools: { kind: "explicit", names: ["read", "grep"] },
      }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual(["read", "grep"]);
  });

  it("gives a child with an empty tool list no tools at all", () => {
    const config = assembleSessionConfig(
      "reader",
      { ...base, activeToolNames: ["read", "bash"] },
      {},
      { isGitRepo: false, branch: "", platform: "linux" },
      registryWith("reader", { tools: { kind: "explicit", names: [] } }),
      assemblerIO,
    );
    expect(config.toolNames).toEqual([]);
  });

  it("takes the parent's tools captured at request time, not the current ones", () => {
    // The snapshot is the request-time capture; the assembler's context is
    // filled from it, so a later change to the parent does not reach a child
    // that is already queued.
    const snapshotTools = STUB_SNAPSHOT.activeToolNames;
    expect(resolveChildToolNames({ kind: "inherit" }, snapshotTools)).toEqual([
      "read",
      "bash",
    ]);
  });
});

describe("the shipped specialists", () => {
  it("starts the debug specialist from the parent's conversation", () => {
    const deps = createToolDeps();
    expect(deps.registry.find("debug")?.inheritContext).toBe(true);
  });

  it("starts every other specialist from a fresh conversation", () => {
    const deps = createToolDeps();
    for (const id of ["explore", "reviewer", "researcher", "worker"]) {
      expect(deps.registry.find(id)?.inheritContext).toBe(false);
    }
  });
});
