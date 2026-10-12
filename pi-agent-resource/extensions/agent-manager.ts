import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askAgentFilename, authorAgentDefinition } from "../shared/agent-authoring";
import { AGENT_PROFILES, agentIdentity, parseAgentMarkdown, renderAgentMarkdown, type AgentRuntime, type AgentFrontmatter } from "../shared/agent-contracts";
import { detectAgentRuntimes, type AgentResourceSource } from "../shared/agent-runtime-detection";
import { DEFAULT_AGENT_TOOLS, validateAgentSavePolicy } from "../shared/agent-save-policy";
import { getPathResolver, NodeFileSystem, type ResourceFileSystem, type ResourcePathResolver } from "../shared/filesystem";
import { notifyWhenUsingDevelopmentExtension } from "../shared/runtime";
import { getFilterSubcommandArgumentCompletionFromStringUsingSubLabel, SubCommands } from "../shared/subcommands";

const extensionName = "agent-manager";
export const GLOBAL_AGENT_DIRECTORY = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), CONFIG_DIR_NAME, "agent"), "agents");
export const LOCAL_AGENT_DIRECTORY = join(CONFIG_DIR_NAME, "agents");
type AgentScope = "global" | "local";
type GetResourceFileSystem = (rootPath?: string) => ResourceFileSystem;
type GetPathResolver = (cwd?: string) => ResourcePathResolver;
export interface AgentAuthoringOptions {
  runtime?: AgentRuntime;
  detectedRuntimes?: readonly AgentRuntime[];
  sources?: readonly AgentResourceSource[];
  availableToolNames?: readonly string[];
}
export interface AgentChoice { path: string; label: string }

export function parseAgentCommandArgument(argument: string) {
  const result = SubCommands.parse(argument.trim());
  return result.success ? { success: true as const, output: result.output } : { success: false as const, errorMessage: result.errorMessage };
}

export default (pi: ExtensionAPI) => {
  for (const scope of ["global", "local"] as const) {
    pi.registerCommand(scope === "global" ? "resource:agent" : "resource:local-agent", {
      description: scope === "global" ? "This is for managing global agents" : "This is for managing project agents",
      getArgumentCompletions: getFilterSubcommandArgumentCompletionFromStringUsingSubLabel("agent"),
      handler: async (argument, ctx) => {
        notifyWhenUsingDevelopmentExtension(extensionName, ctx);
        const parsed = parseAgentCommandArgument(argument);
        if (!parsed.success) { ctx.ui.notify(`Invalid command: ${parsed.errorMessage}`, "error"); return; }
        if (!ctx.hasUI) { ctx.ui.notify("Agent authoring requires interactive or RPC UI", "error"); return; }
        const registeredTools = pi.getAllTools?.() ?? [];
        const options: AgentAuthoringOptions = {
          sources: [...registeredTools, ...(pi.getCommands?.() ?? [])],
          availableToolNames: registeredTools.filter((tool) => tool.exposure !== "hidden").map((tool) => tool.name),
        };
        const handler = { create: handleCreate, edit: handleEdit, delete: handleDelete }[parsed.output];
        await handler(ctx, scope, undefined, undefined, options);
      },
    });
  }
};

function missing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function report(ctx: ExtensionContext, action: string, error: unknown) {
  ctx.ui.notify(`${action}: ${error instanceof Error ? error.message : String(error)}`, "error");
}

function assertAgentSavePolicy(frontmatter: AgentFrontmatter) {
  const errors = validateAgentSavePolicy(frontmatter);
  if (errors.length) throw new Error(errors.join("\n"));
}

async function selectRuntime(ctx: ExtensionContext, options: AgentAuthoringOptions) {
  const detected = options.detectedRuntimes ?? await detectAgentRuntimes(options.sources ?? []);
  const runtime = options.runtime ?? (detected.length === 1 ? detected[0] : undefined);
  if (runtime) {
    ctx.ui.notify(`Authoring profile: ${AGENT_PROFILES[runtime].label} (selection does not isolate discovery)`, "info");
    return { runtime, detected };
  }
  const runtimes = ["tintin", "nico"] as const;
  const labels = runtimes.map((id) => AGENT_PROFILES[id].label);
  const selected = await ctx.ui.select("Choose agent runtime — detection is absent or ambiguous", labels);
  const chosen = runtimes[labels.indexOf(selected ?? "")];
  return chosen ? { runtime: chosen, detected } : undefined;
}

