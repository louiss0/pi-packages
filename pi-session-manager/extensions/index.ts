import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
  type SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  digits,
  type InferOutput,
  isoDateTime,
  literal,
  object,
  picklist,
  pipe,
  regex,
  safeParse,
  string,
  summarize,
  transform,
  union,
} from "valibot";

const CONFIG_DIR_NAME = ".pi";
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

        return { integer: Number.parseInt(integer), unit };
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

        return { integer: Number.parseInt(integer), unit };
      }),
    ),
  ],
  "You can only use an integer suffixed by days, weeks, or hours or the shorthand d/w/h units",
);

export type DurationRecord = InferOutput<typeof durationRecordSchema>;

export const SESION_TITLE_SEPARATOR = "--";
export const sessionSeriesCommandsSchema = picklist(["create", "delete", "new", "continue"]);
export const sessionSeriesEntrySchema = object({
  type: literal("custom"),
  customType: literal("session-manager/series"),
  data: object({
    series: string(),
    createdAt: pipe(string(), isoDateTime()),
  }),
});
export type SessionSeriesEntry = Extract<SessionEntry, { type: "custom" }> &
  InferOutput<typeof sessionSeriesEntrySchema>;

export abstract class $TimestampCalculator {
  readonly now = Date.now();
  readonly HOUR_IN_MS = 60 ** 2 * 1000;
  readonly DAY_IN_MS = 24 * this.HOUR_IN_MS;
  readonly WEEK_IN_MS = 7 * this.DAY_IN_MS;

  abstract hour(number: number): number;
  abstract day(number: number): number;
  abstract week(number: number): number;
}

class TimestampCalculator extends $TimestampCalculator {
  hour(number: number) {
    return this.now - number * this.HOUR_IN_MS;
  }

  day(number: number) {
    return this.now - number * this.DAY_IN_MS;
  }

  week(number: number) {
    return this.now - number * this.WEEK_IN_MS;
  }
}

export interface $SessionFilter {
  readonly sessions: Array<SessionInfo>;
  getSessionsBasedOnDurationIntegerAndUnit(
    integer: DurationRecord["integer"],
    durationUnit: DurationRecord["unit"],
  ): Array<SessionInfo>;
  getSessionsBasedOnPredeterminedTimestamp(): Array<SessionInfo>;
  getSessionsThatAreTheLastNth(number: number): Array<SessionInfo>;
  getSessionsThatHaveTheTitleAsAPrefix(title: string): Array<SessionInfo>;
}

class SessionFilter implements $SessionFilter {
  readonly sessions: Array<SessionInfo>;

  readonly #timestampCalculator: $TimestampCalculator;

  constructor(sessions: Array<SessionInfo>, timestampCalculator: $TimestampCalculator) {
    this.sessions = sessions;
    this.#timestampCalculator = timestampCalculator;
  }

  getSessionsBasedOnDurationIntegerAndUnit(
    integer: DurationRecord["integer"],
    durationUnit: DurationRecord["unit"],
  ) {
    return this.sessions.filter((session) => {
      switch (durationUnit) {
        case "hours":
        case "h":
          return session.modified.getTime() < this.#timestampCalculator.hour(integer);
        case "days":
        case "d":
          return session.modified.getTime() < this.#timestampCalculator.day(integer);
        case "weeks":
        case "w":
          return session.modified.getTime() < this.#timestampCalculator.week(integer);
      }
    });
  }

  getSessionsBasedOnPredeterminedTimestamp() {
    return this.sessions.filter(
      (session) => session.modified.getTime() < this.#timestampCalculator.day(3),
    );
  }

  getSessionsThatAreTheLastNth(number: number) {
    return this.sessions.slice(-number);
  }

  getSessionsThatHaveTheTitleAsAPrefix(title: string) {
    return this.sessions.filter((session) =>
      session.name?.startsWith(`${title}${SESION_TITLE_SEPARATOR}`),
    );
  }
}

type SessionSeriesCommand = InferOutput<typeof sessionSeriesCommandsSchema>;

function removeSessionFiles(sessions: Array<SessionInfo>) {
  for (const session of sessions) {
    rmSync(session.path);
  }
}

export type RemoveSessionFiles = typeof removeSessionFiles;

function getSessionSeriesTitles(cwd?: string) {
  const configPath = join(
    cwd ?? process.cwd(),
    CONFIG_DIR_NAME,
    "pi-session-manager.config.json",
  );

  if (!existsSync(configPath)) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));

    if (Array.isArray(parsed) && parsed.every((title) => typeof title === "string")) {
      return parsed;
    }
  } catch {
    return [] as string[];
  }

  return [] as string[];
}

