import { describe, expect, it } from "vitest";

import { getHistoryQuery, parseHistoryCommands, shouldIncludeHistoryCommand } from "./history";

describe("history helpers", () => {
  it("builds the last-100 history query", () => {
    expect(getHistoryQuery()).toBe(
      "history | where command !~ '(?i)^\\s*pi\\b' | last 100 | get command | to json",
    );
  });

  it("keeps only non-empty commands that are not pi invocations", () => {
    expect(
      parseHistoryCommands(
        JSON.stringify([
          "ls",
          "",
          1,
          null,
          "pwd",
          "pi",
          "PI tools",
          "pip install",
          "echo pi",
        ]),
      ),
    ).toEqual(["ls", "pwd", "pip install", "echo pi"]);
  });

  it("never allows pi commands into the command list", () => {
    expect(shouldIncludeHistoryCommand("pi")).toBe(false);
    expect(shouldIncludeHistoryCommand("PI tools list")).toBe(false);
    expect(shouldIncludeHistoryCommand("  pi --help")).toBe(false);
    expect(shouldIncludeHistoryCommand("pnpm nx test")).toBe(true);
    expect(shouldIncludeHistoryCommand("pip install")).toBe(true);
    expect(shouldIncludeHistoryCommand("echo pi")).toBe(true);
  });

});
