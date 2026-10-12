import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryFileSystem, PathResolver } from "../shared/filesystem";
import { parseAgentMarkdown, renderAgentMarkdown, type AgentFrontmatter } from "../shared/agent-contracts";
const { author, filename } = vi.hoisted(() => ({ author: vi.fn(), filename: vi.fn() }));
vi.mock("../shared/agent-authoring", () => ({ authorAgentDefinition: author, askAgentFilename: filename }));
vi.mock("node:os", async (importOriginal) => ({ ...await importOriginal<typeof import("node:os")>(), homedir: () => "/test-home" }));
import registerAgentManager, { handleCreate, handleDelete, handleEdit, listAgentChoices, parseAgentCommandArgument } from "./agent-manager";

describe("agent manager", () => {
  const resolver = new PathResolver("/workspace", "/test-home");
  const path = resolver.resolveGlobalAgentPath("auditor.md");
  const original = "---\nname: security-review\ndescription: Review security issues in the codebase\ntools: read,grep\nmodel: claude\n---\nOriginal prompt\n";
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
    author.mockResolvedValue({ frontmatter: { name: "security-review", description: "Review security issues in the codebase", model: "claude", tools: "read,grep" }, body: "Inspect auth.\n---\nKeep this delimiter in the prompt." });
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
          ? { name: "security-review", description: "Review security issues in the codebase", tools: "read,grep", model: "claude", memory: { scope: "project", path: "reviewer" } }
          : { name: "security-review", description: "Review security issues in the codebase", tools: "read,grep", model: "claude", persist_session: false },
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
      const definition = { frontmatter: { name: "security-review", description: "Audit code and report any security issues found", tools: "read,grep", model: "claude", extensions: false }, body: "Inspect auth.\n---\nKeep this line." };
      fs.seed({ [path]: renderAgentMarkdown("tintin", definition.frontmatter, definition.body) });
      author.mockImplementation(async (_ui, runtime, initial) => {
        expect(runtime).toBe("tintin");
        expect(initial).toEqual(definition);
        return { frontmatter: { ...initial.frontmatter, description: "Audit code and report serious security issues" }, body: initial.body };
      });
      await handleEdit(ctx(), "global", getFs, getResolver, options);
      const saved = await fs.readFile(path);
      expect(saved.success).toBe(true);
      if (!saved.success) throw saved.error;
      expect(parseAgentMarkdown("tintin", saved.data)).toEqual({
        frontmatter: { ...definition.frontmatter, description: "Audit code and report serious security issues" },
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

  it("rejects project definitions without the four essential fields", async () => {
    author.mockResolvedValue({ frontmatter: {}, body: "Parent-specific instructions" });
    await handleCreate(ctx(), "local", getFs, getResolver, options);
    expect((await fs.readFile(resolver.resolveLocalAgentPath("auditor.md"))).success).toBe(false);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Tools are required"), "error");
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

  it("leaves legacy definitions readable when no changes are saved", async () => {
    const legacy = "---\nname: MixedCase\ndescription: Brief\n---\nOriginal prompt\n";
    fs.seed({ [path]: legacy });
    author.mockImplementation(async (_ui, _runtime, initial) => initial);
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect(await fs.readFile(path)).toEqual({ success: true, data: legacy });
    expect(ui.notify).toHaveBeenCalledWith("Definition unchanged", "info");
  });

  it("refuses changed edits that still omit essential fields", async () => {
    const legacy = "---\nname: reviewer\ndescription: Brief\n---\nOriginal prompt\n";
    fs.seed({ [path]: legacy });
    author.mockImplementation(async (_ui, _runtime, initial) => ({ ...initial, body: "Updated prompt" }));
    await handleEdit(ctx(), "global", getFs, getResolver, options);
    expect(await fs.readFile(path)).toEqual({ success: true, data: legacy });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Tools are required"), "error");
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
      return { frontmatter: { name: "changed", description: "Review code and report potential issues thoroughly", tools: "read", model: "claude" }, body: "changed" };
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

  describe("pinned upstream agent loaders (Tintin 0.19.0, Nico 0.77.0)", () => {
    async function discoverNico(markdown: string) {
      const directory = mkdtempSync(join(tmpdir(), "pi-agent-nico-"));
      try {
        const agentsDir = join(directory, ".pi", "agents");
        mkdirSync(agentsDir, { recursive: true });
        writeFileSync(join(agentsDir, "auditor.md"), markdown);
        const { discoverAgents } = await import("../node_modules/pi-subagents/src/agents/agents.js");
        return discoverAgents(directory, "project", undefined, { globalNpmRoot: null });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }

    it("distinguishes loader-required fields from the stricter authoring policy", async () => {
      const minimalNico = await discoverNico("---\nname: reviewer\ndescription: A shorter runtime-valid description\n---\nReview code.");
      expect(minimalNico.agentDiagnostics ?? []).toEqual([]);
      expect(minimalNico.agents.find((agent) => agent.name === "reviewer")).toMatchObject({ description: "A shorter runtime-valid description" });
      expect(minimalNico.agents.find((agent) => agent.name === "reviewer")?.tools).toBeUndefined();
      expect(minimalNico.agents.find((agent) => agent.name === "reviewer")?.model).toBeUndefined();
      const missingDescription = await discoverNico("---\nname: reviewer\n---\nReview code.");
      expect(missingDescription.agents.some((agent) => agent.name === "reviewer" && agent.filePath?.endsWith("auditor.md"))).toBe(false);

      const directory = mkdtempSync(join(tmpdir(), "pi-agent-tintin-"));
      try {
        const agentsDir = join(directory, ".pi", "agents");
        mkdirSync(agentsDir, { recursive: true });
        writeFileSync(join(agentsDir, "reviewer.md"), "---\nname: reviewer\n---\nReview code.");
        const { loadCustomAgents } = await import("../node_modules/@tintinweb/pi-subagents/src/custom-agents");
        const loaded = loadCustomAgents(directory, true).get("reviewer");
        expect(loaded).toMatchObject({ name: "reviewer", description: "reviewer", model: undefined });
        expect(loaded?.builtinToolNames?.length).toBeGreaterThan(0);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("loads Nico structured budget metadata without parser diagnostics", async () => {
      const markdown = renderAgentMarkdown("nico", {
        name: "reviewer", description: "Review security issues in the codebase",
        tools: "read,grep", model: "claude",
        toolBudget: { hard: 12, soft: 8, block: ["bash"] },
      }, "Inspect auth and report findings.");
      const discovered = await discoverNico(markdown);
      expect(discovered.agentDiagnostics ?? []).toEqual([]);
      expect(discovered.agents.find((agent) => agent.name === "reviewer")?.toolBudget).toEqual({ hard: 12, soft: 8, block: ["bash"] });
    });

    it("loads Nico JSON Schema metadata through its JSON parser", async () => {
      const schema = { type: "object", properties: { status: { type: "string" } } };
      const markdown = renderAgentMarkdown("nico", {
        name: "reviewer", description: "Review security issues in the codebase",
        tools: "read,grep", model: "claude", outputSchema: schema,
      }, "Inspect auth.");
      const discovered = await discoverNico(markdown);
      expect(discovered.agentDiagnostics ?? []).toEqual([]);
      expect(discovered.agents.find((agent) => agent.name === "reviewer")?.outputSchema).toEqual(schema);
    });

    it("loads Nico list-valued selectors without retaining YAML item quotes", async () => {
      const markdown = renderAgentMarkdown("nico", {
        name: "reviewer", description: "Review security issues in the codebase",
        tools: "read,grep", model: "claude", allowedAgents: ["scout"],
      }, "Inspect auth.");
      const discovered = await discoverNico(markdown);
      expect(discovered.agentDiagnostics ?? []).toEqual([]);
      expect(discovered.agents.find((agent) => agent.name === "reviewer")?.allowedAgents).toEqual(["scout"]);
    });

    it("refuses an empty list that Nico's loader treats as a literal selector", async () => {
      const raw = "---\nname: reviewer\ndescription: Review security issues in the codebase\ntools: read,grep\nmodel: claude\nextensions: []\n---\nInspect auth.";
      const discovered = await discoverNico(raw);
      expect(discovered.agents.find((agent) => agent.name === "reviewer")?.extensions).toEqual(["[]"]);
      expect(() => renderAgentMarkdown("nico", {
        name: "reviewer", description: "Review security issues in the codebase",
        tools: "read,grep", model: "claude", extensions: [],
      }, "Inspect auth.")).toThrow('extensions: Nico reads an empty YAML list as the literal selector "[]"');
    });

    it.each(["tintin", "nico"] as const)("loads manager-authored %s definitions from a project", async (runtime) => {
      const directory = mkdtempSync(join(tmpdir(), "pi-agent-loader-"));
      try {
        const frontmatter = {
          name: "security-review",
          description: "Review security issues in the codebase",
          tools: "read,grep",
          model: "claude",
        };
        author.mockResolvedValue({ frontmatter, body: "Inspect auth and report findings." });
        await handleCreate(ctx(), "global", getFs, getResolver, { runtime });
        const saved = await fs.readFile(path);
        expect(saved.success).toBe(true);
        if (!saved.success) throw saved.error;
        const agentsDir = join(directory, ".pi", "agents");
        mkdirSync(agentsDir, { recursive: true });
        writeFileSync(join(agentsDir, "auditor.md"), saved.data);

        if (runtime === "tintin") {
          // Direct loader import avoids activating the upstream extension.
          const { loadCustomAgents } = await import("../node_modules/@tintinweb/pi-subagents/src/custom-agents");
          expect(loadCustomAgents(directory, true).get("security-review")).toMatchObject({
            name: frontmatter.name,
            description: frontmatter.description,
            builtinToolNames: ["read", "grep"],
            model: frontmatter.model,
            systemPrompt: "Inspect auth and report findings.",
          });
        } else {
          // Nico's exported discovery applies its real profile conversion.
          const { discoverAgents } = await import("../node_modules/pi-subagents/src/agents/agents.js");
          const discovered = discoverAgents(directory, "project", undefined, { globalNpmRoot: null });
          expect(discovered.agentDiagnostics ?? []).toEqual([]);
          expect(discovered.agents.find((agent) => agent.name === "security-review")).toMatchObject({
            name: frontmatter.name,
            description: frontmatter.description,
            tools: ["read", "grep"],
            model: frontmatter.model,
            systemPrompt: "Inspect auth and report findings.",
          });
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
