import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
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

export abstract class $TimestampCalculator {
  HOUR_IN_MS = 60 ** 2 * 1000;
  DAY_IN_MS = 24 * this.HOUR_IN_MS;
  WEEK_IN_MS = 7 * this.DAY_IN_MS;

  abstract hour(number: number): number;
  abstract day(number: number): number;
  abstract week(number: number): number;
}

export default function (pi: ExtensionAPI) {
  const commandRoot = "session";

  pi.registerCommand(`${commandRoot}:clean:inactive`, {
    handler: async (_, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);

      handleSessionCleanInactive({ sessions }, ctx);
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

      const sessions = await SessionManager.list(ctx.cwd);

      handleSessionCleanOlderThan(result.output, { sessions }, ctx);
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

      const sessions = await SessionManager.list(ctx.cwd);

      handleSessionDeleteLast(result.output, { sessions }, ctx);
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

export function handleSessionCleanInactive(
  deps: {
    sessions: Array<SessionInfo>;
    cleanSessionsOlderThan: (timestamp: number) => void;
  },
  ctx: ExtensionContext,
) {}

export function handleSessionCleanOlderThan(
  input: string,
  deps: { sessions: Array<SessionInfo> },
  ctx: ExtensionContext,
) {}

export function handleSessionDeleteLast(
  number: number,
  deps: { sessions: Array<SessionInfo> },
  ctx: ExtensionContext,
) {}

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
