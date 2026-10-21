import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "#src/agents/definition";
import {
  createAgentLookup,
  createFactorySession,
  createSubagentSessionIO,
} from "./subagent-session-io";

describe("createSubagentSessionIO", () => {
  it("returns a stub with all EnvironmentIO methods", () => {
    const io = createSubagentSessionIO();
    expect(typeof io.detectEnv).toBe("function");
    expect(typeof io.getAgentDir).toBe("function");
    expect(typeof io.deriveSessionDir).toBe("function");
  });

  it("returns a stub with all SessionFactoryIO methods", () => {
    const io = createSubagentSessionIO();
    expect(typeof io.createResourceLoader).toBe("function");
    expect(typeof io.createSessionManager).toBe("function");
    expect(typeof io.createSettingsManager).toBe("function");
    expect(typeof io.createSession).toBe("function");
  });

  it("assemblerIO has the production interface's methods only", () => {
    const io = createSubagentSessionIO();
    expect(typeof io.assemblerIO.buildAgentPrompt).toBe("function");
    expect(typeof io.assemblerIO.loadProjectContext).toBe("function");
    expect(Object.keys(io.assemblerIO)).toEqual([
      "buildAgentPrompt",
      "loadProjectContext",
    ]);
  });

  it("assemblerIO defaults return sensible stub values", () => {
    const io = createSubagentSessionIO();
    expect(io.assemblerIO.buildAgentPrompt).toBeDefined();
  });

  it("detectEnv resolves to a stub EnvInfo", async () => {
    const io = createSubagentSessionIO();
    const env = await io.detectEnv(vi.fn(), "/cwd");
    expect(env).toEqual({ isGitRepo: false, branch: "", platform: "linux" });
  });

  it("getAgentDir returns /mock/agent-dir", () => {
    const io = createSubagentSessionIO();
    expect(io.getAgentDir()).toBe("/mock/agent-dir");
  });

  it("createSessionManager returns a stub with newSession and getSessionFile", () => {
    const io = createSubagentSessionIO();
    const mgr = io.createSessionManager("/cwd", "/sessions");
    expect(typeof mgr.newSession).toBe("function");
    expect(typeof mgr.getSessionFile).toBe("function");
  });

  it("assemblerIO methods can be configured after creation", () => {
    const io = createSubagentSessionIO();
    io.assemblerIO.buildAgentPrompt.mockReturnValue("custom prompt");
    const result = io.assemblerIO.buildAgentPrompt(
      { name: "explore", instructions: "" },
      "/cwd",
      { isGitRepo: false, branch: "", platform: "linux" },
    );
    expect(result).toBe("custom prompt");
  });

  it("stubs retain Mock methods (vi.fn())", () => {
    const io = createSubagentSessionIO();
    io.detectEnv.mockResolvedValue({
      isGitRepo: true,
      branch: "main",
      platform: "darwin",
    });
    expect(io.detectEnv.mock).toBeDefined();
  });
});

describe("createAgentLookup", () => {
  it("select returns the default definition", () => {
    const lookup = createAgentLookup();
    const selection = lookup.select("explore");
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.definition.id).toBe("explore");
      expect(selection.definition.instructions).toBe("You are Explore.");
    }
  });

  it("default definition selects the read tool", () => {
    const lookup = createAgentLookup();
    const selection = lookup.select("explore");
    expect(selection.ok && selection.definition.tools).toEqual({
      kind: "explicit",
      names: ["read"],
    });
  });

  it("accepts a partial definition override", () => {
    const override: Partial<AgentDefinition> = {
      displayName: "Custom",
      maxTurns: 7,
    };
    const lookup = createAgentLookup(override);
    const selection = lookup.select("explore");
    expect(selection.ok && selection.definition.displayName).toBe("Custom");
    expect(selection.ok && selection.definition.maxTurns).toBe(7);
    // other defaults still present
    expect(selection.ok && selection.definition.instructions).toBe(
      "You are Explore.",
    );
  });

  it("select and find are vi.fn() stubs", () => {
    const lookup = createAgentLookup();
    expect(lookup.select.mock).toBeDefined();
    expect(lookup.find.mock).toBeDefined();
  });
});

describe("createFactorySession", () => {
  it("returns a stub with all eight session methods", () => {
    const session = createFactorySession();
    expect(Array.isArray(session.messages)).toBe(true);
    expect(typeof session.subscribe).toBe("function");
    expect(typeof session.prompt).toBe("function");
    expect(typeof session.abort).toBe("function");
    expect(typeof session.steer).toBe("function");
    expect(typeof session.dispose).toBe("function");
    expect(typeof session.getActiveToolNames).toBe("function");
    expect(typeof session.setActiveToolsByName).toBe("function");
    expect(typeof session.bindExtensions).toBe("function");
  });

  it("getActiveToolNames returns ['read'] before and after bind", async () => {
    const session = createFactorySession();
    expect(session.getActiveToolNames()).toEqual(["read"]);
    await session.bindExtensions();
    expect(session.getActiveToolNames()).toEqual(["read"]);
  });

  it("stubs retain Mock methods (vi.fn())", () => {
    const session = createFactorySession();
    session.setActiveToolsByName(["read"]);
    expect(session.setActiveToolsByName.mock.calls[0][0]).toEqual(["read"]);
  });

  it("exposes the core's working event bus (subscribe/emit)", () => {
    const session = createFactorySession();
    const events: unknown[] = [];
    session.subscribe((e) => events.push(e));
    session.emit({ type: "factory-event" });
    expect(events).toEqual([{ type: "factory-event" }]);
  });
});
