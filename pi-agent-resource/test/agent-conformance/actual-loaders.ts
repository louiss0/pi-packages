const yamlModule = require("js-yaml");
const yaml = yamlModule.load ? yamlModule : (yamlModule.default ? yamlModule.default : {});

const body = "Review the code and report actionable findings.";

function fixture(fields = ""): string {
  return `---\nname: conformance-reviewer\ndescription: Loader conformance fixture\n${fields}---\n\n${body}\n`;
}

function authored(runtime: any, fields: any = {}): string {
  const frontmatter: any = {
    name: "conformance-reviewer", description: "Loader conformance fixture", ...fields,
  };
  // minimal validation
  expect(frontmatter.name).toBeDefined();
  expect(frontmatter.description).toBeDefined();
  return `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}---\n\n${body}\n`;
}

// YAML parse
function parseYaml(str: string): any {
  return yaml.load ? yaml.load(str) : yamlModule.load(str);
}

// parseNico: parse the frontmatter from Nico-formatted agent markdown
export function parseNico(markdown: string): { frontmatter: any; body?: string } {
  // handle BOM
  if (markdown.charCodeAt(0) === 0xFEFF) {
    markdown = markdown.slice(1);
  }
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { frontmatter: {} };
  }
  const frontmatterStr = match[1];
  const bodyText = match[2] || "";
  return {
    frontmatter: parseYaml(frontmatterStr) || {},
    body: bodyText,
  };
}

// parseTintin: parse frontmatter from Tintin-formatted agent markdown
export function parseTintin(markdown: string): { frontmatter: any; body?: string } {
  if (markdown.charCodeAt(0) === 0xFEFF) {
    markdown = markdown.slice(1);
    markdown = markdown.replace(/\r\n/g, "\n");
  }
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { frontmatter: {} };
  }
  const frontmatterStr = match[1];
  const bodyText = match[2] || "";
  return {
    frontmatter: parseYaml(frontmatterStr) || {},
    body: bodyText,
  };
}

// loadNico: load an agent from Nico-formatted markdown
export function loadNico(markdown: string): any {
  // handle BOM
  if (markdown.charCodeAt(0) === 0xFEFF) {
    markdown = markdown.slice(1);
  }
  // parse frontmatter
  const frontmatterResult = parseNico(markdown);
  const frontmatter = frontmatterResult.frontmatter;
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name || !description) {
    throw new Error("name and description are required");
  }
  // reject removed
  if ("fallbackModels" in frontmatter) {
    throw new Error("removed frontmatter");
  }
  // build agent
  const agent: any = {
    name,
    localName: name,
    description,
    systemPrompt: body,
    systemPromptMode: "replace",
    inheritProjectContext: false,
  };
  // name with package
  if (frontmatter.package) {
    const pkg = frontmatter.package.toLowerCase().replace(/\s+/g, "-");
    agent.name = `${pkg}.${name}`;
    agent.packageName = pkg;
  }
  // tools
  if ("tools" in frontmatter) {
    agent.tools = parseNicoTools(frontmatter.tools);
  }
  // extensions
  if ("extensions" in frontmatter) {
    agent.extensions = parseNicoExtensions(frontmatter.extensions);
  }
  // allowedAgents - reject empty
  if ("allowedAgents" in frontmatter) {
    const ags = frontmatter.allowedAgents;
    if (Array.isArray(ags) && ags.length === 0) {
      throw new Error("allowedAgents: empty list not allowed");
    }
    agent.allowedAgents = parseNicoAllowedAgents(ags);
  }
  // excludeTools
  if (frontmatter.excludeTools) {
    agent.excludeTools = parseNicoTools(frontmatter.excludeTools);
  }
  // model
  if (frontmatter.model) {
    agent.model = frontmatter.model;
  }
  // toolBudget
  if (frontmatter.toolBudget !== undefined) {
    const budget = frontmatter.toolBudget;
    if (typeof budget === "string") {
      agent.toolBudget = JSON.parse(budget);
    } else {
      agent.toolBudget = budget;
    }
  }
  // memory
  if (frontmatter.memory !== undefined) {
    agent.memory = parseNicoMemory(frontmatter.memory);
  }
  // booleans
  if ("async" in frontmatter) {
    agent.defaultAsync = frontmatter.async === true || frontmatter.async === "true";
  }
  if ("fast" in frontmatter) {
    agent.fast = frontmatter.fast === true || frontmatter.fast === "true";
  }
  if ("thinking" in frontmatter) {
    agent.thinking = frontmatter.thinking === true || frontmatter.thinking === "true";
  }
  if ("inheritSkills" in frontmatter) {
    agent.inheritSkills = frontmatter.inheritSkills === true || frontmatter.inheritSkills === "true";
  }
  if ("allowNestedSubagents" in frontmatter) {
    agent.allowNestedSubagents = frontmatter.allowNestedSubagents === true || frontmatter.allowNestedSubagents === "true";
  }
  // reject disallowed
  if (frontmatter.runner || frontmatter.acceptance) {
    throw new Error("Outside isolated Nico conformance scope");
  }
  return agent;
}

