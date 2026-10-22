import { describe, expect, it } from "vitest";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";

describe("createResolvedSpawnConfig", () => {
  it("produces a background-shaped config by default", () => {
    expect(createResolvedSpawnConfig()).toEqual({
      identity: {
        subagentType: "worker",
        rawType: "worker",
        displayName: "Worker",
        definition: expect.any(Object),
      },
      notes: [],
      execution: {
        prompt: "do the task",
        description: "task",
        model: undefined,
        modelSelection: {
          model: undefined,
          source: "inherited",
          reason: "the parent has no model to step down from",
        },
        thinkingDecision: {
          applicable: false,
          source: "none",
          clamped: false,
          reason:
            "no model was resolved, so there is no reasoning level to set",
        },
        turnPolicy: { kind: "unlimited" },
        thinking: undefined,
        inheritContext: false,
        runInBackground: true,
      },
      presentation: {
        agentTags: [],
        detailBase: {
          displayName: "Worker",
          description: "task",
          subagentType: "worker",
          modelName: undefined,
          tags: undefined,
        },
      },
    });
  });

  it("applies the scalar overrides", () => {
    const config = createResolvedSpawnConfig({
      displayName: "General-purpose",
      prompt: "do something",
      description: "bg task",
      runInBackground: true,
    });
    expect(config.identity.displayName).toBe("General-purpose");
    expect(config.execution.prompt).toBe("do something");
    expect(config.execution.description).toBe("bg task");
  });

  it("mirrors runInBackground into the execution", () => {
    const config = createResolvedSpawnConfig({ runInBackground: true });
    expect(config.execution.runInBackground).toBe(true);
  });

  it("defaults rawType to subagentType but keeps an explicit rawType", () => {
    expect(createResolvedSpawnConfig().identity.rawType).toBe("worker");
    const explicit = createResolvedSpawnConfig({
      rawType: "other-type",
    });
    expect(explicit.identity.rawType).toBe("other-type");
  });

  it("carries no notes by default", () => {
    expect(createResolvedSpawnConfig().notes).toEqual([]);
  });

  it("mirrors displayName, description, subagentType, and model into presentation.detailBase", () => {
    const config = createResolvedSpawnConfig({
      subagentType: "Explore",
      displayName: "Explore",
      description: "scan repo",
      model: "haiku",
    });
    expect(config.presentation.detailBase).toEqual({
      displayName: "Explore",
      description: "scan repo",
      subagentType: "Explore",
      modelName: "haiku",
      tags: undefined,
    });
  });
});
