import { join } from "node:path";
import { Picker } from "@code-fixer-23/pi-form-components";
import {
  loadSkillsFromDir,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getPathResolver, NodeFileSystem } from "./filesystem";
import { handleSkillInvocationTargets } from "./skill-invocation-controls";
import { modalEditorOverlayOptions } from "./ui";
import { isSkillModelInvocationDisabled } from "./skill-invocation";

/** Pick an installed pack without loading it or changing the active pack selection. */
export async function handlePackSkillInvocation(
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Skill invocation settings require TUI mode", "error");
    return;
  }
  const fileSystem = new NodeFileSystem();
  const resolver = getPathResolver(ctx.cwd);
  const entries = await fileSystem.readDirectoryEntries(
    resolver.resolvePackPath(),
  );
  if (!entries.success) {
    if ("code" in entries.error && entries.error.code === "ENOENT")
      ctx.ui.notify("No packs found", "info");
    else
      ctx.ui.notify(`Could not list packs: ${entries.error.message}`, "error");
    return;
  }
  const packs = entries.data
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (packs.length === 0) {
    ctx.ui.notify("No packs found", "info");
    return;
  }
  const pack = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const picker = new Picker(
      "Select pack",
      {
        title: "Select a pack to manage skill invocation",
        items: packs,
        itemLimit: 8,
        helpText: "Type to filter | ↑↓ navigate | Enter select | Esc cancel",
      },
      theme,
      tui,
      done,
    );
    picker.setFocused(true);
    return picker;
  }, modalEditorOverlayOptions);
  if (pack === null || !packs.includes(pack)) return;

  const skillRoot = resolver.resolvePackSkillPath(pack, "");
  const discovered = loadSkillsFromDir({ dir: skillRoot, source: "path" });
  const warn = (path: string | undefined, message: string) =>
    ctx.ui.notify(`Pack '${pack}': ${path}: ${message}`, "warning");
  for (const diagnostic of discovered.diagnostics)
    warn(diagnostic.path, diagnostic.message);

  // Pi intentionally suppresses parse diagnostics for standalone Markdown.
  // Report frontmatter-bearing files it skipped without adding them to the list.
  const rootEntries = await fileSystem.readDirectoryEntries(skillRoot);
  const knownPaths = new Set([
    ...discovered.skills.map((skill) => skill.filePath),
    ...discovered.diagnostics.map((diagnostic) => diagnostic.path),
  ]);
  if (
    rootEntries.success &&
    !rootEntries.data.some((entry) => entry.name === "SKILL.md")
  ) {
    for (const entry of rootEntries.data) {
      if (
        (!entry.isFile?.() && !entry.isSymbolicLink?.()) ||
        entry.name.startsWith(".") ||
        !entry.name.endsWith(".md")
      )
        continue;
      const path = join(skillRoot, entry.name);
      if (knownPaths.has(path)) continue;
      const content = await fileSystem.readFile(path);
      if (!content.success) {
        warn(path, content.error.message);
        continue;
      }
      if (!/^(?:\uFEFF)?---[\t ]*\r?\n/.test(content.data)) continue;
      try {
        isSkillModelInvocationDisabled(content.data);
      } catch (error) {
        warn(path, error instanceof Error ? error.message : String(error));
      }
    }
  }
  const targets = discovered.skills
    .map((skill) => ({ path: skill.filePath, label: skill.name }))
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.path.localeCompare(b.path),
    );
  await handleSkillInvocationTargets(
    ctx,
    targets,
    fileSystem,
    `Pack '${pack}' — skill model invocation`,
  );
}
