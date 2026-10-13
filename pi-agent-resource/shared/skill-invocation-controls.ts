import { MultiSelect } from "@code-fixer-23/pi-form-components";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { NodeFileSystem, type ResourceFileSystem } from "./filesystem";
import {
  isSkillModelInvocationDisabled,
  setSkillModelInvocationDisabled,
} from "./skill-invocation";
import { modalEditorOverlayOptions } from "./ui";

export type SkillInvocationTarget = { path: string; label: string };

/** Manage the skills Pi actually loaded, including package and .agents skills. */
export async function handleSkillInvocation(
  ctx: ExtensionCommandContext,
  commands: ReturnType<ExtensionAPI["getCommands"]>,
  fileSystem: ResourceFileSystem = new NodeFileSystem(),
): Promise<void> {
  const targets = commands
    .filter((command) => command.source === "skill")
    .map((command) => {
      const scope =
        command.sourceInfo.scope === "user"
          ? "global"
          : command.sourceInfo.scope === "project"
            ? "local"
            : "temporary";
      return {
        path: command.sourceInfo.path,
        label: `${command.name.replace(/^skill:/, "")} (${scope})`,
      };
    });
  await handleSkillInvocationTargets(ctx, targets, fileSystem);
}

/** Shared checkbox/save workflow for loaded skills or skills in an installed pack. */
export async function handleSkillInvocationTargets(
  ctx: ExtensionCommandContext,
  targets: readonly SkillInvocationTarget[],
  fileSystem: ResourceFileSystem = new NodeFileSystem(),
  title = "Skill model invocation",
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Skill invocation settings require TUI mode", "error");
    return;
  }
  const skills: {
    path: string;
    label: string;
    content: string;
    disabled: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.path)) continue;
    const path = target.path;
    seen.add(path);
    try {
      const result = await fileSystem.readFile(path);
      if (!result.success) throw result.error;
      skills.push({
        path,
        label: target.label,
        content: result.data,
        disabled: isSkillModelInvocationDisabled(result.data),
      });
    } catch (error) {
      ctx.ui.notify(
        `Cannot edit skill ${path}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  if (skills.length === 0) {
    ctx.ui.notify("No editable skills found", "info");
    return;
  }

  const selected = await ctx.ui.custom<string[] | null>(
    (tui, theme, _kb, done) => {
      const list = new MultiSelect(
        title,
        {
          title:
            "Checked = disable-model-invocation: true (manual /skill:name only)\n↑↓ navigate | Space toggle | Enter save and reload | Esc cancel",
          items: skills.map((skill) => ({
            value: skill.path,
            label: skill.label,
            description: skill.path,
          })),
          initialValues: skills
            .filter((skill) => skill.disabled)
            .map((skill) => skill.path),
          itemLimit: 8,
          itemChoiceStyle: "checkbox",
        },
        tui,
        theme,
        done,
      );
      list.setFocused(true);
      return list;
    },
    modalEditorOverlayOptions,
  );

  if (selected === null) return;
  const disabledPaths = new Set(selected);
  let saved = 0;
  let failed = 0;
  for (const skill of skills) {
    const disabled = disabledPaths.has(skill.path);
    if (disabled === skill.disabled) continue;
    try {
      const current = await fileSystem.readFile(skill.path);
      if (!current.success) throw current.error;
      if (current.data !== skill.content)
        throw new Error(
          "file changed while the picker was open; reopen and try again",
        );
      const result = await fileSystem.writeFile(
        skill.path,
        setSkillModelInvocationDisabled(current.data, disabled),
      );
      if (!result.success) throw result.error;
      saved++;
    } catch (error) {
      failed++;
      ctx.ui.notify(
        `Cannot save skill ${skill.path}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }
  if (failed > 0 && saved === 0) return;
  ctx.ui.notify(
    failed > 0
      ? `Saved ${saved} skill invocation change(s); ${failed} failed. Reloading skills...`
      : "Skill invocation settings saved. Reloading skills...",
    failed > 0 ? "warning" : "info",
  );
  await ctx.reload();
}
