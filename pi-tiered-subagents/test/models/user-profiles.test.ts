import { describe, expect, it } from "vitest";
import { mergeProfiles, parseProfile } from "#src/models/user-profiles";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import type { FamilyProfile } from "#src/models/profile";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);

/** A profile in the shape the settings file holds. */
const GPT_PROFILE = {
  versions: [
    {
      version: "6.1",
      tiers: [
        {
          tier: "sol",
          models: [{ provider: "openai", id: "gpt-6.1-sol" }],
          fallbacks: [{ version: "6", tier: "luna" }],
        },
      ],
    },
  ],
};

describe("parseProfile", () => {
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
    expect(Object.keys(parsed.profile)).toEqual(["family", "versions"]);
  });

  it("refuses a value that is not a profile", () => {
    expect(parseProfile("gpt", "gpt").ok).toBe(false);
    expect(parseProfile("gpt", 42).ok).toBe(false);
  });

  it("refuses a profile with no versions", () => {
    expect(parseProfile("gpt", {}).ok).toBe(false);
  });

  it("refuses a tier with no models", () => {
    const parsed = parseProfile("gpt", {
      versions: [{ version: "6.1", tiers: [{ tier: "sol" }] }],
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("mergeProfiles", () => {
  const global: FamilyProfile[] = [
    {
      family: "gpt",
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
        versions: [
          {
            version: "7",
            tiers: [
              {
                tier: "sol",
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
        versions: [
          {
            version: "1",
            tiers: [
              { tier: "", models: [{ provider: "meta", id: "llama-1" }] },
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
        versions: [
          {
            version: "6.1",
            tiers: [
              {
                tier: "sol",
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
