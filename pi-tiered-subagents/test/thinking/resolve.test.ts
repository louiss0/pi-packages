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
    thinkingLevelMap: levels,
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

describe("resolveThinking — the automatic level", () => {
  it("prefers medium", () => {
    const decision = resolveThinking({ model: makeReasoningModel() });
    expect(decision.level).toBe("medium");
    expect(decision.source).toBe("automatic");
  });

  it("falls back to low when the model has no medium", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        medium: null,
        low: "low",
        high: "high",
      }),
    });
    expect(decision.level).toBe("low");
  });

  it("falls back to the lowest supported level when it has neither", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        medium: null,
        low: null,
        minimal: "minimal",
        high: "high",
      }),
    });
    expect(decision.level).toBe("minimal");
  });

  it("never turns reasoning off on a model that has it", () => {
    const decision = resolveThinking({
      model: modelWithLevels({ off: "off", minimal: "minimal" }),
    });
    expect(decision.level).not.toBe("off");
  });
});

describe("resolveThinking — the parent's model was kept", () => {
  it("uses the next supported rung instead of jumping to a preferred default", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      }),
      parentLevel: "max",
      parentModelKept: true,
    });
    expect(decision.level).toBe("high");
    expect(decision.source).toBe("parent");
    expect(decision.reason).toContain("one supported rung");
  });

  it.each([
    "off",
    "minimal",
  ] as const)("uses the supported non-off floor when the parent is at %s below it", (parentLevel) => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
        max: null,
      }),
      parentLevel,
      parentModelKept: true,
    });
    expect(decision.level).toBe("low");
    expect(decision.source).toBe("parent");
    expect(decision.reason).toContain("lowest supported non-off level");
  });

  it("takes medium when it is the next supported rung below high", () => {
    const decision = resolveThinking({
      model: makeReasoningModel(),
      parentLevel: "high",
      parentModelKept: true,
    });
    expect(decision.level).toBe("medium");
    expect(decision.source).toBe("parent");
  });

  it("drops to a supported level below the parent's when low is not lower", () => {
    const decision = resolveThinking({
      model: makeReasoningModel(),
      parentLevel: "low",
      parentModelKept: true,
    });
    // The parent is already at low, so the child steps below it rather than
    // matching it.
    expect(decision.level).toBe("minimal");
    expect(decision.reason).toContain(
      "below the effort the parent was running at",
    );
  });

  it("never raises the parent's effort", () => {
    const decision = resolveThinking({
      model: makeReasoningModel(),
      parentLevel: "minimal",
      parentModelKept: true,
    });
    expect(decision.level).not.toBe("medium");
    expect(decision.level).not.toBe("high");
  });

  it("keeps the parent's effort when the model supports nothing lower", () => {
    const decision = resolveThinking({
      model: modelWithLevels({
        off: "off",
        minimal: null,
        low: null,
        medium: null,
        high: "high",
      }),
      parentLevel: "high",
      parentModelKept: true,
    });
    expect(decision.level).toBe("high");
    expect(decision.reason).toContain("stands");
  });

  it("uses the automatic level when the parent's effort is unknown", () => {
    const decision = resolveThinking({
      model: makeReasoningModel(),
      parentModelKept: true,
    });
    expect(decision.level).toBe("medium");
  });
});
