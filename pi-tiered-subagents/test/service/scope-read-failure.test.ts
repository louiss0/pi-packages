import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  loadDefinitionScope,
  loadDefinitionScopeAsync,
} from "#src/agents/loader";
import { createSubagentsHarness } from "#test/helpers/subagents-harness";

it("refuses a launch when a configured scope cannot be enumerated instead of using shipped defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-scope-failure-"));
  try {
    const path = join(dir, "agents");
    await writeFile(path, "not a directory");
    const project = await loadDefinitionScopeAsync(path);
    const h = await createSubagentsHarness({
      scopes: () => ({
        global: { definitions: [], errors: [] },
        project,
      }),
    });
    try {
      const outcome = await h.service.launch("explore", "must not fall back");
      expect(outcome).toMatchObject({
        kind: "rejected",
        reason: "configuration",
      });
      if (outcome.kind !== "rejected")
        throw new Error("failed scope was accepted");
      expect(outcome.message).toContain(path);
      expect(h.service.listAgents()).toEqual([]);
      expect(h.children.children).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps a genuinely missing optional scope usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-missing-scope-"));
  try {
    const project = await loadDefinitionScopeAsync(join(dir, "absent"));
    const h = await createSubagentsHarness({
      scopes: () => ({
        global: { definitions: [], errors: [] },
        project,
      }),
    });
    try {
      const outcome = await h.service.launch("explore", "normal shipped role");
      expect(outcome.kind).toBe("accepted");
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle();
      await h.service.waitForAll();
    } finally {
      await h.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([
  ["async", loadDefinitionScopeAsync],
  ["sync", loadDefinitionScope],
] as const)("rejects an unreadable override through the %s loader without blocking other agents", async (_mode, load) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-file-failure-"));
  try {
    const path = join(dir, "explore.md");
    await mkdir(path);
    const project = await load(dir);
    const h = await createSubagentsHarness({
      scopes: () => ({
        global: { definitions: [], errors: [] },
        project,
      }),
    });
    try {
      const outcome = await h.service.launch("explore", "unreadable override");
      expect(outcome).toMatchObject({
        kind: "rejected",
        reason: "configuration",
      });
      if (outcome.kind !== "rejected")
        throw new Error("unreadable override was accepted");
      expect(outcome.message).toContain(path);
      expect(h.service.listAgents()).toEqual([]);
      expect(h.children.children).toHaveLength(0);
      expect((await h.service.launch("reviewer", "unrelated role")).kind).toBe(
        "accepted",
      );
      const child = await h.children.childBorn(0);
      (await child.runStarted(0)).settle();
      await h.service.waitForAll();
    } finally {
      await h.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
