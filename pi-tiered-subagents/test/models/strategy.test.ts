import { describe, expect, it } from "vitest";
import {
  candidateJoins,
  matchesTier,
  mostSpecificTier,
  SHIPPED_STRATEGIES,
  strategiesByFamily,
} from "#src/models/strategy";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);

/** The parts a family's strategy reads out of an id. */
function parse(family: string, id: string) {
  const strategy = strategies.get(family);
  if (!strategy) throw new Error(`no strategy for ${family}`);
  return strategy.parse(id);
}

describe("the GPT naming structure", () => {
  it("reads a version and a tier", () => {
    expect(parse("gpt", "gpt-6.1-sol")).toEqual({
      family: "gpt",
      version: "6.1",
      tierCandidates: ["sol"],
    });
  });

  it("reads a version with no tier", () => {
    expect(parse("gpt", "gpt-5.5")).toEqual({
      family: "gpt",
      version: "5.5",
      tierCandidates: [],
    });
  });

  it("reads a two-word tier as its segments", () => {
    expect(parse("gpt", "gpt-5.3-codex-spark")?.tierCandidates).toEqual([
      "codex",
      "spark",
    ]);
  });

  it("does not read a version out of a name that is not one", () => {
    expect(parse("gpt", "gpt-4o-2024-08-06")).toBeUndefined();
  });

  it("rejects an id of another family", () => {
    expect(parse("gpt", "claude-opus-5")).toBeUndefined();
  });
});

describe("the Claude naming structure", () => {
  it("reads the line before the version", () => {
    expect(parse("claude", "claude-opus-5")).toEqual({
      family: "claude",
      version: "5",
      tierCandidates: ["opus"],
    });
  });

  it("joins the version's segments", () => {
    expect(parse("claude", "claude-sonnet-4-5")).toEqual({
      family: "claude",
      version: "4.5",
      tierCandidates: ["sonnet"],
    });
  });

  it("keeps a dated snapshot's date out of the version", () => {
    expect(parse("claude", "claude-haiku-4-5-20251001")).toEqual({
      family: "claude",
      version: "4.5",
      tierCandidates: ["haiku"],
    });
  });

  it("rejects an id whose line is a number", () => {
    expect(parse("claude", "claude-3-5-sonnet-20241022")).toBeUndefined();
  });
});

describe("the Gemini naming structure", () => {
  it("reads a version and a variant", () => {
    expect(parse("gemini", "gemini-3.1-pro-preview")).toEqual({
      family: "gemini",
      version: "3.1",
      tierCandidates: ["pro", "preview"],
    });
  });

  it("reads a two-word variant as its segments", () => {
    expect(parse("gemini", "gemini-2.5-flash-lite")?.tierCandidates).toEqual([
      "flash",
      "lite",
    ]);
  });
});

describe("the GLM naming structure", () => {
  it("reads the catalogue flagship and flash variant", () => {
    expect(parse("glm", "glm-5.3")).toEqual({
      family: "glm",
      version: "5.3",
      tierCandidates: [],
    });
    expect(parse("glm", "glm-5.3-flash")?.tierCandidates).toEqual(["flash"]);
  });
});

describe("the MiniMax naming structure", () => {
  it("reads a capitalized id", () => {
    expect(parse("minimax", "MiniMax-M2.7")).toEqual({
      family: "minimax",
      version: "2.7",
      tierCandidates: [],
    });
  });

  it("reads a serving variant", () => {
    expect(parse("minimax", "MiniMax-M2.7-highspeed")?.tierCandidates).toEqual([
      "highspeed",
    ]);
  });
});

describe("the Qwen naming structure", () => {
  it("reads a version glued to the name", () => {
    expect(parse("qwen", "qwen3.7-max")).toEqual({
      family: "qwen",
      version: "3.7",
      tierCandidates: ["max"],
    });
  });
});

describe("the DeepSeek naming structure", () => {
  it("reads the version behind its letter", () => {
    expect(parse("deepseek", "deepseek-v4.1-flash")).toEqual({
      family: "deepseek",
      version: "4.1",
      tierCandidates: ["flash"],
    });
  });

  it("cannot place an id that names no version", () => {
    expect(parse("deepseek", "deepseek-flash")).toBeUndefined();
  });
});

describe("the MiMo naming structure", () => {
  it("reads the version behind its letter", () => {
    expect(parse("mimo", "mimo-v2.6-pro")).toEqual({
      family: "mimo",
      version: "2.6",
      tierCandidates: ["pro"],
    });
  });
});

describe("the shipped strategies", () => {
  it("cover the eight agreed families", () => {
    expect([...strategies.keys()].sort()).toEqual([
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

  it("place no id in two families", () => {
    for (const id of ["gpt-6.1-sol", "claude-opus-5", "glm-5.3-flash"]) {
      const families = SHIPPED_STRATEGIES.filter(
        (strategy) => strategy.parse(id) !== undefined,
      );
      expect(families).toHaveLength(1);
    }
  });
});

describe("candidateJoins", () => {
  it("yields the segments and their joins", () => {
    expect(candidateJoins(["flash", "lite"])).toEqual([
      "flash",
      "flash-lite",
      "lite",
    ]);
  });

  it("yields the empty name for a model with no segment", () => {
    expect(candidateJoins([])).toEqual([""]);
  });
});

describe("matchesTier", () => {
  it("matches a segment", () => {
    expect(matchesTier(["sol"], "sol")).toBe(true);
  });

  it("matches a join", () => {
    expect(matchesTier(["flash", "lite"], "flash-lite")).toBe(true);
  });

  it("matches a tier the model qualifies further", () => {
    expect(matchesTier(["code", "highspeed"], "code")).toBe(true);
  });

  it("does not match a name the model does not carry", () => {
    expect(matchesTier(["pro"], "flash")).toBe(false);
  });

  it("matches the default rung for a model with no segment", () => {
    expect(matchesTier([], "")).toBe(true);
    expect(matchesTier(["sol"], "")).toBe(false);
  });
});

describe("mostSpecificTier", () => {
  it("prefers the longest tier the model names", () => {
    expect(mostSpecificTier(["flash", "lite"], ["flash", "flash-lite"])).toBe(
      "flash-lite",
    );
  });

  it("returns undefined when the model names no tier", () => {
    expect(mostSpecificTier(["pro"], ["flash", "sol"])).toBeUndefined();
  });
});
