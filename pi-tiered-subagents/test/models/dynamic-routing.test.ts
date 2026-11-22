import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { parseProfile } from "#src/models/user-profiles";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { routeModel } from "#src/models/router";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";

const strategies = strategiesByFamily(SHIPPED_STRATEGIES);
const profiles = new Map(
  SHIPPED_PROFILES.map((profile) => [profile.family, profile]),
);
const model = (provider: string, id: string) =>
  ({ provider, id, name: id }) as Model<any>;
function route(parent: string, available: Model<any>[], role = "explore") {
  return routeModel(
    model("parent", parent),
    { strategies, profiles, available },
    role,
  );
}

describe("version-independent family ladders", () => {
  it("stops Claude's version at the first qualifier", () => {
    expect(
      route("claude-opus-77-3-code-2", [
        model("parent", "claude-haiku-77-3-2"),
        model("parent", "claude-haiku-77-3"),
      ]),
    ).toMatchObject({ kind: "routed", modelId: "claude-haiku-77-3" });
  });

  it("routes a dated Claude parent to the exact unqualified same-version target", () => {
    expect(
      route("claude-opus-77-3-20261027", [
        model("parent", "claude-haiku-77-3-20261027"),
        model("parent", "claude-haiku-77-3"),
      ]),
    ).toMatchObject({ kind: "routed", modelId: "claude-haiku-77-3" });
  });

  it("does not substitute a dated candidate for an exact base identity", () => {
    expect(
      route("claude-opus-77-3-20261027", [
        model("parent", "claude-haiku-77-3-20261027"),
      ]),
    ).toMatchObject({
      kind: "retained",
      model: { id: "claude-opus-77-3-20261027" },
    });
  });

  it.each([
    ["gpt-77.3-sol-code-2", "gpt-77.3-luna"],
    ["gemini-77.3-krypton-code-2", "gemini-77.3-hydrogen"],
    ["mimo-v77.3-pro-ultraspeed-serving-2", "mimo-v77.3-flash"],
    ["MiniMax-M77.3-highspeed", "MiniMax-M77.3-flash"],
  ])("routes qualified/multiword parent %s to exact %s", (parent, target) => {
    expect(route(parent, [model("parent", target)])).toMatchObject({
      kind: "routed",
      modelId: target,
    });
  });
  it("retains an unsupported qualified Flash parent", () => {
    const parent = "gemini-77.3-flash-lite-20261027";
    expect(
      route(parent, [model("parent", "gemini-77.3-flash-lite")], "debug"),
    ).toMatchObject({
      kind: "retained",
      model: { id: parent },
    });
  });
  it("routes Gemini Krypton workers to same-version Carbon", () => {
    expect(
      route(
        "gemini-77.3-krypton",
        [
          model("parent", "gemini-78-carbon"),
          model("parent", "gemini-77.3-carbon"),
        ],
        "worker",
      ),
    ).toMatchObject({ kind: "routed", modelId: "gemini-77.3-carbon" });
  });
  it("routes Gemini Carbon workers to same-version Argon rather than another release", () => {
    expect(
      route(
        "gemini-77.3-carbon",
        [
          model("parent", "gemini-78-argon"),
          model("parent", "gemini-77.3-argon"),
          model("parent", "gemini-77.3-hydrogen"),
        ],
        "worker",
      ),
    ).toMatchObject({ kind: "routed", modelId: "gemini-77.3-argon" });
  });
  it.each([
    ["gemini-77.3-argon", "worker", "gemini-77.3-hydrogen"],
    ["gemini-77.3-hydrogen", "worker", "gemini-77.3-hydrogen"],
  ])("routes %s for %s to %s", (parent, role, target) => {
    expect(route(parent, [model("parent", target)], role)).toMatchObject({
      kind: "routed",
      modelId: target,
    });
  });
  it("retains Gemini Carbon when only another version has a target", () => {
    expect(
      route(
        "gemini-77.3-carbon",
        [model("parent", "gemini-78-argon")],
        "worker",
      ),
    ).toMatchObject({ kind: "retained", model: { id: "gemini-77.3-carbon" } });
  });
  it("accepts a ladder without releases or concrete identities", () => {
    expect(
      parseProfile("gpt", {
        group: "size",
        tiers: [
          { tier: "sol", size: "L" },
          { tier: "luna", size: "S" },
        ],
      }).ok,
    ).toBe(true);
  });
  it("constructs an unseen GPT release exactly", () => {
    expect(
      route("gpt-77.3-sol", [model("parent", "gpt-77.3-luna")]),
    ).toMatchObject({ kind: "routed", modelId: "gpt-77.3-luna" });
  });
  it("constructs Claude with the line before the version", () => {
    expect(
      route("claude-opus-77-3", [model("parent", "claude-haiku-77-3")]),
    ).toMatchObject({ kind: "routed", modelId: "claude-haiku-77-3" });
  });
  it("prefers the parent provider independent of registry order", () => {
    expect(
      route("gpt-77-sol", [
        model("other", "gpt-77-luna"),
        model("parent", "gpt-77-luna"),
      ]),
    ).toMatchObject({ kind: "routed", provider: "parent" });
  });
  it("accepts a unique alternate provider", () => {
    expect(route("gpt-77-sol", [model("other", "gpt-77-luna")])).toMatchObject({
      kind: "routed",
      provider: "other",
    });
  });
  it("skips ambiguous providers and tries a cheaper same-version rung", () => {
    expect(
      route("gpt-77-sol", [
        model("a", "gpt-77-luna"),
        model("b", "gpt-77-luna"),
        model("c", "gpt-77-mini"),
      ]),
    ).toMatchObject({ kind: "routed", modelId: "gpt-77-mini", provider: "c" });
  });
  it("skips ambiguous providers, then walks down versions", () => {
    expect(
      route("gpt-77-sol", [
        model("a", "gpt-77-luna"),
        model("b", "gpt-77-luna"),
        model("parent", "gpt-76-mini"),
      ]),
    ).toMatchObject({
      kind: "routed",
      modelId: "gpt-76-mini",
      provider: "parent",
    });
  });
  it("retains when no lower version has a runnable rung", () => {
    expect(
      route("gpt-77-sol", [
        model("a", "gpt-77-luna"),
        model("b", "gpt-77-luna"),
        model("parent", "gpt-78-mini"),
      ]),
    ).toMatchObject({ kind: "retained", model: { id: "gpt-77-sol" } });
  });
});
