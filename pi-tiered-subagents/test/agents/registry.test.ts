import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDefinitionScopes } from "#src/agents/loader";
import { AgentRegistry } from "#src/agents/registry";

/** A source tree with a global and a project directory. */
interface Tree {
  globalDir: string;
  cwd: string;
  writeGlobal(name: string, content: string): void;
  writeProject(name: string, content: string): void;
}

describe("AgentRegistry", () => {
  let tree: Tree;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "pi-tiered-registry-"));
    const globalDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(globalDir, "agents"), { recursive: true });
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    tree = {
      globalDir,
      cwd,
      writeGlobal: (name, content) =>
        writeFileSync(join(globalDir, "agents", name), content),
      writeProject: (name, content) =>
        writeFileSync(join(cwd, ".pi", "agents", name), content),
    };
  });

  afterEach(() => {
    rmSync(tree.globalDir, { recursive: true, force: true });
    rmSync(tree.cwd, { recursive: true, force: true });
  });

  const registry = (projectTrusted = true) =>
    new AgentRegistry(() =>
      loadDefinitionScopes({
        globalDir: tree.globalDir,
        cwd: tree.cwd,
        projectTrusted,
      }),
    );

  it("ships exactly the five agreed specialists", () => {
    expect(registry().ids()).toEqual([
      "debug",
      "explore",
      "researcher",
      "reviewer",
      "worker",
    ]);
  });

  it("gives the shipped specialists their exact tool lists", () => {
    const tools = (id: string) => registry().find(id)?.tools;
    expect(tools("explore")).toEqual({
      kind: "explicit",
      names: ["read", "grep", "find", "ls"],
    });
    expect(tools("reviewer")).toEqual({
      kind: "explicit",
      names: ["read", "grep", "find"],
    });
    expect(tools("researcher")).toEqual({
      kind: "explicit",
      names: ["read", "grep", "find", "ls", "web_search"],
    });
    expect(tools("worker")).toEqual({ kind: "inherit" });
    expect(tools("debug")).toEqual({ kind: "inherit" });
  });

  it("gives every specialist fresh conversation except debug", () => {
    const inheritContext = (id: string) => registry().find(id)?.inheritContext;
    expect(inheritContext("debug")).toBe(true);
    expect(inheritContext("explore")).toBe(false);
    expect(inheritContext("worker")).toBe(false);
    expect(inheritContext("reviewer")).toBe(false);
    expect(inheritContext("researcher")).toBe(false);
  });

  it("runs every specialist in the background by default", () => {
    for (const id of registry().ids()) {
      expect(registry().find(id)?.runInBackground).toBe(true);
    }
  });

  it("adds a global definition the package has never heard of", () => {
    tree.writeGlobal("auditor.md", "---\ndescription: Audits things\n---\n");
    const found = registry().find("auditor");
    expect(found?.description).toBe("Audits things");
    expect(found?.origin).toBe("global");
  });

  it("refines a shipped specialist with a global file", () => {
    tree.writeGlobal(
      "reviewer.md",
      "---\ndescription: A local reviewer\n---\n\nLook closely.\n",
    );
    const found = registry().find("reviewer");
    expect(found?.description).toBe("A local reviewer");
    expect(found?.instructions).toBe("Look closely.");
    // The tool restrictions survive a definition that names no tools.
    expect(found?.tools).toEqual({
      kind: "explicit",
      names: ["read", "grep", "find"],
    });
    expect(found?.origin).toBe("global");
  });

  it("lets a project file refine a global one", () => {
    tree.writeGlobal("reviewer.md", "---\ndescription: Global\n---\n");
    tree.writeProject("reviewer.md", "---\ndescription: Project\n---\n");
    const found = registry().find("reviewer");
    expect(found?.description).toBe("Project");
    expect(found?.origin).toBe("project");
  });

  it("ignores project definitions when the project is not trusted", () => {
    tree.writeProject("reviewer.md", "---\ndescription: Project\n---\n");
    const found = registry(false).find("reviewer");
    expect(found?.description).not.toBe("Project");
    expect(found?.origin).toBe("shipped");
  });

  it("ignores a project definition that introduces a new agent when untrusted", () => {
    tree.writeProject("sneaky.md", "---\ndescription: Sneaky\n---\n");
    expect(registry(false).find("sneaky")).toBeUndefined();
  });

  it("clears a shipped model when a file writes null", () => {
    tree.writeGlobal("explore.md", "---\nmodel: null\n---\n");
    expect(registry().find("explore")?.model).toBeUndefined();
  });

  it("rejects an unknown agent rather than running another one", () => {
    const selection = registry().select("nonexistent");
    expect(selection.ok).toBe(false);
    if (!selection.ok) {
      expect(selection.error).toContain('Unknown agent type "nonexistent"');
    }
  });

  it("rejects a disabled agent", () => {
    tree.writeGlobal("reviewer.md", "---\nenabled: false\n---\n");
    const selection = registry().select("reviewer");
    expect(selection.ok).toBe(false);
    if (!selection.ok) {
      expect(selection.error).toContain('Agent "reviewer" is disabled');
    }
  });

  it("does not offer a disabled agent as available", () => {
    tree.writeGlobal("reviewer.md", "---\nenabled: false\n---\n");
    expect(registry().enabledIds()).not.toContain("reviewer");
  });

  it("selects an agent by its normalized identifier", () => {
    const selection = registry().select("REVIEWER");
    expect(selection.ok).toBe(true);
  });

  it("picks up a definition added after the registry was built", () => {
    const reg = registry();
    expect(reg.find("late")).toBeUndefined();
    tree.writeGlobal("late.md", "---\ndescription: Late\n---\n");
    reg.reload();
    expect(reg.find("late")?.description).toBe("Late");
  });

  it("reports a duplicate identifier in one scope", () => {
    const reg = new AgentRegistry(() => ({
      global: {
        definitions: [],
        errors: [
          'Two agent definitions normalize to the identifier "reviewer": a/reviewer.md and a/Reviewer.md. Rename one of them; neither is used.',
        ],
      },
    }));
    expect(reg.errors()).toHaveLength(1);
    expect(reg.errors()[0]).toContain('normalize to the identifier "reviewer"');
  });

  it("treats the same identifier in two scopes as an override, not a duplicate", () => {
    tree.writeGlobal("reviewer.md", "---\ndescription: Global\n---\n");
    tree.writeProject("reviewer.md", "---\ndescription: Project\n---\n");
    const reg = registry();
    expect(reg.errors()).toEqual([]);
    expect(reg.find("reviewer")?.description).toBe("Project");
  });
});
