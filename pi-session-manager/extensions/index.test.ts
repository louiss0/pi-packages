import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  handleSessionCleanInactive,
  handleSessionCleanOlderThan,
  handleSessionDeleteLast,
  handleSessionSeries,
} from ".";

type MockExtenstionContext =
  | Partial<ExtensionContext>
  | {
      ui: Partial<ExtensionUIContext>;
    };

describe.todo("handleSessionCleanInactive", () => {
  const context = {} satisfies MockExtenstionContext;

  it("", () => {
    handleSessionCleanInactive(context as ExtensionContext);
  });
});

describe.todo("handleSessionCleanOlderThan", () => {
  it("", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionCleanOlderThan("", context as ExtensionContext);
  });
});

describe.todo("handleSessionDeleteLast", () => {
  it("", () => {
    const context = {} satisfies MockExtenstionContext;

    handleSessionDeleteLast(5, context as ExtensionContext);
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
