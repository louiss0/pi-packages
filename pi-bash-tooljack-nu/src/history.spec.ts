import {
  buildHistoryItems,
  getHistoryQuery,
  HISTORY_LIMIT,
  parseHistoryCommands,
  updateHistoryFilter,
} from "./history";

describe("history helpers", () => {
  it("builds the last-100 history query", () => {
    expect(getHistoryQuery()).toBe(
      `history | where command !~ '(?i)pi' | last ${HISTORY_LIMIT} | get command | to json`,
    );
  });

  it("keeps only non-empty string commands", () => {
    expect(parseHistoryCommands(JSON.stringify(["ls", "", 1, null, "pwd"]))).toEqual([
      "ls",
      "pwd",
    ]);
  });

  it("reverses history items so the newest command is first", () => {
    expect(buildHistoryItems(["older", "newer"])).toEqual([
      { value: "newer", label: "newer", description: "2" },
      { value: "older", label: "older", description: "1" },
    ]);
  });

  it("updates the inline filter from typed input", () => {
    expect(updateHistoryFilter("git", " ")).toBe("git ");
    expect(updateHistoryFilter("git ", "s")).toBe("git s");
    expect(updateHistoryFilter("git s", "\u007f")).toBe("git ");
    expect(updateHistoryFilter("git ", "\u0015")).toBe("");
    expect(updateHistoryFilter("git", "\u001b[A")).toBe("git");
  });
});
