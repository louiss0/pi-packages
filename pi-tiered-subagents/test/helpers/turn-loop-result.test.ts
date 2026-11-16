import { describe, expect, it } from "vitest";
import { childCompletedEvent, turnLoopResult } from "./turn-loop-result";

describe("turnLoopResult", () => {
  it("describes a completed run by default", () => {
    expect(turnLoopResult()).toEqual({
      responseText: "done",
    });
  });

  it("applies overrides while keeping other defaults", () => {
    expect(turnLoopResult({ responseText: "custom" })).toEqual({
      responseText: "custom",
    });
  });
});

describe("childCompletedEvent", () => {
  it("describes a completed run by default", () => {
    expect(childCompletedEvent()).toEqual({
      sessionDir: "/sessions/child",
      agentName: "Explore",
    });
  });

  it("applies overrides while keeping other defaults", () => {
    expect(childCompletedEvent({ agentName: "Plan" })).toEqual({
      sessionDir: "/sessions/child",
      agentName: "Plan",
    });
  });
});
