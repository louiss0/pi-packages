import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { type FamilyProfile, validateProfile } from "#src/models/profile";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { type RoutingContext, routeModel } from "#src/models/router";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);

/** A model in the catalogue's shape. */
function model(provider: string, id: string): Model<any> {
  return { provider, id, name: id } as Model<any>;
}

/** A routing context over the given available models and profiles. */
function context(
  available: Model<any>[],
  profiles: FamilyProfile[] = SHIPPED_PROFILES as FamilyProfile[],
): RoutingContext {
  return {
    available,
    profiles: new Map(profiles.map((profile) => [profile.family, profile])),
    strategies,
  };
}

/** The profiles the package ships, as a map. */
function shippedProfiles(): Map<string, FamilyProfile> {
  return new Map(
    (SHIPPED_PROFILES as FamilyProfile[]).map((profile) => [
      profile.family,
      profile,
    ]),
  );
}

describe("the shipped profiles", () => {
  it("are valid against the shipped strategies", () => {
    for (const profile of SHIPPED_PROFILES as FamilyProfile[]) {
      expect({
        family: profile.family,
        problems: validateProfile(profile, strategies.get(profile.family)),
      }).toEqual({ family: profile.family, problems: [] });
    }
  });

  it("cover the eight agreed families", () => {
    expect([...shippedProfiles().keys()].sort()).toEqual([
      "claude",
      "deepseek",
      "gemini",
      "gpt",
      "kimi",
      "mimo",
      "minimax",
      "qwen",
    ]);
  });
});

describe("validateProfile", () => {
  const strategy = strategies.get("gpt");

  it("rejects a model from another family", () => {
    const problems = validateProfile(
      {
        family: "gpt",
        versions: [
          {
            version: "6.1",
            tiers: [
              { tier: "sol", models: [model("openai", "claude-opus-5")] },
            ],
          },
        ],
      },
      strategy,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects a model of another version", () => {
    const problems = validateProfile(
      {
        family: "gpt",
        versions: [
          {
            version: "6.1",
            tiers: [{ tier: "sol", models: [model("openai", "gpt-6-sol")] }],
          },
        ],
      },
      strategy,
    );
    expect(problems[0]?.problem).toContain("is version 6, not 6.1");
  });

  it("rejects a model that is not in the tier it is listed under", () => {
    const problems = validateProfile(
      {
        family: "gpt",
        versions: [
          {
            version: "6.1",
            tiers: [{ tier: "luna", models: [model("openai", "gpt-6.1-sol")] }],
          },
        ],
      },
      strategy,
    );
    expect(problems[0]?.problem).toContain("is not in the tier");
  });

  it("rejects a fallback the profile does not have", () => {
    const problems = validateProfile(
      {
        family: "gpt",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                models: [model("openai", "gpt-6.1-sol")],
                fallbacks: [{ version: "9.9", tier: "luna" }],
              },
            ],
          },
        ],
      },
      strategy,
    );
    expect(problems[0]?.problem).toContain('fallback version "9.9"');
  });

  it("rejects a fallback tier the version does not have", () => {
    const problems = validateProfile(
      {
        family: "gpt",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                models: [model("openai", "gpt-6.1-sol")],
                fallbacks: [{ version: "6.1", tier: "nope" }],
              },
            ],
          },
        ],
      },
      strategy,
    );
    expect(problems[0]?.problem).toContain('fallback tier "nope"');
  });

  it("rejects a family with no naming structure", () => {
    const problems = validateProfile(
      {
        family: "llama",
        versions: [
          { version: "1", tiers: [{ tier: "", models: [model("x", "y")] }] },
        ],
      },
      undefined,
    );
    expect(
      problems.some((problem) => problem.problem.includes("naming structure")),
    ).toBe(true);
  });
});

