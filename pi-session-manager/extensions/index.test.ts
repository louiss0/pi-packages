import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import {
  handleSessionCleanInactive,
  handleSessionCleanOlderThan,
  handleSessionDeleteLast,
  handleSessionSeries,
  $TimestampCalculator,
  type $SessionFilter,
  type DurationRecord,
  type RemoveSessionFiles,
  SESION_TITLE_SEPARATOR,
  type GetSessionEntryWithSeries,
  sessionSeriesEntrySchema,
  type SessionSeriesEntry,
  type $SessionManagerConfigurator,
  type SessionManagerConfig,
  SessionConfigError,
} from ".";

type MockExtenstionCommandContext =
  | Partial<ExtensionCommandContext>
  | {
      ui?: Partial<ExtensionUIContext>;
      sessionManager?: Partial<ExtensionContext["sessionManager"]>;
    };

class MockPastTimestampCalculator extends $TimestampCalculator {
  #nowTimestamp = this.now;

  hour(number = 1): number {
    return this.#nowTimestamp - number * this.HOUR_IN_MS;
  }

  day(number = 1): number {
    return this.#nowTimestamp - number * this.DAY_IN_MS;
  }

  week(number = 1): number {
    return this.#nowTimestamp - number * this.WEEK_IN_MS;
  }
}

class ModifiedTimeCalculator extends $TimestampCalculator {
  hour = (multiplier: number): number => {
    return multiplier * this.HOUR_IN_MS;
  };

  day = (multiplier: number): number => {
    return multiplier * this.DAY_IN_MS;
  };

  week = (multiplier: number): number => {
    return multiplier * this.WEEK_IN_MS;
  };
}

class MockSessionFilter implements $SessionFilter {
  #sessions: SessionInfo[] = [];

  #timestampCalculator: $TimestampCalculator;

  constructor(sessions: SessionInfo[], timestampCalculator: $TimestampCalculator) {
    this.#sessions = sessions;
    this.#timestampCalculator = timestampCalculator;
  }

  get sessions(): SessionInfo[] {
    return this.#sessions;
  }

  getSessionsThatHaveTheTitleAsAPrefix(title: string): Array<SessionInfo> {
    return this.#sessions.filter((session) =>
      session.name?.startsWith(`${title}${SESION_TITLE_SEPARATOR}`),
    );
  }

  getSessionsThatAreTheLastNth(number: number) {
    return this.#sessions.slice(-number);
  }

  getSessionsBasedOnDurationIntegerAndUnit(
    integer: number,
    durationUnit: DurationRecord["unit"],
  ) {
    return this.#sessions.filter((session) => {
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

  getSessionsBasedOnDayLimit() {
    return this.#sessions.filter(
      (session) => session.modified.getTime() < this.#timestampCalculator.day(3),
    );
  }
}

const generateSessionsBasedOnModifiedTimeCalculation = (
  modifiedTimeOffsetCalculator: (multiplier: number) => number,
): SessionInfo[] => {
  const count = Math.max(6, Math.floor(Math.random() * 12));
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    path: `/path/to/session/${i}`,
    id: `session-id-${i}`,
    cwd: `/user/work/${i}`,
    name: `Session ${i}`,
    parentSessionPath: i > 5 ? `/path/to/parent/${i}` : "/path/to/parent",
    created: new Date(now - 1000000 * i),
    modified: new Date(now - modifiedTimeOffsetCalculator(i)),
    messageCount: i * 2,
    firstMessage: `Hello from session ${i}`,
    allMessagesText: `Full history for session ${i}`,
  }));
};

class SessionManagerConfiguratorMock implements $SessionManagerConfigurator {
  #config: SessionManagerConfig = {
    sessionDeletionDayLimit: 3,
    seriesRecord: {},
  };

  get config(): SessionManagerConfig {
    return this.#config;
  }

  appendSessionSeriesBasedOnCwd(cwd: string, series: string): void {
    this.#config.seriesRecord[cwd] = (this.#config.seriesRecord[cwd] ?? []).concat(series);
  }

  deleteSessionSeriesBasedOnCwd(cwd: string, series: string): void {
    this.#config.seriesRecord[cwd] = (this.#config.seriesRecord[cwd] ?? []).filter(
      (s) => s !== series,
    );
  }

  configureSessionDeletionDayLimit(days: number): void {
    this.#config.sessionDeletionDayLimit = days;
  }

  getSessionDeletionDayLimit(): number | SessionConfigError {
    if (this.#config.sessionDeletionDayLimit < 0) {
      return new SessionConfigError("sessionDeletionDayLimit must be a non-negative number");
    }

    return this.#config.sessionDeletionDayLimit;
  }

  generateInitialConfig(cwd: string): void {
    this.#config.seriesRecord[cwd] = [];
  }

  getSessionTitlesForCwd(cwd: string): string[] | SessionConfigError {
    if (!this.#config.seriesRecord[cwd]) {
      return new SessionConfigError("no series found for cwd");
    }

    return this.#config.seriesRecord[cwd];
  }
}

