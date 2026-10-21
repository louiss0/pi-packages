import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectDefinitions,
  loadDefinitionScope,
  parseDefinitionContent,
} from "#src/agents/loader";

describe("parseDefinitionContent", () => {
  it("reads the frontmatter and the body", () => {
    const patch = parseDefinitionContent(
      [
        "---",
        "display_name: Reviewer",
        "description: Reviews a change",
        "---",
        "",
        "Assess the change.",
      ].join("\n"),
    );
    expect(patch.displayName).toBe("Reviewer");
    expect(patch.description).toBe("Reviews a change");
    expect(patch.instructions).toBe("Assess the change.");
  });

  it("leaves a field the file does not mention unspecified", () => {
    const patch = parseDefinitionContent("---\ndescription: Only this\n---\n");
    expect(patch.description).toBe("Only this");
    expect(patch.displayName).toBeUndefined();
    expect(patch.model).toBeUndefined();
    expect(patch.tools).toBeUndefined();
  });

  it("treats an empty body as no instructions at all", () => {
    const patch = parseDefinitionContent("---\ndescription: Nothing\n---\n\n");
    expect(patch.instructions).toBeUndefined();
  });

  it("reads a comma-separated tool list", () => {
    const patch = parseDefinitionContent("---\ntools: read, grep\n---\n");
    expect(patch.tools).toEqual({ kind: "explicit", names: ["read", "grep"] });
  });

  it("reads a tool list written as a YAML sequence", () => {
    const patch = parseDefinitionContent(
      "---\ntools:\n  - read\n  - find\n---\n",
    );
    expect(patch.tools).toEqual({ kind: "explicit", names: ["read", "find"] });
  });

  it("reads the inherit keyword", () => {
    const patch = parseDefinitionContent("---\ntools: inherit\n---\n");
    expect(patch.tools).toEqual({ kind: "inherit" });
  });

  it("reads an empty tool list as no tools", () => {
    const patch = parseDefinitionContent("---\ntools: []\n---\n");
    expect(patch.tools).toEqual({ kind: "explicit", names: [] });
  });

  it("reads upstream's none spelling as no tools", () => {
    const patch = parseDefinitionContent("---\ntools: none\n---\n");
    expect(patch.tools).toEqual({ kind: "explicit", names: [] });
  });

  it("clears an inherited model when the file writes null", () => {
    const patch = parseDefinitionContent("---\nmodel: null\n---\n");
    expect(patch.model).toBeNull();
  });

  it("reads a thinking level", () => {
    const patch = parseDefinitionContent("---\nthinking: high\n---\n");
    expect(patch.thinking).toBe("high");
  });

  it("drops a thinking level Pi does not know", () => {
    const patch = parseDefinitionContent("---\nthinking: extreme\n---\n");
    expect(patch.thinking).toBeUndefined();
  });

  it("reads the boolean fields", () => {
    const patch = parseDefinitionContent(
      "---\ninherit_context: true\nrun_in_background: false\nenabled: false\n---\n",
    );
    expect(patch.inheritContext).toBe(true);
    expect(patch.runInBackground).toBe(false);
    expect(patch.enabled).toBe(false);
  });

  it("reads a turn ceiling", () => {
    const patch = parseDefinitionContent("---\nmax_turns: 8\n---\n");
    expect(patch.maxTurns).toBe(8);
  });
});

describe("loadDefinitionScope", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-tiered-agents-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads no definitions from a directory that does not exist", () => {
    const scope = loadDefinitionScope(join(dir, "missing"));
    expect(scope.definitions).toEqual([]);
    expect(scope.errors).toEqual([]);
  });

  it("reads one definition per Markdown file, named by its file", () => {
    writeFileSync(join(dir, "reviewer.md"), "---\ndescription: Reviews\n---\n");
    const scope = loadDefinitionScope(dir);
    expect(scope.definitions).toHaveLength(1);
    expect(scope.definitions[0]?.id).toBe("reviewer");
    expect(scope.definitions[0]?.patch.description).toBe("Reviews");
  });

  it("normalizes the identifier to lowercase", () => {
    writeFileSync(join(dir, "Reviewer.md"), "---\ndescription: Reviews\n---\n");
    const scope = loadDefinitionScope(dir);
    expect(scope.definitions[0]?.id).toBe("reviewer");
  });

  it("reports two files that normalize to the same identifier", () => {
    const scope = collectDefinitions([
      {
        name: "reviewer.md",
        content: "---\ndescription: One\n---\n",
        path: "a/reviewer.md",
      },
      {
        name: "Reviewer.md",
        content: "---\ndescription: Two\n---\n",
        path: "a/Reviewer.md",
      },
    ]);
    expect(scope.errors).toHaveLength(1);
    expect(scope.errors[0]).toContain('normalize to the identifier "reviewer"');
  });

  it("uses neither of two files that normalize to the same identifier", () => {
    const scope = collectDefinitions([
      {
        name: "reviewer.md",
        content: "---\ndescription: One\n---\n",
        path: "a/reviewer.md",
      },
      {
        name: "Reviewer.md",
        content: "---\ndescription: Two\n---\n",
        path: "a/Reviewer.md",
      },
    ]);
    expect(scope.definitions).toEqual([]);
  });

  it("reports a third file that joins a duplicated identifier once", () => {
    const scope = collectDefinitions([
      { name: "reviewer.md", content: "", path: "a/reviewer.md" },
      { name: "Reviewer.md", content: "", path: "a/Reviewer.md" },
      { name: "REVIEWER.md", content: "", path: "a/REVIEWER.md" },
    ]);
    expect(scope.errors).toHaveLength(1);
  });

  it("ignores files that are not Markdown", () => {
    writeFileSync(join(dir, "reviewer.md"), "---\ndescription: One\n---\n");
    writeFileSync(join(dir, "notes.txt"), "not a definition");
    const scope = loadDefinitionScope(dir);
    expect(scope.definitions).toHaveLength(1);
  });

  it("reads a definition with no frontmatter at all", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plain.md"), "Just instructions.");
    const scope = loadDefinitionScope(dir);
    expect(scope.definitions[0]?.patch.instructions).toBe("Just instructions.");
    expect(scope.definitions[0]?.patch.description).toBeUndefined();
  });
});
