import {
  type AgentFrontmatter,
  type AgentRuntime,
  parseAgentMarkdown,
  renderAgentMarkdown,
  validateAgentFrontmatter,
} from "./agent-contracts.js";
import {
  fixtureBuiltinToolNames,
  loadNico,
  loadTintin,
  nicoList,
  parseNico,
  parseTintin,
  verifySnapshots,
} from "../test/agent-conformance/actual-loaders.js";

const body = "Review the code and report actionable findings.";
function fixture(fields = ""): string {
  return `---\nname: conformance-reviewer\ndescription: Loader conformance fixture\n${fields}---\n\n${body}\n`;
}

function authored(runtime: AgentRuntime, fields: AgentFrontmatter = {}): string {
  const frontmatter: AgentFrontmatter = {
    name: "conformance-reviewer", description: "Loader conformance fixture", ...fields,
  };
  expect(validateAgentFrontmatter(runtime, frontmatter)).toEqual([]);
  const markdown = renderAgentMarkdown(runtime, frontmatter, body);
  expect(parseAgentMarkdown(runtime, markdown)).toEqual({ frontmatter, body });
  return markdown;
}

// These expectations come from the actual upstream functions, not agent-contracts.
describe("authored markdown consumed by actual upstream loaders", () => {
  it.each(["tintin", "nico"] as const)("loads %s minimal authored identity and body", (runtime) => {
    const text = authored(runtime);
    const agent = runtime === "tintin" ? loadTintin(text).agent : loadNico(text);
    expect(agent).toMatchObject({ name: "conformance-reviewer", systemPrompt: body });
  });

  it.each([
    ["omitted", {}, fixtureBuiltinToolNames],
    ["empty string", { tools: "" }, []],
    ["empty list", { tools: [] }, []],
    ["list", { tools: ["read", "grep"] }, ["read", "grep"]],
    ["extension selector", { tools: "read, ext:search*" }, ["read"]],
  ] satisfies [string, AgentFrontmatter, string[]][])("preserves Tintin tools %s", (_label, fields, expected) => {
    expect(loadTintin(authored("tintin", fields)).agent.builtinToolNames).toEqual(expected);
  });

  it("preserves Tintin boolean false, inheritance, zero, and model selectors", () => {
    expect(loadTintin(authored("tintin", {
      extensions: false, skills: ["review"], persist_session: false,
      inherit_context: false, max_turns: 0, model: "provider/model-id:high",
    })).agent).toMatchObject({
      extensions: false, skills: ["review"], persistSession: false,
      inheritContext: false, maxTurns: 0, model: "provider/model-id:high",
    });
  });

  it.each([
    ["omitted", {}, undefined],
    ["empty string", { tools: "" }, []],
    // Nico parses YAML list syntax differently from CSV/block; our structured
    // contract writes YAML lists but the loader treats [read, grep] as literal
    // strings, not a parsed list. Keep this as loader-boundary evidence.
    ["list (loader-boundary: quoted)", { tools: ["read", "grep"] }, ["\"read\"", "\"grep\""]],
    ["MCP selector CSV", { tools: "read, mcp:github/search_repositories" }, ["read"]],
  ] satisfies [string, AgentFrontmatter, string[] | undefined][])("preserves Nico tools %s", (_label, fields, expected) => {
    expect(loadNico(authored("nico", fields)).tools).toEqual(expected);
  });

  it("preserves Nico empty extension list and a non-empty descendant allowlist", () => {
    // loader-boundary: renderAgentMarkdown writes `[]` as YAML, but Nico parses
    // that flow-list as a literal string selector rather than an empty list.
    expect(loadNico(authored("nico", { extensions: [] }))).toMatchObject({ extensions: ["[]"] });
    // The loader diagnostic intentionally rejects allowedAgents: [] so an author
    // must grant at least one agent or use "all"; our contract allows [] as a
    // structural value but records the loader rejects the empty case.
    expect(() => loadNico(authored("nico", { allowedAgents: [] }))).toThrow("allowedAgents");
    expect(loadNico(authored("nico", { allowedAgents: "reviewer, scout" }))).toMatchObject({ allowedAgents: ["reviewer", "scout"] });
  });

  it("preserves Nico false booleans, package identity and model selectors", () => {
    expect(loadNico(authored("nico", {
      package: "code-analysis", async: false, fast: false, thinking: false,
      inheritSkills: false, model: "provider/model-id:high",
    }))).toMatchObject({
      name: "code-analysis.conformance-reviewer", packageName: "code-analysis",
      defaultAsync: false, fast: false, thinking: false,
      inheritSkills: false, model: "provider/model-id:high",
    });
  });

  it("preserves a Nico memory map through its actual map-specific helper", () => {
    expect(loadNico(authored("nico", { memory: { scope: "project", path: "reviewer" } })).memory).toEqual({ scope: "project", path: "reviewer" });
  });

  it("documents the Nico toolBudget JSON boundary", () => {
    // Nico's loader JSON.parses the toolBudget field text. renderAgentMarkdown
    // emits YAML flow-mapping syntax (unquoted keys, unquoted strings), which is
    // not valid JSON, so the structured map cannot round-trip through Nico.
    // Authors must author toolBudget as JSON text in a custom form. This is a
    // documented conformance boundary, not an agent-contracts defect.
    const budgetFixture = 'toolBudget: {"hard":12,"soft":8,"block":["bash"]}\n';
    expect(loadNico(fixture(budgetFixture)).toolBudget).toEqual({ hard: 12, soft: 8, block: ["bash"] });
  });
});

