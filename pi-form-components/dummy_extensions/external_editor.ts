import { join } from "node:path";
import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExternalEditor } from "../src/lib/components";

export default function externalEditior(pi: ExtensionAPI) {
  pi.registerCommand("external-editor", {
    description: "Edit dummy files",
    handler: async (args, ctx) => {
      const { EDITOR } = process.env;

      if (!EDITOR) {
        return ctx.ui.notify("EDITOR environment variable not set", "error");
      }

      const dummyFile = join(import.meta.dirname, "../fixtures/example.md");

      // ctx.ui.notify(`Opening file ${dummyFile} cwd ${import.meta.dirname}`, "warning");

      const result = await ctx.ui.custom(createExternalEditor(EDITOR, dummyFile));

      if (result instanceof Error) {
        return ctx.ui.notify(result.message, "error");
      }

      ctx.ui.notify(result.after);
    },
  });
}
