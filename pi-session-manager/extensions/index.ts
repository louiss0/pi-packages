import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { rmSync } from "fs";
import {
  digits,
  type InferOutput,
  picklist,
  pipe,
  regex,
  safeParse,
  string,
  summarize,
  transform,
  union,
} from "valibot";

export const sessionSeriesCommandsSchema = picklist(["create", "delete", "new"]);

type SessionSeriesCommand = InferOutput<typeof sessionSeriesCommandsSchema>;
const integerWithUnitRE = /(?<integer>\d+)(?<unit>days|weeks|hours)/;
const integerWithUnitShortRE = /(?<integer>\d+)(?<unit>d|w|h)/;
const durationRecordSchema = union(
  [
    pipe(
      string(),
      regex(integerWithUnitRE),
      transform((input) => {
        const { integer, unit } = integerWithUnitRE.exec(input)?.groups as {
          integer: string;
          unit: "days" | "weeks" | "hours";
        };

        return { integer: parseInt(integer), unit };
      }),
    ),
    pipe(
      string(),
      regex(integerWithUnitShortRE),
      transform((input) => {
        const { integer, unit } = integerWithUnitShortRE.exec(input)?.groups as {
          integer: string;
          unit: "d" | "w" | "h";
        };
        return { integer: parseInt(integer), unit };
      }),
    ),
  ],
  "You can only use an integer suffixed by days, weeks, or hours or the shorthand d/w/h units",
);

export type DurationRecord = InferOutput<typeof durationRecordSchema>;

export default function (pi: ExtensionAPI) {
  const commandRoot = "session";

  pi.registerCommand(`${commandRoot}:clean:inactive`, {
    handler: async (_, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);

      handleSessionCleanInactive({}, ctx);
    },
  });

  pi.registerCommand(`${commandRoot}:clean:older-than`, {
    handler: async (args, ctx) => {
      const result = safeParse(durationRecordSchema, args);

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

export abstract class $TimestampCalculator {
  HOUR_IN_MS = 60 ** 2 * 1000;
  DAY_IN_MS = 24 * this.HOUR_IN_MS;
  WEEK_IN_MS = 7 * this.DAY_IN_MS;

  abstract hour(number: number): number;
  abstract day(number: number): number;
  abstract week(number: number): number;
}

export interface $SessionFilter {
  readonly sessions: Array<SessionInfo>;
  getSessionsBasedOnDurationIntegerAndUnit(
    integer: DurationRecord["integer"],
    durationUnit: DurationRecord["unit"],
  ): Array<SessionInfo>;
  getSessionsBasedOnPredeterminedTimestamp(): Array<SessionInfo>;

  getSessionsThatAreTheLastNth(number: number): Array<SessionInfo>;
}

function removeSessionFiles(sessions: Array<SessionInfo>) {
  for (const session of sessions) {
    rmSync(session.path);
  }
}

export type RemoveSessionFiles = typeof removeSessionFiles;

export function handleSessionCleanInactive(
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {}

export function handleSessionCleanOlderThan(
  input: DurationRecord,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {}

export function handleSessionDeleteLast(
  number: number,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {}

export function handleSessionSeries(command: SessionSeriesCommand, deps:{

  setSessionName: ExtensionAPI['setSessionName']

} ctx: ExtensionContext) {
  switch (command) {
    case "new":
      break;

    case "create":
      break;

    case "delete":
      break;

    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