async function confirmCoexistence(ctx: ExtensionContext, detected: readonly AgentRuntime[]) {
  return detected.length < 2 || await ctx.ui.confirm("Shared agent discovery location", "Both Pi subagent runtimes are detected. The other runtime can also discover this file and ignore unfamiliar permission restrictions. A profile is not an isolation boundary. Save intentionally?");
}

function rootFor(scope: AgentScope, resolver: ResourcePathResolver) {
  return scope === "local" ? resolver.resolveLocalAgentPath() : resolver.resolveGlobalAgentPath();
}

async function getResources(ctx: ExtensionContext, scope: AgentScope, runtime: AgentRuntime, getFileSystem: GetResourceFileSystem, getResolver: GetPathResolver) {
  const cwd = ctx.cwd || process.cwd();
  let resolver = getResolver(cwd);
  const fs = getFileSystem(rootFor(scope, resolver));
  // Nico discovers the nearest project .pi/.agents directory, not necessarily task cwd.
  if (scope === "local" && runtime === "nico") {
    let directory = cwd;
    while (directory !== homedir()) {
      const entries = await fs.readDirectoryEntries(directory);
      if (!entries.success) {
        if (!missing(entries.error)) throw entries.error;
      } else if (entries.data.some((entry) => entry.isDirectory() && [CONFIG_DIR_NAME, ".agents"].includes(entry.name))) {
        resolver = getResolver(directory);
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const root = rootFor(scope, resolver);
  ctx.ui.notify(`Using ${scope === "local" ? "project" : "user"} agent definitions from ${root}`, "info");
  return { fs, resolver, root };
}

export async function handleCreate(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
  options: AgentAuthoringOptions = {},
) {
  try {
    const selection = await selectRuntime(ctx, options);
    if (!selection) { ctx.ui.notify("Agent creation cancelled", "info"); return; }
    const { runtime, detected } = selection;
    const { fs, root } = await getResources(ctx, scope, runtime, getFileSystem, getResolver);
    const filename = await askAgentFilename(ctx.ui);
    if (filename === undefined) { ctx.ui.notify("Agent creation cancelled", "info"); return; }
    const path = join(root, `${filename}.md`);
    const existing = await fs.readFile(path);
    if (existing.success) { ctx.ui.notify("Agent file already exists; use edit instead. Nothing was overwritten.", "error"); return; }
    if (!missing(existing.error)) throw existing.error;
    const definition = await authorAgentDefinition(ctx.ui, runtime, {
      frontmatter: runtime === "nico" ? { name: filename, tools: DEFAULT_AGENT_TOOLS } : { tools: DEFAULT_AGENT_TOOLS },
      body: "",
    }, options.availableToolNames, "create");
    if (!definition || !await confirmCoexistence(ctx, detected)) { ctx.ui.notify("Agent creation cancelled", "info"); return; }
    assertAgentSavePolicy(definition.frontmatter);
    const content = renderAgentMarkdown(runtime, definition.frontmatter, definition.body);
    const directory = await fs.mkdir(root, { recursive: true });
    if (!directory.success) throw directory.error;
    // Atomic exclusive publication also closes the check/write collision window.
    const result = await fs.writeFile(path, content, { exclusive: true, atomic: true });
    if (!result.success) throw result.error;
    ctx.ui.notify(`Definition saved: ${path}. Reload the subagent runtime to refresh its catalog; this does not launch an agent.`, "info");
  } catch (error) { report(ctx, "Agent creation failed", error); }
}

export async function handleEdit(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
  options: AgentAuthoringOptions = {},
) {
  try {
    const selection = await selectRuntime(ctx, options);
    if (!selection) { ctx.ui.notify("Agent editing cancelled", "info"); return; }
    const { runtime, detected } = selection;
    const { fs, resolver } = await getResources(ctx, scope, runtime, getFileSystem, getResolver);
    const agent = await pickAgent(ctx, "Edit Agent", scope, runtime, fs, resolver);
    if (!agent) { ctx.ui.notify("Agent editing cancelled", "info"); return; }
    const before = await fs.readFile(agent.path);
    if (!before.success) throw before.error;
    // Unknown or malformed fields fail before any form or prompt edit can mutate the file.
    const parsed = parseAgentMarkdown(runtime, before.data);
    const definition = await authorAgentDefinition(ctx.ui, runtime, parsed, options.availableToolNames);
    if (!definition || !await confirmCoexistence(ctx, detected)) { ctx.ui.notify("Agent editing cancelled", "info"); return; }
    if (JSON.stringify(definition) === JSON.stringify(parsed)) { ctx.ui.notify("Definition unchanged", "info"); return; }
    assertAgentSavePolicy(definition.frontmatter);
    const content = renderAgentMarkdown(runtime, definition.frontmatter, definition.body);
    const current = await fs.readFile(agent.path);
    if (!current.success) throw current.error;
    if (current.data !== before.data) throw new Error("Agent changed outside this editor; reopen it. Nothing was overwritten.");
    const result = await fs.writeFile(agent.path, content, { atomic: true });
    if (!result.success) throw result.error;
    ctx.ui.notify(`Definition saved: ${agent.path}. Reload the subagent runtime to refresh its catalog.`, "info");
  } catch (error) { report(ctx, "Agent edit failed", error); }
}

export async function handleDelete(
  ctx: ExtensionContext,
  scope: AgentScope = "global",
  getFileSystem: GetResourceFileSystem = () => new NodeFileSystem(),
  getResolver: GetPathResolver = getPathResolver,
  options: AgentAuthoringOptions = {},
) {
  try {
    const selection = await selectRuntime(ctx, options);
    if (!selection) { ctx.ui.notify("Agent deletion cancelled", "info"); return; }
    const { fs, resolver } = await getResources(ctx, scope, selection.runtime, getFileSystem, getResolver);
    const agent = await pickAgent(ctx, "Delete Agent", scope, selection.runtime, fs, resolver);
    if (!agent || !await ctx.ui.confirm("Delete agent definition", `Delete ${agent.path}? A lower-priority definition with the same runtime identity may become active.`)) { ctx.ui.notify("Agent deletion cancelled", "info"); return; }
    const result = await fs.removeFile(agent.path);
    if (!result.success) throw result.error;
    ctx.ui.notify("Agent definition deleted; reload the subagent runtime to refresh its catalog", "info");
  } catch (error) { report(ctx, "Agent deletion failed", error); }
}

async function pickAgent(ctx: ExtensionContext, title: string, scope: AgentScope, runtime: AgentRuntime, fs: ResourceFileSystem, resolver: ResourcePathResolver) {
  const choices = await listAgentChoices(scope, runtime, fs, resolver);
  if (!choices.length) { ctx.ui.notify("No agent definition files found", "info"); return undefined; }
  const selected = await ctx.ui.select(title, choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === selected);
}

export async function listAgentChoices(scope: AgentScope, runtime: AgentRuntime, fs: ResourceFileSystem, resolver: ResourcePathResolver): Promise<AgentChoice[]> {
  const primary = rootFor(scope, resolver);
  const roots = [primary];
  if (scope === "local") roots.push(join(dirname(dirname(primary)), ".agents", ...(runtime === "tintin" ? ["agents"] : [])));
  const choices: AgentChoice[] = [];
  const seen = new Set<string>();
  const walk = async (directory: string, root: string) => {
    if (seen.has(directory)) return;
    seen.add(directory);
    const result = await fs.readDirectoryEntries(directory);
    if (!result.success) { if (missing(result.error)) return; throw result.error; }
    for (const entry of result.data.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (AGENT_PROFILES[runtime].recursive) await walk(path, root); continue; }
      if (entry.isFile && !entry.isFile()) continue;
      if (!entry.name.endsWith(".md") || (runtime === "nico" && entry.name.endsWith(".chain.md"))) continue;
      const file = await fs.readFile(path);
      let identity = basename(entry.name, ".md");
      let status = "";
      if (!file.success) status = ` [unreadable: ${file.error.message}]`;
      else {
        try { identity = agentIdentity(runtime, parseAgentMarkdown(runtime, file.data).frontmatter, basename(entry.name, ".md")); }
        catch (error) { status = ` [not editable: ${error instanceof Error ? error.message : String(error)}]`; }
      }
      choices.push({ path, label: `${scope}: ${identity} — ${root}/${relative(root, path)}${status}` });
    }
  };
  for (const root of roots) await walk(root, root);
  return choices;
}
