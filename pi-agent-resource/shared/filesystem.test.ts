import { getMemoryResourceFileSystem } from "./filesystem";

describe("shared/filesystem", () => {
  const memoryFileSystem = getMemoryResourceFileSystem();

  afterEach(() => {
    memoryFileSystem.reset();
  });

  it("uses memfs explicitly", async () => {
    const fileSystem = memoryFileSystem;

    await fileSystem.mkdir("/workspace/.pi/agents", { recursive: true });
    await fileSystem.writeFile("/workspace/.pi/agents/test.md", "hello");

    await expect(fileSystem.readFile("/workspace/.pi/agents/test.md")).resolves.toEqual({
      data: "hello",
      success: true,
    });
  });

  it("can seed and clear the memory filesystem explicitly in tests", async () => {
    memoryFileSystem.seed({
      "/workspace/.pi/prompts/test.md": "prompt",
    });

    await expect(memoryFileSystem.readFile("/workspace/.pi/prompts/test.md")).resolves.toEqual({
      data: "prompt",
      success: true,
    });

    memoryFileSystem.reset();

    await expect(
      memoryFileSystem.readFile("/workspace/.pi/prompts/test.md"),
    ).resolves.toMatchObject({
      success: false,
    });
  });

  it("removes files and directories with explicit methods", async () => {
    const fileSystem = memoryFileSystem;

    await fileSystem.mkdir("/workspace/.pi/agent/skills/test-skill", {
      recursive: true,
    });
    await fileSystem.writeFile("/workspace/.pi/agent/skills/test-skill/SKILL.md", "skill");
    await fileSystem.removeFile("/workspace/.pi/agent/skills/test-skill/SKILL.md");

    await expect(
      fileSystem.readFile("/workspace/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });

    await fileSystem.writeFile("/workspace/.pi/agent/skills/test-skill/SKILL.md", "skill");
    await fileSystem.removeDirectory("/workspace/.pi/agent/skills/test-skill");

    await expect(
      fileSystem.readFile("/workspace/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });
  });
});
