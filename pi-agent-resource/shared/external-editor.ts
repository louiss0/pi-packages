import {
  mkdtemp,
  rm,
  writeFile as writeTempFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExternalEditorFactory } from "@code-fixer-23/pi-form-components";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { modalEditorOverlayOptions } from "./ui";

export type ExternalEditorEditResult = {
  after: string;
  before: string;
  changed: boolean;
};

type ExternalEditorContext = {
  ui: Pick<ExtensionContext["ui"], "custom" | "notify">;
};

export async function editFileWithExternalEditor(
  ctx: ExternalEditorContext,
  filePath: string,
  resourceLabel: string,
) {
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    const error = new Error(`Set $VISUAL or $EDITOR to edit ${resourceLabel}`);
    ctx.ui.notify(error.message, "error");
    return error;
  }

  const result = await ctx.ui.custom<ExternalEditorEditResult | Error>(
    createExternalEditorFactory(editor, filePath),
    modalEditorOverlayOptions,
  );

  if (result instanceof Error) {
    ctx.ui.notify(result.message, "error");
    return result;
  }

  return result;
}

export async function editMarkdownWithExternalEditor(
  ctx: ExternalEditorContext,
  initialContent: string,
  resourceLabel: string,
) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-agent-resource-"));
  const filePath = join(temporaryDirectory, "draft.md");

  await writeTempFile(filePath, initialContent, "utf8");

  try {
    const result = await editFileWithExternalEditor(ctx, filePath, resourceLabel);

    if (result instanceof Error) {
      return result;
    }

    return result.after;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
