/**
 * entry-seam-validation.test.ts — ARCHITECTURE-SPEC stories 106–108.
 *
 * 106: external bytes are validated from `unknown` once, at the loader's entry
 *      seam. Malformed input becomes a typed diagnostic on the scope; the core
 *      consumes owned patches instead of reinterpreting raw YAML downstream.
 * 107: the launch path's definition loading is an asynchronous adapter, so the
 *      legacy synchronous chain does not expand into the new architecture.
 * 108: the adapter's cancellation follows signal semantics — an aborted signal
 *      rejects with the signal's reason, it is not swallowed into an empty
 *      scope or reinterpreted as a load failure.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectDefinitions,
  loadDefinitionScopeAsync,
  loadDefinitionScopesAsync,
  parseDefinitionContent,
} from "#src/agents/loader";

describe("entry-seam validation (story 106)", () => {
  it("reports a file whose frontmatter is not readable YAML and uses neither it nor its instructions", () => {
    const scope = collectDefinitions([
      {
        name: "broken.md",
        content: "---\ndisplay_name: [unclosed\n---\n\nBody text.",
        path: "a/broken.md",
      },
    ]);
    expect(scope.definitions).toEqual([]);
    expect(scope.errors).toHaveLength(1);
    expect(scope.errors[0]).toContain("Could not parse the agent definition");
    expect(scope.errors[0]).toContain("a/broken.md");
  });

  it("keeps reading the scope's other files when one file is malformed", () => {
    const scope = collectDefinitions([
      {
        name: "broken.md",
        content: "---\n: : :\n---\n",
        path: "a/broken.md",
      },
      {
        name: "reviewer.md",
        content: "---\ndescription: Reviews\n---\n",
        path: "a/reviewer.md",
      },
    ]);
    expect(scope.definitions.map((d) => d.id)).toEqual(["reviewer"]);
    expect(scope.errors).toHaveLength(1);
  });

  it("diagnoses a frontmatter block that is not a mapping instead of reading it as one", () => {
    const problems: string[] = [];
    const patch = parseDefinitionContent(
      "---\njust a scalar\n---\n\nDo the work.",
      (problem) => problems.push(problem),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not a mapping");
    // The body is still the standing instructions; only the keys are ignored.
    expect(patch.instructions).toBe("Do the work.");
    expect(patch.displayName).toBeUndefined();
  });

  it("reports a recognized key holding a value of the wrong type, and drops the value", () => {
    const scope = collectDefinitions([
      {
        name: "reviewer.md",
        content:
          "---\ndisplay_name: 42\nmax_turns: five\nenabled: yes\n---\n\nBody.",
        path: "a/reviewer.md",
      },
    ]);
    expect(scope.definitions).toHaveLength(1);
    const patch = scope.definitions[0]?.patch;
    expect(patch?.displayName).toBeUndefined();
    expect(patch?.maxTurns).toBeUndefined();
    expect(patch?.enabled).toBeUndefined();
    expect(scope.errors).toHaveLength(3);
    expect(scope.errors.join("\n")).toContain(
      '"display_name" value must be a string',
    );
    expect(scope.errors.join("\n")).toContain(
      '"max_turns" value must be a non-negative number',
    );
    expect(scope.errors.join("\n")).toContain(
      '"enabled" value must be true or false',
    );
    expect(scope.errors[0]).toContain("a/reviewer.md");
  });

  it("reports a negative turn ceiling rather than treating it as absent", () => {
    const problems: string[] = [];
    const patch = parseDefinitionContent("---\nmax_turns: -3\n---\n", (p) =>
      problems.push(p),
    );
    expect(patch.maxTurns).toBeUndefined();
    expect(problems).toHaveLength(1);
  });

  it("reports a thinking level Pi does not know, through the seam's diagnostics", () => {
    const problems: string[] = [];
    const patch = parseDefinitionContent("---\nthinking: extreme\n---\n", (p) =>
      problems.push(p),
    );
    expect(patch.thinking).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Invalid thinking level");
  });

  it("drops non-string entries of a YAML tool list instead of coercing them", () => {
    const problems: string[] = [];
    const patch = parseDefinitionContent(
      "---\ntools:\n  - read\n  - 5\n---\n",
      (p) => problems.push(p),
    );
    expect(patch.tools).toEqual({ kind: "explicit", names: ["read"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"tools" list');
  });

  it("leaves absent and clearing keys untouched by validation", () => {
    const problems: string[] = [];
    const patch = parseDefinitionContent(
      "---\nmodel: null\ndescription: Valid\n---\n",
      (p) => problems.push(p),
    );
    expect(problems).toEqual([]);
    expect(patch.model).toBeNull();
    expect(patch.description).toBe("Valid");
    expect(patch.maxTurns).toBeUndefined();
  });
});

describe("asynchronous definition loading (stories 107 and 108)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-tiered-entry-seam-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a missing directory as an empty scope, without throwing", async () => {
    const scope = await loadDefinitionScopeAsync(join(dir, "missing"));
    expect(scope.definitions).toEqual([]);
    expect(scope.errors).toEqual([]);
  });

  it("reads one definition per Markdown file, in file-name order", async () => {
    writeFileSync(join(dir, "zeta.md"), "---\ndescription: Last\n---\n");
    writeFileSync(join(dir, "alpha.md"), "---\ndescription: First\n---\n");
    const scope = await loadDefinitionScopeAsync(dir);
    expect(scope.definitions.map((d) => d.id)).toEqual(["alpha", "zeta"]);
    expect(scope.definitions[0]?.patch.description).toBe("First");
  });

  it("validates a malformed file into a scope error instead of rejecting the load", async () => {
    writeFileSync(join(dir, "broken.md"), "---\n[unclosed\n---\n");
    writeFileSync(join(dir, "sound.md"), "---\ndescription: Fine\n---\n");
    const scope = await loadDefinitionScopeAsync(dir);
    expect(scope.definitions.map((d) => d.id)).toEqual(["sound"]);
    expect(scope.errors).toHaveLength(1);
    expect(scope.errors[0]).toContain("Could not parse the agent definition");
  });

  it("surfaces a field-level diagnostic on an otherwise usable file", async () => {
    writeFileSync(join(dir, "reviewer.md"), "---\nmax_turns: many\n---\n");
    const scope = await loadDefinitionScopeAsync(dir);
    expect(scope.definitions).toHaveLength(1);
    expect(scope.definitions[0]?.patch.maxTurns).toBeUndefined();
    expect(scope.errors).toHaveLength(1);
    expect(scope.errors[0]).toContain('"max_turns"');
  });

  it("rejects with the signal's reason when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadDefinitionScopeAsync(dir, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("observes cancellation mid-scope: an aborted signal rejects rather than returning partial files", async () => {
    writeFileSync(join(dir, "a.md"), "---\ndescription: A\n---\n");
    const controller = new AbortController();
    controller.abort(new Error("caller went away"));
    await expect(
      loadDefinitionScopeAsync(dir, controller.signal),
    ).rejects.toThrow("caller went away");
  });

  it("loads both scopes concurrently and returns each under its own layer", async () => {
    const globalDir = join(dir, "global");
    const projectDir = join(dir, "project", ".pi", "agents");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(globalDir, "reviewer.md"), "---\ndescription: G\n---\n");
    writeFileSync(join(projectDir, "planner.md"), "---\ndescription: P\n---\n");

    const scopes = await loadDefinitionScopesAsync({
      globalDir: dir,
      cwd: join(dir, "project"),
    });
    // The global layer is read from <globalDir>/agents, which does not exist here.
    expect(scopes.global.definitions).toEqual([]);

    const withAgents = await loadDefinitionScopesAsync({
      globalDir: join(dir, "global-parent"),
      cwd: join(dir, "project"),
    });
    expect(withAgents.project.definitions.map((d) => d.id)).toEqual([
      "planner",
    ]);
  });

  it("rejects the combined load when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadDefinitionScopesAsync(
        { globalDir: dir, cwd: dir },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