// THis is written like this so that I can use the outline to find tests
const test = it
  .extend("sessions", () => {
    const modifiedTimeCalculator = new ModifiedTimeCalculator();
    return [
      modifiedTimeCalculator.hour,
      modifiedTimeCalculator.day,
      modifiedTimeCalculator.week,
    ]
      .map(generateSessionsBasedOnModifiedTimeCalculation)
      .flat();
  })
  .extend("timestampCalculator", new MockPastTimestampCalculator());

function castToExtensionContext(context: MockExtenstionCommandContext): ExtensionContext {
  return context as ExtensionContext;
}

const mockRemoveSessionFiles = vi.fn<RemoveSessionFiles>();

describe("handleSessionCleanInactive", () => {
  test("gets rid of all sessions that haven't been modified in the last three days", ({
    sessions,
    timestampCalculator,
  }) => {
    const context = {
      ui: {
        notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
      },
    } satisfies MockExtenstionCommandContext;

    const mockSessionFilter = new MockSessionFilter(sessions, timestampCalculator);

    const getSessionsBasedOnPredeterminedTimestamp = vi.spyOn(
      mockSessionFilter,
      "getSessionsBasedOnDayLimit",
    );

    const timeStampDaySpy = vi.spyOn(timestampCalculator, "day");

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock();

    handleSessionCleanInactive(
      {
        sessionFilter: mockSessionFilter,
        sessionManagerConfigurator,
        removeSessionFiles: mockRemoveSessionFiles,
      },
      castToExtensionContext(context),
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      "Getting rid of all sessions that have been inactive for three days",
      "warning",
    );

    expect(getSessionsBasedOnPredeterminedTimestamp).toHaveBeenCalled();

    expect(timeStampDaySpy).toHaveBeenCalledWith(3);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getSessionsBasedOnPredeterminedTimestamp.mock.results[0]?.value,
    );
  });
});

describe("handleSessionCleanOlderThan", () => {
  test("cleans sessions older than the specified unit", ({ sessions, timestampCalculator }) => {
    const context = {
      ui: {
        notify: vi.fn(),
      },
    } satisfies MockExtenstionCommandContext;

    const mockSessionFilter = new MockSessionFilter(sessions, timestampCalculator);

    const getSessionsBasedOnDurationIntegerAndUnit = vi.spyOn(
      mockSessionFilter,
      "getSessionsBasedOnDurationIntegerAndUnit",
    );
    const timeStampDaySpy = vi.spyOn(timestampCalculator, "day");

    const durationRecord = { integer: 7, unit: "days" } as const;
    handleSessionCleanOlderThan(
      durationRecord,
      {
        sessionFilter: mockSessionFilter,
        removeSessionFiles: mockRemoveSessionFiles,
      },
      castToExtensionContext(context),
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      `Deleteing sessions that are from ${durationRecord.integer} ${durationRecord.unit} ago`,
    );

    expect(getSessionsBasedOnDurationIntegerAndUnit).toHaveBeenCalledWith(
      durationRecord.integer,
      durationRecord.unit,
    );

    expect(timeStampDaySpy).toHaveBeenCalledWith(durationRecord.integer);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getSessionsBasedOnDurationIntegerAndUnit.mock.results[0]?.value,
    );
  });
});

describe("handleSessionDeleteLast", () => {
  test("deletes the last sessions by a specified nth", ({ sessions, timestampCalculator }) => {
    const context = {
      ui: {
        notify: vi.fn(),
      },
    } satisfies MockExtenstionCommandContext;

    const mockSessionFilter = new MockSessionFilter(sessions, timestampCalculator);

    const getSessionsThatAreTheLastNth = vi.spyOn(
      mockSessionFilter,
      "getSessionsThatAreTheLastNth",
    );

    const nthSessions = 5;
    handleSessionDeleteLast(
      nthSessions,
      {
        sessionFilter: mockSessionFilter,
        removeSessionFiles: mockRemoveSessionFiles,
      },
      castToExtensionContext(context),
    );

    expect(context.ui.notify).toHaveBeenCalledWith(`Deleting the last ${nthSessions}`);

    expect(getSessionsThatAreTheLastNth).toHaveBeenCalledWith(nthSessions);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getSessionsThatAreTheLastNth.mock.results[0]?.value,
    );
  });
});

