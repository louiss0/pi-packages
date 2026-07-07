import { describe, expect, it } from "vitest";

import { parsePlaceholders } from "./prompt-parser";

describe("parsePlaceholders", () => {
  it.each([
    ["Hello $1", [{ kind: "single", position: 1 }]],
    [
      "Hello ${1:-default}",
      [{ kind: "default", position: 1, value: "default" }],
    ],
    [
      "Hello ${@:2}",
      [{ kind: "slice", start: 2, end: Number.POSITIVE_INFINITY }],
    ],
    ["Hello ${@:2:3}", [{ kind: "slice", start: 2, end: 4 }]],
    ["Hello $ARGUMENTS", [{ kind: "named", name: "ARGUMENTS" }]],
  ])("parses %s", (content, expected) => {
    expect(parsePlaceholders(content)).toEqual(expected);
  });
});
