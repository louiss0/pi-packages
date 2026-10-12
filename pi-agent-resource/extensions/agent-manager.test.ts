import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryFileSystem, PathResolver } from "../shared/filesystem";
import { parseAgentMarkdown, renderAgentMarkdown, type AgentFrontmatter } from "../shared/agent-contracts";
const { author, filename } = vi.hoisted(() => ({ author: vi.fn(), filename: vi.fn() }));
vi.mock("../shared/agent-authoring", () => ({ authorAgentDefinition: author, askAgentFilename: filename }));
vi.mock("node:os", () => ({ homedir: () => "/test-home" }));
import registerAgentManager, { handleCreate, handleDelete, handleEdit, listAgentChoices, parseAgentCommandArgument } from "./agent-manager";

describe("agent manager", () => {
  const resolver = new PathResolver("/workspace", "/test-home");
  const path = resolver.resolveGlobalAgentPath("auditor.md");
  const original = "---\nname: security-review\ndescription: Review security\n---\nOriginal prompt\n";
  let fs: MemoryFileSystem;
  const ui = { input: vi.fn(), select: vi.fn(), editor: vi.fn(), notify: vi.fn(), confirm: vi.fn() };
  const ctx = () => ({ cwd: "/workspace", hasUI: true, ui }) as unknown as ExtensionContext;
  const options = { runtime: "tintin" as const };
  const getFs = () => fs;
  const getResolver = () => resolver;
  beforeEach(() => {
    vi.clearAllMocks();
    fs = new MemoryFileSystem();
    fs.reset();
    filename.mockResolvedValue("auditor");
    author.mockResolvedValue({ frontmatter: { name: "security-review", description: "Security: # careful", model: "anthropic/claude-opus-4-6", tools: ["read", "ext:mcp/search"] }, body: "Inspect auth.\n---\nKeep this delimiter in the prompt." });
    ui.confirm.mockResolvedValue(true);
    ui.select.mockImplementation(async (_title: string, labels: string[]) => labels[0]);
  });
  afterEach(() => { fs.reset(); vi.unstubAllEnvs(); });

  it("keeps both command names and rejects noninteractive mutation", async () => {
    const registerCommand = vi.fn();
    registerAgentManager({ registerCommand } as never);
    expect(registerCommand.mock.calls.map(([name]) => name)).toEqual(["resource:agent", "resource:local-agent"]);
    await registerCommand.mock.calls[0][1].handler("create", { hasUI: false, ui });
    expect(author).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Agent authoring requires interactive or RPC UI", "error");
    expect(parseAgentCommandArgument("create")).toMatchObject({ success: true, output: "create" });
    expect(parseAgentCommandArgument("unknown")).toMatchObject({ success: false });
  });

  it("creates safely serialized frontmatter and the complete prompt body", async () => {
    await handleCreate(ctx(), "global", getFs, getResolver, options);
    const result = await fs.readFile(path);
    expect(result).toEqual({ success: true, data: renderAgentMarkdown("tintin", (await author.mock.results[0].value).frontmatter, (await author.mock.results[0].value).body) });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Definition saved:"), "info");
    expect(ui.notify).not.toHaveBeenCalledWith("Agent created");
  });

  describe("agent definition serialization", () => {
    it.each(["tintin", "nico"] as const)("saves %s definitions readable by the selected contract", async (runtime) => {
      const definition: { frontmatter: AgentFrontmatter; body: string } = {
        frontmatter: runtime === "nico"
          ? { name: "security-review", description: "Security review", tools: "read, mcp:github/search_repositories", memory: { scope: "project", path: "reviewer" } }
          : { name: "security-review", description: "Security review", tools: ["read", "grep"], persist_session: false },
        body: "Inspect auth.\n---\nPreserve prompt delimiters.",
      };
      author.mockResolvedValue(definition);
      await handleCreate(ctx(), "global", getFs, getResolver, { runtime });
      const saved = await fs.readFile(path);
      expect(saved.success).toBe(true);
      if (!saved.success) throw saved.error;
      expect(saved.data).toBe(renderAgentMarkdown(runtime, definition.frontmatter, definition.body));
      expect(parseAgentMarkdown(runtime, saved.data)).toEqual(definition);
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Definition saved:"), "info");
    });

    it("preserves structured metadata and prompt content through an edit", async () => {
      const definition = { frontmatter: { name: "security-review", description: "Audit #1", tools: ["read", "grep"], extensions: false }, body: "Inspect auth.\n---\nKeep this line." };
      fs.seed({ [path]: renderAgentMarkdown("tintin", definition.frontmatter, definition.body) });
      author.mockImplementation(async (_ui, runtime, initial) => {
        expect(runtime).toBe("tintin");
        expect(initial).toEqual(definition);
        return { frontmatter: { ...initial.frontmatter, description: "Audit #2" }, body: initial.body };
      });
      await handleEdit(ctx(), "global", getFs, getResolver, options);
      const saved = await fs.readFile(path);
      expect(saved.success).toBe(true);
      if (!saved.success) throw saved.error;
      expect(parseAgentMarkdown("tintin", saved.data)).toEqual({
        frontmatter: { ...definition.frontmatter, description: "Audit #2" },
        body: definition.body,
      });
    });

    it("rejects invalid authored frontmatter before creating a file", async () => {
      author.mockResolvedValue({ frontmatter: { name: "security-review", tools: ["read"], unexpected: true }, body: "Prompt" });
      await handleCreate(ctx(), "global", getFs, getResolver, options);
      expect((await fs.readFile(path)).success).toBe(false);
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Agent creation failed"), "error");
    });
  });

  it("writes project definitions without requiring model/tools pins", async () => {
    author.mockResolvedValue({ frontmatter: {}, body: "Parent-specific instructions" });
    await handleCreate(ctx(), "local", getFs, getResolver, options);
    expect((await fs.readFile(resolver.resolveLocalAgentPath("auditor.md"))).success).toBe(true);
  });

  it("refuses preexisting files without opening authoring or overwriting", async () => {
    fs.seed({ [path]: original });
    await handleCreate(ctx(), "global", getFs, getResolver, options);
    expect(author).not.toHaveBeenCalled();
    expect(await fs.readFile(path)).toEqual({ success: true, data: original });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("already exists"), "error");
  });

  it("does not create directories or files when authoring is cancelled", async () => {
    author.mockResolvedValue(undefined);
    await handleCreate(ctx(), "global", getFs, getResolver, options);
    expect((await fs.readDirectoryEntries(resolver.resolveGlobalAgentPath())).success).toBe(false);
  });

  it("requires coexistence confirmation when both runtimes were detected", async () => {
    ui.confirm.mockResolvedValue(false);
    await handleCreate(ctx(), "global", getFs, getResolver, { ...options, detectedRuntimes: ["tintin", "nico"] });
    expect(ui.confirm).toHaveBeenCalledWith("Shared agent discovery location", expect.stringContaining("ignore unfamiliar permission restrictions"));
    expect((await fs.readFile(path)).success).toBe(false);
  });

  it("asks for a profile when detection is absent", async () => {
    filename.mockResolvedValue(undefined);
    await handleCreate(ctx(), "global", getFs, getResolver);
    expect(ui.select).toHaveBeenCalledWith(expect.stringContaining("detection is absent or ambiguous"), expect.any(Array));
  });

  it("leaves a file unchanged when known fields are not edited", async () => {
    fs.seed({ [path]: original });
    author.mockImplementation(async (_ui, _runtime, initial) => initial);
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect(await fs.readFile(path)).toEqual({ success: true, data: original });
    expect(ui.notify).toHaveBeenCalledWith("Definition unchanged", "info");
  });

  it.each(["unexpected: true", "model: [bad]", "name: first\nname: duplicate"]) ("refuses structured editing of invalid or unknown fields: %s", async (fields) => {
    const content = `---\n${fields}\n---\nKeep this body`;
    fs.seed({ [path]: content });
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect(author).not.toHaveBeenCalled();
    expect(await fs.readFile(path)).toEqual({ success: true, data: content });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Agent edit failed"), "error");
  });

  it("edits metadata without renaming the underlying file", async () => {
    fs.seed({ [path]: original });
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect((await fs.readFile(path)).success).toBe(true);
    expect((await fs.readFile(resolver.resolveGlobalAgentPath("security-review.md"))).success).toBe(false);
  });

  it("refuses to overwrite changes made during structured editing", async () => {
    fs.seed({ [path]: original });
    author.mockImplementation(async () => {
      await fs.writeFile(path, "external change");
      return { frontmatter: { name: "changed" }, body: "changed" };
    });
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect(await fs.readFile(path)).toEqual({ success: true, data: "external change" });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("changed outside"), "error");
  });

  it("requires explicit delete confirmation", async () => {
    fs.seed({ [path]: original });
    ui.confirm.mockResolvedValue(false);
    await handleDelete(ctx(), "global", getFs, getResolver, options);
    expect((await fs.readFile(path)).success).toBe(true);
    ui.confirm.mockResolvedValue(true);
    await handleDelete(ctx(), "global", getFs, getResolver, options);
    expect((await fs.readFile(path)).success).toBe(false);
  });

  it("lists only files, uses runtime identity and includes distinguishing source paths", async () => {
    fs.seed({ [path]: original, [resolver.resolveGlobalAgentPath("notes.txt")]: "notes", [resolver.resolveGlobalAgentPath("security-review.md")]: original });
    await fs.mkdir(resolver.resolveGlobalAgentPath("folder.md"), { recursive: true });
    const choices = await listAgentChoices("global", "tintin", fs, resolver);
    expect(choices).toHaveLength(2);
    expect(choices.every((choice) => choice.label.includes("security-review"))).toBe(true);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(2);
  });

  it("recurses for Nico, skips chains, and includes legacy project files", async () => {
    fs.seed({
      [resolver.resolveLocalAgentPath("nested/scout.md")]: "---\nname: scout\ndescription: Recon\npackage: analysis\n---\nInspect code",
      [resolver.resolveLocalAgentPath("flow.chain.md")]: "not an agent",
      [join("/workspace", ".agents", "legacy.md")]: "---\nname: legacy\ndescription: Recon\n---\nInspect code",
    });
    const choices = await listAgentChoices("local", "nico", fs, resolver);
    expect(choices).toHaveLength(2);
    expect(choices.some((choice) => choice.label.includes("analysis.scout"))).toBe(true);
    expect(choices.some((choice) => choice.label.includes("legacy"))).toBe(true);
  });

  it("does not turn a permissions error into an empty list", async () => {
    vi.spyOn(fs, "readDirectoryEntries").mockResolvedValue({ success: false, error: new Error("permission denied") });
    await expect(listAgentChoices("global", "tintin", fs, resolver)).rejects.toThrow("permission denied");
  });
});
