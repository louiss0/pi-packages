import type {
  ExtensionContext,
  ExtensionUIContext,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import {
  DAY_IN_MS,
  handleSessionCleanInactive,
  handleSessionCleanOlderThan,
  handleSessionDeleteLast,
  handleSessionSeries,
  $TimestampCalculator,
} from ".";
import { Session } from "inspector/promises";

type MockExtenstionContext =
  | Partial<ExtensionContext>
  | {
      ui: Partial<ExtensionUIContext>;
    };

class MockTimestampCalculator extends $TimestampCalculator {
  hour(number = 1): number {
    return number * this.HOUR_IN_MS;
  }
  day(number = 1): number {
    return number * this.DAY_IN_MS;
  }
  week(number = 1): number {
    return number * this.WEEK_IN_MS;
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
  .extend("timestampCalculator", new MockTimestampCalculator());

function castToExtensionContext(context: MockExtenstionContext): ExtensionContext {
  return context as ExtensionContext;
}

describe.todo("handleSessionCleanInactive", () => {
  cleanIt(
    "gets rid of all sessions that haven't been modified in the last three days",
    ({ sessions }) => {
      const context = {
        ui: {
          notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
        },
      } satisfies MockExtenstionContext;

      const cleanSessionsOlderThan = vi.fn();

      handleSessionCleanInactive(
        {
          sessions,
          cleanSessionsOlderThan,
        },
        castToExtensionContext(context),
      );

      expect(context.ui.notify).toHaveBeenCalledWith(
        "Getting rid of all sessions that have been inactive for three days",
        "warning",
      );

      const threeDaysAgoTimeStamp = Date.now() - 3 * DAY_IN_MS;
      expect(cleanSessionsOlderThan).toHaveBeenCalledWith(threeDaysAgoTimeStamp);

      expect(context.ui.notify).toHaveBeenCalledWith(
        [
          "Got rid of all the sessions that have been inactive for three days",
          ...sessions
            .filter((session) => session.modified.getTime() < threeDaysAgoTimeStamp)
            .map((session) => session.name),
        ].join("\n"),
      );
    },
  );
});

describe.todo("handleSessionCleanOlderThan", () => {
  it("", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionCleanOlderThan("", { sessions: [] }, context as ExtensionContext);
  });
});

describe.todo("handleSessionDeleteLast", () => {
  it("", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionDeleteLast(5, { sessions: [] }, context as ExtensionContext);
  });
});

describe.todo("handleSessionSeries", () => {
  it("creates a session series when create is passed", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionSeries("create", context as ExtensionContext);
  });

  it("deletes a session series when delete is passed", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionSeries("delete", context as ExtensionContext);
  });

  it("Makes a new session in a series new is passed", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionSeries("new", context as ExtensionContext);
  });

  it("Resumes a session in a series resume is passed", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionSeries("resume", context as ExtensionContext);
  });
});
