import { describe, expect, it } from "vitest";
import { resolveInvocation } from "#src/agents/invocation";
import type { AgentDefinition } from "#src/agents/definition";

/** A definition with every field set, to layer requests onto. */
const DEFINITION: AgentDefinition = {
  id: "worker",
  displayName: "Worker",
  description: "Implements a scoped change",
  instructions: "Do the work.",
  tools: { kind: "inherit" },
  model: "anthropic/claude-sonnet-5",
  thinking: "medium",
  maxTurns: 12,
  inheritContext: false,
  runInBackground: true,
  enabled: true,
  origin: "shipped",
};

describe("resolveInvocation", () => {
  it("takes the definition's values when the request names none", () => {
    const resolved = resolveInvocation(DEFINITION, {});
    expect(resolved.model).toBe("anthropic/claude-sonnet-5");
    expect(resolved.modelFromParams).toBe(false);
    expect(resolved.thinking).toBe("medium");
    expect(resolved.maxTurns).toBe(12);
    expect(resolved.inheritContext).toBe(false);
    expect(resolved.runInBackground).toBe(true);
  });

  it("lets the request win over the definition", () => {
    const resolved = resolveInvocation(DEFINITION, {
      model: "anthropic/claude-opus-5",
      thinking: "high",
      maxTurns: 3,
      inheritContext: true,
      runInBackground: false,
    });
    expect(resolved.model).toBe("anthropic/claude-opus-5");
    expect(resolved.modelFromParams).toBe(true);
    expect(resolved.thinking).toBe("high");
    expect(resolved.maxTurns).toBe(3);
    expect(resolved.inheritContext).toBe(true);
    expect(resolved.runInBackground).toBe(false);
  });

  it("fills only the fields the request leaves out", () => {
    const resolved = resolveInvocation(DEFINITION, { thinking: "low" });
    expect(resolved.thinking).toBe("low");
    expect(resolved.model).toBe("anthropic/claude-sonnet-5");
    expect(resolved.maxTurns).toBe(12);
  });

  it("names no model when neither the request nor the definition does", () => {
    // The definition with no model key at all, rather than one whose key holds
    // undefined: "no model was named" is the absence, not a value of nothing.
    const { model: _named, ...unnamed } = DEFINITION;
    const resolved = resolveInvocation(unnamed, {});
    expect(resolved.model).toBeUndefined();
    expect(resolved.modelFromParams).toBe(false);
  });
});
