import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  type SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  getSetting,
  type SettingDefinition,
  setSetting,
} from "@juanibiapina/pi-extension-settings";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  array,
  checkItems,
  digits,
  type InferOutput,
  integer,
  isoTimestamp,
  literal,
  object,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  string,
  summarize,
  title,
  transform,
  union,
} from "valibot";

export default function (pi: ExtensionAPI) {
  const commandRoot = "session-manager";

  registerSessionManagerSettings(pi);

  let sessionManagerConfigurator: SessionManagerConfigurator;

  pi.on("session_start", async (event, ctx) => {
    sessionManagerConfigurator = new SessionManagerConfigurator();

    if (event.reason !== "fork" && event.reason !== "reload") {
      applyPersistedSessionSeriesData(pi, ctx);
    }

    const eventIsNotReloadOrStartUp =
      event.reason !== "reload" && event.reason !== "startup";
    if (eventIsNotReloadOrStartUp) {
      return;
    }

    const dayLimitResult =
      sessionManagerConfigurator.getSessionDeletionDayLimit();

    if (dayLimitResult instanceof SessionConfigError) {
      ctx.ui.notify(
        `Generated initial session manager config.
        Since there's no default daylimit for getting rid of the sessions
        ${dayLimitResult.message}`,
        "error",
      );
      sessionManagerConfigurator.generateInitialConfig(ctx.cwd);
      return ctx.ui.notify(
        `Every ${sessionManagerConfigurator.defaultSessionDeletionDayLimit} days unmodified sessions will be deleted `,
        "warning",
      );
    }

    const sessions = await SessionManager.list(ctx.cwd);
    const sessionFilter = new SessionFilter(
      sessions,
      new TimestampCalculator(),
    );

    const unmodifiedSessionsFromThePastNthDays =
      sessionFilter.getModifiedSessionsBasedOnDayLimit(dayLimitResult);

    if (unmodifiedSessionsFromThePastNthDays.length === 0) {
      return;
    }

    removeSessionFiles(unmodifiedSessionsFromThePastNthDays);
    ctx.ui.notify(
      `Removed ${unmodifiedSessionsFromThePastNthDays.length} inactive session(s).`,
      "info",
    );
  });

  pi.registerCommand(`${commandRoot}:clean:inactive`, {
    handler: async (_, ctx) => {
      const sessions = await SessionManager.list(ctx.cwd);
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

      handleSessionCleanInactive(
        {
          sessionFilter,
          sessionManagerConfigurator,
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
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

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
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

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

  pi.registerCommand(`${commandRoot}:clean:inactive:all`, {
    handler: async (_, ctx) => {
      const sessions = await SessionManager.listAll();
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

      handleSessionCleanInactive(
        {
          sessionFilter,
          sessionManagerConfigurator,
          removeSessionFiles,
        },
        ctx,
      );
    },
  });

  pi.registerCommand(`${commandRoot}:clean:older-than:all`, {
    handler: async (args, ctx) => {
      const result = safeParse(durationRecordSchema, args);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      const sessions = await SessionManager.listAll();
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

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

  pi.registerCommand(`${commandRoot}:delete-last:all`, {
    getArgumentCompletions: (prefix) => {
      const autoCompleteItems: Array<AutocompleteItem> = [];

      for (let i = 1; i <= 10; i++) {
        autoCompleteItems.push({
          value: i.toString(),
          label: `last ${i.toString()} in every project`,
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

      const sessions = await SessionManager.listAll();
      const sessionFilter = new SessionFilter(
        sessions,
        new TimestampCalculator(),
      );

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
          sessionManagerConfigurator: new SessionManagerConfigurator(),
          sessionFilter: new SessionFilter(sessions, new TimestampCalculator()),
          getSessionEntryWithSeries,
          removeSessionFiles,
        },
        ctx,
      );
    },
  });
}

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
  getModifiedSessionsBasedOnDurationIntegerAndUnit(
    integer: DurationRecord["integer"],
    durationUnit: DurationRecord["unit"],
  ): Array<SessionInfo>;
  getModifiedSessionsBasedOnDayLimit(dayLimit: number): Array<SessionInfo>;
  getSessionsThatAreTheLastNth(number: number): Array<SessionInfo>;
  getSessionsThatHaveTheTitleAsAPrefix(title: string): Array<SessionInfo>;
}

class SessionFilter implements $SessionFilter {
  readonly sessions: Array<SessionInfo>;

  readonly #timestampCalculator: $TimestampCalculator;

  constructor(
    sessions: Array<SessionInfo>,
    timestampCalculator: $TimestampCalculator,
  ) {
    this.sessions = sessions;
    this.#timestampCalculator = timestampCalculator;
  }

  getModifiedSessionsBasedOnDurationIntegerAndUnit(
    integer: DurationRecord["integer"],
    durationUnit: DurationRecord["unit"],
  ) {
    return this.sessions.filter((session) => {
      switch (durationUnit) {
        case "hours":
        case "h":
          return (
            session.modified.getTime() < this.#timestampCalculator.hour(integer)
          );
        case "days":
        case "d":
          return (
            session.modified.getTime() < this.#timestampCalculator.day(integer)
          );
        case "weeks":
        case "w":
          return (
            session.modified.getTime() < this.#timestampCalculator.week(integer)
          );
      }
    });
  }

  getModifiedSessionsBasedOnDayLimit(dayLimit: number) {
    return this.sessions.filter(
      (session) =>
        session.modified.getTime() < this.#timestampCalculator.day(dayLimit),
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

  return sessions;
}

export type RemoveSessionFiles = typeof removeSessionFiles;

const pathSegmentSeparatorRE = /[\\/]+/;

// Sessions from every project share one listing, so the deepest cwd segment is the grouping key
export function getSessionProjectName(session: SessionInfo) {
  const cwdSegments = session.cwd.split(pathSegmentSeparatorRE).filter(Boolean);

  return cwdSegments.at(-1) ?? session.cwd;
}

export function sortSessionsByProjectName(sessions: Array<SessionInfo>) {
  return [...sessions].sort((session, otherSession) => {
    const projectComparison = getSessionProjectName(session).localeCompare(
      getSessionProjectName(otherSession),
    );

    if (projectComparison !== 0) {
      return projectComparison;
    }

    return session.modified.getTime() - otherSession.modified.getTime();
  });
}

function groupSessionLabelsByProject(sessions: Array<SessionInfo>) {
  const sessionLabelsByProject = new Map<string, string[]>();

  for (const session of sortSessionsByProjectName(sessions)) {
    const project = getSessionProjectName(session);
    const sessionLabel = session.name || session.firstMessage || session.id;

    sessionLabelsByProject.set(project, [
      ...(sessionLabelsByProject.get(project) ?? []),
      sessionLabel,
    ]);
  }

  return sessionLabelsByProject;
}

export function formatDeletedSessionsListing(sessions: Array<SessionInfo>) {
  const listingLines = [`Removed ${sessions.length} session(s):`];

  for (const [project, sessionLabels] of groupSessionLabelsByProject(
    sessions,
  )) {
    listingLines.push(project);

    for (const sessionLabel of sessionLabels) {
      listingLines.push(`  ${sessionLabel}`);
    }
  }

  return listingLines.join("\n");
}

export function presentDeletedSessions(
  deletedSessions: Array<SessionInfo>,
  ctx: Pick<ExtensionCommandContext, "ui">,
) {
  if (deletedSessions.length === 0) {
    ctx.ui.notify("No sessions matched, so nothing was deleted.", "info");
    return;
  }

  ctx.ui.notify(formatDeletedSessionsListing(deletedSessions), "info");
}
// Settings are persisted through @juanibiapina/pi-extension-settings under this extension name
export const settingsExtensionName = "pi-session-manager";

const sessionDeletionDayLimitSchema = pipe(
  string("must be a whole number of days"),
  regex(/^\d+$/),
  transform(Number.parseInt),
);

export const seriesRecordSchema = record(
  pipe(string("must be a valid folder path"), title("folder-path")),
  record(
    pipe(string("must be a series Name"), title("series-name")),
    pipe(
      array(string("Must be a title")),
      title("titles"),
      checkItems(
        (item, index, array) => array.indexOf(item) === index,
        "Duplicate items are not allowed.",
      ),
    ),
  ),
);

export type SeriesRecord = InferOutput<typeof seriesRecordSchema>;

export const sessionManagerConfigSchema = object({
  sessionDeletionDayLimit: sessionDeletionDayLimitSchema,
  seriesRecord: seriesRecordSchema,
});

const sessionDeletionDayLimitSettingId = "sessionDeletionDayLimit";

const seriesRecordSettingId = "seriesRecord";

function registerSessionManagerSettings(
  pi: Pick<ExtensionAPI, "events">,
): void {
  pi.events.emit("pi-extension-settings:register", {
    name: settingsExtensionName,
    settings: [
      {
        id: sessionDeletionDayLimitSettingId,
        label: "Session Deletion Day Limit",
        description:
          "Unmodified sessions older than this many days get deleted on startup",
        defaultValue: "3",
        values: ["1", "3", "5", "7", "14", "30"],
      },
    ] satisfies SettingDefinition[],
  });
}

export type SessionManagerConfig = InferOutput<
  typeof sessionManagerConfigSchema
>;

export interface $SessionManagerConfigurator {
  configureSessionDeletionDayLimit(days: number): void;
  getSessionSeriesForCwd(cwd: string): string[] | SessionConfigError;
  getSessionTitlesForSeriesBasedOnCwd(
    cwd: string,
    series: string,
  ): string[] | SessionConfigError;
  appendSessionSeriesBasedOnCwd(
    cwd: string,
    series: string,
    title: string,
  ): void;
  deleteSessionSeriesBasedOnCwd(cwd: string, series: string): void;
  getSessionDeletionDayLimit(): number | SessionConfigError;
  generateInitialConfig(cwd: string): void;
}

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}

class SessionManagerConfigurator implements $SessionManagerConfigurator {
  readonly defaultSessionDeletionDayLimit = 3;

  generateInitialConfig(cwd: string): void {
    this.configureSessionDeletionDayLimit(this.defaultSessionDeletionDayLimit);

    const result = this.#readSeriesRecord();

    if (result instanceof SessionConfigError) {
      return;
    }

    result[cwd] ??= {};

    this.#writeSeriesRecord(result);
  }

  #readSeriesRecord() {
    try {
      const storedSeriesRecord = getSetting(
        settingsExtensionName,
        seriesRecordSettingId,
      );

      if (storedSeriesRecord === undefined) {
        return {} as SeriesRecord;
      }

      const result = safeParse(
        seriesRecordSchema,
        JSON.parse(storedSeriesRecord),
      );

      if (!result.success) {
        return new SessionConfigError(summarize(result.issues));
      }

      return result.output;
    } catch (e) {
      if (e instanceof Error) {
        return new SessionConfigError(e.message);
      }

      return new SessionConfigError(e as string);
    }
  }

  #writeSeriesRecord(seriesRecord: SeriesRecord): void {
    setSetting(
      settingsExtensionName,
      seriesRecordSettingId,
      JSON.stringify(seriesRecord),
    );
  }

  deleteSessionSeriesBasedOnCwd(cwd: string, series: string): void {
    const result = this.#readSeriesRecord();

    if (result instanceof SessionConfigError) {
      return;
    }

    const cwdSeriesRecord = result[cwd];

    if (!cwdSeriesRecord) {
      return;
    }

    delete cwdSeriesRecord[series.trim()];

    this.#writeSeriesRecord(result);
  }

  getSessionDeletionDayLimit() {
    const storedDayLimit = getSetting(
      settingsExtensionName,
      sessionDeletionDayLimitSettingId,
    );

    if (storedDayLimit === undefined) {
      return new SessionConfigError(
        "No session deletion day limit has been configured yet",
      );
    }

    const result = safeParse(sessionDeletionDayLimitSchema, storedDayLimit);

    if (!result.success) {
      return new SessionConfigError(summarize(result.issues));
    }

    return result.output;
  }

  getSessionSeriesForCwd(cwd: string) {
    const result = this.#readSeriesRecord();

    if (result instanceof SessionConfigError) {
      return result;
    }

    return Object.keys(result[cwd] ?? {});
  }

  getSessionTitlesForSeriesBasedOnCwd(cwd: string, series: string) {
    const result = this.#readSeriesRecord();

    if (result instanceof SessionConfigError) {
      return result;
    }

    return result[cwd]?.[series.trim()] ?? [];
  }

  configureSessionDeletionDayLimit(days: number): void {
    setSetting(
      settingsExtensionName,
      sessionDeletionDayLimitSettingId,
      days.toString(),
    );
  }

  appendSessionSeriesBasedOnCwd(
    cwd: string,
    series: string,
    title: string,
  ): void {
    const result = this.#readSeriesRecord();

    if (result instanceof SessionConfigError) {
      return;
    }

    const normalizedSeries = series.trim();
    const normalizedTitle = title.trim();
    const cwdSeriesRecord = result[cwd] ?? {};
    const titles = cwdSeriesRecord[normalizedSeries] ?? [];

    if (
      !titles.some((existingTitle) => existingTitle.trim() === normalizedTitle)
    ) {
      cwdSeriesRecord[normalizedSeries] = titles.concat(normalizedTitle);
    }

    result[cwd] = cwdSeriesRecord;

    this.#writeSeriesRecord(result);
  }
}

export function getSessionEntryWithSeries(
  sessionEntries: SessionEntry[],
  sessionName?: string,
): SessionSeriesEntry | undefined {
  const matchingEntries = sessionEntries.filter(
    (entry): entry is SessionSeriesEntry =>
      entry.type === sessionSeriesEntrySchema.entries.type.literal &&
      entry.customType === sessionSeriesEntrySchema.entries.customType.literal,
  );

  if (!sessionName) {
    return;
  }

  const normalizedSessionName = sessionName.trim();
  const matchedEntry = matchingEntries.find((entry) => {
    const sessionTitle =
      entry.data.sessionTitle ??
      getSessionTitleFromSessionName(normalizedSessionName, entry.data.series);

    if (!sessionTitle) {
      return false;
    }

    return (
      `${entry.data.series}${SESION_TITLE_SEPARATOR}${sessionTitle}` ===
      normalizedSessionName
    );
  });

  if (!matchedEntry || matchedEntry.data.sessionTitle) {
    return matchedEntry;
  }

  const sessionTitle = getSessionTitleFromSessionName(
    normalizedSessionName,
    matchedEntry.data.series,
  );

  if (!sessionTitle) {
    return matchedEntry;
  }

  return {
    ...matchedEntry,
    data: {
      ...matchedEntry.data,
      sessionTitle,
    },
  } as SessionSeriesEntry;
}

export type GetSessionEntryWithSeries = typeof getSessionEntryWithSeries;

export function handleSessionCleanInactive(
  deps: {
    sessionFilter: $SessionFilter;
    sessionManagerConfigurator: $SessionManagerConfigurator;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionCommandContext,
) {
  ctx.ui.notify(
    "Getting rid of all sessions that have been inactive for three days",
    "warning",
  );
  const dayLimit = deps.sessionManagerConfigurator.getSessionDeletionDayLimit();

  if (dayLimit instanceof SessionConfigError) {
    ctx.ui.notify(dayLimit.message, "error");
    return;
  }

  const deletedSessions =
    deps.removeSessionFiles(
      deps.sessionFilter.getModifiedSessionsBasedOnDayLimit(dayLimit),
    ) ?? [];

  presentDeletedSessions(deletedSessions, ctx);
}

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
        const { integer, unit } = integerWithUnitShortRE.exec(input)
          ?.groups as {
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

export function handleSessionCleanOlderThan(
  input: DurationRecord,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionCommandContext,
) {
  ctx.ui.notify(
    `Deleting sessions that are from ${input.integer} ${input.unit} ago`,
  );
  const deletedSessions =
    deps.removeSessionFiles(
      deps.sessionFilter.getModifiedSessionsBasedOnDurationIntegerAndUnit(
        input.integer,
        input.unit,
      ),
    ) ?? [];

  presentDeletedSessions(deletedSessions, ctx);
}

export function handleSessionDeleteLast(
  number: number,
  deps: {
    sessionFilter: $SessionFilter;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionCommandContext,
) {
  ctx.ui.notify(`Deleting the last ${number}`);
  const deletedSessions =
    deps.removeSessionFiles(
      deps.sessionFilter.getSessionsThatAreTheLastNth(number),
    ) ?? [];

  presentDeletedSessions(deletedSessions, ctx);
}

export const SESION_TITLE_SEPARATOR = "--";

function getSessionTitleFromSessionName(sessionName: string, series: string) {
  const prefix = `${series.trim()}${SESION_TITLE_SEPARATOR}`;

  if (!sessionName.startsWith(prefix)) {
    return;
  }

  return sessionName.slice(prefix.length).trim();
}

export const sessionSeriesCommandsSchema = picklist([
  "create",
  "delete",
  "new",
  "continue",
]);
export const sessionSeriesEntrySchema = object({
  type: literal("custom"),
  customType: literal("session-manager/series"),
  data: object({
    series: string(),
    sessionTitle: string(),
    createdAt: pipe(string(), isoTimestamp()),
  }),
});

export type SessionSeriesEntry = Extract<SessionEntry, { type: "custom" }> &
  InferOutput<typeof sessionSeriesEntrySchema>;

export const sessionSeriesDataSchema = object({
  sessionName: string(),
  entry: object({
    customType: literal("session-manager/series"),
    series: string(),
    sessionTitle: string(),
    createdAt: pipe(string(), isoTimestamp()),
  }),
});

export type SessionSeriesData = InferOutput<typeof sessionSeriesDataSchema>;

const sessionSeriesDataTempFileName = "pi-session-manager.session-data.json";

export function getSessionSeriesDataTempPath(baseDir = tmpdir()) {
  return join(baseDir, sessionSeriesDataTempFileName);
}

export function persistSessionSeriesData(
  sessionData: SessionSeriesData,
  tempPath = getSessionSeriesDataTempPath(),
) {
  writeFileSync(tempPath, JSON.stringify(sessionData), {
    encoding: "utf-8",
  });
}

export function consumePersistedSessionSeriesData(
  tempPath = getSessionSeriesDataTempPath(),
) {
  if (!existsSync(tempPath)) {
    return;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(tempPath, {
        encoding: "utf-8",
      }),
    );

    const result = safeParse(sessionSeriesDataSchema, parsed);

    if (!result.success) {
      return;
    }

    unlinkSync(tempPath);
    return result.output;
  } catch {
    return;
  }
}

export function applyPersistedSessionSeriesData(
  pi: Pick<ExtensionAPI, "setSessionName" | "appendEntry">,
  ctx: Pick<ExtensionCommandContext, "ui">,
  tempPath = getSessionSeriesDataTempPath(),
) {
  const sessionData = consumePersistedSessionSeriesData(tempPath);

  if (!sessionData) {
    return false;
  }

  pi.setSessionName(sessionData.sessionName);
  const { customType, ...data } = sessionData.entry;
  pi.appendEntry(customType, data);
  ctx.ui.notify("Setting necessary session data");
  return true;
}

function promptForUniqueInput(
  ctx: ExtensionCommandContext,
  prompt: string,
  description: string | undefined,
  existingValues: string[],
  duplicateMessage: (value: string) => string,
) {
  return (async () => {
    while (true) {
      const value = await ctx.ui.input(prompt, description);

      if (!value) {
        return;
      }

      if (/^\s+$/.test(value)) {
        continue;
      }

      const trimmedValue = value.trim();

      if (
        existingValues.some(
          (existingValue) => existingValue.trim() === trimmedValue,
        )
      ) {
        ctx.ui.notify(duplicateMessage(trimmedValue), "warning");
        continue;
      }

      return trimmedValue;
    }
  })();
}

function getSessionTitlesForSeriesFromSessions(
  sessions: SessionInfo[],
  series: string,
) {
  const prefix = `${series.trim()}${SESION_TITLE_SEPARATOR}`;

  return sessions
    .map((session) => session.name?.trim())
    .filter((name): name is string => Boolean(name?.startsWith(prefix)))
    .map((name) => name.slice(prefix.length).trim())
    .filter((title) => title.length > 0);
}

export async function handleSessionSeries(
  command: SessionSeriesCommand,
  deps: {
    sessionManagerConfigurator: $SessionManagerConfigurator;
    sessionFilter: $SessionFilter;
    getSessionEntryWithSeries: GetSessionEntryWithSeries;
    removeSessionFiles: RemoveSessionFiles;
  },
  ctx: ExtensionCommandContext,
) {
  switch (command) {
    case "create": {
      const seriesResult =
        deps.sessionManagerConfigurator.getSessionSeriesForCwd(ctx.cwd);

      if (seriesResult instanceof SessionConfigError) {
        ctx.ui.notify(seriesResult.message, "error");
        return;
      }

      const series = await promptForUniqueInput(
        ctx,
        "What is the name of your session series?",
        "What are you focused on?",
        seriesResult,
        (value) => `This series has already been added ${value}`,
      );

      if (!series) {
        return;
      }

      const titlesResult =
        deps.sessionManagerConfigurator.getSessionTitlesForSeriesBasedOnCwd(
          ctx.cwd,
          series,
        );

      if (titlesResult instanceof SessionConfigError) {
        ctx.ui.notify(titlesResult.message, "error");
        return;
      }

      const title = await promptForUniqueInput(
        ctx,
        "What is the name of the new session you want to make in this one?",
        "What task is a part of what you are focusing on?",
        titlesResult,
        (value) => `This title has already been added ${value}`,
      );

      if (!title) {
        return;
      }

      const sessionName = `${series}${SESION_TITLE_SEPARATOR}${title}`;
      const sessionData = {
        sessionName,
        entry: {
          customType: sessionSeriesEntrySchema.entries.customType.literal,
          series,
          sessionTitle: title,
          createdAt: new Date().toISOString(),
        },
      };

      persistSessionSeriesData(sessionData);

      await ctx.newSession({
        withSession: async (sessionCtx) => {
          deps.sessionManagerConfigurator.appendSessionSeriesBasedOnCwd(
            sessionCtx.cwd,
            series,
            title,
          );

          sessionCtx.ui.notify("Your session series has been created");
        },
      });

      break;
    }

    case "delete": {
      const result = deps.sessionManagerConfigurator.getSessionSeriesForCwd(
        ctx.cwd,
      );

      if (result instanceof SessionConfigError) {
        ctx.ui.notify(result.message, "error");
        return;
      }

      const series = await ctx.ui.select(
        "Which session series would you like to delete?",
        result,
      );

      if (!series) {
        return;
      }

      deps.removeSessionFiles(
        deps.sessionFilter.getSessionsThatHaveTheTitleAsAPrefix(series.trim()),
      );
      deps.sessionManagerConfigurator.deleteSessionSeriesBasedOnCwd(
        ctx.cwd,
        series,
      );
      ctx.ui.notify(`This series ${series} and it's related sessions`);
      return;
    }

    case "new": {
      const result = deps.sessionManagerConfigurator.getSessionSeriesForCwd(
        ctx.cwd,
      );

      if (result instanceof SessionConfigError) {
        ctx.ui.notify(result.message, "error");
        return;
      }

      const series = await ctx.ui.select(
        "Which session series would you like to create a new session in?",
        result,
      );

      if (!series) {
        return;
      }

      const titleResult =
        deps.sessionManagerConfigurator.getSessionTitlesForSeriesBasedOnCwd(
          ctx.cwd,
          series,
        );

      if (titleResult instanceof SessionConfigError) {
        ctx.ui.notify(titleResult.message, "error");
        return;
      }

      const title = await promptForUniqueInput(
        ctx,
        "What is the name of the this new session?",
        "What do you want your agent to do now?",
        titleResult,
        (value) => `This title has already been added ${value}`,
      );

      if (!title) {
        return;
      }

      const sessionName = `${series}${SESION_TITLE_SEPARATOR}${title}`;
      const sessionData = {
        sessionName,
        entry: {
          customType: sessionSeriesEntrySchema.entries.customType.literal,
          series,
          sessionTitle: title,
          createdAt: new Date().toISOString(),
        },
      };

      persistSessionSeriesData(sessionData);

      await ctx.newSession({
        withSession: async (sessionCtx) => {
          deps.sessionManagerConfigurator.appendSessionSeriesBasedOnCwd(
            sessionCtx.cwd,
            series,
            title,
          );

          sessionCtx.ui.notify(`You have created a new session in ${series}
          with ${title}
          `);
        },
      });

      break;
    }

    case "continue": {
      const entries = ctx.sessionManager.getEntries();
      const entry = deps.getSessionEntryWithSeries(
        entries,
        ctx.sessionManager.getSessionName(),
      );

      if (!entry) {
        ctx.ui.notify("No session series was found", "error");
        return;
      }

      const titlesResult = getSessionTitlesForSeriesFromSessions(
        deps.sessionFilter.getSessionsThatHaveTheTitleAsAPrefix(
          entry.data.series,
        ),
        entry.data.series,
      );

      const title = await promptForUniqueInput(
        ctx,
        `What's the new title for the session in series ${entry.data.series}`,
        undefined,
        titlesResult,
        (value) => `This title has already been added ${value}`,
      );

      if (!title) {
        return;
      }

      const sessionName = `${entry.data.series}${SESION_TITLE_SEPARATOR}${title}`;
      const sessionData = {
        sessionName,
        entry: {
          customType: sessionSeriesEntrySchema.entries.customType.literal,
          series: entry.data.series,
          sessionTitle: title,
          createdAt: new Date().toISOString(),
        },
      };

      persistSessionSeriesData(sessionData);

      await ctx.newSession({
        withSession: async (sessionCtx) => {
          deps.sessionManagerConfigurator.appendSessionSeriesBasedOnCwd(
            sessionCtx.cwd,
            entry.data.series,
            title,
          );

          sessionCtx.ui.notify(`You have created a new session in ${entry.data.series}
      with ${title}
      `);
        },
      });

      break;
    }

    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
