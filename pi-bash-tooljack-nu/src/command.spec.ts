import { describe, expect, it } from "vitest";

import { getCommandSuggestions } from "./command";

describe("getCommandSuggestions", () => {
  it("returns real suggestions from NuShell", async () => {
    const suggestions = await getCommandSuggestions("");

    expect(suggestions?.items.length).toBeGreaterThan(0);
  }, 30_000);

  it("returns real suggestions from NuShell based on ", async () => {
    const suggestions = await getCommandSuggestions("each");

    expect(suggestions?.items.length).toBeGreaterThan(0);
  }, 30_000);

  describe("suggestions are returned based on prefix", () => {
    it.for(["each", "str", "path"])(
      "returns suggestions based on prefix %s",
      async (prefix) => {
        const suggestions = await getCommandSuggestions(prefix);

        expect(suggestions?.items.length).toBeGreaterThan(0);
        expect(
          suggestions?.items.some((item) => item.value.startsWith(prefix)),
        ).toBe(true);
      },
    );
  });

  describe("marks command as requires closure when it does", () => {
    it.for(["each", "do", "group-by", "sort-by", "par-each"])(
      "returns suggestions based on prefix %s",
      async (prefix) => {
        const suggestions = await getCommandSuggestions(prefix);
        const prefixItems = suggestions?.items.filter((item) =>
          item.value.startsWith(prefix),
        );

        expect(prefixItems?.length).toBeGreaterThan(0);
        expect(prefixItems?.every((item) => item.requiresClosure)).toBe(true);
      },
    );
  });

  it("returns null when are no commands available", async () => {
    const result = await getCommandSuggestions("bobobobobo");

    expect(result).toBeNull();
  }, 30_000);

  describe("How it returns results based on category", () => {
    it.for(["strings", "math", "filesystem", "random", "formats"])(
      "returns suggestions based on category %s",
      async (prefix) => {
        const result = await getCommandSuggestions(prefix);

        expect(result?.items.length).toBeGreaterThan(0);
      },
    );
  });

  describe("How it returns results based on search terms", () => {
    it.for([
      "aka",
      "every",
      "colors",
      "some",
      "concatenate",
      "slice",
      "search",
      "parse",
      "convert",
      "regex",
    ])("returns suggestions based on search_terms %s", async (prefix) => {
      const result = await getCommandSuggestions(prefix);

      expect(result?.items.length).toBeGreaterThan(0);
    });
  });
});
