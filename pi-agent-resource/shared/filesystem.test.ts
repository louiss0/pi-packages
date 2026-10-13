import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryFileSystem, NodeFileSystem, PathResolver } from "./filesystem";

describe("shared/filesystem", () => {
  const memoryFileSystem = new MemoryFileSystem();

  afterEach(() => {
    memoryFileSystem.reset();
    vi.unstubAllEnvs();
  });

  it("uses memfs explicitly", async () => {
    const fileSystem = memoryFileSystem;

    await fileSystem.mkdir("/.pi/agents", { recursive: true });
    await fileSystem.writeFile("/.pi/agents/test.md", "hello");

    await expect(fileSystem.readFile("/.pi/agents/test.md")).resolves.toEqual({
      data: "hello",
      success: true,
    });
  });

  it("can seed and clear the memory filesystem explicitly in tests", async () => {
    memoryFileSystem.seed({
      "/.pi/prompts/test.md": "prompt",
    });

    await expect(
      memoryFileSystem.readFile("/.pi/prompts/test.md"),
    ).resolves.toEqual({
      data: "prompt",
      success: true,
    });

    memoryFileSystem.reset();

    await expect(
      memoryFileSystem.readFile("/.pi/prompts/test.md"),
    ).resolves.toMatchObject({
      success: false,
    });
  });

  it("removes files and directories with explicit methods", async () => {
    const fileSystem = memoryFileSystem;

    await fileSystem.mkdir("/.pi/agent/skills/test-skill", {
      recursive: true,
    });
    await fileSystem.writeFile(
      "/.pi/agent/skills/test-skill/SKILL.md",
      "skill",
    );
    await fileSystem.removeFile("/.pi/agent/skills/test-skill/SKILL.md");

    await expect(
      fileSystem.readFile("/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });

    await fileSystem.writeFile(
      "/.pi/agent/skills/test-skill/SKILL.md",
      "skill",
    );
    await fileSystem.removeDirectory("/.pi/agent/skills/test-skill");

    await expect(
      fileSystem.readFile("/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });
  });

  it("resolves agent paths with the dedicated agents folders", () => {
    const pathResolver = new PathResolver("/workspace", "/test-home");

    expect(pathResolver.resolveLocalAgentPath()).toBe(
      join("/workspace", ".pi", "agents"),
    );
    expect(pathResolver.resolveLocalAgentPath("oracle.md")).toBe(
      join("/workspace", ".pi", "agents", "oracle.md"),
    );

    expect(pathResolver.resolveGlobalAgentPath()).toBe(
      join("/test-home", ".pi", "agent", "agents"),
    );
    expect(pathResolver.resolveGlobalAgentPath("oracle.md")).toBe(
      join("/test-home", ".pi", "agent", "agents", "oracle.md"),
    );

    expect(pathResolver.resolvePackAgentPath("team-pack", "oracle.md")).toBe(
      join("/test-home", ".pi", "packs", "team-pack", "agents", "oracle.md"),
    );
  });

  it("honors relocated Pi agent state including tilde expansion", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "~/custom-pi");
    expect(
      new PathResolver("/workspace", "/test-home").resolveGlobalAgentPath(
        "a.md",
      ),
    ).toBe(join("/test-home", "custom-pi", "agents", "a.md"));
  });

  it("exclusive memory writes never overwrite an existing file", async () => {
    memoryFileSystem.seed({ "/agents/a.md": "original" });
    expect(
      (
        await memoryFileSystem.writeFile("/agents/a.md", "changed", {
          exclusive: true,
        })
      ).success,
    ).toBe(false);
    expect(await memoryFileSystem.readFile("/agents/a.md")).toEqual({
      success: true,
      data: "original",
    });
  });

  it("publishes Node files atomically, refuses collisions, and removes temporary files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-resource-"));
    const path = join(directory, "agent.md");
    const fs = new NodeFileSystem();
    try {
      expect(
        (await fs.writeFile(path, "first", { atomic: true, exclusive: true }))
          .success,
      ).toBe(true);
      expect(
        (
          await fs.writeFile(path, "collision", {
            atomic: true,
            exclusive: true,
          })
        ).success,
      ).toBe(false);
      expect(await fs.readFile(path)).toEqual({ success: true, data: "first" });
      expect(
        (await fs.writeFile(path, "edited", { atomic: true })).success,
      ).toBe(true);
      expect(await fs.readFile(path)).toEqual({
        success: true,
        data: "edited",
      });
      expect(await fs.readDirectoryNames(directory)).toEqual({
        success: true,
        data: ["agent.md"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
