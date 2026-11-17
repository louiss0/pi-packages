import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { defined, type Patch } from "#src/optional";
import { resolveThinking } from "#src/thinking/resolve";
import { makeModel, makeReasoningModel } from "#test/helpers/make-model";

/** A model that supports only the levels named. */
function modelWithLevels(
  levels: Record<string, string | null>,
  overrides: Patch<Model<any>> = {},
): Model<any> {
  return makeModel({
    id: "claude-sonnet-5",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null,
      ...levels,
    },
    ...defined(overrides),
  });
}

describe("resolveThinking — a model that does not reason", () => {
  it("discards the level and says it does not apply", () => {
    const decision = resolveThinking({
      requested: "high",
      model: makeModel(),
    });
    expect(decision.applicable).toBe(false);
    expect(decision.level).toBeUndefined();
    expect(decision.reason).toContain("does not do extended reasoning");
  });

  it("discards the definition's level too", () => {
    const decision = resolveThinking({
      defined: "low",
      model: makeModel(),
    });
    expect(decision.applicable).toBe(false);
    expect(decision.level).toBeUndefined();
  });
});

describe("resolveThinking — an explicit level", () => {
  it("takes the request's level when the model supports it", () => {
    const decision = resolveThinking({
      requested: "high",
      model: makeReasoningModel(),
    });
    expect(decision.level).toBe("high");
    expect(decision.source).toBe("request");
    expect(decision.clamped).toBe(false);
  });

  it("takes the definition's level when the request names none", () => {
    const decision = resolveThinking({
      defined: "low",
      model: makeReasoningModel(),
    });
    expect(decision.level).toBe("low");
    expect(decision.source).toBe("definition");
  });

  it("clamps a level the model does not support, the way Pi clamps it", () => {
    const decision = resolveThinking({
      requested: "xhigh",
      model: makeReasoningModel(),
    });
    expect(decision.clamped).toBe(true);
    expect(decision.level).toBe("high");
    expect(decision.reason).toContain("clamped");
  });

  it("never clamps a request down to off on a reasoning model", () => {
    const decision = resolveThinking({
      requested: "medium",
      model: modelWithLevels({
        off: "off",
        minimal: null,
        low: null,
        medium: null,
        high: "high",
      }),
    });
    expect(decision.clamped).toBe(true);
    expect(decision.level).not.toBe("off");
  });

  it("refuses an explicit off on a model that reasons", () => {
    const decision = resolveThinking({
      requested: "off",
      model: makeReasoningModel(),
    });
    expect(decision.clamped).toBe(true);
    expect(decision.level).not.toBe("off");
    expect(decision.reason).toContain("does extended reasoning");
  });

  it("keeps the request's level when there is no model to check it against", () => {
    const decision = resolveThinking({ requested: "medium" });
    expect(decision.level).toBe("medium");
    expect(decision.clamped).toBe(false);
  });
});

describe("resolveThinking — the automatic upper median", () => {
  it("selects the higher middle level of an even four-level array", () => {
    const decision = resolveThinking({ model: makeReasoningModel() });
    expect(decision.level).toBe("medium");
    expect(decision.source).toBe("automatic");
    expect(decision.reason).toContain("upper median");
  });

  it("selects high from the six non-off levels", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      }),
    });
    expect(decision.level).toBe("high");
  });

  it("uses the upper median of a gapped even array", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        low: "low",
        high: "high",
      }),
    });
    expect(decision.level).toBe("high");
  });

  it("uses the middle of a gapped odd array", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        low: "low",
        high: "high",
        max: "max",
      }),
    });
    expect(decision.level).toBe("high");
  });

  it("keeps a singleton reasoning level", () => {
    const decision = resolveThinking({
      model: modelWithLevels({ off: "off", minimal: "minimal" }),
    });
    expect(decision.level).toBe("minimal");
  });

  it("never includes off in the median", () => {
    const decision = resolveThinking({
      model: modelWithLevels({ off: "off", high: "high" }),
    });
    expect(decision.level).toBe("high");
  });
});
