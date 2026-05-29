import {
  parseTemplate,
  parsePlaceholders,
  parseArgumentHint,
  InvalidArgumentHintError,
  InvalidPlaceholderError,
} from "./prompt-parser.js";

describe("parseTemplate", () => {
  it("should work", () => {
    const markdown = `---
argument-hint: <project>
---
This is the content.
`;

    expect(parseTemplate(markdown)).toEqual({
      argumentHint: "<project>",
      content: "This is the content.",
    });
  });
});

describe("parseArgumentHint", () => {
  it("should work", () => {
    expect(parseArgumentHint("<project-name>")).toEqual([
      { name: "project-name", required: true, position: 1 },
    ]);
  });

  it("should work with multiple arguments", () => {
    expect(parseArgumentHint("<project-name> <project-version>")).toEqual([
      { name: "project-name", required: true, position: 1 },
      { name: "project-version", required: true, position: 2 },
    ]);
  });

  it("should work with optional arguments", () => {
    expect(parseArgumentHint("<project-name> [project-version]")).toEqual([
      { name: "project-name", required: true, position: 1 },
      { name: "project-version", required: false, position: 2 },
    ]);
  });

  it("should work with optional arguments at the end", () => {
    expect(parseArgumentHint("<project-name> [project-version] [project-]")).toEqual([
      { name: "project-name", required: true, position: 1 },
      { name: "project-version", required: false, position: 2 },
      { name: "project-", required: false, position: 3 },
    ]);
  });

  it("should return an error when a hint is invalid", () => {
    const result = parseArgumentHint("<project-name> [project-version");

    assertError(result, InvalidArgumentHintError);

    expect(result).toHaveProperty("message", "Invalid argument hint: [project-version");
  });

  it("should return an error when optional arguments are not at the end", () => {
    const result = parseArgumentHint("<project-name> [project-version] <project>");

    assertError(result, InvalidArgumentHintError);

    expect(result).toHaveProperty(
      "message",
      "Invalid argument hint: <project-name> [project-version] <project> all optional arguments must be at the end",
    );
  });
});

describe("parsePlaceholders", () => {
  it("should work", () => {
    expect(parsePlaceholders("$1")).toEqual([{ kind: "single", position: 1 }]);
  });

  it("should work with multiple placeholders", () => {
    expect(parsePlaceholders("$1 $2")).toEqual([
      { kind: "single", position: 1 },
      { kind: "single", position: 2 },
    ]);
  });

  describe("should work with slice placeholders", () => {
    it.for([
      {
        input: "{@:2}",
        expected: [{ kind: "slice", start: 2, end: Infinity }],
      },
      { input: "{@:2:5}", expected: [{ kind: "slice", start: 2, end: 5 }] },
    ])("For $input $expected.kind is $expected.start/$expected.end", ({ input, expected }) => {
      expect(parsePlaceholders(input)).toEqual(expected);
    });
  });

  it("should work with named placeholders", () => {
    expect(parsePlaceholders("$ARGUMENTS")).toEqual([{ kind: "named", name: "ARGUMENTS" }]);
  });

  it("should work with all placeholder", () => {
    expect(parsePlaceholders("$@")).toEqual([{ kind: "rest" }]);
  });

  describe("should return an error when the placeholder is invalid", () => {
    it.for([
      {
        input: "$\\1",
        expected: new InvalidPlaceholderError(
          "Invalid placeholder: $\\1 don't escape placeholders",
        ),
      },
      {
        input: "$\\2",
        expected: new InvalidPlaceholderError(
          "Invalid placeholder: $\\2 don't escape placeholders",
        ),
      },
      {
        input: "$\\3",
        expected: new InvalidPlaceholderError(
          "Invalid placeholder: $\\3 don't escape placeholders",
        ),
      },
      {
        input: "${1}",
        expected: new InvalidPlaceholderError(
          "Invalid placeholder: ${1} don't wrap placeholders in braces",
        ),
      },
      {
        input: "${2}",
        expected: new InvalidPlaceholderError(
          "Invalid placeholder: ${2} don't wrap placeholders in braces",
        ),
      },
    ])("For $input, expected $expected.message", ({ input, expected }) => {
      const result = parsePlaceholders(input);

      assertError(result, InvalidPlaceholderError);

      expect(result).toHaveProperty("message", expected.message);
    });
  });

  it("should return an error when args and rest are used together ", () => {
    const result = parsePlaceholders("$@ $ARGUMENTS");

    assertError(result, InvalidPlaceholderError);
    expect(result).toHaveProperty(
      "message",
      "Invalid placeholder: $@ $ARGUMENTS don't mix args and rest placeholders",
    );
  });
});

function assertError<T extends new (...args: never[]) => Error>(
  result: unknown,
  error: T,
): asserts result is InstanceType<T> {
  expect(result).toBeInstanceOf(error.constructor);
}