export default function (pi: ExtensionAPI) {
  const commandRoot = "session";

  pi.registerCommand(`${commandRoot}:clean:inactive`, {
    handler: async (_, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);
      const sessionFilter = new SessionFilter(sessions, new TimestampCalculator());

      handleSessionCleanInactive(
        {
          sessionFilter,
          removeSessionFiles,
        },
        ctx,
      );
    },
  });

  pi.registerCommand(`${commandRoot}:clean:older-than`, {
    handler: async (args, ctx) => {
      const result = safeParse(durationRecordSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      const sessions = await SessionManager.list(ctx.cwd);
      const sessionFilter = new SessionFilter(sessions, new TimestampCalculator());

      handleSessionCleanOlderThan(
        result.output,
        {
          sessionFilter,
          removeSessionFiles,
        },
        ctx,
      );
    },
  });

  pi.registerCommand(`${commandRoot}:delete-last`, {
    getArgumentCompletions: (prefix) => {
      const autoCompleteItems: Array<AutocompleteItem> = [];

      for (let i = 1; i <= 10; i++) {
        autoCompleteItems.push({
          value: i.toString(),
          label: `last ${i.toString()}`,
        });
      }

      return autoCompleteItems.filter((item) => item.value === prefix);
    },
    handler: async (args, ctx) => {
      const intSchema = pipe(string(), digits(), transform(Number.parseInt));
      const result = safeParse(intSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      const sessions = await SessionManager.list(ctx.cwd);
      const sessionFilter = new SessionFilter(sessions, new TimestampCalculator());

      handleSessionDeleteLast(
        result.output,
        {
          sessionFilter,
          removeSessionFiles,
        },
        ctx,
      );
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

      const sessions = await SessionManager.list(ctx.cwd);

      await handleSessionSeries(
        result.output,
        {
          setSessionName: pi.setSessionName,
          sessionFilter: new SessionFilter(sessions, new TimestampCalculator()),
          getSessionEntryWithSeries,
          appendEntry: pi.appendEntry,
          removeSessionFiles,
        },
        ctx,
      );
    },
  });
}

function getSessionEntryWithSeries(
  sesssionEntries: SessionEntry[],
): SessionSeriesEntry | undefined {
  return sesssionEntries.find(
    (entry): entry is SessionSeriesEntry =>
      entry.type === sessionSeriesEntrySchema.entries.type.literal &&
      entry.customType === sessionSeriesEntrySchema.entries.customType.literal,
  );
}

export type GetSessionEntryWithSeries = typeof getSessionEntryWithSeries;

export function handleSessionCleanInactive(
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {
  ctx.ui.notify(
    "Getting rid of all sessions that have been inactive for three days",
    "warning",
  );
  deps.removeSessionFiles(deps.sessionFilter.getSessionsBasedOnPredeterminedTimestamp());
}

export function handleSessionCleanOlderThan(
  input: DurationRecord,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {
  ctx.ui.notify(`Deleteing sessions that are from ${input.integer} ${input.unit} ago`);
  deps.removeSessionFiles(
    deps.sessionFilter.getSessionsBasedOnDurationIntegerAndUnit(input.integer, input.unit),
  );
}

export function handleSessionDeleteLast(
  number: number,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {
  ctx.ui.notify(`Deleting the last ${number}`);
  deps.removeSessionFiles(deps.sessionFilter.getSessionsThatAreTheLastNth(number));
}

export async function handleSessionSeries(
  command: SessionSeriesCommand,
  deps: {
    setSessionName: ExtensionAPI["setSessionName"];
    sessionFilter: $SessionFilter;
    getSessionEntryWithSeries: GetSessionEntryWithSeries;
    appendEntry: ExtensionAPI["appendEntry"];
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionContext,
) {
  const commandContext = ctx as ExtensionContext & Pick<ExtensionCommandContext, "newSession">;

  switch (command) {
    case "create": {
      const series = await ctx.ui.input(
        "What is the name of your session series?",
        "What are you focused on?",
      );
      const title = await ctx.ui.input(
        "What is the name of the new session you want to make in this one?",
        "What task is a part of what you are focusing on?",
      );

      if (!series || !title) {
        return;
      }

      await commandContext.newSession({
        withSession: async () => {
          deps.setSessionName(`${series}${SESION_TITLE_SEPARATOR}${title}`);
          deps.appendEntry(sessionSeriesEntrySchema.entries.customType.literal, {
            series,
            createdAt: new Date().toISOString(),
          });
        },
      });

      ctx.ui.notify("Your session series has been created");
      return;
    }

    case "delete": {
      const series = await ctx.ui.select(
        "Which session series would you like to delete?",
        getSessionSeriesTitles(ctx.cwd),
      );

      if (!series) {
        return;
      }

      deps.removeSessionFiles(deps.sessionFilter.getSessionsThatHaveTheTitleAsAPrefix(series));
      ctx.ui.notify(`This series ${series} and it's related sessions`);
      return;
    }

    case "new": {
      const series = await ctx.ui.select(
        "Which session series would you like to create a new session in?",
        getSessionSeriesTitles(ctx.cwd),
      );
      const title = await ctx.ui.input(
        "What is the name of the this new session?",
        "What do you want your agent to do now?",
      );

      if (!series || !title) {
        return;
      }

      await commandContext.newSession({
        withSession: async () => {
          deps.setSessionName(`${series}${SESION_TITLE_SEPARATOR}${title}`);
        },
      });

      ctx.ui.notify(`You have created a new session in ${series}
      with ${title}
      `);
      return;
    }

    case "continue": {
      const entries = ctx.sessionManager.getEntries();
      const entry = deps.getSessionEntryWithSeries(entries);

      if (!entry) {
        ctx.ui.notify("No session series was found", "error");
        return;
      }

      const title = await ctx.ui.input(
        `What's the new title for the session in series ${entry.data.series}`,
      );

      if (!title) {
        return;
      }

      await commandContext.newSession({
        withSession: async () => {
          deps.setSessionName(`${entry.data.series}${SESION_TITLE_SEPARATOR}${title}`);
        },
      });

      ctx.ui.notify(`You have created a new session in ${entry.data.series}
      with ${title}
      `);
      return;
    }

    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
