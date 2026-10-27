import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { parseModelIdentity, resolveExactModel } from "#src/models/identity";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { makeModel } from "#test/helpers/make-model";
import type { FamilyProfile } from "#src/models/profile";
import type { ModelRegistry } from "#src/models/registry";
import { type RoutingContext, routingContext } from "#src/models/router";
import { selectModel } from "#src/models/selection";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";

/** A model in the catalogue's shape. */
function model(provider: string, id: string): Model<any> {
  return { provider, id, name: id } as Model<any>;
}

const SOL = model("openai", "gpt-6.1-sol");
const LUNA = model("openai", "gpt-6-luna");
const SONNET = model("anthropic", "claude-sonnet-5-5");

/** A registry over the given models. */
function registry(available: Model<any>[]): ModelRegistry {
  return {
    find: (provider, id) =>
      available.find((m) => m.provider === provider && m.id === id),
    getAll: () => available,
    getAvailable: () => available,
  };
}

/** The shipped ladders, over the given available models. */
function routing(available: Model<any>[]): RoutingContext {
  return routingContext(
    {
      profiles: new Map(
        (SHIPPED_PROFILES as readonly FamilyProfile[]).map((profile) => [
          profile.family,
          profile,
        ]),
      ),
      strategies: strategiesByFamily(SHIPPED_STRATEGIES),
    },
    available,
  );
}

describe("parseModelIdentity", () => {
  it("splits the provider from the id", () => {
    expect(parseModelIdentity("anthropic/claude-sonnet-5")).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-5",
    });
  });

  it("keeps a namespace separator in the id", () => {
    expect(parseModelIdentity("openrouter/anthropic/claude-sonnet-5")).toEqual({
      provider: "openrouter",
      id: "anthropic/claude-sonnet-5",
    });
  });

  it("refuses a name with no provider", () => {
    expect(parseModelIdentity("claude-sonnet-5")).toBeUndefined();
    expect(parseModelIdentity("")).toBeUndefined();
  });
});

describe("resolveExactModel", () => {
  it("resolves the model it names", () => {
    const resolved = resolveExactModel(
      "anthropic/claude-sonnet-5-5",
      registry([SONNET]),
    );
    expect(typeof resolved !== "string" && resolved.id).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("does not match a shorthand", () => {
    const resolved = resolveExactModel("sonnet", registry([SONNET]));
    expect(typeof resolved === "string").toBe(true);
  });

  it("does not fall back to another provider", () => {
    const resolved = resolveExactModel(
      "openai/claude-sonnet-5-5",
      registry([SONNET]),
    );
    expect(typeof resolved === "string").toBe(true);
  });

  it("does not resolve a model the session cannot run", () => {
    const registry = {
      // The session knows the model, but cannot run it.
      find: () => makeModel({ id: "claude-sonnet-5-5", provider: "anthropic" }),
      getAll: () => [
        makeModel({ id: "claude-sonnet-5-5", provider: "anthropic" }),
      ],
      getAvailable: () => [],
    };
    const resolved = resolveExactModel("anthropic/claude-sonnet-5-5", registry);
    expect(typeof resolved === "string").toBe(true);
  });

  it("says what is available when it cannot resolve", () => {
    const resolved = resolveExactModel("anthropic/nope", registry([SONNET]));
    expect(typeof resolved === "string" && resolved).toContain(
      "anthropic/claude-sonnet-5-5",
    );
  });
});

describe("selectModel", () => {
  it("routes for the resolved agent identifier", () => {
    const result = selectModel(
      { parentModel: SOL, agentId: "reviewer" },
      registry([SOL, LUNA]),
      routing([SOL, LUNA]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.identity).toEqual({
      provider: "openai",
      id: "gpt-6.1-sol",
    });
    expect(result.selection.reason).toContain("reviewer");
  });

  it("takes the request's model over the definition's", () => {
    const result = selectModel(
      {
        requestedModel: "anthropic/claude-sonnet-5-5",
        definitionModel: "openai/gpt-6-luna",
        parentModel: SOL,
      },
      registry([SONNET, LUNA]),
      routing([SOL, SONNET, LUNA]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.source).toBe("request");
    expect(result.selection.modelId).toBe("claude-sonnet-5-5");
  });

  it("takes the definition's model over the automatic routing", () => {
    const result = selectModel(
      {
        definitionModel: "openai/gpt-6-luna",
        parentModel: SOL,
      },
      registry([SOL, LUNA]),
      routing([SOL, LUNA]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.source).toBe("definition");
    expect(result.selection.modelId).toBe("gpt-6-luna");
  });

  it("routes automatically when neither names a model", () => {
    const result = selectModel(
      { parentModel: SOL },
      registry([SOL, LUNA]),
      routing([SOL, LUNA]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.source).toBe("routed");
    expect(result.selection.modelId).toBe("gpt-6-luna");
    expect(result.selection.reason).toContain("gpt-6.1-sol");
  });

  it("reports a model it cannot resolve rather than falling back", () => {
    const result = selectModel(
      { requestedModel: "anthropic/nope", parentModel: SOL },
      registry([SOL]),
      routing([SOL]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Model not found");
  });

  it("reports a definition's model it cannot resolve", () => {
    const result = selectModel(
      { definitionModel: "anthropic/nope", parentModel: SOL },
      registry([SOL]),
      routing([SOL]),
    );
    expect(result.ok).toBe(false);
  });

  it("uses an explicit model for a family it does not know", () => {
    const other = model("acme", "wonder-1");
    const result = selectModel(
      { requestedModel: "acme/wonder-1", parentModel: other },
      registry([other]),
      routing([other]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.modelId).toBe("wonder-1");
  });

  it("reports a parent model it cannot place in a family", () => {
    const other = model("acme", "wonder-1");
    const result = selectModel(
      { parentModel: other },
      registry([other]),
      routing([other]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot place the model");
  });

  it("keeps the parent's model when the ladder has nothing to offer", () => {
    const result = selectModel(
      { parentModel: LUNA },
      registry([LUNA]),
      routing([LUNA]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.source).toBe("inherited");
    expect(result.selection.identity).toEqual({
      provider: LUNA.provider,
      id: LUNA.id,
    });
  });
});
