import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { MultiSelect } from "@code-fixer-23/pi-form-components";
import registerSkillManager from "./skill-manager";
import { NodeFileSystem } from "../shared/filesystem";

type Factory = (
  tui: TUI,
  theme: Theme,
  keyboard: unknown,
  done: (value: string[] | null) => void,
) => Component;

describe("skill invocation command", () => {
  let directory: string;
  let globalPath: string;
  let localPath: string;
  let commands: ReturnType<ExtensionAPI["getCommands"]>;
  const globalContent =
    "---\nname: review\ndescription: Global review\n---\nGlobal instructions\n";
  const localContent =
    "---\nname: review\ndescription: Local review\ndisable-model-invocation: true\n---\nLocal instructions\n";
  const notify = vi.fn();
  const reload = vi.fn();
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 40, columns: 120 },
  } as unknown as TUI;

  function command() {
    const registerCommand = vi.fn();
    registerSkillManager({
      registerCommand,
      registerFlag: vi.fn(),
      getCommands: () => commands,
    } as unknown as ExtensionAPI);
    const entry = registerCommand.mock.calls.find(
      ([name]) => name === "resource:skill:invocation",
    );
    expect(entry, "the invocation command is registered").toBeDefined();
    return entry![1] as {
      handler: (arg: string, ctx: ExtensionCommandContext) => Promise<void>;
    };
  }

  function context(custom: ReturnType<typeof vi.fn>, mode = "tui") {
    return {
      cwd: directory,
      mode,
      ui: { custom, notify },
      reload,
    } as unknown as ExtensionCommandContext;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), "pi-skill-invocation-"));
    globalPath = join(directory, "global.md");
    localPath = join(directory, "local.md");
    await writeFile(globalPath, globalContent);
    await writeFile(localPath, localContent);
    commands = [
      {
        name: "skill:review",
        source: "skill",
        description: "Global review",
        sourceInfo: {
          path: globalPath,
          scope: "user",
          source: "local",
          origin: "top-level",
        },
      },
      {
        name: "skill:review",
        source: "skill",
        description: "Local review",
        sourceInfo: {
          path: localPath,
          scope: "project",
          source: "local",
          origin: "top-level",
        },
      },
      {
        name: "prompt",
        source: "prompt",
        sourceInfo: {
          path: "not-a-skill.md",
          scope: "user",
          source: "local",
          origin: "top-level",
        },
      },
    ];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("reports write failures without claiming success or reloading", async () => {
    vi.spyOn(NodeFileSystem.prototype, "writeFile").mockResolvedValue({
      success: false,
      error: new Error("Permission denied"),
    });
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          const component = factory(tui, theme, {}, done);
          component.handleInput?.(" ");
          component.handleInput?.("\r");
        }),
    );
    await command().handler("", context(custom));
    expect(await readFile(globalPath, "utf8")).toBe(globalContent);
    expect(await readFile(localPath, "utf8")).toBe(localContent);
    expect(notify).toHaveBeenCalledWith(
      `Cannot save skill ${globalPath}: Permission denied`,
      "error",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("deduplicates a skill path shared by multiple catalog entries", async () => {
    commands.splice(1, 0, commands[0]);
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          const component = factory(tui, theme, {}, done);
          expect(
            component
              .render(120)
              .join("\n")
              .match(/review \(global\)/g),
          ).toHaveLength(1);
          component.handleInput?.(" ");
          component.handleInput?.("\r");
        }),
    );
    await command().handler("", context(custom));
    expect(await readFile(globalPath, "utf8")).toContain(
      "disable-model-invocation: true",
    );
    expect(await readFile(localPath, "utf8")).toBe(localContent);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a skill changed while the list was open, but reloads successfully saved changes", async () => {
    const custom = vi.fn(async (factory: Factory) => {
      const selected = await new Promise<string[] | null>((done) => {
        const component = factory(tui, theme, {}, done);
        component.handleInput?.(" ");
        component.handleInput?.("\u001b[B");
        component.handleInput?.(" ");
        component.handleInput?.("\r");
      });
      await writeFile(globalPath, globalContent + "External edit\n");
      return selected;
    });
    await command().handler("", context(custom));
    expect(await readFile(globalPath, "utf8")).toBe(
      globalContent + "External edit\n",
    );
    expect(await readFile(localPath, "utf8")).toContain(
      "disable-model-invocation: false",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("file changed while the picker was open"),
      "error",
    );
    expect(notify).toHaveBeenCalledWith(
      "Saved 1 skill invocation change(s); 1 failed. Reloading skills...",
      "warning",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    "malformed",
    "unreadable",
  ])("reports and skips a %s skill without blocking the other scope", async (failure) => {
    if (failure === "malformed")
      await writeFile(globalPath, "---\nname: [\n---\nBody");
    else await rm(globalPath);
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          const component = factory(tui, theme, {}, done);
          const rendered = component.render(120).join("\n");
          expect(rendered).toContain("review (local)");
          expect(rendered).not.toContain("review (global)");
          component.handleInput?.(" ");
          component.handleInput?.("\r");
        }),
    );
    await command().handler("", context(custom));
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(`Cannot edit skill ${globalPath}`),
      "error",
    );
    expect(await readFile(localPath, "utf8")).toContain(
      "disable-model-invocation: false",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("discards staged toggles on Esc without reloading or writing", async () => {
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          const component = factory(tui, theme, {}, done);
          component.handleInput?.(" ");
          component.handleInput?.("\u001b");
        }),
    );
    await command().handler("", context(custom));
    expect(await readFile(globalPath, "utf8")).toBe(globalContent);
    expect(await readFile(localPath, "utf8")).toBe(localContent);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when the user finishes even if the selection is unchanged", async () => {
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          factory(tui, theme, {}, done).handleInput?.("\r");
        }),
    );
    await command().handler("", context(custom));
    expect(await readFile(globalPath, "utf8")).toBe(globalContent);
    expect(await readFile(localPath, "utf8")).toBe(localContent);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reports an empty skill catalog without opening a picker or reloading", async () => {
    commands = commands.filter((command) => command.source !== "skill");
    const custom = vi.fn();
    await command().handler("", context(custom));
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No editable skills found", "info");
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    "rpc",
    "json",
    "print",
  ])("requires TUI mode instead of changing skills in %s mode", async (mode) => {
    const custom = vi.fn();
    await command().handler("", context(custom, mode));
    expect(custom).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Skill invocation settings require TUI mode",
      "error",
    );
    expect(await readFile(globalPath, "utf8")).toBe(globalContent);
  });

  it("shows global and local skills in a preselected pi-form-components list, saves both directions and reloads once", async () => {
    const custom = vi.fn(
      (factory: Factory) =>
        new Promise<string[] | null>((done) => {
          const component = factory(tui, theme, {}, done);
          const initial = component.render(120).join("\n");
          expect(initial).toContain("[ ] review (global)");
          expect(initial).toContain("[x] review (local)");
          expect(initial).toContain(globalPath);
          expect(initial).not.toContain("not-a-skill");
          expect(initial).toContain("Checked = disable-model-invocation: true");
          expect(component).toBeInstanceOf(MultiSelect);
          component.handleInput?.(" ");
          component.handleInput?.("\u001b[B");
          component.handleInput?.(" ");
          component.handleInput?.("\r");
        }),
    );

    await command().handler("", context(custom));

    expect(await readFile(globalPath, "utf8")).toBe(
      "---\nname: review\ndescription: Global review\ndisable-model-invocation: true\n---\nGlobal instructions\n",
    );
    expect(await readFile(localPath, "utf8")).toBe(
      "---\nname: review\ndescription: Local review\ndisable-model-invocation: false\n---\nLocal instructions\n",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
