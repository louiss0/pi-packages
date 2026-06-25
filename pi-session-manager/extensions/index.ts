import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  digits,
  picklist,
  pipe,
  regex,
  safeParse,
  string,
  summarize,
  transform,
  union,
  type InferOutput,
} from "valibot";

export const sessionSeriesCommandsSchema = picklist(["create", "delete", "new", "resume"]);

type SessionSeriesCommand = InferOutput<typeof sessionSeriesCommandsSchema>;

export default function (pi: ExtensionAPI) {
  const commandRoot = "session";

  pi.registerCommand(`${commandRoot}:clean:inactive`, {
    handler: async (_, ctx) => {
      handleSessionCleanInactive(ctx);
    },
  });

  pi.registerCommand(`${commandRoot}:clean:older-than`, {
    handler: async (args, ctx) => {
      const durationLimitSchema = union(
        [
          pipe(string(), regex(/(?<integer>\d+)(?<unit>days|weeks|hours)/)),
          pipe(string(), regex(/(?<integer>\d+)(?<unit>d|w|h)/)),
        ],
        "You can only use an integer suffixed by days, weeks, or hours or the shorthand d/w/h units",
      );

      const result = safeParse(durationLimitSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      handleSessionCleanOlderThan(result.output, ctx);
    },
  });

  pi.registerCommand(`${commandRoot}:delete-last`, {
    getArgumentCompletions: (prefix) => {
      const autoCompleteItems: Array<AutocompleteItem> = [];

      for (let i = 1; i <= 10; i++) {
        autoCompleteItems.push({ value: i.toString(), label: `last ${i.toString()}` });
      }
      return autoCompleteItems.filter((item) => item.value === prefix);
    },
    handler: async (args, ctx) => {
      const intSchema = pipe(string(), digits(), transform(parseInt));

      const result = safeParse(intSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      handleSessionDeleteLast(result.output, ctx);
    },
  });

  pi.registerCommand(`${commandRoot}:series`, {
    getArgumentCompletions: (prefix) => {
      return sessionSeriesCommandsSchema.options
        .filter((option) => option.startsWith(prefix))
        .map((option) => ({
          value: option,
          label: option,
          description: `Is it this ${option}`,
        }));
    },
    handler: async (args, ctx) => {
      const result = safeParse(sessionSeriesCommandsSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      handleSessionSeries(result.output, ctx);
    },
  });
}

export function handleSessionCleanInactive(ctx: ExtensionContext) {}

export function handleSessionCleanOlderThan(input: string, ctx: ExtensionContext) {}

export function handleSessionDeleteLast(number: number, ctx: ExtensionContext) {}

export function handleSessionSeries(command: SessionSeriesCommand, ctx: ExtensionContext) {
  switch (command) {
    case "new":
      break;
    case "create":
      break;
    case "delete":
      break;

    case "resume":
      break;

    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
