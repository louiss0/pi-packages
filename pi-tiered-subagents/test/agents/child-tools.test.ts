/**
 * What a child session actually holds.
 *
 * The specification is explicit that a requested tool-name list is not proof:
 * "a requested tool-name list alone is not proof that the actual child has the
 * intended tools after extensions initialize". These tests create a real Pi
 * session and read its active tools back.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A session with the given tools active, created by the real SDK. */
async function createSessionWithTools(tools: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pi-tiered-child-"));
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const modelRegistry = new ModelRegistry({
    getModel: () => undefined,
  } as never);

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    modelRegistry: modelRegistry as never,
    tools,
  } as never);

  return session;
}

describe("a child session's tools", () => {
  it("holds a built-in tool the parent never had active", async () => {
    const session = await createSessionWithTools(["read", "grep"]);
    const active = session.getActiveToolNames();
    expect(active).toContain("grep");
    expect(active).toContain("read");
  });

  it("holds only the tools it was given", async () => {
    const session = await createSessionWithTools(["read", "grep", "find"]);
    const active = session.getActiveToolNames();
    expect(active).toContain("read");
    expect(active).toContain("grep");
    expect(active).toContain("find");
    // The parent's shell and editing tools are not in the child's list.
    expect(active).not.toContain("bash");
    expect(active).not.toContain("write");
  });

  it("holds no capability tool at all when the list is empty", async () => {
    const session = await createSessionWithTools([]);
    expect(session.getActiveToolNames()).toEqual([]);
  });
});
