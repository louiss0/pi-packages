import { describe, expect, it } from "vitest";
import { mergeProfiles, parseProfile } from "#src/models/user-profiles";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import type { FamilyProfile } from "#src/models/profile";
import { validateProfile } from "#src/models/profile";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);

/** A profile in the shape the settings file holds. */
const GPT_PROFILE = {
  group: "size",
  versions: [
    {
      version: "6.1",
      tiers: [
        {
          tier: "sol",
          size: "L",
          models: [{ provider: "openai", id: "gpt-6.1-sol" }],
          fallbacks: [{ version: "6", tier: "luna" }],
        },
      ],
    },
  ],
};

describe("parseProfile", () => {
  it("requires and preserves planner-worker class labels", () => {
    const profile = (modelClass: unknown) => ({
      group: "planner-worker",
      versions: [
        {
          version: "5.3",
          tiers: [
            {
              tier: "flash",
              class: modelClass,
              models: [{ provider: "zai", id: "glm-5.3-flash" }],
            },
          ],
        },
      ],
    });
    for (const modelClass of [undefined, "pro", 42]) {
      expect(parseProfile("glm", profile(modelClass)).ok).toBe(false);
    }
    for (const modelClass of ["planner", "worker"]) {
      const parsed = parseProfile("glm", profile(modelClass));
      expect(parsed.ok && parsed.profile.versions[0]?.tiers[0]?.class).toBe(
        modelClass,
      );
    }
  });

  it("requires a supported family group", () => {
    for (const group of [undefined, "other", 42]) {
      expect(parseProfile("gpt", { ...GPT_PROFILE, group }).ok).toBe(false);
    }
  });

  it("reads and validates the size labels", () => {
    const parsed = parseProfile("gpt", GPT_PROFILE);
    expect(parsed.ok && parsed.profile.group).toBe("size");
    expect(parsed.ok && parsed.profile.versions[0]?.tiers[0]?.size).toBe("L");
    for (const size of [undefined, "XL", 42]) {
      expect(
        parseProfile("gpt", {
          group: "size",
          versions: [
            {
              version: "6.1",
              tiers: [
                {
                  tier: "sol",
                  size,
                  models: [{ provider: "openai", id: "gpt-6.1-sol" }],
                },
              ],
            },
          ],
        }).ok,
      ).toBe(false);
    }
  });

  it("reads a profile from the settings data", () => {
    const parsed = parseProfile("gpt", GPT_PROFILE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.family).toBe("gpt");
    expect(parsed.profile.versions[0]?.tiers[0]?.models[0]?.id).toBe(
      "gpt-6.1-sol",
    );
    expect(parsed.profile.versions[0]?.tiers[0]?.fallbacks).toEqual([
      { version: "6", tier: "luna" },
    ]);
  });

  it("ignores a field the schema does not name", () => {
    const parsed = parseProfile("gpt", {
      ...GPT_PROFILE,
      // A matcher would be code to run; it is not read.
      match: "^gpt-.*$",
      parser: "javascript",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.profile)).toEqual([
      "family",
      "group",
      "versions",
    ]);
  });

  it("refuses a value that is not a profile", () => {
    expect(parseProfile("gpt", "gpt").ok).toBe(false);
    expect(parseProfile("gpt", 42).ok).toBe(false);
  });

  it("refuses a profile with no versions", () => {
    expect(parseProfile("gpt", { group: "size" })).toEqual({
      ok: false,
      problem: "a profile needs a versions list",
    });
  });

  it("refuses a tier with no models", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [{ version: "6.1", tiers: [{ tier: "sol", size: "L" }] }],
    });
    expect(parsed).toEqual({
      ok: false,
      problem: "a tier needs a models list",
    });
  });
});

describe("mergeProfiles", () => {
  const global: FamilyProfile[] = [
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
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    },
  ];

  it("replaces a family whole rather than merging it", () => {
    const { profiles } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      global,
      [],
      strategies,
    );
    expect(profiles.get("gpt")?.versions).toHaveLength(1);
  });

  it("leaves the other families alone", () => {
    const { profiles } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      global,
      [],
      strategies,
    );
    expect(profiles.get("claude")).toEqual(
      (SHIPPED_PROFILES as FamilyProfile[]).find(
        (profile) => profile.family === "claude",
      ),
    );
  });

  it("lets the project layer replace a family", () => {
    const project: FamilyProfile[] = [
      {
        family: "gpt",
        group: "size",
        versions: [
          {
            version: "7",
            tiers: [
              {
                tier: "sol",
                size: "L",
                models: [{ provider: "openai", id: "gpt-7-sol" }],
              },
            ],
          },
        ],
      },
    ];
    const { profiles } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      global,
      project,
      strategies,
    );
    expect(profiles.get("gpt")?.versions[0]?.version).toBe("7");
  });

  it("refuses a profile for a family with no naming structure", () => {
    const unknown: FamilyProfile[] = [
      {
        family: "llama",
        group: "size",
        versions: [
          {
            version: "1",
            tiers: [
              {
                tier: "",
                size: "M",
                models: [{ provider: "meta", id: "llama-1" }],
              },
            ],
          },
        ],
      },
    ];
    const { profiles, problems } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      unknown,
      [],
      strategies,
    );
    expect(profiles.has("llama")).toBe(false);
    expect(problems.join("\n")).toContain("naming structure");
  });

  it("refuses a profile whose models do not follow the naming structure", () => {
    const broken: FamilyProfile[] = [
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
                models: [{ provider: "openai", id: "claude-opus-5" }],
              },
            ],
          },
        ],
      },
    ];
    const { profiles, problems } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      broken,
      [],
      strategies,
    );
    expect(profiles.get("gpt")).toEqual(
      (SHIPPED_PROFILES as FamilyProfile[]).find(
        (profile) => profile.family === "gpt",
      ),
    );
    expect(problems.join("\n")).toContain("naming structure");
  });
});

describe("profile label validation", () => {
  it("reports missing or invalid group and group-appropriate labels", () => {
    const profile = {
      family: "gpt",
      group: "size",
      versions: [
        {
          version: "6.1",
          tiers: [
            {
              tier: "sol",
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    };
    // Runtime callers can still hand validation a malformed profile.
    expect(
      validateProfile(profile as FamilyProfile, strategies.get("gpt"))
        .map((p) => p.problem)
        .join(" "),
    ).toContain("size");
    expect(
      validateProfile(
        { ...profile, group: "planner-worker" } as FamilyProfile,
        strategies.get("gpt"),
      )
        .map((p) => p.problem)
        .join(" "),
    ).toContain("class");
    expect(
      validateProfile(
        { ...profile, group: "unknown" } as unknown as FamilyProfile,
        strategies.get("gpt"),
      )
        .map((p) => p.problem)
        .join(" "),
    ).toContain("group");
  });
});

describe("shipped profile data", () => {
  it("labels every rung and resolves every approved fallback", () => {
    expect(SHIPPED_PROFILES.map((profile) => profile.family).sort()).toEqual([
      "claude",
      "deepseek",
      "gemini",
      "glm",
      "gpt",
      "mimo",
      "minimax",
      "qwen",
    ]);
    for (const profile of SHIPPED_PROFILES) {
      expect(
        validateProfile(profile, strategies.get(profile.family)),
        profile.family,
      ).toEqual([]);
    }
  });
});
