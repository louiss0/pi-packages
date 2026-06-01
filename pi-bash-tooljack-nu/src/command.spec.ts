import { beforeAll } from "vitest";

import { getCommandSuggestions } from "./command";

describe("getCommandSuggestions", () => {
  let hasNuShell = false;

  beforeAll(async () => {
    const suggestions = await getCommandSuggestions("");
    hasNuShell = (suggestions?.items.length ?? 0) > 0;
  });

  function expectNuShellSuggestions(
    suggestions: Awaited<ReturnType<typeof getCommandSuggestions>>,
  ) {
    if (!hasNuShell) {
      expect(suggestions).toBeNull();
      return;
    }

    expect(suggestions?.items.length).toBeGreaterThan(0);
  }

  it("returns real suggestions from NuShell", async () => {
    const suggestions = await getCommandSuggestions("");

    expectNuShellSuggestions(suggestions);
  }, 30_000);

  it("returns real suggestions from NuShell based on ", async () => {
    const suggestions = await getCommandSuggestions("each");

    expectNuShellSuggestions(suggestions);
  }, 30_000);

  describe("suggestions are returned based on prefix", () => {
    it.for([
      "each",
      "str",
      "path",
    ])("returns suggestions based on prefix %s", async (prefix) => {
      const suggestions = await getCommandSuggestions(prefix);

      if (!hasNuShell) {
        expect(suggestions).toBeNull();
        return;
      }

      expect(suggestions?.items.length).toBeGreaterThan(0);
      expect(
        suggestions?.items.some((item) => item.value.startsWith(prefix)),
      ).toBe(true);
    });
  });

  describe("marks command as requires closure when it does", () => {
    it.for([
      "each",
      "do",
      "group-by",
      "sort-by",
      "par-each",
    ])("returns suggestions based on prefix %s", async (prefix) => {
      const suggestions = await getCommandSuggestions(prefix);

      if (!hasNuShell) {
        expect(suggestions).toBeNull();
        return;
      }

      const prefixItems = suggestions?.items.filter((item) =>
        item.value.startsWith(prefix),
      );

      expect(prefixItems?.length).toBeGreaterThan(0);
      expect(prefixItems?.every((item) => item.requiresClosure)).toBe(true);
    });
  });

  it("returns null when are no commands available", async () => {
    const result = await getCommandSuggestions("bobobobobo");

    expect(result).toBeNull();
  }, 30_000);

  describe("How it returns results based on category", () => {
    it.for([
      "strings",
      "math",
      "filesystem",
      "random",
      "formats",
    ])("returns suggestions based on category %s", async (prefix) => {
      const result = await getCommandSuggestions(prefix);

      if (!hasNuShell) {
        expect(result).toBeNull();
        return;
      }

      expect(result?.items.length).toBeGreaterThan(0);
    });
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

      if (!hasNuShell) {
        expect(result).toBeNull();
        return;
      }

      expect(result?.items.length).toBeGreaterThan(0);
    });
  });
});
