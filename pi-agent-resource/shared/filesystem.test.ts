import { getMemoryResourceFileSystem } from "./filesystem";

describe("shared/filesystem", () => {
  const memoryFileSystem = getMemoryResourceFileSystem();

  afterEach(() => {
    memoryFileSystem.reset();
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

    await expect(memoryFileSystem.readFile("/.pi/prompts/test.md")).resolves.toEqual({
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
    await fileSystem.writeFile("/.pi/agent/skills/test-skill/SKILL.md", "skill");
    await fileSystem.removeFile("/.pi/agent/skills/test-skill/SKILL.md");

    await expect(
      fileSystem.readFile("/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });

    await fileSystem.writeFile("/.pi/agent/skills/test-skill/SKILL.md", "skill");
    await fileSystem.removeDirectory("/.pi/agent/skills/test-skill");

    await expect(
      fileSystem.readFile("/.pi/agent/skills/test-skill/SKILL.md"),
    ).resolves.toMatchObject({
      success: false,
    });
  });
});
