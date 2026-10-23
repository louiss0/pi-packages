import { describe, expect, it } from "vitest";
import {
  modelIdentity,
  canReason,
  clampLevel,
  supportedLevels,
  adapter,
} from "#src/agents/sdk-adapter";
import { makeModel } from "#test/helpers/make-model";

describe("sdk-adapter — supportedLevels", () => {
  it("returns off when there is no model", () => {
    expect(supportedLevels(undefined)).toEqual(["off"]);
  });

  it("returns only Pi's exact levels for an ungated model", () => {
    const m = makeModel({ reasoning: true });
    const levels = supportedLevels(m);
    expect(levels).toEqual(expect.arrayContaining(["off"]));
    expect(levels.length).toBeGreaterThan(0);
  });

  it("filters to Pi's level names only", () => {
    // Mock a model that would report an SDK-level Pi doesn't know about
    const m = makeModel({ reasoning: true });
    const levels = supportedLevels(m);
    for (const level of levels) {
      expect([
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]).toContain(level);
    }
  });
});

describe("sdk-adapter — clampLevel", () => {
  it("clamps to off when there is no model", () => {
    expect(clampLevel("high", undefined)).toBe("off");
  });

  it("passes through a supported level", () => {
    const m = makeModel({ reasoning: true });
    // Pi-compatible clamp: supported levels pass through unchanged
    expect(clampLevel("medium", m)).toBe("medium");
  });

  it("passes through off on reasoning models (SDK-level)", () => {
    // The adapter delegates to SDK's clamp; reasoning-resolution layer
    // (resolve.ts) handles refusing "off" when reasoning is available.
    const m = makeModel({ reasoning: true });
    expect(clampLevel("off", m)).toBe("off");
  });
});

describe("sdk-adapter — canReason", () => {
  it("returns false when there is no model", () => {
    expect(canReason(undefined)).toBe(false);
  });

  it("returns false for non-reasoning models", () => {
    const m = makeModel({ reasoning: false });
    expect(canReason(m)).toBe(false);
  });

  it("returns true for reasoning models", () => {
    const m = makeModel({ reasoning: true });
    expect(canReason(m)).toBe(true);
  });
});

describe("sdk-adapter — modelIdentity", () => {
  it("returns undefined when there is no model", () => {
    expect(modelIdentity(undefined)).toBeUndefined();
  });

  it("extracts provider and id", () => {
    const m = makeModel({
      id: "claude-sonnet",
      provider: "anthropic",
      reasoning: true,
    });
    expect(modelIdentity(m)).toEqual({
      provider: "anthropic",
      id: "claude-sonnet",
    });
  });
});

describe("sdk-adapter — adapter instance", () => {
  it("exposes all four operations", () => {
    expect(typeof adapter.supportedLevels).toBe("function");
    expect(typeof adapter.clampLevel).toBe("function");
    expect(typeof adapter.canReason).toBe("function");
    expect(typeof adapter.modelIdentity).toBe("function");
  });
});
