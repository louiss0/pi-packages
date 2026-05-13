import {
  getHistoryQuery,
  HISTORY_LIMIT,
  parseHistoryCommands,
  shouldIncludeHistoryCommand,
  updateHistoryFilter,
} from "./history";

import { getCommandSuggestionsFromCommands } from "./index";

describe("history helpers", () => {
  it("builds the last-100 history query", () => {
    expect(getHistoryQuery()).toBe(
      `history | where command !~ '(?i)pi' | last ${HISTORY_LIMIT} | get command | to json`,
    );
  });

  it("keeps only non-empty non-pi string commands", () => {
    expect(
      parseHistoryCommands(JSON.stringify(["ls", "", 1, null, "pwd", "pi", "PI tools"])),
    ).toEqual(["ls", "pwd"]);
  });

  it("never allows pi commands into the command list", () => {
    expect(shouldIncludeHistoryCommand("pi")).toBe(false);
    expect(shouldIncludeHistoryCommand("PI tools list")).toBe(false);
    expect(shouldIncludeHistoryCommand("pnpm nx test")).toBe(true);
  });


  it("updates the inline filter from typed input", () => {
    expect(updateHistoryFilter("git", " ")).toBe("git ");
    expect(updateHistoryFilter("git ", "s")).toBe("git s");
    expect(updateHistoryFilter("git s", "\u007f")).toBe("git ");
    expect(updateHistoryFilter("git ", "\u0015")).toBe("");
    expect(updateHistoryFilter("git", "\u001b[A")).toBe("git");
  });

  it("shows command completion output for command metadata", () => {
    expect(
      getCommandSuggestionsFromCommands(
        [
          { name: "ls", description: "list files" },
          { name: "do", description: "run closure", signature: { input: "closure" } },
          { name: "", description: "ignored" },
        ],
        "",
      ),
    ).toEqual({
      prefix: "",
      items: [
        { value: "ls", label: "ls", description: "list files", requiresClosure: false },
        { value: "do", label: "do", description: "run closure", requiresClosure: true },
      ],
    });
  });
});
