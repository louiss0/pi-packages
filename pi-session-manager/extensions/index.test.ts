import type {
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "fs";
import { tmpdir } from "os";
import {
  handleSessionCleanInactive,
  handleSessionCleanOlderThan,
  handleSessionDeleteLast,
  handleSessionSeries,
  getSessionEntryWithSeries,
  getSessionSeriesDataTempPath,
  persistSessionSeriesData,
  consumePersistedSessionSeriesData,
  applyPersistedSessionSeriesData,
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

  constructor(
    sessions: SessionInfo[],
    timestampCalculator: $TimestampCalculator,
  ) {
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

  getModifiedSessionsBasedOnDurationIntegerAndUnit(
    integer: number,
    durationUnit: DurationRecord["unit"],
  ) {
    return this.#sessions.filter((session) => {
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
        default: {
          const exhausted: never = durationUnit;

          return exhausted;
        }
      }
    });
  }

  getModifiedSessionsBasedOnDayLimit() {
    return this.#sessions.filter(
      (session) =>
        session.modified.getTime() < this.#timestampCalculator.day(3),
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
  #config: SessionManagerConfig;

  get config(): SessionManagerConfig {
    return this.#config;
  }

  constructor(config: Partial<SessionManagerConfig> = {}) {
    this.#config = {
      sessionDeletionDayLimit: 3,
      seriesRecord: {},
      ...config,
    };
  }

  appendSessionSeriesBasedOnCwd(
    cwd: string,
    series: string,
    title: string,
  ): void {
    const normalizedSeries = series.trim();
    const normalizedTitle = title.trim();
    const cwdSeriesRecord = this.#config.seriesRecord[cwd] ?? {};
    const titles = cwdSeriesRecord[normalizedSeries] ?? [];

    if (
      !titles.some((existingTitle) => existingTitle.trim() === normalizedTitle)
    ) {
      cwdSeriesRecord[normalizedSeries] = titles.concat(normalizedTitle);
    }

    this.#config.seriesRecord[cwd] = cwdSeriesRecord;
  }

  deleteSessionSeriesBasedOnCwd(cwd: string, series: string): void {
    const cwdSeriesRecord = this.#config.seriesRecord[cwd];

    if (!cwdSeriesRecord) {
      return;
    }

    delete cwdSeriesRecord[series.trim()];
  }

  configureSessionDeletionDayLimit(days: number): void {
    this.#config.sessionDeletionDayLimit = days;
  }

  getSessionDeletionDayLimit(): number | SessionConfigError {
    if (this.#config.sessionDeletionDayLimit < 0) {
      return new SessionConfigError(
        "sessionDeletionDayLimit must be a non-negative number",
      );
    }

    return this.#config.sessionDeletionDayLimit;
  }

  generateInitialConfig(cwd: string): void {
    this.#config.seriesRecord[cwd] = {};
  }

  getSessionSeriesForCwd(cwd: string): string[] | SessionConfigError {
    return Object.keys(this.#config.seriesRecord[cwd] ?? {});
  }

  getSessionTitlesForSeriesBasedOnCwd(
    cwd: string,
    series: string,
  ): string[] | SessionConfigError {
    const cwdSeriesRecord = this.#config.seriesRecord[cwd] ?? {};

    return cwdSeriesRecord[series.trim()] ?? [];
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

function castToExtensionContext(context: MockExtenstionCommandContext) {
  return context as ExtensionCommandContext;
}

const tempSessionDataPath = getSessionSeriesDataTempPath();

const mockRemoveSessionFiles = vi.fn<RemoveSessionFiles>();

describe("persisted session series data", () => {
  it("stores data in the OS temp dir and consumes it on session start", () => {
    const sessionData = {
      sessionName: `Implement Auth${SESION_TITLE_SEPARATOR}Create JWT Token`,
      entry: {
        customType: sessionSeriesEntrySchema.entries.customType.literal,
        series: "Implement Auth",
        sessionTitle: "Create JWT Token",
        createdAt: new Date().toISOString(),
      },
    };

    persistSessionSeriesData(sessionData);

    expect(tempSessionDataPath.startsWith(tmpdir())).toBe(true);
    expect(existsSync(tempSessionDataPath)).toBe(true);

    const pi = {
      setSessionName: vi.fn(),
      appendEntry: vi.fn(),
    };
    const ctx = {
      ui: {
        notify: vi.fn(),
      },
    };

    expect(applyPersistedSessionSeriesData(pi as never, ctx as never)).toBe(
      true,
    );
    expect(pi.setSessionName).toHaveBeenCalledWith(sessionData.sessionName);
    expect(pi.appendEntry).toHaveBeenCalledWith(sessionData.entry.customType, {
      series: sessionData.entry.series,
      sessionTitle: sessionData.entry.sessionTitle,
      createdAt: sessionData.entry.createdAt,
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Setting necessary session data",
    );
    expect(existsSync(tempSessionDataPath)).toBe(false);
  });
});

describe("getSessionEntryWithSeries", () => {
  it("only returns the series entry that matches the current session name", () => {
    const createdAt = new Date().toISOString();
    const lspCoverageEntry = {
      type: "custom",
      customType: sessionSeriesEntrySchema.entries.customType.literal,
      data: {
        series: "LSP Coverage",
        sessionTitle: "Add diagnostics",
        createdAt,
      },
    } as SessionSeriesEntry;
    const authEntry = {
      type: "custom",
      customType: sessionSeriesEntrySchema.entries.customType.literal,
      data: {
        series: "Auth Cleanup",
        sessionTitle: "Fix token refresh",
        createdAt,
      },
    } as SessionSeriesEntry;

    expect(
      getSessionEntryWithSeries(
        [lspCoverageEntry, authEntry],
        `Auth Cleanup${SESION_TITLE_SEPARATOR}Fix token refresh`,
      ),
    ).toBe(authEntry);
  });

  it("does not return another session's series entry", () => {
    const createdAt = new Date().toISOString();
    const lspCoverageEntry = {
      type: "custom",
      customType: sessionSeriesEntrySchema.entries.customType.literal,
      data: {
        series: "LSP Coverage",
        sessionTitle: "Add diagnostics",
        createdAt,
      },
    } as SessionSeriesEntry;

    expect(
      getSessionEntryWithSeries(
        [lspCoverageEntry],
        `Auth Cleanup${SESION_TITLE_SEPARATOR}Fix token refresh`,
      ),
    ).toBeUndefined();
  });
});

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

    const mockSessionFilter = new MockSessionFilter(
      sessions,
      timestampCalculator,
    );

    const getModifiedSessionsBasedOnDayLimit = vi.spyOn(
      mockSessionFilter,
      "getModifiedSessionsBasedOnDayLimit",
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

    expect(getModifiedSessionsBasedOnDayLimit).toHaveBeenCalled();

    expect(timeStampDaySpy).toHaveBeenCalledWith(3);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getModifiedSessionsBasedOnDayLimit.mock.results[0]?.value,
    );
  });
});

