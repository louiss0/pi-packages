import { describe, expect, it } from "vitest";

import {
  getHistoryQuery,
  HISTORY_LIMIT,
  parseHistoryCommands,
  shouldIncludeHistoryCommand,
  updateHistoryFilter,
} from "./history";

describe("history helpers", () => {
  it("builds the last-100 history query", () => {
    expect(getHistoryQuery()).toBe(
      `history | where command !~ '(?i)^\\s*pi\\b' | last ${HISTORY_LIMIT} | get command | to json`,
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

  it("updates the inline filter from typed input", () => {
    expect(updateHistoryFilter("git", " ")).toBe("git ");
    expect(updateHistoryFilter("git ", "s")).toBe("git s");
    expect(updateHistoryFilter("git s", "\u007f")).toBe("git ");
    expect(updateHistoryFilter("git ", "\u0015")).toBe("");
    expect(updateHistoryFilter("git", "\u001b[A")).toBe("git");
  });
});
