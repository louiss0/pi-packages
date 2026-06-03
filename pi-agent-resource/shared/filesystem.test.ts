import {
  getResourceFileSystem,
  resetResourceFileSystem,
  useMemoryResourceFileSystem,
} from "./filesystem";
import { resetDevelopmentExtensionNotice } from "./runtime";

describe("shared/filesystem", () => {
  let memoryFileSystem: ReturnType<typeof useMemoryResourceFileSystem>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetDevelopmentExtensionNotice();
    resetResourceFileSystem();
  });

  afterEach(() => {
    resetResourceFileSystem();
  });

  it("uses memfs when development mode is enabled", async () => {
    vi.stubEnv("MODE", "development");
    const fileSystem = getResourceFileSystem();

    await fileSystem.mkdir("/workspace/.pi/agents", { recursive: true });
    await fileSystem.writeFile(
      "/workspace/.pi/agents/test.md",
      "hello",
      "utf8",
    );

    await expect(
      fileSystem.readFile("/workspace/.pi/agents/test.md", "utf8"),
    ).resolves.toBe("hello");
  });

  it("can seed and clear the memory filesystem explicitly in tests", async () => {
    memoryFileSystem = useMemoryResourceFileSystem();
    memoryFileSystem.seed({
      "/workspace/.pi/prompts/test.md": "prompt",
    });

    await expect(
      getResourceFileSystem().readFile(
        "/workspace/.pi/prompts/test.md",
        "utf8",
      ),
    ).resolves.toBe("prompt");

    resetResourceFileSystem();
    memoryFileSystem = useMemoryResourceFileSystem();

    await expect(
      getResourceFileSystem().readFile(
        "/workspace/.pi/prompts/test.md",
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("removes files and directories with explicit methods", async () => {
    memoryFileSystem = useMemoryResourceFileSystem();
    const fileSystem = getResourceFileSystem();

    await fileSystem.mkdir("/workspace/.pi/agent/skills/test-skill", {
      recursive: true,
    });
    await fileSystem.writeFile(
      "/workspace/.pi/agent/skills/test-skill/SKILL.md",
      "skill",
      "utf8",
    );
    await fileSystem.removeFile(
      "/workspace/.pi/agent/skills/test-skill/SKILL.md",
    );

    await expect(
      fileSystem.readFile(
        "/workspace/.pi/agent/skills/test-skill/SKILL.md",
        "utf8",
      ),
    ).rejects.toThrow();

    await fileSystem.writeFile(
      "/workspace/.pi/agent/skills/test-skill/SKILL.md",
      "skill",
      "utf8",
    );
    await fileSystem.removeDirectory("/workspace/.pi/agent/skills/test-skill");

    await expect(
      fileSystem.readFile(
        "/workspace/.pi/agent/skills/test-skill/SKILL.md",
        "utf8",
      ),
    ).rejects.toThrow();
  });
});
