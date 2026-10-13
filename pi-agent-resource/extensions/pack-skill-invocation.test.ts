import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MultiSelect, Picker } from "@code-fixer-23/pi-form-components";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.path,
}));
import registerPack from "./pack";
import { NodeFileSystem } from "../shared/filesystem";

type Factory = (
  tui: TUI,
  theme: Theme,
  keyboard: unknown,
  done: (value: unknown) => void,
) => Component;

describe("pack-first skill invocation", () => {
  let firstSkill: string;
  let secondSkill: string;
  let otherSkill: string;
  const original =
    "---\nname: review\ndescription: Review code\n---\nKeep instructions\n";
  const disabled =
    "---\nname: deploy\ndescription: Deploy code\ndisable-model-invocation: true\n---\nKeep deployment instructions\n";
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 40, columns: 120 },
  } as unknown as TUI;
  const notify = vi.fn();
  const reload = vi.fn();
  const getCommands = vi.fn(() => []);

  function commands() {
    const registerCommand = vi.fn();
    registerPack({
      registerCommand,
      registerFlag: vi.fn(),
      on: vi.fn(),
      getCommands,
    } as unknown as ExtensionAPI);
    return registerCommand.mock.calls;
  }

  function context(custom: ReturnType<typeof vi.fn>, mode = "tui") {
    return {
      cwd: home.path,
      mode,
      ui: { custom, notify },
      reload,
    } as unknown as ExtensionCommandContext;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    home.path = await mkdtemp(join(tmpdir(), "pi-pack-invocation-"));
    firstSkill = join(
      home.path,
      ".pi",
      "packs",
      "alpha",
      "skills",
      "review",
      "SKILL.md",
    );
    secondSkill = join(
      home.path,
      ".pi",
      "packs",
      "alpha",
      "skills",
      "deploy",
      "SKILL.md",
    );
    otherSkill = join(
      home.path,
      ".pi",
      "packs",
      "beta",
      "skills",
      "review",
      "SKILL.md",
    );
    for (const path of [firstSkill, secondSkill, otherSkill])
      await mkdir(join(path, ".."), { recursive: true });
    await writeFile(firstSkill, original);
    await writeFile(secondSkill, disabled);
    await writeFile(otherSkill, original);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(home.path, { recursive: true, force: true });
  });

  it("filters pack selection and never edits skills in a different pack", async () => {
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          if (step++ === 0) {
            for (const key of "beta") component.handleInput?.(key);
            component.handleInput?.("\r");
          } else {
            const rendered = component.render(120).join("\n");
            expect(rendered).toContain("Pack 'beta'");
            expect(rendered).not.toContain("deploy");
            component.handleInput?.(" ");
            component.handleInput?.("\r");
          }
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(await readFile(firstSkill, "utf8")).toBe(original);
    expect(await readFile(secondSkill, "utf8")).toBe(disabled);
    expect(await readFile(otherSkill, "utf8")).toContain(
      "disable-model-invocation: true",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("discovers nested and standalone skills using Pi's pack loading rules", async () => {
    const skillsRoot = join(home.path, ".pi", "packs", "alpha", "skills");
    await rm(skillsRoot, { recursive: true });
    const nested = join(skillsRoot, "group", "nested", "SKILL.md");
    const standalone = join(skillsRoot, "standalone.md");
    await mkdir(join(nested, ".."), { recursive: true });
    const nestedContent =
      "---\nname: nested\ndescription: Nested skill\n---\nNested instructions\n";
    const standaloneContent =
      "---\nname: standalone\ndescription: Standalone skill\n---\nStandalone instructions\n";
    await writeFile(nested, nestedContent);
    await writeFile(standalone, standaloneContent);
    await writeFile(join(skillsRoot, "notes.txt"), "Not a skill");
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          if (step++ !== 0) {
            const rendered = component.render(120).join("\n");
            expect(rendered).toContain("[ ] nested");
            expect(rendered).toContain("[ ] standalone");
            expect(rendered).not.toContain("notes.txt");
            component.handleInput?.(" ");
          }
          component.handleInput?.("\r");
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(await readFile(nested, "utf8")).toContain(
      "disable-model-invocation: true",
    );
    expect(await readFile(standalone, "utf8")).toBe(standaloneContent);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    "file",
    "symlink",
  ])("reports malformed standalone %s skills while still saving valid pack skills", async (kind) => {
    const malformed = join(
      home.path,
      ".pi",
      "packs",
      "alpha",
      "skills",
      "broken.md",
    );
    const content =
      "---\nname: broken\ndescription: [\n---\nBroken standalone skill\n";
    await writeFile(malformed, content);
    if (kind === "symlink") {
      const readEntries = NodeFileSystem.prototype.readDirectoryEntries;
      vi.spyOn(
        NodeFileSystem.prototype,
        "readDirectoryEntries",
      ).mockImplementation(async (path) => {
        const result = await readEntries(path);
        if (!result.success) return result;
        return {
          success: true,
          data: result.data.map((entry) =>
            entry.name === "broken.md"
              ? {
                  name: entry.name,
                  isDirectory: () => false,
                  isFile: () => false,
                  isSymbolicLink: () => true,
                }
              : entry,
          ),
        };
      });
    }
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          if (step++ !== 0) {
            expect(component.render(120).join("\n")).not.toContain("broken");
            component.handleInput?.(" ");
          }
          component.handleInput?.("\r");
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(malformed),
      "warning",
    );
    expect(await readFile(malformed, "utf8")).toBe(content);
    expect(await readFile(secondSkill, "utf8")).toContain(
      "disable-model-invocation: false",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reports invalid pack skills without preventing changes to valid skills", async () => {
    await writeFile(
      secondSkill,
      "---\nname: deploy\ndescription: [\n---\nBroken skill",
    );
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          if (step++ !== 0) {
            expect(component.render(120).join("\n")).not.toContain("deploy");
            component.handleInput?.(" ");
          }
          component.handleInput?.("\r");
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Pack 'alpha':"),
      "warning",
    );
    expect(await readFile(firstSkill, "utf8")).toContain(
      "disable-model-invocation: true",
    );
    expect(await readFile(secondSkill, "utf8")).toBe(
      "---\nname: deploy\ndescription: [\n---\nBroken skill",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offers invocation only for pack skills, not pack prompts", async () => {
    const registered = commands();
    const skills = registered.find(
      ([name]) => name === "resource:pack:skill",
    )![1];
    const prompts = registered.find(
      ([name]) => name === "resource:pack:prompt",
    )![1];
    expect(skills.getArgumentCompletions("inv")).toEqual([
      expect.objectContaining({ value: "invocation" }),
    ]);
    expect(prompts.getArgumentCompletions("inv")).toEqual([]);
    const custom = vi.fn();
    await prompts.handler("invocation", context(custom));
    expect(custom).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    "pack",
    "skills",
  ])("cancels at the %s selection without writing or reloading", async (stage) => {
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          if (step++ === 0 && stage === "skills") component.handleInput?.("\r");
          else {
            if (stage === "skills") component.handleInput?.(" ");
            component.handleInput?.("\u001b");
          }
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(await readFile(firstSkill, "utf8")).toBe(original);
    expect(await readFile(secondSkill, "utf8")).toBe(disabled);
    expect(await readFile(otherSkill, "utf8")).toBe(original);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a missing pack store without opening the selector", async () => {
    await rm(join(home.path, ".pi", "packs"), { recursive: true });
    const custom = vi.fn();
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No packs found", "info");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a pack with no skills without opening a skill selector", async () => {
    await rm(join(home.path, ".pi", "packs", "alpha", "skills"), {
      recursive: true,
    });
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          factory(tui, theme, {}, done).handleInput?.("\r");
        }),
    );
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom));
    expect(custom).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("No editable skills found", "info");
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    "rpc",
    "json",
    "print",
  ])("requires TUI mode before selecting a pack in %s", async (mode) => {
    const custom = vi.fn();
    await commands()
      .find(([name]) => name === "resource:pack:skill")![1]
      .handler("invocation", context(custom, mode));
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill invocation settings require TUI mode",
      "error",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("selects an unloaded pack before toggling only its skills and reloading once", async () => {
    let step = 0;
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<unknown>((done) => {
          const component = factory(tui, theme, {}, done);
          const initial = component.render(120).join("\n");
          if (step++ === 0) {
            expect(component).toBeInstanceOf(Picker);
            expect(initial).toContain("alpha");
            expect(initial).toContain("beta");
            component.handleInput?.("\r");
          } else {
            expect(component).toBeInstanceOf(MultiSelect);
            expect(initial).toContain("alpha");
            expect(initial).toContain("[x] deploy");
            expect(initial).toContain("[ ] review");
            component.handleInput?.(" ");
            component.handleInput?.("\u001b[B");
            component.handleInput?.(" ");
            component.handleInput?.("\r");
          }
        }),
    );
    const skillCommand = commands().find(
      ([name]) => name === "resource:pack:skill",
    )![1];
    await skillCommand.handler("invocation", context(custom));

    expect(await readFile(firstSkill, "utf8")).toBe(
      "---\nname: review\ndescription: Review code\ndisable-model-invocation: true\n---\nKeep instructions\n",
    );
    expect(await readFile(secondSkill, "utf8")).toBe(
      disabled.replace(
        "disable-model-invocation: true",
        "disable-model-invocation: false",
      ),
    );
    expect(await readFile(otherSkill, "utf8")).toBe(original);
    expect(getCommands).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