describe("handleSessionCleanOlderThan", () => {
  test("cleans sessions older than the specified unit", ({
    sessions,
    timestampCalculator,
  }) => {
    const context = {
      ui: {
        notify: vi.fn(),
      },
    } satisfies MockExtenstionCommandContext;

    const mockSessionFilter = new MockSessionFilter(
      sessions,
      timestampCalculator,
    );

    const getModifiedSessionsBasedOnDurationIntegerAndUnit = vi.spyOn(
      mockSessionFilter,
      "getModifiedSessionsBasedOnDurationIntegerAndUnit",
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

    expect(
      getModifiedSessionsBasedOnDurationIntegerAndUnit,
    ).toHaveBeenCalledWith(durationRecord.integer, durationRecord.unit);

    expect(timeStampDaySpy).toHaveBeenCalledWith(durationRecord.integer);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getModifiedSessionsBasedOnDurationIntegerAndUnit.mock.results[0]?.value,
    );
  });
});

describe("handleSessionDeleteLast", () => {
  test("deletes the last sessions by a specified nth", ({
    sessions,
    timestampCalculator,
  }) => {
    const context = {
      ui: {
        notify: vi.fn(),
      },
    } satisfies MockExtenstionCommandContext;

    const mockSessionFilter = new MockSessionFilter(
      sessions,
      timestampCalculator,
    );

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

    expect(context.ui.notify).toHaveBeenCalledWith(
      `Deleting the last ${nthSessions}`,
    );

    expect(getSessionsThatAreTheLastNth).toHaveBeenCalledWith(nthSessions);

    expect(mockRemoveSessionFiles).toHaveBeenCalledWith(
      getSessionsThatAreTheLastNth.mock.results[0]?.value,
    );
  });
});

