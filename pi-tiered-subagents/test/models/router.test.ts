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
      "glm",
      "gpt",
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
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                size: "L",
                models: [model("openai", "claude-opus-5")],
              },
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
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                size: "L",
                models: [model("openai", "gpt-6-sol")],
              },
            ],
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
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "luna",
                size: "M",
                models: [model("openai", "gpt-6.1-sol")],
              },
            ],
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
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                size: "L",
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
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                size: "L",
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
        group: "size",
        versions: [
          {
            version: "1",
            tiers: [{ tier: "", size: "M", models: [model("x", "y")] }],
          },
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
  it("keeps review at the parent's size instead of stepping down", () => {
    const parent = model("anthropic", "claude-opus-4-5");
    const outcome = routeModel(
      parent,
      context([parent, model("anthropic", "claude-sonnet-4-5")]),
      "reviewer",
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("claude-opus-4-5");
    expect(outcome.reason).toContain("reviewer targets L");
  });

  it.each([
    ["worker", "claude-opus-4-5", "claude-sonnet-4-5", "M"],
    ["researcher", "claude-opus-4-5", "claude-haiku-4-5", "S"],
    ["explore", "claude-sonnet-4-5", "claude-haiku-4-5", "S"],
    ["debug", "claude-haiku-4-5", "claude-sonnet-4-5", "M"],
    ["reviewer", "claude-sonnet-4-5", "claude-sonnet-4-5", "M"],
    ["worker", "claude-haiku-4-5", "claude-haiku-4-5", "S"],
    ["custom-editor", "claude-opus-4-5", "claude-sonnet-4-5", "M"],
    ["reviewer", "claude-opus-4-5-20251101", "claude-opus-4-5", "L"],
  ])("%s from %s selects %s (size %s)", (role, parentId, expected, target) => {
    const available = [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ].map((id) => model("anthropic", id));
    const outcome = routeModel(
      model("anthropic", parentId),
      context(available),
      role,
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect([outcome.provider, outcome.modelId]).toEqual([
      "anthropic",
      expected,
    ]);
    expect(outcome.reason).toContain(`${role} targets ${target}`);
  });

  it.each([
    ["openai", "gpt-6.1-sol", "worker", "gpt-6-luna", "M"],
    ["openai", "gpt-6-astra", "worker", "gpt-6-luna", "M"],
    ["openai", "gpt-6-sol", "reviewer", "gpt-6-sol", "L"],
    ["openai", "gpt-5.6-luna", "debug", "gpt-5.6-terra", "M"],
    ["openai", "gpt-5.6-terra", "debug", "gpt-5.6-terra", "M"],
    ["openai", "gpt-5.4", "researcher", "gpt-5.4-mini", "S"],
    ["openai", "gpt-5.4-nano", "worker", "gpt-5.4-mini", "S"],
    ["qwen-token-plan", "qwen3.7-max", "worker", "qwen3.7-plus", "M"],
    ["qwen-token-plan", "qwen3.7-plus", "worker", "qwen3.6-flash", "S"],
    ["minimax", "MiniMax-M3.1", "debug", "MiniMax-M3.1-flash", "worker"],
    ["minimax", "MiniMax-M3.1-flash", "reviewer", "MiniMax-M3.1", "planner"],
    ["xiaomi", "mimo-v2.6-pro", "worker", "mimo-v2.6-flash", "worker"],
    [
      "xiaomi",
      "mimo-v2.6-flash",
      "reviewer",
      "mimo-v2.6-pro-ultraspeed",
      "planner",
    ],
    ["zai", "glm-5.3", "worker", "glm-5.3-flash", "worker"],
    ["zai", "glm-5.3-flash", "reviewer", "glm-5.3", "planner"],
    ["deepseek", "deepseek-v4-pro", "reviewer", "deepseek-v4-pro", "planner"],
  ])("%s/%s routes %s to %s (%s)", (provider, parentId, role, expected, target) => {
    const available = SHIPPED_PROFILES.flatMap((profile) =>
      profile.versions.flatMap((version) =>
        version.tiers.flatMap((tier) =>
          tier.models.map((candidate) =>
            model(candidate.provider, candidate.id),
          ),
        ),
      ),
    );
    const outcome = routeModel(
      model(provider, parentId),
      context(available),
      role,
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect([outcome.provider, outcome.modelId]).toEqual([provider, expected]);
    expect(outcome.reason).toContain(`${role} targets ${target}`);
  });

  it.each([
    "worker",
    "explore",
    "researcher",
    "debug",
  ])("retains DeepSeek when %s has no worker class", (role) => {
    const parent = model("deepseek", "deepseek-v4-pro");
    const outcome = routeModel(parent, context([parent]), role);
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.model).toBe(parent);
    expect(outcome.reason).toContain(`${role} targets worker`);
  });

  it("steps down one size in the parent's own version", () => {
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
      group: "size",
      versions: [
        {
          version: "6.1",
          tiers: [
            {
              tier: "sol",
              size: "L",
              models: [model("openai", "gpt-6.1-sol")],
            },
          ],
        },
        {
          version: "6",
          tiers: [
            { tier: "sol", size: "L", models: [model("openai", "gpt-6-sol")] },
            {
              tier: "luna",
              size: "M",
              models: [model("openai", "gpt-6-luna")],
            },
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

  it("keeps the parent's model when no target or cheaper rung is runnable", () => {
    const parent = model("anthropic", "claude-opus-4-5");
    const outcome = routeModel(parent, context([parent]));
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.model).toBe(parent);
    expect(outcome.reason).toContain("worker targets M");
    expect(outcome.reason).toContain("keeping claude-opus-4-5");
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
    const outcome = routeModel(undefined, context([]), "reviewer");
    expect(outcome.kind).toBe("retained");
    if (outcome.kind === "retained")
      expect(outcome.reason).toContain("reviewer targets");
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

  it.each([
    "worker",
    "explore",
    "researcher",
    "debug",
    "custom-role",
  ])("%s uses the worker class even from a worker parent", (role) => {
    const parent = model("google", "gemini-2.5-flash-lite");
    const outcome = routeModel(
      parent,
      context([
        parent,
        model("google", "gemini-2.5-pro"),
        model("google", "gemini-2.5-flash"),
      ]),
      role,
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gemini-2.5-flash");
    expect(outcome.reason).toContain(`${role} targets worker`);
  });

  it("steps a worker parent up to the planner class for review", () => {
    const parent = model("google", "gemini-2.5-flash");
    const outcome = routeModel(
      parent,
      context([parent, model("google", "gemini-2.5-pro")]),
      "reviewer",
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect([outcome.provider, outcome.modelId]).toEqual([
      "google",
      "gemini-2.5-pro",
    ]);
    expect(outcome.reason).toContain("reviewer targets planner");
  });

  it("uses a Gemini worker tier within its version", () => {
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

  it.each([
    ["google", "gemini-3.7-flash", "reviewer", "gemini-2.5-pro", "planner"],
    ["google", "gemini-3.5-flash", "reviewer", "gemini-2.5-pro", "planner"],
    ["minimax", "MiniMax-M3", "worker", "MiniMax-M3.1-flash", "worker"],
    ["minimax", "MiniMax-M2.7", "explore", "MiniMax-M3.1-flash", "worker"],
    ["qwen-token-plan", "qwen3.7-max", "researcher", "qwen3.6-flash", "S"],
    ["qwen-token-plan", "qwen3.7-plus", "worker", "qwen3.6-flash", "S"],
  ])("%s/%s reaches the %s target via approved links", (provider, parentId, role, expected, target) => {
    const parent = model(provider, parentId);
    const outcome = routeModel(
      parent,
      context([parent, model(provider, expected)]),
      role,
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect([outcome.provider, outcome.modelId]).toEqual([provider, expected]);
    expect(outcome.reason).toContain(`${role} targets ${target}`);
  });

  it("keeps walking down approved links when a target model is unavailable", () => {
    const outcome = routeModel(
      model("openai", "gpt-6.1-sol"),
      context([model("openai", "gpt-5.6-luna")]),
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gpt-5.6-luna");
  });

  it("tries the next approved target path when the first is unrunnable", () => {
    const parent = model("google", "gemini-3.7-flash");
    const profile: FamilyProfile = {
      family: "gemini",
      group: "planner-worker",
      versions: [
        {
          version: "3.7",
          tiers: [
            {
              tier: "flash",
              class: "worker",
              models: [parent],
              fallbacks: [
                { version: "3.1", tier: "pro-preview" },
                { version: "2.5", tier: "pro" },
              ],
            },
          ],
        },
        {
          version: "3.1",
          tiers: [
            {
              tier: "pro-preview",
              class: "planner",
              models: [model("google", "gemini-3.1-pro-preview")],
            },
          ],
        },
        {
          version: "2.5",
          tiers: [
            {
              tier: "pro",
              class: "planner",
              models: [model("google", "gemini-2.5-pro")],
            },
          ],
        },
      ],
    };
    const outcome = routeModel(
      parent,
      context([model("google", "gemini-2.5-pro")], [profile]),
      "reviewer",
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gemini-2.5-pro");
  });

  it("degrades review downward when its planner target is unavailable", () => {
    const parent = model("google", "gemini-2.5-pro");
    const outcome = routeModel(
      parent,
      context([model("google", "gemini-2.5-flash")]),
      "reviewer",
    );
    expect(outcome.kind).toBe("routed");
    if (outcome.kind !== "routed") return;
    expect(outcome.modelId).toBe("gemini-2.5-flash");
    expect(outcome.reason).toContain("reviewer targets planner");
  });

  it("does not promote a worker target through a planner-only cross-version link", () => {
    const parent = model("google", "gemini-3.7-flash");
    const outcome = routeModel(
      parent,
      context([model("google", "gemini-2.5-pro")]),
      "worker",
    );
    expect(outcome.kind).toBe("retained");
    if (outcome.kind !== "retained") return;
    expect(outcome.model).toBe(parent);
    expect(outcome.reason).toContain("worker targets worker");
  });

  it("never chooses a model the session cannot run", () => {
    const outcome = routeModel(
      model("openai", "gpt-5.6-sol"),
      context([model("openai", "gpt-5.6-sol")]),
    );
    expect(outcome.kind).toBe("retained");
  });
});