describe("handleSessionSeries", () => {
  it("creates a session series when create is passed", async () => {
    const context = {
      cwd: "/pi-packages",
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(async (options) => {
        options?.withSession?.({} as never);
        return { cancelled: false };
      }),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue("Implement Auth")
          .mockResolvedValue("Create JWT Token"),
      },
    } satisfies MockExtenstionCommandContext;

    const setSessionName = vi.fn<ExtensionAPI["setSessionName"]>();
    const appendEntry = vi.fn<ExtensionAPI["appendEntry"]>();

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock();
    const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "appendSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "create",
      {
        setSessionName,
        sessionManagerConfigurator,
        sessionFilter: new MockSessionFilter([], new MockPastTimestampCalculator()),
        appendEntry,
        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of your session series?",
      "What are you focused on?",
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of the new session you want to make in this one?",
      "What task is a part of what you are focusing on?",
    );

    const series = context.ui.input.mock.settledResults[0]?.value;
    const sessionTitleAndSubTitle = `${series}${SESION_TITLE_SEPARATOR}${context.ui.input.mock.settledResults[1]?.value}`;

    expect(context.newSession).toHaveBeenCalledWith({
      withSession: expect.any(Function),
    });

    expect(setSessionName).toHaveBeenCalledWith(sessionTitleAndSubTitle);
    expect(appendEntry).toHaveBeenCalledWith(
      sessionSeriesEntrySchema.entries.customType.literal,
      {
        series,
        createdAt: expect.any(String),
      },
    );
    expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(context.cwd, series);

    expect(context.ui.notify).toHaveBeenCalledWith("Your session series has been created");
  });

  it("deletes a session series when delete is passed", async () => {
    const sessionSerieses = [
      "refactor-auth-middleware",
      "fix-memory-leak-prod",
      "implement-graphql-subscriptions",
      "update-dependency-vulnerabilities",
      "ui-component-library-migration",
      "optimize-database-queries",
      "setup-ci-cd-pipeline",
      "unit-test-coverage-boost",
      "api-documentation-swagger",
      "feature-flag-cleanup",
    ];

    const now = Date.now();

    const generateSessionsFromSerieses = (): SessionInfo[] => {
      return sessionSerieses
        .map((series, i) =>
          Array.from({ length: 3 }, (_, j) => ({
            path: `/path/to/session/${i}__${j}`,
            id: `session-id-${i}__${j}`,
            cwd: `/user/work/${i}__${j}`,
            name: `${series}${SESION_TITLE_SEPARATOR}Session ${i}__${j}`,
            parentSessionPath: j > 5 ? `/path/to/parent/${i}__${j}` : `/path/to/parent/${i}`,
            created: new Date(now - 1000000 * i),
            modified: new Date(now - i * 1000),
            messageCount: i * j * 2,
            firstMessage: `Hello from session ${i}`,
            allMessagesText: `Full history for session ${i}`,
          })),
        )
        .flat();
    };

    const randomSeries = sessionSerieses[Math.floor(Math.random() * sessionSerieses.length)]!;

    const context = {
      cwd: "/user/work/0",
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        select: vi.fn<ExtensionUIContext["select"]>().mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionCommandContext;
    const setSessionName = vi.fn<ExtensionAPI["setSessionName"]>();

    const mockSessionFilter = new MockSessionFilter(
      generateSessionsFromSerieses(),
      new MockPastTimestampCalculator(),
    );

    const mockGetSessionsThatHaveTheTitleAsAPrefixSpy = vi.spyOn(
      mockSessionFilter,
      "getSessionsThatHaveTheTitleAsAPrefix",
    );

    const removeSessionFiles = vi.fn<RemoveSessionFiles>();

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock();
    sessionManagerConfigurator.generateInitialConfig("/user/work/0");
    for (const series of sessionSerieses) {
      sessionManagerConfigurator.appendSessionSeriesBasedOnCwd("/user/work/0", series);
    }
    const getSessionTitlesForCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "getSessionTitlesForCwd",
    );
    const deleteSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "deleteSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "delete",
      {
        setSessionName,
        sessionManagerConfigurator,
        sessionFilter: mockSessionFilter,
        appendEntry() {
          return;
        },
        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles,
      },
      castToExtensionContext(context),
    );

    expect(getSessionTitlesForCwdSpy).toHaveBeenCalledWith(context.cwd);

    expect(context.ui.select).toHaveBeenCalledWith(
      "Which session series would you like to delete?",
      sessionSerieses,
    );

    expect(mockGetSessionsThatHaveTheTitleAsAPrefixSpy).toHaveBeenCalledWith(
      context.ui.select.mock.settledResults[0]?.value,
    );

    expect(removeSessionFiles).toHaveBeenCalledWith(
      mockGetSessionsThatHaveTheTitleAsAPrefixSpy.mock.results[0]?.value,
    );
    expect(deleteSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
      context.cwd,
      context.ui.select.mock.settledResults[0]?.value,
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      `This series ${context.ui.select.mock.settledResults[0]?.value} and it's related sessions`,
    );
  });

  it("Makes a new session in a series new is passed", async () => {
    const sessionSeries = [
      "refactor-auth-middleware",
      "fix-memory-leak-prod",
      "implement-graphql-subscriptions",
      "update-dependency-vulnerabilities",
      "ui-component-library-migration",
      "optimize-database-queries",
      "setup-ci-cd-pipeline",
      "unit-test-coverage-boost",
      "api-documentation-swagger",
      "feature-flag-cleanup",
    ];

    const randomSeries = sessionSeries[Math.floor(Math.random() * sessionSeries.length)]!;

    const context = {
      cwd: "/user/work/0",
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(async (options) => {
        options?.withSession?.({} as never);
        return { cancelled: false };
      }),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue("Add tests to the lib/index.ts file"),
        select: vi.fn<ExtensionUIContext["select"]>().mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionCommandContext;
    const setSessionName = vi.fn<ExtensionAPI["setSessionName"]>();

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock();
    sessionManagerConfigurator.generateInitialConfig("/user/work/0");
    for (const series of sessionSeries) {
      sessionManagerConfigurator.appendSessionSeriesBasedOnCwd("/user/work/0", series);
    }
    const getSessionTitlesForCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "getSessionTitlesForCwd",
    );

    await handleSessionSeries(
      "new",
      {
        setSessionName,
        sessionManagerConfigurator,
        sessionFilter: new MockSessionFilter([], new MockPastTimestampCalculator()),
        appendEntry() {
          return;
        },
        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(getSessionTitlesForCwdSpy).toHaveBeenCalledWith(context.cwd);

    expect(context.ui.select).toHaveBeenCalledWith(
      "Which session series would you like to create a new session in?",
      sessionSeries,
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of the this new session?",
      "What do you want your agent to do now?",
    );

    expect(context.newSession).toHaveBeenCalledWith({
      withSession: expect.any(Function),
    });

    const sessionSeriesAndTitle = `${context.ui.select.mock.settledResults[0]?.value}${SESION_TITLE_SEPARATOR}${context.ui.input.mock.settledResults[0]?.value}`;
    expect(setSessionName).toHaveBeenCalledWith(sessionSeriesAndTitle);

    expect(context.ui.notify).toHaveBeenCalledWith(
      `You have created a new session in ${context.ui.select.mock.settledResults[0]?.value}
      with ${context.ui.input.mock.settledResults[0]?.value}
      `,
    );
  });

  it("continues a session in a series when continue is passed", async () => {
    const context = {
      sessionManager: {
        getEntries: vi.fn<ExtensionCommandContext["sessionManager"]["getEntries"]>(),
      },
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(async (options) => {
        options?.withSession?.({} as never);
        return { cancelled: false };
      }),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue("Make coverage for Processor full"),
      },
    } satisfies MockExtenstionCommandContext;

    const getSessionEntryWithSeries = vi.fn<GetSessionEntryWithSeries>();
    const seriesEntry = {
      type: "custom",
      customType: sessionSeriesEntrySchema.entries.customType.literal,
      data: {
        series: "refactor-auth-middleware",
        createdAt: new Date().toISOString(),
      },
    } as SessionSeriesEntry;

    getSessionEntryWithSeries.mockReturnValue(seriesEntry);

    const setSessionName = vi.fn<ExtensionAPI["setSessionName"]>();

    await handleSessionSeries(
      "continue",
      {
        setSessionName,
        sessionFilter: new MockSessionFilter([], new MockPastTimestampCalculator()),
        getSessionEntryWithSeries,
        sessionManagerConfigurator: new SessionManagerConfiguratorMock(),
        appendEntry() {
          return;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(context.sessionManager.getEntries).toHaveBeenCalled();

    expect(getSessionEntryWithSeries).toHaveBeenCalledWith(
      context.sessionManager.getEntries.mock.results[0]?.value,
    );

    const entry = getSessionEntryWithSeries.mock.results[0]?.value as SessionSeriesEntry;

    expect(entry).toEqual(
      expect.objectContaining({
        type: "custom",
        customType: sessionSeriesEntrySchema.entries.customType.literal,
      }),
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      `What's the new title for the session in series ${entry.data.series}`,
    );

    expect(context.newSession).toHaveBeenCalledWith({
      withSession: expect.any(Function),
    });

    const sessionSeriesAndTitle = `${entry.data.series}${SESION_TITLE_SEPARATOR}${context.ui.input.mock.settledResults[0]?.value}`;
    expect(setSessionName).toHaveBeenCalledWith(sessionSeriesAndTitle);

    expect(context.ui.notify).toHaveBeenCalledWith(
      `You have created a new session in ${entry.data.series}
      with ${context.ui.input.mock.settledResults[0]?.value}
      `,
    );
  });
});
