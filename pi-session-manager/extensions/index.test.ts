import type {
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
} from ".";

type MockExtenstionContext =
  | Partial<ExtensionContext>
  | {
      ui: Partial<ExtensionUIContext>;
    };

class MockPastTimestampCalculator extends $TimestampCalculator {
  #nowTimestamp = Date.now();
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
  hour(multiplier: number): number {
    return multiplier * this.HOUR_IN_MS;
  }
  day(multiplier: number): number {
    return multiplier * this.DAY_IN_MS;
  }
  week(multiplier: number): number {
    return multiplier * this.WEEK_IN_MS;
  }
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

  getSessionsBasedOnPredeterminedTimestamp() {
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

const cleanIt = it
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

function castToExtensionContext(context: MockExtenstionContext): ExtensionContext {
  return context as ExtensionContext;
}

const mockRemoveSessionFiles = vi.fn<RemoveSessionFiles>();

describe.todo("handleSessionCleanInactive", () => {
  cleanIt(
    "gets rid of all sessions that haven't been modified in the last three days",
    ({ sessions, timestampCalculator }) => {
      const context = {
        ui: {
          notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
        },
      } satisfies MockExtenstionContext;

      const mockSessionFilter = new MockSessionFilter(sessions, timestampCalculator);

      const getSessionsBasedOnPredeterminedTimestamp = vi.spyOn(
        mockSessionFilter,
        "getSessionsBasedOnPredeterminedTimestamp",
      );

      const timeStampDaySpy = vi.spyOn(timestampCalculator, "day");

      handleSessionCleanInactive(
        {
          sessionFilter: mockSessionFilter,
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
    },
  );
});

describe.todo("handleSessionCleanOlderThan", () => {
  cleanIt(
    "cleans sessions older than the specified unit",
    ({ sessions, timestampCalculator }) => {
      const context = {
        ui: {
          notify: vi.fn(),
        },
      } satisfies MockExtenstionContext;

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
    },
  );
});

describe.todo("handleSessionDeleteLast", () => {
  cleanIt(
    "deletes the last sessions by a specified nth",
    ({ sessions, timestampCalculator }) => {
      const context = {
        ui: {
          notify: vi.fn(),
        },
      } satisfies MockExtenstionContext;

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
    },
  );
});

describe.todo("handleSessionSeries", () => {
  it("creates a session series when create is passed", () => {
    const context = {
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi.fn<ExtensionUIContext["input"]>(),
      },
    } satisfies MockExtenstionContext;

    handleSessionSeries("create", castToExtensionContext(context));

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of your session series?",
      "What are you focused on?",
    );

    expect(context.ui.notify).toHaveBeenCalledWith("Your session series has been created");
  });

  it("deletes a session series when delete is passed", () => {
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

    const randomSeries = sessionSeries[Math.floor(Math.random() * sessionSeries.length)];

    const context = {
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        select: vi.fn<ExtensionUIContext["select"]>().mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionContext;

    handleSessionSeries("delete", castToExtensionContext(context));

    expect(context.ui.select).toHaveBeenCalledWith(
      "Which session series would you like to delete?",
      sessionSeries,
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      `This series ${context.ui.select.mock.settledResults[0]?.value} and it's related sessions`,
    );
  });

  it("Makes a new session in a series new is passed", () => {
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

    const randomSeries = sessionSeries[Math.floor(Math.random() * sessionSeries.length)];

    const context = {
      ui: {
        notify: vi.fn<ExtensionUIContext["notify"]>(),
        input: vi.fn<ExtensionUIContext["input"]>(),
        select: vi.fn<ExtensionUIContext["select"]>().mockResolvedValue(randomSeries),
      },
    } satisfies MockExtenstionContext;

    handleSessionSeries("new", castToExtensionContext(context));

    expect(context.ui.select).toHaveBeenCalledWith(
      "Which session series would you like to create a new session in?",
      sessionSeries,
    );

    expect(context.ui.input).toHaveBeenCalledWith(
      "What is the name of the this new session?",
      "What do you want your agent to do now?",
    );

    expect(context.ui.notify).toHaveBeenCalledWith(
      `You have created a new session in ${context.ui.select.mock.settledResults[0]?.value}
      with ${context.ui.input.mock.settledResults[0]?.value}
      `,
    );
  });
});
