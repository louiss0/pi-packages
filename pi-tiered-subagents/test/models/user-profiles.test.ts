import { describe, expect, it } from "vitest";
import {
  mergeProfiles,
  parseProfile,
  parseUserProfiles,
} from "#src/models/user-profiles";
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
  });

  it("ignores obsolete fallback entries without rejecting the profile", () => {
    for (const fallbacks of [
      [{ version: "6", tier: "luna" }],
      [{ version: "missing", tier: "missing" }, null, 42],
      "obsolete",
    ]) {
      const parsed = parseProfile("gpt", {
        group: "size",
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
                size: "L",
                models: [{ provider: "openai", id: "gpt-6.1-sol" }],
                fallbacks,
              },
            ],
          },
        ],
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.profile.versions[0]?.tiers[0]).toEqual({
        tier: "sol",
        size: "L",
        models: [{ provider: "openai", id: "gpt-6.1-sol" }],
      });
      expect(validateProfile(parsed.profile, strategies.get("gpt"))).toEqual(
        [],
      );
    }
  });

  it("rejects a field the schema does not name", () => {
    const parsed = parseProfile("gpt", {
      ...GPT_PROFILE,
      // A matcher would be code to run; it is not read.
      match: "^gpt-.*$",
      parser: "javascript",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("match");
  });

  it("refuses a value that is not a profile", () => {
    expect(parseProfile("gpt", "gpt").ok).toBe(false);
    expect(parseProfile("gpt", 42).ok).toBe(false);
    expect(parseProfile("gpt", []).ok).toBe(false);
    expect(parseProfile("gpt", null).ok).toBe(false);
  });

  it("refuses a profile with no versions", () => {
    const parsed = parseProfile("gpt", { group: "size" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("versions");
  });

  it("refuses a tier with no models", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [{ version: "6.1", tiers: [{ tier: "sol", size: "L" }] }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("versions[0].tiers[0].models");
  });

  it("trims version, tier, provider, and model id without rewriting identity", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [
        {
          version: " 6.1 RC ",
          tiers: [
            {
              tier: " So L ",
              size: "L",
              models: [{ provider: " Open AI ", id: " GPT 6.1 Sol " }],
            },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.versions[0]?.version).toBe("6.1 RC");
    expect(parsed.profile.versions[0]?.tiers[0]?.tier).toBe("So L");
    expect(parsed.profile.versions[0]?.tiers[0]?.models[0]).toEqual({
      provider: "Open AI",
      id: "GPT 6.1 Sol",
    });
  });

  it("does not accept an explicitly undefined optional label", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [
        {
          version: "6.1",
          tiers: [
            {
              tier: "sol",
              size: undefined,
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("versions[0].tiers[0].size");
  });

  it("names the label field a group problem belongs to", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [
        {
          version: "6.1",
          tiers: [
            {
              tier: "sol",
              size: "L",
              class: 42,
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("versions[0].tiers[0].class");
  });

  it("orders array indexes numerically", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: Array.from({ length: 11 }, (_, index) => ({
        version: `v${index}`,
        tiers: [
          {
            tier: "sol",
            models: [{ provider: "openai", id: `gpt-${index}-sol` }],
          },
        ],
      })),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem.indexOf("versions[2].tiers")).toBeLessThan(
      parsed.problem.indexOf("versions[10].tiers"),
    );
  });

  it("preserves the empty default-tier name", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [
        {
          version: "5.5",
          tiers: [
            {
              tier: "   ",
              size: "M",
              models: [{ provider: "openai", id: "gpt-5.5" }],
            },
          ],
        },
      ],
    });
    expect(parsed.ok && parsed.profile.versions[0]?.tiers[0]?.tier).toBe("");
  });

  it("rejects identities that become blank after trimming", () => {
    const profile = (version: string, provider: string, id: string) => ({
      group: "size",
      versions: [
        {
          version,
          tiers: [{ tier: "sol", size: "L", models: [{ provider, id }] }],
        },
      ],
    });
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["   ", "openai", "gpt-6.1-sol"],
      ["6.1", "   ", "gpt-6.1-sol"],
      ["6.1", "openai", "   "],
    ];
    for (const [version, provider, id] of cases) {
      const parsed = parseProfile("gpt", profile(version, provider, id));
      expect(parsed.ok, `${version}/${provider}/${id}`).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/versions|provider|id/);
    }
  });

  it("reports a missing group label alongside another structural problem", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      versions: [{ version: "   ", tiers: [{ tier: "sol", models: [] }] }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toContain("versions[0].version");
    expect(parsed.problem).toContain("versions[0].tiers[0].size");
  });

  it("reports every structural problem with a deterministic field path", () => {
    const broken = {
      group: "size",
      versions: [
        {
          version: "   ",
          tiers: [
            {
              tier: "sol",
              size: "XL",
              models: [{ provider: "   ", id: "   " }],
              obsolete: true,
            },
          ],
          extra: true,
        },
      ],
      ignored: true,
    };
    const first = parseProfile("gpt", broken);
    const second = parseProfile("gpt", broken);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    expect(first.problem).toBe(second.problem);
    for (const path of [
      "ignored",
      "versions[0].extra",
      "versions[0].tiers[0].obsolete",
      "versions[0].version",
      "versions[0].tiers[0].size",
      "versions[0].tiers[0].models[0].provider",
      "versions[0].tiers[0].models[0].id",
    ]) {
      expect(first.problem, path).toContain(path);
    }
  });
});

describe("parseUserProfiles", () => {
  it("rejects malformed families independently", () => {
    const valid = { ...GPT_PROFILE };
    const broken = {
      ...GPT_PROFILE,
      versions: [
        {
          version: "6.1",
          tiers: [
            {
              tier: "sol",
              size: "XL",
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    };
    const parsed = parseUserProfiles({ gpt: valid, claude: broken });
    expect(parsed.profiles.map((profile) => profile.family)).toEqual(["gpt"]);
    expect(parsed.problems.join("\n")).toContain("claude");
    expect(parsed.problems.join("\n")).toContain("versions[0].tiers[0].size");
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

  it("runs domain checks on normalized identities", () => {
    const parsed = parseProfile("gpt", {
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
        {
          version: " 6.1 ",
          tiers: [
            {
              tier: "sol",
              size: "L",
              models: [{ provider: "openai", id: "gpt-6.1-sol" }],
            },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { problems } = mergeProfiles(
      SHIPPED_PROFILES as FamilyProfile[],
      [parsed.profile],
      [],
      strategies,
    );
    expect(problems.join("\n")).toContain("listed twice");
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
  it("ignores obsolete fallback references in runtime profile data", () => {
    const profile = {
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
              fallbacks: [{ version: "missing", tier: "missing" }],
            },
          ],
        },
      ],
    } as const;
    expect(validateProfile(profile, strategies.get("gpt"))).toEqual([]);
  });

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
  it("labels every rung without cross-version links", () => {
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
      for (const version of profile.versions) {
        for (const tier of version.tiers) {
          expect(tier).not.toHaveProperty("fallbacks");
        }
      }
    }
  });
});