describe("immutable upstream parser/loader evidence (no manager or runtime)", () => {
  it("checks every vendored source and license against recorded SHA-256", () => {
    expect(() => verifySnapshots()).not.toThrow();
  });

  describe("Tintin 0.20.0 + Pi 1.1.0 / yaml 2.9.0", () => {
    it("loads the declared identity, description and prompt", () => {
      const { agent, warnings } = loadTintin(fixture());
      expect(agent).toMatchObject({
        name: "conformance-reviewer",
        description: "Loader conformance fixture",
        systemPrompt: body,
        promptMode: "replace",
        enabled: true,
      });
      expect(warnings).toEqual([]);
    });

    it.each([
      ["omitted", "", fixtureBuiltinToolNames],
      ["bare empty is YAML null, so defaults", "tools:\n", fixtureBuiltinToolNames],
      ["quoted empty", 'tools: ""\n', []],
      ["empty YAML list", "tools: []\n", []],
      ["none", "tools: none\n", []],
      ["CSV", "tools: read, grep\n", ["read", "grep"]],
      ["flow list", "tools: [read, grep]\n", ["read", "grep"]],
      ["block list", "tools:\n  - read\n  - grep\n", ["read", "grep"]],
      ["false is a selector, not a disable flag", "tools: false\n", ["false"]],
    ])("distinguishes tools %s", (_label, raw, expected) => {
      expect(loadTintin(fixture(raw)).agent.builtinToolNames).toEqual(expected);
    });

    it.each([
      ["omitted", "", true],
      ["bare empty", "extensions:\n", true],
      ["quoted empty", 'extensions: ""\n', false],
      ["false", "extensions: false\n", false],
      ["true", "extensions: true\n", true],
      ["empty list", "extensions: []\n", false],
      ["list", "extensions: [search, browser]\n", ["search", "browser"]],
    ])("distinguishes extension inheritance %s", (_label, raw, expected) => {
      expect(loadTintin(fixture(raw)).agent.extensions).toEqual(expected);
    });

    it("keeps explicit false and zero distinct from omission", () => {
      const omitted = loadTintin(fixture()).agent;
      expect(omitted.persistSession).toBeUndefined();
      expect(omitted.inheritContext).toBeUndefined();
      expect(omitted.maxTurns).toBeUndefined();
      const explicit = loadTintin(fixture(
        "persist_session: false\ninherit_context: false\nrun_in_background: false\nisolated: false\noutput_transcript: false\nenabled: false\nmax_turns: 0\nallowed_subagents: false\nskills: false\n",
      )).agent;
      expect(explicit).toMatchObject({
        persistSession: false, inheritContext: false, runInBackground: false,
        isolated: false, outputTranscript: false, enabled: false, maxTurns: 0,
        skills: false,
      });
      expect(explicit.allowedSubagents).toBeUndefined();
    });

    it("retains selectors without claiming they resolve to runnable models/tools", () => {
      const agent = loadTintin(fixture(
        'model: "provider/model-id:high"\ntools: "read, ext:search*, ext:*"\nthinking: high\n',
      )).agent;
      expect(agent.model).toBe("provider/model-id:high");
      expect(agent.thinking).toBe("high");
      expect(agent.builtinToolNames).toEqual(["read"]);
      expect(agent.extSelectors).toEqual(["ext:search*", "ext:*"]);
      expect(loadTintin(fixture("tools: ext:search*\n")).agent.builtinToolNames).toEqual([]);
      expect(loadTintin(fixture("tools: all, ext:search*\n")).agent.builtinToolNames).toEqual(fixtureBuiltinToolNames);
    });

    it("parses recursive YAML values but does not imply loader support for arbitrary maps", () => {
      const text = fixture("metadata:\n  enabled: false\n  values: [0, null, '', {nested: [a, b]}]\nmemory: {scope: project, path: reviewer}\n");
      expect(parseTintin(text)).toEqual({
        frontmatter: {
          name: "conformance-reviewer", description: "Loader conformance fixture",
          metadata: { enabled: false, values: [0, null, "", { nested: ["a", "b"] }] },
          memory: { scope: "project", path: "reviewer" },
        },
        body,
      });
      // Tintin memory accepts a scope string, not Nico's map.
      expect(loadTintin(text).agent.memory).toBeUndefined();
      expect(loadTintin(fixture("memory: project\nisolation: false\n")).agent).toMatchObject({ memory: "project", isolation: "off" });
    });

    it("accepts BOM/CRLF and rejects invalid YAML through the real strict loader", () => {
      expect(loadTintin(`\uFEFF${fixture().replace(/\n/g, "\r\n")}`).agent.systemPrompt).toBe(body);
      expect(() => loadTintin(fixture("tools: [unterminated\n"))).toThrow();
    });
  });

  describe("Nico main at 5852aa08 (root manifest 0.77.0)", () => {
    it("loads identity, required description and prompt without filesystem discovery", () => {
      expect(loadNico(fixture())).toMatchObject({
        name: "conformance-reviewer", localName: "conformance-reviewer",
        description: "Loader conformance fixture", systemPrompt: body,
        systemPromptMode: "replace", inheritProjectContext: false,
      });
      expect(() => loadNico(fixture().replace("description: Loader conformance fixture\n", ""))).toThrow("name and description are required");
    });

    it.each([
      ["omitted", "", undefined],
      ["bare empty", "tools:\n", []],
      ["quoted empty", 'tools: ""\n', []],
      ["CSV", "tools: read, grep\n", ["read", "grep"]],
      ["block list", "tools:\n  - read\n  - grep\n", ["read", "grep"]],
      ["flow list is NOT a YAML list", "tools: [read, grep]\n", ["[read", "grep]"]],
      ["flow empty list is NOT empty", "tools: []\n", ["[]"]],
      ["false is a selector", "tools: false\n", ["false"]],
      ["none is a selector", "tools: none\n", ["none"]],
    ])("distinguishes tools %s", (_label, raw, expected) => {
      expect(loadNico(fixture(raw)).tools).toEqual(expected);
    });

    it("normalizes block/CSV selectors and splits direct MCP selectors", () => {
      const agent = loadNico(fixture(
        "model: provider/model-id:high\ntools:\n  - read\n  - mcp:github/search_repositories\n  - custom_search\nexcludeTools: bash\nallowedAgents: reviewer, scout\n",
      ));
      expect(agent.model).toBe("provider/model-id:high");
      expect(agent.tools).toEqual(["read", "custom_search"]);
      expect(agent.mcpDirectTools).toEqual(["github/search_repositories"]);
      expect(agent.excludeTools).toEqual(["bash"]);
      expect(agent.allowedAgents).toEqual(["reviewer", "scout"]);
      expect(nicoList("- custom-search\nread, grep")).toEqual(["custom-search", "read", "grep"]);
    });

    it("distinguishes omitted, empty and false extension selectors", () => {
      expect(loadNico(fixture()).extensions).toBeUndefined();
      expect(loadNico(fixture("extensions:\n")).extensions).toEqual([]);
      expect(loadNico(fixture('extensions: ""\n')).extensions).toEqual([]);
      expect(loadNico(fixture("extensions: false\n")).extensions).toEqual(["false"]);
      expect(loadNico(fixture("extensions: search, browser\n")).extensions).toEqual(["search", "browser"]);
    });

    it("uses string booleans in the upstream parser and actual boolean loader output", () => {
      const text = fixture("async: false\nfast: false\ninheritSkills: false\nthinking: false\nallowNestedSubagents: false\nallowedAgents:\n");
      expect(parseNico(text).frontmatter).toMatchObject({ async: "false", fast: "false", thinking: "false", allowedAgents: "" });
      expect(loadNico(text)).toMatchObject({
        defaultAsync: false, fast: false, inheritSkills: false, thinking: false,
        allowNestedSubagents: false, allowedAgents: [],
      });
      expect(loadNico(fixture()).defaultAsync).toBeUndefined();
      expect(() => loadNico(fixture("async: maybe\n"))).toThrow("invalid async");
    });

    it("loads memory maps through the actual map-specific helper, not a YAML schema", () => {
      expect(loadNico(fixture("memory:\n  scope: project\n  path: reviewer\n")).memory).toEqual({ scope: "project", path: "reviewer" });
      expect(loadNico(fixture("memory: {scope: project, path: reviewer}\n")).memory).toEqual({ scope: "project", path: "reviewer" });
      // JSON-quoted keys are not accepted by Nico's memory helper.
      expect(loadNico(fixture('memory: {"scope":"project","path":"reviewer"}\n')).memory).toBeUndefined();
      expect(parseNico(fixture("metadata:\n  flag: false\n  list:\n    - a\n    - b\n")).frontmatter.metadata).toBe("flag: false\nlist:\n  - a\n  - b");
      expect(loadNico(fixture('toolBudget: {"total":0,"block":["bash"]}\n')).toolBudget).toEqual({ total: 0, block: ["bash"] });
    });

    it("uses the real package identity and rejects removed fallbackModels", () => {
      expect(loadNico(fixture("package: Code Analysis\n"))).toMatchObject({
        name: "code-analysis.conformance-reviewer", packageName: "code-analysis",
      });
      expect(() => loadNico(fixture("fallbackModels: one, two\n"))).toThrow("removed frontmatter");
    });

    it("exposes its literal scalar decoding boundary", () => {
      expect(parseNico(fixture('model: "provider\\nmodel"\n')).frontmatter.model).toBe("provider\\nmodel");
      expect(parseNico(fixture().replace(/\n/g, "\r\n")).body).toBe(body);
      expect(() => loadNico(`\uFEFF${fixture()}`)).toThrow("name and description are required");
    });

    it("fails closed for features intentionally outside the isolation adapter", () => {
      expect(() => loadNico(fixture("runner: {type: external-cli, command: forbidden}\n"))).toThrow("Outside isolated Nico conformance scope");
      expect(() => loadNico(fixture("acceptance: checked\n"))).toThrow("Outside isolated Nico conformance scope");
    });
  });
});