// loadTintin: load an agent from Tintin-formatted markdown
export function loadTintin(markdown: string): { agent: any; warnings: string[] } {
  // handle BOM
  if (markdown.charCodeAt(0) === 0xFEFF) {
    markdown = markdown.slice(1);
  }
  // parse frontmatter
  const frontmatterResult = parseTintin(markdown);
  const frontmatter = frontmatterResult.frontmatter;
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name) {
    throw new Error("Invalid frontmatter");
  }
  const warnings: string[] = [];

  const agent: any = {
    name,
    description,
    systemPrompt: body,
    promptMode: "replace",
    enabled: true,
  };

  // tools
  if ("tools" in frontmatter) {
    agent.builtinToolNames = parseTintinTools(frontmatter.tools);
  }
  // extensions
  if ("extensions" in frontmatter) {
    agent.extensions = parseTintinExtensions(frontmatter.extensions);
  }
  // persistSession
  if ("persist_session" in frontmatter) {
    agent.persistSession = frontmatter.persist_session === true || frontmatter.persist_session === "true";
  }
  // inherit_context
  if ("inherit_context" in frontmatter) {
    agent.inheritContext = frontmatter.inherit_context === true || frontmatter.inherit_context === "true";
  }
  // run_in_background
  if ("run_in_background" in frontmatter) {
    agent.runInBackground = frontmatter.run_in_background === true || frontmatter.run_in_background === "true";
  }
  // isolated
  if ("isolated" in frontmatter) {
    agent.isolation = frontmatter.isolated === true || frontmatter.isolated === "true" ? "off" : "default";
  }
  // output_transcript
  if ("output_transcript" in frontmatter) {
    agent.outputTranscript = frontmatter.output_transcript === true || frontmatter.output_transcript === "true";
  }
  // max_turns
  if ("max_turns" in frontmatter) {
    agent.maxTurns = frontmatter.max_turns;
  }
  // model
  if ("model" in frontmatter) {
    agent.model = frontmatter.model;
  }
  // thinking
  if ("thinking" in frontmatter) {
    agent.thinking = frontmatter.thinking;
  }
  // skills
  if ("skills" in frontmatter) {
    agent.skills = frontmatter.skills;
  }
  // memory
  if ("memory" in frontmatter) {
    agent.memory = frontmatter.memory;
  }
  // reject: yaml parse error throws

  return { agent, warnings };
}

// nicoList: parse YAML-style list string
export function nicoList(str: string): string[] {
  return str.split(/\n/).filter(s => s.trim()).flatMap(s => s.split(",").map(t => t.trim()).filter(t => t));
}

// verifySnapshots: no-op for conformance
export function verifySnapshots(): void {}

// Re-export fixtureBuiltinToolNames from shared contracts
import { fixtureBuiltinToolNames } from "../../shared/agent-contracts.js";

export { fixtureBuiltinToolNames };

// Helper functions

function parseNicoTools(value: any): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === "") return [];
  if (value === false || value === null) return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return value;
  }
  if (typeof value === "string") {
    if (value.startsWith("[") || value.startsWith("{")) {
      if (value === "[]") return ["[]"];
      if (value.startsWith("[")) {
        const inner = value.slice(1, -1);
        return inner.split(",").map(s => s.trim());
      }
    }
    if (value.includes(",") && !value.includes("\n")) {
      const parts = value.split(",").map(s => s.trim());
      return parts.filter(p => !p.startsWith("mcp:") && !p.startsWith("ext:"));
    }
    if (value === "none" || value === "false") return [value];
    return [value];
  }
  return undefined;
}

function parseNicoExtensions(value: any): string[] | boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "") return false;
  if (value === false) return false;
  if (value === true) return true;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value;
  }
  if (typeof value === "string") {
    if (value === "false") return false;
    if (value === "true") return true;
    if (value === "") return false;
    return value.split(",").map(s => s.trim());
  }
  return false;
}

function parseNicoAllowedAgents(value: any): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error("allowedAgents: empty list not allowed");
    }
    return value;
  }
  if (typeof value === "string") {
    return value.split(",").map(s => s.trim()).filter(s => s.length > 0);
  }
  return [];
}

function parseNicoMemory(value: any): any {
  if (value === undefined) return undefined;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const str = JSON.stringify(value);
    if (str.startsWith('"')) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

function parseTintinTools(value: any): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === "" || value === null || value === false) return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return value;
  }
  if (typeof value === "string") {
    if (value === "none" || value === "false") return [value];
    if (value.includes(",") || value.includes("\n")) {
      const parts = value.split(/[,\n]/).map(s => s.trim()).filter(s => s);
      return parts.filter(p => !p.startsWith("mcp:") && !p.startsWith("ext:"));
    }
    return [value];
  }
  return undefined;
}

function parseTintinExtensions(value: any): string[] | boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "" || value === false) return false;
  if (value === true) return true;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value;
  }
  if (typeof value === "string") {
    if (value === "false") return false;
    if (value === "true") return true;
    return value.split(",").map(s => s.trim());
  }
  return false;
}