describe("handleSessionSeries", () => {
  describe("how it handles creation of tasks", () => {
    it("creates a session series when create is passed", async () => {
      const sessionCtx = {
        cwd: "/session/create",
        ui: {
          notify: vi.fn(),
        },
      };

      const context = {
        cwd: "/pi-packages",
        newSession: vi.fn<ExtensionCommandContext["newSession"]>(
          async (options) => {
            options?.withSession?.(sessionCtx as never);
            return { cancelled: false };
          },
        ),
        ui: {
          notify: vi.fn<ExtensionUIContext["notify"]>(),
          input: vi
            .fn<ExtensionUIContext["input"]>()
            .mockResolvedValue("Implement Auth")
            .mockResolvedValue("Create JWT Token"),
        },
      } satisfies MockExtenstionCommandContext;

      const sessionManagerConfigurator = new SessionManagerConfiguratorMock();
      const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
        sessionManagerConfigurator,
        "appendSessionSeriesBasedOnCwd",
      );

      await handleSessionSeries(
        "create",
        {
          sessionManagerConfigurator,
          sessionFilter: new MockSessionFilter(
            [],
            new MockPastTimestampCalculator(),
          ),
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
      const title = context.ui.input.mock.settledResults[1]?.value;

      expect(context.newSession).toHaveBeenCalledWith({
        withSession: expect.any(Function),
      });

      expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
        sessionCtx.cwd,
        series,
        title,
      );

      expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
        "Your session series has been created",
      );
    });

    it("stops creating a session series when the series prompt is cancelled", async () => {
      const context = {
        cwd: "/pi-packages",
        newSession: vi.fn<ExtensionCommandContext["newSession"]>(),
        ui: {
          notify: vi.fn<ExtensionUIContext["notify"]>(),
          input: vi
            .fn<ExtensionUIContext["input"]>()
            .mockResolvedValue(undefined),
        },
      } satisfies MockExtenstionCommandContext;

      await handleSessionSeries(
        "create",
        {
          sessionManagerConfigurator: new SessionManagerConfiguratorMock(),
          sessionFilter: new MockSessionFilter(
            [],
            new MockPastTimestampCalculator(),
          ),
          getSessionEntryWithSeries() {
            return undefined;
          },
          removeSessionFiles() {
            return;
          },
        },
        castToExtensionContext(context),
      );

      expect(context.ui.input).toHaveBeenCalledTimes(1);
      expect(context.newSession).not.toHaveBeenCalled();
    });

    const seriesInput = "Implement Auth";
    it("keeps asking for a unique trimmed session series when creating", async () => {
      const sessionCtx = {
        cwd: "/session/create-unique",
        ui: {
          notify: vi.fn(),
        },
      };

      const context = {
        cwd: "/pi-packages",
        newSession: vi.fn<ExtensionCommandContext["newSession"]>(
          async (options) => {
            options?.withSession?.(sessionCtx as never);
            return { cancelled: false };
          },
        ),
        ui: {
          notify: vi.fn<ExtensionUIContext["notify"]>(),
          input: vi
            .fn<ExtensionUIContext["input"]>()
            .mockResolvedValueOnce("  Implement Auth  ")
            .mockResolvedValueOnce("  Implement Billing  ")
            .mockResolvedValueOnce("  Create JWT Token  "),
        },
      } satisfies MockExtenstionCommandContext;

      const sessionManagerConfigurator = new SessionManagerConfiguratorMock({
        seriesRecord: {
          [context.cwd]: {
            [seriesInput]: ["Existing title"],
          },
        },
      });

      const getSessionSeriesForCwdSpy = vi.spyOn(
        sessionManagerConfigurator,
        "getSessionSeriesForCwd",
      );
      const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
        sessionManagerConfigurator,
        "appendSessionSeriesBasedOnCwd",
      );

      await handleSessionSeries(
        "create",
        {
          sessionManagerConfigurator,
          sessionFilter: new MockSessionFilter(
            [],
            new MockPastTimestampCalculator(),
          ),
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

      expect(getSessionSeriesForCwdSpy).toHaveBeenCalledWith(context.cwd);

      expect(context.ui.notify).toHaveBeenCalledWith(
        `This series has already been added ${seriesInput}`,
        "warning",
      );

      expect(context.ui.input).toHaveBeenCalledTimes(3);

      expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
        sessionCtx.cwd,
        "Implement Billing",
        "Create JWT Token",
      );

      expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
        "Your session series has been created",
      );
    });
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
            parentSessionPath:
              j > 5 ? `/path/to/parent/${i}__${j}` : `/path/to/parent/${i}`,
            created: new Date(now - 1000000 * i),
            modified: new Date(now - i * 1000),
            messageCount: i * j * 2,
            firstMessage: `Hello from session ${i}`,
            allMessagesText: `Full history for session ${i}`,
          })),
        )
        .flat();
    };

    const randomSeries =
      sessionSerieses[Math.floor(Math.random() * sessionSerieses.length)] ??
      sessionSerieses[0];

    const context = {
      cwd: "/user/work/0",
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        select: vi
          .fn<ExtensionUIContext["select"]>()
          .mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionCommandContext;

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
    for (const [index, series] of sessionSerieses.entries()) {
      sessionManagerConfigurator.appendSessionSeriesBasedOnCwd(
        "/user/work/0",
        series,
        `Session ${index}`,
      );
    }
    const getSessionSeriesForCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "getSessionSeriesForCwd",
    );
    const deleteSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "deleteSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "delete",
      {
        sessionManagerConfigurator,
        sessionFilter: mockSessionFilter,

        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles,
      },
      castToExtensionContext(context),
    );

    expect(getSessionSeriesForCwdSpy).toHaveBeenCalledWith(context.cwd);

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

    const randomSeries =
      sessionSeries[Math.floor(Math.random() * sessionSeries.length)] ??
      sessionSeries[0];

    const sessionCtx = {
      cwd: "/session/new",
      ui: {
        notify: vi.fn(),
      },
    };

    const context = {
      cwd: "/user/work/0",
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(
        async (options) => {
          options?.withSession?.(sessionCtx as never);
          return { cancelled: false };
        },
      ),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue("Add tests to the lib/index.ts file"),
        select: vi
          .fn<ExtensionUIContext["select"]>()
          .mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionCommandContext;

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock();
    sessionManagerConfigurator.generateInitialConfig("/user/work/0");
    for (const [index, series] of sessionSeries.entries()) {
      sessionManagerConfigurator.appendSessionSeriesBasedOnCwd(
        "/user/work/0",
        series,
        `Session ${index}`,
      );
    }
    const getSessionSeriesForCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "getSessionSeriesForCwd",
    );
    const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "appendSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "new",
      {
        sessionManagerConfigurator,
        sessionFilter: new MockSessionFilter(
          [],
          new MockPastTimestampCalculator(),
        ),

        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(getSessionSeriesForCwdSpy).toHaveBeenCalledWith(context.cwd);

    expect(context.ui.select).toHaveBeenCalledWith(
      "Which session series would you like to create a new session in?",
      sessionSeries,
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of the this new session?",
      "What do you want your agent to do now?",
    );

    expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
      sessionCtx.cwd,
      randomSeries,
      "Add tests to the lib/index.ts file",
    );

    expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(
        `You have created a new session in ${context.ui.select.mock.settledResults[0]?.value}`,
      ),
    );

    expect(context.newSession).toHaveBeenCalledWith({
      withSession: expect.any(Function),
    });

    const sessionSeriesAndTitle = `${context.ui.select.mock.settledResults[0]?.value}${SESION_TITLE_SEPARATOR}${context.ui.input.mock.settledResults[0]?.value}`;
    expect(consumePersistedSessionSeriesData()).toMatchObject({
      sessionName: sessionSeriesAndTitle,
    });

    expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(
        `You have created a new session in ${context.ui.select.mock.settledResults[0]?.value}`,
      ),
    );
  });

  it("stops creating a new session in a series when the title prompt is cancelled", async () => {
    const selectedSeries = "refactor-auth-middleware";
    const context = {
      cwd: "/user/work/cancel-new-title",
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue(undefined),
        select: vi
          .fn<ExtensionUIContext["select"]>()
          .mockResolvedValue(selectedSeries),
      },
    } satisfies MockExtenstionCommandContext;

    await handleSessionSeries(
      "new",
      {
        sessionManagerConfigurator: new SessionManagerConfiguratorMock({
          seriesRecord: {
            [context.cwd]: {
              [selectedSeries]: [],
            },
          },
        }),
        sessionFilter: new MockSessionFilter(
          [],
          new MockPastTimestampCalculator(),
        ),
        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(context.ui.input).toHaveBeenCalledTimes(1);
    expect(context.newSession).not.toHaveBeenCalled();
  });

  it("keeps asking for a unique trimmed title when creating a new session in a series", async () => {
    const selectedSeries = "refactor-auth-middleware";

    const sessionCtx = {
      cwd: "/session/new-series",
      ui: {
        notify: vi.fn(),
      },
    };

    const context = {
      cwd: "/user/work/0",
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(
        async (options) => {
          options?.withSession?.(sessionCtx as never);
          return { cancelled: false };
        },
      ),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValueOnce("  Design JWT  ")
          .mockResolvedValueOnce("  Refactor Hooks  "),
        select: vi
          .fn<ExtensionUIContext["select"]>()
          .mockResolvedValue(selectedSeries),
      },
    } satisfies MockExtenstionCommandContext;

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock({
      seriesRecord: {
        [context.cwd]: {
          [selectedSeries]: ["Design JWT"],
        },
      },
    });

    const getSessionTitlesForSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "getSessionTitlesForSeriesBasedOnCwd",
    );
    const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "appendSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "new",
      {
        sessionManagerConfigurator,
        sessionFilter: new MockSessionFilter(
          [],
          new MockPastTimestampCalculator(),
        ),

        getSessionEntryWithSeries() {
          return undefined;
        },
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(getSessionTitlesForSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
      context.cwd,
      selectedSeries,
    );
    expect(context.ui.notify).toHaveBeenCalledWith(
      `This title has already been added Design JWT`,
      "warning",
    );
    expect(context.ui.input).toHaveBeenCalledTimes(2);
    expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
      sessionCtx.cwd,
      selectedSeries,
      "Refactor Hooks",
    );

    expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
      `You have created a new session in ${selectedSeries}
          with Refactor Hooks
          `,
    );
  });

  it("stops continuing a session in a series when the title prompt is cancelled", async () => {
    const context = {
      cwd: "/user/work/cancel-continue-title",
      sessionManager: {
        getEntries:
          vi.fn<ExtensionCommandContext["sessionManager"]["getEntries"]>(),
        getSessionName: vi
          .fn<ExtensionCommandContext["sessionManager"]["getSessionName"]>()
          .mockReturnValue("refactor-auth-middleware--current-task"),
      },
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValue(undefined),
      },
    } satisfies MockExtenstionCommandContext;

    await handleSessionSeries(
      "continue",
      {
        sessionFilter: new MockSessionFilter(
          [],
          new MockPastTimestampCalculator(),
        ),
        getSessionEntryWithSeries() {
          return {
            type: "custom",
            customType: sessionSeriesEntrySchema.entries.customType.literal,
            data: {
              series: "refactor-auth-middleware",
              sessionTitle: "current-task",
              createdAt: new Date().toISOString(),
            },
          } as SessionSeriesEntry;
        },
        sessionManagerConfigurator: new SessionManagerConfiguratorMock(),
        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(context.ui.input).toHaveBeenCalledTimes(1);
    expect(context.newSession).not.toHaveBeenCalled();
  });

  it("continues a session in a series when continue is passed", async () => {
    const sessionCtx = {
      cwd: "/session/continue",
      ui: {
        notify: vi.fn(),
      },
    };

    const context = {
      cwd: "/user/work/0",
      sessionManager: {
        getEntries:
          vi.fn<ExtensionCommandContext["sessionManager"]["getEntries"]>(),
        getSessionName: vi
          .fn<ExtensionCommandContext["sessionManager"]["getSessionName"]>()
          .mockReturnValue("refactor-auth-middleware--current-task"),
      },
      newSession: vi.fn<ExtensionCommandContext["newSession"]>(
        async (options) => {
          options?.withSession?.(sessionCtx as never);
          return { cancelled: false };
        },
      ),
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi
          .fn<ExtensionUIContext["input"]>()
          .mockResolvedValueOnce("  Make coverage for Processor full  ")
          .mockResolvedValueOnce("  Make coverage for Processor optimized  "),
      },
    } satisfies MockExtenstionCommandContext;

    const getSessionEntryWithSeries = vi.fn<GetSessionEntryWithSeries>();
    const seriesEntry = {
      type: "custom",
      customType: sessionSeriesEntrySchema.entries.customType.literal,
      data: {
        series: "refactor-auth-middleware",
        sessionTitle: "current-task",
        createdAt: new Date().toISOString(),
      },
    } as SessionSeriesEntry;

    getSessionEntryWithSeries.mockReturnValue(seriesEntry);

    const sessionManagerConfigurator = new SessionManagerConfiguratorMock({
      seriesRecord: {
        [context.cwd]: {
          [seriesEntry.data.series]: ["Make coverage for Processor full"],
        },
      },
    });

    const appendSessionSeriesBasedOnCwdSpy = vi.spyOn(
      sessionManagerConfigurator,
      "appendSessionSeriesBasedOnCwd",
    );

    await handleSessionSeries(
      "continue",
      {
        sessionFilter: new MockSessionFilter(
          [
            {
              path: "/path/to/session/continue-0",
              id: "session-id-continue-0",
              cwd: context.cwd,
              name: `${seriesEntry.data.series}${SESION_TITLE_SEPARATOR}Make coverage for Processor full`,
              parentSessionPath: "/path/to/parent/continue-0",
              created: new Date(),
              modified: new Date(),
              messageCount: 1,
              firstMessage: "Hello from session continue",
              allMessagesText: "Full history for session continue",
            },
          ],
          new MockPastTimestampCalculator(),
        ),
        getSessionEntryWithSeries,
        sessionManagerConfigurator,

        removeSessionFiles() {
          return;
        },
      },
      castToExtensionContext(context),
    );

    expect(context.sessionManager.getEntries).toHaveBeenCalled();

    expect(getSessionEntryWithSeries).toHaveBeenCalledWith(
      context.sessionManager.getEntries.mock.results[0]?.value,
      context.sessionManager.getSessionName(),
    );

    const entry = getSessionEntryWithSeries.mock.results[0]
      ?.value as SessionSeriesEntry;

    expect(entry).toEqual(expect.schemaMatching(sessionSeriesEntrySchema));

    expect(context.ui.input).toHaveBeenCalledWith(
      `What's the new title for the session in series ${entry.data.series}`,
      undefined,
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      `This title has already been added Make coverage for Processor full`,
      "warning",
    );
    expect(context.ui.input).toHaveBeenCalledTimes(2);

    expect(context.newSession).toHaveBeenCalledWith({
      withSession: expect.any(Function),
    });

    const sessionSeriesAndTitle = `${entry.data.series}${SESION_TITLE_SEPARATOR}${context.ui.input.mock.settledResults[1]?.value?.trim()}`;
    expect(consumePersistedSessionSeriesData()).toMatchObject({
      sessionName: sessionSeriesAndTitle,
    });
    expect(appendSessionSeriesBasedOnCwdSpy).toHaveBeenCalledWith(
      sessionCtx.cwd,
      entry.data.series,
      "Make coverage for Processor optimized",
    );

    expect(sessionCtx.ui.notify).toHaveBeenCalledWith(
      `You have created a new session in ${entry.data.series}
      with ${context.ui.input.mock.settledResults[1]?.value?.trim()}
      `,
    );
  });
});
