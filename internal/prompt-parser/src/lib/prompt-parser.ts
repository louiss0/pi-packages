export function parseTemplate(markdown: string): { argumentHint: string; content: string } {
  return { argumentHint: "", content: "" };
}

type Argument = { name: string; required: boolean; position: number };

export class InvalidArgumentHintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentHintError";
  }
}

export function parseArgumentHint(
  unparsedArgumentHint: string,
): Array<Argument> | InvalidArgumentHintError {
  return [];
}

type Placeholder =
  | { kind: "single"; position: number }
  | { kind: "slice"; start: number; end: number }
  | { kind: "named"; name: "ARGUMENTS" }
  | { kind: "rest" };

export class InvalidPlaceholderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlaceholderError";
  }
}

export function parsePlaceholders(
  markdownContent: string,
): Array<Placeholder> | InvalidPlaceholderError {
  return [];
}
