import { describe, expect, it } from "vitest";

import { getCommandSuggestions } from "./command";

describe("getCommandSuggestions", () => {
  it("returns real suggestions from NuShell", async () => {
    const suggestions = await getCommandSuggestions("");

    expect(suggestions).not.toBeNull();
    expect(suggestions?.items.length).toBeGreaterThan(0);
  }, 30_000);

  it("returns real suggestions from NuShell based on ", async () => {
    const suggestions = await getCommandSuggestions("each");

    expect(suggestions).not.toBeNull();
    expect(suggestions?.items.length).toBeGreaterThan(0);
  }, 30_000);

  describe("suggestions are returned based on prefix", () => {
    it.for(["each", "str", "path"])(
      "returns suggestions based on prefix %s",
      async (prefix) => {
        const suggestions = await getCommandSuggestions(prefix);

        expect(suggestions).not.toBeNull();
        expect(suggestions?.items.length).toBeGreaterThan(0);
        expect(suggestions?.items.every((item) => item.value.startsWith(prefix))).toBe(true);
      },
    );
  });

  describe("marks command as requires closure when it does", () => {
    it.for(["each", "do", "group-by", "sort-by", "par-each"])(
      "returns suggestions based on prefix %s",
      async (prefix) => {
        const suggestions = await getCommandSuggestions(prefix);

        expect(suggestions).not.toBeNull();
        expect(suggestions?.items.length).toBeGreaterThan(0);
        expect(suggestions?.items.every((item) => item.value.startsWith(prefix))).toBe(true);

        expect(suggestions?.items.every((item) => item.requiresClosure)).toBe(true);
      },
    );
  });
});