describe("routeModel", () => {
  it("steps down one tier in the parent's own version", () => {
    const outcome = routeModel(
      model("openai", "gpt-5.6-sol"),
      context([
        model("openai", "gpt-5.6-sol"),
        model("openai", "gpt-5.6-terra"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gpt-5.6-terra");
    expect(outcome.tier).toBe("gpt 5.6 tier terra");
  });

  it("takes the first model of a tier in the profile's preference order", () => {
    const outcome = routeModel(
      model("anthropic", "claude-opus-4-5"),
      context([
        model("anthropic", "claude-opus-4-5"),
        model("anthropic", "claude-sonnet-4-5"),
        model("anthropic", "claude-sonnet-4-5-20250929"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("claude-sonnet-4-5");
  });

  it("walks past a tier the session cannot run", () => {
    const outcome = routeModel(
      model("openai", "gpt-5.6-sol"),
      context([
        model("openai", "gpt-5.6-sol"),
        model("openai", "gpt-5.6-luna"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gpt-5.6-luna");
  });

  it("crosses into an approved version when its own has nothing to offer", () => {
    const outcome = routeModel(
      model("openai", "gpt-6.1-sol"),
      context([model("openai", "gpt-6.1-sol"), model("openai", "gpt-6-luna")]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gpt-6-luna");
    expect(outcome.tier).toBe("gpt 6 tier luna");
  });

  it("does not cross into a version the profile does not approve", () => {
    const profile: FamilyProfile = {
      family: "gpt",
      versions: [
        {
          version: "6.1",
          tiers: [{ tier: "sol", models: [model("openai", "gpt-6.1-sol")] }],
        },
        {
          version: "6",
          tiers: [
            { tier: "sol", models: [model("openai", "gpt-6-sol")] },
            { tier: "luna", models: [model("openai", "gpt-6-luna")] },
          ],
        },
      ],
    };
    const outcome = routeModel(
      model("openai", "gpt-6.1-sol"),
      context(
        [model("openai", "gpt-6.1-sol"), model("openai", "gpt-6-luna")],
        [profile],
      ),
    );
    expect(outcome.kind).toBe("retained");
  });

  it("keeps the parent's model when the ladder has nothing left", () => {
    const parent = model("openai", "gpt-5.4-nano");
    const outcome = routeModel(parent, context([parent]));
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.model).toBe(parent);
    expect(outcome.reason).toContain("no lower gpt tier is available");
  });

  it("keeps the parent's model when its family has no profile", () => {
    const parent = model("openai", "gpt-6.1-sol");
    const outcome = routeModel(parent, context([parent], []));
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.reason).toContain("no profile");
  });

  it("keeps the parent's model when its version is not on the ladder", () => {
    const parent = model("openai", "gpt-4.1");
    const outcome = routeModel(parent, context([parent]));
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.reason).toContain("no profile for version 4.1");
  });

  it("errors on a model it cannot place in a family", () => {
    const outcome = routeModel(
      model("acme", "wonder-model-9"),
      context([model("acme", "wonder-model-9")]),
    );
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.error).toContain("Cannot place the model");
  });

  it("keeps the parent's model when there is no parent", () => {
    const outcome = routeModel(undefined, context([]));
    expect(outcome.kind).toBe("retained");
  });

  it("steps down a Claude line within its version", () => {
    const outcome = routeModel(
      model("anthropic", "claude-opus-5"),
      context([
        model("anthropic", "claude-opus-5"),
        model("anthropic", "claude-sonnet-5"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("claude-sonnet-5");
  });

  it("steps down a Gemini tier within its version", () => {
    const outcome = routeModel(
      model("google", "gemini-2.5-pro"),
      context([
        model("google", "gemini-2.5-pro"),
        model("google", "gemini-2.5-flash"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gemini-2.5-flash");
  });

  it("steps down a Kimi version when its own has no lower tier", () => {
    const outcome = routeModel(
      model("moonshotai", "kimi-k3"),
      context([
        model("moonshotai", "kimi-k3"),
        model("moonshotai", "kimi-k2.7-code"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("kimi-k2.7-code");
  });

  it("keeps walking down the approved links when a tier is unavailable", () => {
    const outcome = routeModel(
      model("moonshotai", "kimi-k3"),
      context([
        model("moonshotai", "kimi-k3"),
        model("moonshotai", "kimi-k2.6"),
      ]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("kimi-k2.6");
  });

  it("never chooses a model the session cannot run", () => {
    const outcome = routeModel(
      model("openai", "gpt-5.6-sol"),
      context([model("openai", "gpt-5.6-sol")]),
    );
    expect(outcome.kind).toBe("retained");
  });
});
