import { describe, expect, it } from "vitest";
import type { FamilyProfile } from "#src/models/profiles";
import { validateProfile } from "#src/models/profiles";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";
import {
  mergeProfiles,
  parseProfile,
  parseUserProfiles,
} from "#src/models/user-profiles";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);
const body = {
  group: "size",
  tiers: [
    { tier: "sol", size: "L" },
    { tier: "luna", size: "S" },
  ],
};
function profile(tiers: FamilyProfile["tiers"]): FamilyProfile {
  return { family: "gpt", group: "size", tiers };
}

describe("parseProfile", () => {
  it("reads a version-independent profile from settings", () => {
    expect(parseProfile("gpt", body)).toEqual({
      ok: true,
      profile: { family: "gpt", ...body },
    });
  });
  it("requires and preserves planner-worker labels", () => {
    expect(
      parseProfile("glm", {
        group: "planner-worker",
        tiers: [{ tier: "", class: "planner" }],
      }),
    ).toEqual({
      ok: true,
      profile: {
        family: "glm",
        group: "planner-worker",
        tiers: [{ tier: "", class: "planner" }],
      },
    });
    expect(
      parseProfile("glm", {
        group: "planner-worker",
        tiers: [{ tier: "flash" }],
      }),
    ).toMatchObject({
      ok: false,
      problem: expect.stringContaining("tiers[0].class"),
    });
  });
  it.each([
    undefined,
    null,
    [],
    3,
    "profile",
    {},
    { ...body, group: "unknown" },
    { ...body, tiers: null },
  ])("refuses malformed structural data: %j", (value) => {
    expect(parseProfile("gpt", value).ok).toBe(false);
  });
  it.each([
    { ...body, versions: [] },
    { ...body, providers: ["openai"] },
    { ...body, tiers: [{ tier: "sol", size: "L", models: [] }] },
    { ...body, typo: true },
  ])("rejects obsolete catalogues and unknown fields: %j", (value) => {
    expect(parseProfile("gpt", value).ok).toBe(false);
  });
  it("trims tier names and preserves the unnamed default", () => {
    expect(
      parseProfile("gpt", {
        group: "size",
        tiers: [
          { tier: " sol ", size: "L" },
          { tier: "  ", size: "M" },
        ],
      }),
    ).toEqual({
      ok: true,
      profile: profile([
        { tier: "sol", size: "L" },
        { tier: "", size: "M" },
      ]),
    });
  });
  it("ignores obsolete tier fallback references", () => {
    expect(
      parseProfile("gpt", {
        group: "size",
        tiers: [{ tier: "sol", size: "L", fallbacks: { nonsense: true } }],
      }),
    ).toEqual({ ok: true, profile: profile([{ tier: "sol", size: "L" }]) });
  });
  it("rejects explicitly undefined optional labels", () => {
    expect(
      parseProfile("gpt", {
        group: "size",
        tiers: [{ tier: "sol", size: "L", class: undefined }],
      }).ok,
    ).toBe(false);
  });
  it("reports missing labels alongside other structural problems", () => {
    expect(
      parseProfile("gpt", { group: "size", tiers: [{ tier: 7 }] }),
    ).toMatchObject({
      ok: false,
      problem: expect.stringContaining("tiers[0].size"),
    });
    expect(
      parseProfile("gpt", { group: "size", tiers: [{ tier: 7 }] }),
    ).toMatchObject({
      ok: false,
      problem: expect.stringContaining("tiers[0].tier"),
    });
  });
  it("orders diagnostics by numeric array index and deterministically", () => {
    const invalid = {
      group: "size",
      tiers: Array.from({ length: 12 }, () => ({ tier: "sol" })),
    };
    const result = parseProfile("gpt", invalid);
    expect(result).toEqual(parseProfile("gpt", invalid));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.indexOf("tiers[2].size")).toBeLessThan(
      result.problem.indexOf("tiers[10].size"),
    );
  });
});

describe("parseUserProfiles", () => {
  it("rejects malformed families independently", () => {
    const result = parseUserProfiles({ gpt: body, claude: null });
    expect(result.profiles.map((entry) => entry.family)).toEqual(["gpt"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("claude");
  });
  it("accepts absent settings", () => {
    expect(parseUserProfiles(undefined)).toEqual({
      profiles: [],
      problems: [],
    });
  });
});

describe("mergeProfiles", () => {
  const global = profile([{ tier: "sol", size: "L" }]);
  const project = profile([{ tier: "luna", size: "S" }]);
  it("replaces whole families and gives the project layer precedence", () => {
    const result = mergeProfiles(
      SHIPPED_PROFILES,
      [global],
      [project],
      strategies,
    );
    expect(result.problems).toEqual([]);
    expect(result.profiles.get("gpt")).toEqual(project);
    expect(result.profiles.get("claude")).toBe(
      SHIPPED_PROFILES.find((entry) => entry.family === "claude"),
    );
  });
  it("refuses unknown naming structures without disturbing other families", () => {
    const result = mergeProfiles(
      SHIPPED_PROFILES,
      [{ ...global, family: "unknown" }],
      [],
      strategies,
    );
    expect(result.problems).toHaveLength(1);
    expect(result.profiles.has("unknown")).toBe(false);
  });
  it.each([
    profile([]),
    profile([
      { tier: "sol", size: "L" },
      { tier: "sol", size: "M" },
    ]),
    profile([{ tier: "gpt-7-sol", size: "L" }]),
    profile([{ tier: "7", size: "L" }]),
    profile([{ tier: "sol" }]),
    { ...global, family: "GPT" },
    {
      family: "claude",
      group: "size",
      tiers: [{ tier: "", size: "M" }],
    } as FamilyProfile,
  ])("refuses invalid domain relationships: %j", (invalid) => {
    expect(
      validateProfile(invalid, strategies.get(invalid.family)).length,
    ).toBeGreaterThan(0);
    const result = mergeProfiles(SHIPPED_PROFILES, [invalid], [], strategies);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.profiles.get("gpt")).toBe(
      SHIPPED_PROFILES.find((entry) => entry.family === "gpt"),
    );
  });
  it("validates normalized tier names", () => {
    const parsed = parseProfile("gpt", {
      group: "size",
      tiers: [{ tier: " sol ", size: "L" }],
    });
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(
      mergeProfiles([], [parsed.profile], [], strategies).problems,
    ).toEqual([]);
  });
});

describe("shipped ladders", () => {
  it("contain no release catalogue or concrete model identities", () => {
    for (const entry of SHIPPED_PROFILES) {
      expect(Object.keys(entry).sort()).toEqual(["family", "group", "tiers"]);
      expect(validateProfile(entry, strategies.get(entry.family))).toEqual([]);
      for (const tier of entry.tiers)
        expect(Object.keys(tier).sort()).toEqual(
          [entry.group === "size" ? "size" : "class", "tier"].sort(),
        );
    }
  });
  it("preserves the user's Luna S correction across releases", () => {
    expect(
      SHIPPED_PROFILES.find((entry) => entry.family === "gpt")?.tiers.find(
        (entry) => entry.tier === "luna",
      )?.size,
    ).toBe("S");
  });
});
