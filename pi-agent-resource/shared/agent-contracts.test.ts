import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILES,
  agentIdentity,
  parseAgentMarkdown,
  renderAgentMarkdown,
  validateAgentFrontmatter,
  type AgentFieldDefinition,
  type AgentFrontmatter,
  type AgentRuntime,
  type AgentValue,
  type AgentValueKind,
} from "./agent-contracts";

// These fixtures exercise the authoring contract. They intentionally do not
// import either upstream loader or claim loader conformance.
const nicoBase: AgentFrontmatter = {
  name: "scout",
  description: "Fast codebase recon",
};
const tintinFixture: AgentFrontmatter = {
  name: "Code Reviewer",
  display_name: "Review: Security",
  description: "Audit #1\nwith evidence\n",
  color: "#8B5CF6",
  enabled: true,
  tools: [
    "read",
    "grep",
    "ext:builtin:codemode",
    "ext:builtin:mcp/mcp__radius__search",
  ],
  extensions: ["builtin:mcp", "builtin:codemode", "/abs/path.ts"],
  inherit_extensions: false,
  exclude_extensions: ["pi-notify"],
  disallowed_tools: "write, edit",
  skills: "review-checklist, safe-bash",
  inherit_skills: true,
  memory: "local",
  model: "anthropic/claude-opus-4-6",
  thinking: "high",
  max_turns: 0,
  persist_session: false,
  output_transcript: false,
  session_dir: "./sessions",
  isolation: "worktree",
  allowed_subagents: ["Explore", "Plan"],
  prompt_mode: "append",
  inherit_context: true,
  run_in_background: false,
  isolated: false,
};
const nicoFixture: AgentFrontmatter = {
  ...nicoBase,
  package: "Code Analysis",
  advertise: true,
  aliases: ["explorer", "code-scout"],
  alias: "legacy-scout",
  tools: [
    "read",
    "grep",
    "./tools/search.ts",
    "mcp:github/search_repositories",
    "subagent",
  ],
  excludeTools: "bash, unknown_extension_tool",
  extensions: null,
  subagentOnlyExtensions: ["./tools/child-only-search.ts"],
  mutationTools: "fixture_write, fixture_patch",
  model: "provider/custom-id:high",
  fast: false,
  thinking: false,
  systemPromptMode: "replace",
  inheritProjectContext: true,
  inheritGlobalContext: false,
  inheritSkills: false,
  defaultContext: "fork",
  skills: "safe-bash, review-checklist",
  skill: ["compat-skill"],
  skillPath: ["./skills", "../shared-skills"],
  memory: { scope: "project", path: "security/reviewer" },
  async: true,
  timeoutMs: 900000,
  toolTimeoutMs: 600000,
  machine: "workmac",
  interactive: true,
  maxSubagentDepth: 1,
  allowNestedSubagents: true,
  allowedAgents: ["scout", "reviewer"],
  acceptance: {
    level: "checked",
    report: "on",
    preserveStagedIndex: true,
    criteria: [
      "Keep scope bounded",
      {
        id: "scope",
        must: "Only edit approved files",
        evidence: ["changed-files"],
        severity: "required",
      },
    ],
    evidence: ["commands-run", "residual-risks"],
    verify: [
      {
        id: "test",
        command: "pnpm test",
        timeoutMs: 1000,
        cwd: "./",
        env: { CI: "true" },
        allowFailure: false,
      },
    ],
    review: { agent: "reviewer", focus: "Regressions", required: true },
    stopRules: ["Stop on unsafe changes"],
    reason: "Contract fixture",
  },
  acceptanceRole: "read-only",
  output: "context.md",
  outputMode: "inline",
  outputSchema: {
    type: "object",
    properties: { findings: { type: "array", items: { type: "string" } } },
    required: ["findings"],
  },
  defaultReads: ["context.md"],
  defaultProgress: true,
  toolBudget: { hard: 30, soft: 20, block: ["read", "grep"] },
  permissions: { edit: "ask", fixture_search: "allow", write: "deny" },
  runner: { type: "pi" },
};
function fm(
  runtime: AgentRuntime,
  patch: AgentFrontmatter = {},
): AgentFrontmatter {
  return { ...(runtime === "nico" ? nicoBase : {}), ...patch };
}
function markdown(frontmatter: string, body = "Prompt\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}
function diagnostics(runtime: AgentRuntime, patch: AgentFrontmatter): string {
  return validateAgentFrontmatter(runtime, fm(runtime, patch)).join("\n");
}

describe("agent file profiles", () => {
  it("exposes runtime labels, discovery shape and every current file field (including aliases)", () => {
    expect(AGENT_PROFILES.tintin.label).toBe("@tintinweb/pi-subagents");
    expect(AGENT_PROFILES.tintin.recursive).toBe(false);
    expect(AGENT_PROFILES.nico.recursive).toBe(true);
    expect(AGENT_PROFILES.tintin.fields.map(({ key }) => key).sort()).toEqual(
      Object.keys(tintinFixture).sort(),
    );
    expect(AGENT_PROFILES.nico.fields.map(({ key }) => key).sort()).toEqual(
      [...Object.keys(nicoFixture), "launcher", "permission"].sort(),
    );
  });
  it("does not expose settings, removed keys or run-only controls", () => {
    for (const runtime of ["nico", "tintin"] as const) {
      const keys = AGENT_PROFILES[runtime].fields.map(({ key }) => key);
      for (const key of [
        "fallbackModels",
        "agentScope",
        "resume",
        "cwd",
        "runnerLaunchers",
        "defaultModel",
        "disabled",
        "agentContract",
        "schedule",
        "maxRuntimeMs",
      ])
        expect(keys).not.toContain(key);
    }
  });
  it("declares explicit children for structured controls rather than opaque map editors", () => {
    for (const key of ["memory", "acceptance", "runner", "toolBudget"]) {
      const definition = AGENT_PROFILES.nico.fields.find(
        (candidate) => candidate.key === key,
      );
      expect(definition?.children?.length).toBeGreaterThan(0);
      expect(definition?.openMap).not.toBe(true);
    }
    const runner = AGENT_PROFILES.nico.fields.find(
      ({ key }) => key === "runner",
    );
    expect(runner?.children?.map(({ key }) => key)).toEqual([
      "type",
      "provider",
      "options",
      "command",
      "args",
      "adapter",
      "promptDelivery",
      "capabilities",
    ]);
    const acceptance = AGENT_PROFILES.nico.fields.find(
      ({ key }) => key === "acceptance",
    );
    expect(acceptance?.children?.map(({ key }) => key)).toEqual([
      "level",
      "report",
      "preserveStagedIndex",
      "criteria",
      "evidence",
      "verify",
      "review",
      "stopRules",
      "reason",
    ]);
  });
  it("only uses open maps for contract-owned arbitrary dictionaries", () => {
    const paths: string[] = [];
    function collect(fields: readonly AgentFieldDefinition[], parent = "") {
      for (const definition of fields) {
        const path = parent ? `${parent}.${definition.key}` : definition.key;
        if (definition.openMap) paths.push(path);
        if (definition.children) collect(definition.children, path);
        expect(definition.description.length).toBeGreaterThan(0);
        expect(definition.group.length).toBeGreaterThan(0);
        expect(definition.kinds.length).toBeGreaterThan(0);
      }
    }
    collect(AGENT_PROFILES.nico.fields);
    expect(paths.sort()).toEqual(
      [
        "acceptance.verify.env",
        "acceptance.verify.schema",
        "outputSchema",
        "permission",
        "permissions",
        "runner.options",
      ].sort(),
    );
  });
  it("exports the requested value/type surface", () => {
    const runtime: AgentRuntime = "tintin";
    const value: AgentValue = {
      bool: false,
      nil: null,
      strings: ["on", "true"],
      decimal: 0.5,
    };
    const kinds: readonly AgentValueKind[] = [
      "string",
      "boolean",
      "integer",
      "list",
      "map",
      "null",
    ];
    expect(runtime).toBe("tintin");
    expect(value).toHaveProperty("nil", null);
    expect(kinds).toHaveLength(6);
  });
});

describe("agent Markdown fixtures and preservation", () => {
  it.each([
    ["tintin", tintinFixture],
    ["nico", nicoFixture],
  ] as const)("roundtrips full %s frontmatter without defaults or prompt rewriting", (runtime, fixture) => {
    const body =
      "\r\n# Specialist\r\n\r\n---\r\nname: this is prompt content\r\n```yaml\r\n---\r\n```\r\n  trailing spaces  \r\n";
    expect(validateAgentFrontmatter(runtime, fixture)).toEqual([]);
    const original = structuredClone(fixture);
    const rendered = renderAgentMarkdown(runtime, fixture, body);
    expect(parseAgentMarkdown(runtime, rendered)).toEqual({
      frontmatter: fixture,
      body,
    });
    expect(fixture).toEqual(original);
  });
  it("parses the Nico documentation frontmatter example", () => {
    const parsed = parseAgentMarkdown(
      "nico",
      markdown(`name: scout
package: code-analysis
description: Fast codebase recon
advertise: true
aliases: explorer, code-scout
tools: read, grep, find, ls, bash, mcp:chrome-devtools
excludeTools: bash
extensions:
subagentOnlyExtensions: ./tools/child-only-search.ts
model: claude-haiku-4-5
thinking: high
systemPromptMode: replace
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
skills: safe-bash, review-checklist
skillPath: ./skills, ../shared-skills
output: context.md
defaultReads: context.md
defaultProgress: true
async: true
timeoutMs: 900000
toolTimeoutMs: 600000
acceptance: {level: none, reason: lightweight lookup}
acceptanceRole: read-only
interactive: true
maxSubagentDepth: 1
allowNestedSubagents: true
allowedAgents: scout, reviewer`),
    );
    expect(parsed.frontmatter.extensions).toBeNull();
    expect(parsed.frontmatter.tools).toBe(
      "read, grep, find, ls, bash, mcp:chrome-devtools",
    );
    expect(agentIdentity("nico", parsed.frontmatter, "scout.md")).toBe(
      "code-analysis.scout",
    );
  });
  it("parses the Tintin documentation security-auditor example", () => {
    expect(
      parseAgentMarkdown(
        "tintin",
        markdown(`color: red
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30`),
      ).frontmatter,
    ).toEqual({
      color: "red",
      description: "Security Code Reviewer",
      tools: "read, grep, find, bash",
      model: "anthropic/claude-opus-4-6",
      thinking: "high",
      max_turns: 30,
    });
  });
  it("preserves CRLF, a leading body newline, interior fences, and no final newline", () => {
    const body = "\r\n  Prompt  \r\n---\r\nSecond\r\nlast";
    const input = "\uFEFF---\r\nname: Audit\r\n---\r\n" + body;
    expect(parseAgentMarkdown("tintin", input)).toEqual({
      frontmatter: { name: "Audit" },
      body,
    });
    expect(
      parseAgentMarkdown(
        "tintin",
        renderAgentMarkdown("tintin", { name: "Audit" }, body),
      ).body,
    ).toBe(body);
  });
  it.each([
    "",
    "Prompt\r\n---\r\n",
    "---not-a-fence\n",
    "  ---\n",
    "\uFEFFPrompt\r\n",
  ])("does not strip Markdown without an opening frontmatter fence: %j", (body) => {
    expect(parseAgentMarkdown("tintin", body)).toEqual({
      frontmatter: {},
      body,
    });
  });
  it("supports empty blocks and a closing fence at EOF", () => {
    expect(parseAgentMarkdown("tintin", "---\n# comment\n---")).toEqual({
      frontmatter: {},
      body: "",
    });
    expect(
      parseAgentMarkdown("tintin", renderAgentMarkdown("tintin", {}, "")),
    ).toEqual({ frontmatter: {}, body: "" });
    expect(parseAgentMarkdown("tintin", "--- \r\nname: x\r\n--- \r\n")).toEqual(
      { frontmatter: { name: "x" }, body: "" },
    );
  });
  it.each([
    "on",
    "true",
    "false",
    "null",
    "#8B5CF6",
    ":high",
    "a: b # comment",
    "multi\nline\n",
    '"quoted"',
    "---\nname: injected",
    "",
    "  spaced  ",
    "2026-01-01",
  ])("safely serializes and retains string scalar %j", (value) => {
    const frontmatter: AgentFrontmatter = { description: value, model: value };
    expect(
      parseAgentMarkdown(
        "tintin",
        renderAgentMarkdown("tintin", frontmatter, "Prompt"),
      ).frontmatter,
    ).toEqual(frontmatter);
  });
  it("uses YAML 1.2 and never stringifies boolean/null/list distinctions", () => {
    const parsed = parseAgentMarkdown(
      "tintin",
      markdown(
        'description: on\nmodel: "true"\ncolor: "#8B5CF6"\nenabled: false\npersist_session: null\nmax_turns: 0\ntools: []',
      ),
    );
    expect(parsed.frontmatter).toEqual({
      description: "on",
      model: "true",
      color: "#8B5CF6",
      enabled: false,
      persist_session: null,
      max_turns: 0,
      tools: [],
    });
  });
  it.each([
    null,
    "",
    [],
    false,
    true,
    "none",
    "all",
    ["reviewer"],
  ] satisfies AgentValue[])("retains Tintin inheritance value %j verbatim", (extensions) => {
    const frontmatter = {
      extensions,
      skills: extensions,
      allowed_subagents: extensions,
    };
    expect(
      parseAgentMarkdown(
        "tintin",
        renderAgentMarkdown("tintin", frontmatter, ""),
      ).frontmatter,
    ).toEqual(frontmatter);
  });
  it.each([
    null,
    "",
    "read, mcp:github/search",
    ["read", "mcp:github/search"],
  ] satisfies AgentValue[])("retains Nico simple list value %j", (tools) => {
    const frontmatter = fm("nico", {
      tools,
      extensions: tools,
      allowedAgents: tools,
    });
    expect(
      parseAgentMarkdown("nico", renderAgentMarkdown("nico", frontmatter, ""))
        .frontmatter,
    ).toEqual(frontmatter);
  });
  it("reads legacy Nico empty lists without re-emitting them as literal selectors", () => {
    const legacy = parseAgentMarkdown(
      "nico",
      markdown("name: scout\ndescription: Recon\nextensions: []"),
    );
    expect(legacy.frontmatter.extensions).toEqual([]);
    expect(() =>
      renderAgentMarkdown("nico", legacy.frontmatter, legacy.body),
    ).toThrow(
      'extensions: Nico reads an empty YAML list as the literal selector "[]"',
    );
  });
  it("accepts comma scalar and YAML block/flow lists without normalization", () => {
    const frontmatter = parseAgentMarkdown(
      "nico",
      markdown(
        "name: scout\ndescription: Recon\ntools:\n  - read\n  - mcp:github/search_repositories\nskills: [one, two]\nskillPath: ./skills, ../shared",
      ),
    ).frontmatter;
    expect(frontmatter.tools).toEqual([
      "read",
      "mcp:github/search_repositories",
    ]);
    expect(frontmatter.skills).toEqual(["one", "two"]);
    expect(frontmatter.skillPath).toBe("./skills, ../shared");
  });
  it("preserves arbitrary provider options and repeated acyclic values as data", () => {
    const shared = {
      string: "true",
      boolean: true,
      nil: null,
      empty: "",
      list: [],
      map: {},
      fraction: 0.5,
    };
    const frontmatter = fm("nico", {
      runner: {
        type: "external-job",
        provider: "surf-oracle",
        options: { a: shared, b: shared },
      },
    });
    expect(
      parseAgentMarkdown("nico", renderAgentMarkdown("nico", frontmatter, ""))
        .frontmatter,
    ).toEqual(frontmatter);
    expect(renderAgentMarkdown("nico", frontmatter, "")).not.toContain("&a");
  });
  it("keeps omission distinct from explicitly empty lists/nulls", () => {
    const defaults = fm("nico");
    expect(
      parseAgentMarkdown("nico", renderAgentMarkdown("nico", defaults, ""))
        .frontmatter,
    ).toEqual(defaults);
    expect(defaults).not.toHaveProperty("extensions");
    expect(defaults).not.toHaveProperty("thinking");
    expect(validateAgentFrontmatter("tintin", {})).toEqual([]);
  });
});

describe("strict parsing and diagnostics", () => {
  it.each([
    "---\nname: x",
    "---\r\nname: x\r\n---not-a-fence",
  ])("rejects missing closing fence", (input) => {
    expect(() => parseAgentMarkdown("tintin", input)).toThrow(
      /missing closing ---/,
    );
  });
  it.each([
    "[]",
    "- name",
    "42",
    "null",
    "true",
  ])("rejects non-mapping YAML %j", (source) => {
    expect(() => parseAgentMarkdown("tintin", markdown(source))).toThrow(
      /mapping/,
    );
  });
  it.each([
    "name: [unterminated",
    "name: x\nname: y",
    "memory: {scope: project, scope: user}",
    "description: !custom text",
    "1: value",
    "? [a, b]\n: value",
  ])("rejects malformed, duplicate, custom-tag, or non-string-key YAML %j", (source) => {
    expect(() => parseAgentMarkdown("tintin", markdown(source))).toThrow(
      /YAML|mapping keys/,
    );
  });
  it("rejects cycles and non-finite numbers even inside arbitrary options", () => {
    for (const options of [
      "&cycle {child: *cycle}",
      "{value: .inf}",
      "{value: .nan}",
    ]) {
      expect(() =>
        parseAgentMarkdown(
          "nico",
          markdown(
            `name: scout\ndescription: Recon\nrunner:\n  type: external-job\n  provider: test\n  options: ${options}`,
          ),
        ),
      ).toThrow(/cyclic|finite/);
    }
  });
  it.each([
    "tintin",
    "nico",
  ] as const)("refuses unknown keys in %s parse, validation, and render", (runtime) => {
    const frontmatter = fm(runtime, { unknown: true });
    expect(validateAgentFrontmatter(runtime, frontmatter).join("\n")).toMatch(
      /unknown.*structured editing/,
    );
    expect(() => renderAgentMarkdown(runtime, frontmatter, "")).toThrow(
      /unknown/,
    );
    const known = runtime === "nico" ? "name: scout\ndescription: Recon\n" : "";
    expect(() =>
      parseAgentMarkdown(runtime, markdown(`${known}unknown: true`)),
    ).toThrow(/unknown/);
  });
  it.each<AgentFrontmatter>([
    { memory: { scope: "project", path: "scout", mystery: "x" } },
    { runner: { type: "pi", surprise: false } },
    { acceptance: { level: "checked", review: { foo: "x" } } },
    {
      acceptance: {
        level: "checked",
        verify: [{ id: "test", command: "test", wat: true }],
      },
    },
    { toolBudget: { hard: 3, unknown: true } },
  ])("rejects unknown nested fields with their full path", (patch) => {
    expect(diagnostics("nico", patch)).toMatch(/unknown frontmatter key/);
  });
  it("reports both runtime and offending YAML field names", () => {
    expect(() =>
      parseAgentMarkdown("tintin", markdown("max_turns: high")),
    ).toThrow(/@tintinweb\/pi-subagents[\s\S]*max_turns/);
    expect(() =>
      parseAgentMarkdown(
        "nico",
        markdown("name: scout\ndescription: Recon\nadvertise: nope"),
      ),
    ).toThrow(/nicobailon\/pi-subagents[\s\S]*advertise/);
  });
  it("rejects unsupported programmatic data instead of dropping/coercing it", () => {
    for (const value of [undefined, new Date(), Infinity, NaN, () => "x"]) {
      expect(
        validateAgentFrontmatter("tintin", {
          description: value,
        } as unknown as AgentFrontmatter).length,
      ).toBeGreaterThan(0);
    }
    const cyclic: AgentFrontmatter = {};
    cyclic.self = cyclic;
    expect(validateAgentFrontmatter("tintin", cyclic).join("\n")).toMatch(
      /cyclic/,
    );
    expect(
      validateAgentFrontmatter("tintin", [] as unknown as AgentFrontmatter),
    ).toEqual(["frontmatter: expected a mapping of field names to values."]);
  });
  it("never mutates failed edit inputs", () => {
    const original = { ...nicoBase, unsupported: { key: null }, tools: [] };
    const snapshot = structuredClone(original);
    expect(() => renderAgentMarkdown("nico", original, "\r\nPrompt")).toThrow(
      /unsupported/,
    );
    expect(original).toEqual(snapshot);
  });
});

describe("known field and compatibility validation", () => {
  it.each([
    ["tintin", { max_turns: -1 }, "max_turns"],
    ["tintin", { max_turns: 1.5 }, "integer"],
    ["tintin", { max_turns: Number.MAX_SAFE_INTEGER + 1 }, "integer"],
    ["tintin", { persist_session: "false" }, "boolean"],
    ["tintin", { tools: [false] }, "string"],
    ["tintin", { thinking: "ultra" }, "one of"],
    ["tintin", { prompt_mode: "fresh" }, "one of"],
    ["tintin", { isolation: true }, "only false"],
    ["tintin", { memory: "global" }, "one of"],
    ["nico", { timeoutMs: 0 }, "positive integer"],
    ["nico", { timeoutMs: -1 }, "positive integer"],
    ["nico", { timeoutMs: 1.5 }, "integer"],
    ["nico", { timeoutMs: "100" }, "integer"],
    ["nico", { toolTimeoutMs: 2147483648 }, "2147483647"],
    ["nico", { maxSubagentDepth: -1 }, "non-negative"],
    ["nico", { advertise: null }, "boolean"],
    ["nico", { async: "true" }, "boolean"],
    ["nico", { fast: 1 }, "boolean"],
    ["nico", { thinking: true }, "only false"],
    ["nico", { outputMode: "text" }, "one of"],
    ["nico", { acceptanceRole: "admin" }, "one of"],
    ["nico", { defaultContext: "inherit" }, "one of"],
    ["nico", { allowNestedSubagents: "yes" }, "boolean"],
    ["nico", { tools: { read: true } }, "expected"],
    ["nico", { skillPath: [1] }, "string"],
    ["nico", { package: true }, "only false"],
    ["nico", { package: "!!!" }, "sanitization"],
  ] as const)("validates %s field values: %j", (runtime, patch, message) => {
    expect(diagnostics(runtime, patch as AgentFrontmatter)).toContain(message);
  });
  it.each([
    "tintin",
    "nico",
  ] as const)("validates all thinking levels for %s without model/tool registry checks", (runtime) => {
    for (const level of [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]) {
      expect(
        validateAgentFrontmatter(
          runtime,
          fm(runtime, {
            thinking: level,
            model: "some-provider/new-id",
            tools: "unknown_lazy_tool",
          }),
        ),
      ).toEqual([]);
    }
  });
  it("requires Nico name and description rather than creating loader-invisible definitions", () => {
    expect(validateAgentFrontmatter("nico", {}).join("\n")).toMatch(
      /name[\s\S]*description/,
    );
    expect(diagnostics("nico", { name: "", description: " " })).toMatch(
      /non-empty/,
    );
  });
  it("only restricts Tintin names for colons, not cosmetic labels/spaces/case", () => {
    expect(diagnostics("tintin", { name: "plugin:review" })).toMatch(
      /reserved/,
    );
    expect(
      validateAgentFrontmatter("tintin", {
        name: "Code Reviewer",
        display_name: "Plugin: Reviewer",
        color: "unrecognized-color",
      }),
    ).toEqual([]);
  });
  it("does not conflate filesystem isolation with hermetic isolation", () => {
    expect(
      validateAgentFrontmatter("tintin", {
        isolation: "worktree",
        allowed_subagents: "all",
      }),
    ).toEqual([]);
    expect(
      diagnostics("tintin", { isolated: true, allowed_subagents: true }),
    ).toMatch(/isolated agents cannot/);
    expect(
      validateAgentFrontmatter("tintin", {
        isolated: true,
        allowed_subagents: false,
        extensions: true,
        skills: true,
      }),
    ).toEqual([]);
    expect(
      validateAgentFrontmatter(
        "nico",
        fm("nico", {
          allowedAgents: [],
          inheritGlobalContext: true,
          inheritProjectContext: false,
        }),
      ),
    ).toEqual([]);
  });
  it.each([
    "worktree",
    "off",
    "none",
    "no",
    false,
    null,
  ] satisfies AgentValue[])("accepts Tintin isolation spelling %j", (isolation) => {
    expect(validateAgentFrontmatter("tintin", { isolation })).toEqual([]);
  });
  it("validates extension exclusions without restricting tools/provider/path syntax", () => {
    expect(
      diagnostics("tintin", { exclude_extensions: "*, /abs/foo.ts" }),
    ).toMatch(/plain extension names/);
    expect(
      validateAgentFrontmatter("tintin", {
        exclude_extensions: "builtin:mcp, pi-notify",
        tools: "read, ext:package/tool, ext:builtin:mcp/mcp__server__search",
        extensions: ["*", "C:\\tools\\provider.ts"],
      }),
    ).toEqual([]);
  });
  it.each([
    "../escape",
    "/abs",
    "C:\\root",
    "foo/./bar",
    "foo/../bar",
    "foo:bar",
    "foo\0bar",
    "",
  ])("rejects unsafe memory path %j", (path) => {
    expect(diagnostics("nico", { memory: { scope: "user", path } })).toMatch(
      /memory.path/,
    );
  });
  it("requires memory controls and validates budget/permission rules", () => {
    expect(diagnostics("nico", { memory: {} })).toMatch(
      /memory.scope[\s\S]*memory.path/,
    );
    expect(
      diagnostics("nico", { toolBudget: { hard: 0, soft: 1, block: [] } }),
    ).toMatch(/positive[\s\S]*soft[\s\S]*block/);
    expect(
      diagnostics("nico", {
        permissions: { bash: "deny", intercom: "ask", read: "invalid" },
      }),
    ).toMatch(/pi-guard[\s\S]*reserved[\s\S]*allow, ask or deny/);
    expect(diagnostics("nico", { permission: {}, permissions: {} })).toMatch(
      /both permission and permissions/,
    );
  });
});

describe("structured acceptance", () => {
  it.each([
    ["none", "reason"],
    ["verified", "runtime verify"],
    ["reviewed", "one of"],
    [true, "only false"],
    [{ level: "none" }, "reason"],
    [{ level: "verified", verify: [] }, "runtime command"],
    [{ level: "checked", preserveStagedIndex: false }, "must be true"],
    [{ level: "attested", preserveStagedIndex: true }, "requires level"],
    [{ level: "checked", evidence: ["invented"] }, "one of"],
    [{ level: "checked", report: "on" }, "outputSchema"],
    [{ review: true }, "only false"],
    [{ verify: ["pnpm test"] }, "command map"],
    [{ verify: [{ command: "test" }] }, ".id"],
    [
      { verify: [{ id: "test", command: "test", env: { CI: true } }] },
      ".env.CI",
    ],
    [
      { verify: [{ id: "test", command: "test", timeoutMs: 0 }] },
      "positive integer",
    ],
    [
      { verify: [{ id: "test", command: "test", schema: {} }] },
      "requires output: json",
    ],
    [
      {
        criteria: [
          { id: "A_B", must: "one" },
          { id: "a b", must: "two" },
        ],
      },
      "duplicate normalized",
    ],
  ] satisfies [
    AgentValue,
    string,
  ][])("checks acceptance policy %j", (acceptance, message) => {
    expect(diagnostics("nico", { acceptance })).toContain(message);
  });
  it("accepts scalar defaults, reasoned disable, and structured verified policies", () => {
    const policies: AgentValue[] = [
      "auto",
      "attested",
      "checked",
      false,
      { level: "none", reason: "small lookup" },
      {
        level: "verified",
        verify: [
          {
            id: "gate",
            command: "node verify.js",
            output: "json",
            schema: { type: "boolean" },
          },
        ],
        review: false,
      },
    ];
    for (const acceptance of policies)
      expect(
        validateAgentFrontmatter("nico", fm("nico", { acceptance })),
      ).toEqual([]);
  });
  it("refuses competing structured-output sources", () => {
    expect(
      diagnostics("nico", {
        outputSchema: {},
        acceptance: {
          level: "verified",
          verify: [{ id: "gate", command: "check", output: "json" }],
        },
      }),
    ).toMatch(/two structured-output sources/);
  });
});

describe("runner, machine and launcher contracts", () => {
  it.each([
    [{}, "runner.type"],
    [{ type: "unknown" }, "one of"],
    [{ type: "pi", command: "node" }, "not supported"],
    [{ type: "external-job", provider: " test " }, "trimmed"],
    [{ type: "external-job" }, "provider"],
    [{ type: "external-job", provider: "test", args: [] }, "not supported"],
    [{ type: "external-cli" }, "command"],
    [{ type: "external-cli", command: "node", args: [1] }, "string"],
    [{ type: "external-cli", command: "node", options: {} }, "not supported"],
    [
      {
        type: "external-cli",
        command: "codex",
        adapter: "codex-exec",
        args: ["--unsafe"],
      },
      "own argv",
    ],
    [
      { type: "external-cli", command: "node", promptDelivery: "file" },
      "stdin",
    ],
    [
      { type: "external-cli", command: "node", capabilities: { steer: true } },
      "only false",
    ],
    [
      { type: "external-cli", command: "node", capabilities: { stop: false } },
      "unknown",
    ],
  ] satisfies [
    AgentValue,
    string,
  ][])("validates type-specific runner %j", (runner, message) => {
    expect(diagnostics("nico", { runner })).toContain(message);
  });
  it("accepts native, generic command, provider options and all documented code-owned adapters", () => {
    const runners: AgentValue[] = [
      { type: "pi" },
      {
        type: "external-cli",
        command: "./classify",
        args: ["--format", "text"],
        promptDelivery: "stdin",
        capabilities: { steer: false, resume: false },
      },
      { type: "external-job", provider: "surf-oracle", options: {} },
      ...[
        "codex-exec",
        "codex-exec-writer",
        "claude-code",
        "claude-code-writer",
        "cursor-agent",
        "cursor-agent-writer",
      ].map((adapter) => ({ type: "external-cli", command: "cli", adapter })),
    ];
    for (const runner of runners)
      expect(validateAgentFrontmatter("nico", fm("nico", { runner }))).toEqual(
        [],
      );
  });
  it("allows model/effort only on the two Claude adapters", () => {
    expect(
      validateAgentFrontmatter(
        "nico",
        fm("nico", {
          runner: {
            type: "external-cli",
            command: "claude",
            adapter: "claude-code",
          },
          model: ":high",
          thinking: "minimal",
        }),
      ),
    ).toEqual([]);
    expect(
      diagnostics("nico", {
        runner: {
          type: "external-cli",
          command: "codex",
          adapter: "codex-exec",
        },
        model: "provider/id",
        tools: [],
        skills: [],
      }),
    ).toMatch(/model: unsupported Pi-only/);
    expect(
      diagnostics("nico", {
        runner: { type: "external-job", provider: "surf" },
        mutationTools: [],
      }),
    ).toMatch(/mutationTools: unsupported Pi-only/);
  });
  it("reserves read-only adapter selection identities", () => {
    expect(diagnostics("nico", { aliases: ["codex-exec"] })).toMatch(
      /reserved/,
    );
    expect(
      validateAgentFrontmatter(
        "nico",
        fm("nico", {
          name: "codex-exec",
          runner: {
            type: "external-cli",
            command: "codex",
            adapter: "codex-exec",
          },
        }),
      ),
    ).toEqual([]);
  });
  it("allows a launcher with local Pi only, without probing operator configuration", () => {
    expect(
      validateAgentFrontmatter(
        "nico",
        fm("nico", {
          launcher: "Net.v1_2-3",
          runner: { type: "pi" },
          async: true,
        }),
      ),
    ).toEqual([]);
    expect(
      diagnostics("nico", { launcher: "net", machine: "workmac" }),
    ).toMatch(/cannot combine/);
    expect(
      diagnostics("nico", {
        launcher: "net",
        runner: { type: "external-job", provider: "surf" },
      }),
    ).toMatch(/cannot combine/);
    expect(diagnostics("nico", { launcher: "../unsafe" })).toMatch(
      /start with a letter/,
    );
    expect(diagnostics("nico", { launcher: "a".repeat(129) })).toMatch(/128/);
    expect(diagnostics("nico", { machine: "\nunsafe" })).toMatch(
      /control characters/,
    );
  });
});

describe("agent identity", () => {
  it("uses Tintin declared name, never display_name; falls back to basename for blank/null/omitted name", () => {
    expect(
      agentIdentity(
        "tintin",
        { name: " Code Reviewer ", display_name: "Label" },
        "blubb.md",
      ),
    ).toBe("Code Reviewer");
    const fallbacks: AgentFrontmatter[] = [
      {},
      { name: null },
      { name: " " },
      { name: "", display_name: "Label" },
    ];
    for (const frontmatter of fallbacks) {
      expect(
        agentIdentity("tintin", frontmatter, "C:\\agents\\Explore.md"),
      ).toBe("Explore");
    }
  });
  it("adds Nico package namespace while preserving frontmatter fields", () => {
    const frontmatter = fm("nico", { package: "Code Analysis / Team" });
    expect(agentIdentity("nico", frontmatter, "different-file.md")).toBe(
      "code-analysis-team.scout",
    );
    expect(frontmatter.package).toBe("Code Analysis / Team");
    expect(
      agentIdentity("nico", fm("nico", { package: false }), "scout.md"),
    ).toBe("scout");
    expect(agentIdentity("nico", fm("nico", { package: "" }), "scout.md")).toBe(
      "scout",
    );
    expect(
      agentIdentity("nico", fm("nico", { package: "org.tools" }), "scout.md"),
    ).toBe("org.tools.scout");
  });
});
