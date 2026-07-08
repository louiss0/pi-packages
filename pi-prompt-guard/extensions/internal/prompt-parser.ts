import { matter } from "gray-matter-es";

export interface ParsedTemplate {
  argumentHint: string;
  content: string;
}

export interface ParsedPrompt {
  argumentHint: string;
  content: string;
  arguments: Argument[];
  placeholders: Placeholder[];
}

type FrontmatterData = {
  "argument-hint"?: unknown;
};

export type Argument = { name: string; required: boolean; position: number };

export class InvalidArgumentHintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentHintError";
  }
}

export function parseTemplate(markdown: string): ParsedTemplate {
  const file = matter(markdown);
  const { content, data } = file;
  const { ["argument-hint"]: argumentHintValue } = data as FrontmatterData;
  const argumentHint =
    typeof argumentHintValue === "string" ? argumentHintValue : "";

  return {
    argumentHint,
    content: content.trim(),
  };
}

export function parseArgumentHint(
  unparsedArgumentHint: string,
): Array<Argument> | InvalidArgumentHintError {
  const trimmedHint = unparsedArgumentHint.trim();

  if (!trimmedHint) {
    return [];
  }

  const argumentsList = trimmedHint.split(/\s+/);
  const parsedArguments: Argument[] = [];
  let foundOptionalArgument = false;

  for (const [index, argumentHint] of argumentsList.entries()) {
    const requiredMatch = /^<([^<>]+)>$/.exec(argumentHint);

    if (requiredMatch) {
      if (foundOptionalArgument) {
        return new InvalidArgumentHintError(
          `Invalid argument hint: ${trimmedHint} all optional arguments must be at the end`,
        );
      }

      const [, name] = requiredMatch;

      if (!name) {
        return new InvalidArgumentHintError(
          `Invalid argument hint: ${argumentHint}`,
        );
      }

      parsedArguments.push({
        name,
        required: true,
        position: index + 1,
      });

      continue;
    }

    const optionalMatch = /^\[([^[\]]+)\]$/.exec(argumentHint);

    if (optionalMatch) {
      const [, name] = optionalMatch;

      if (!name) {
        return new InvalidArgumentHintError(
          `Invalid argument hint: ${argumentHint}`,
        );
      }

      foundOptionalArgument = true;
      parsedArguments.push({
        name,
        required: false,
        position: index + 1,
      });

      continue;
    }

    return new InvalidArgumentHintError(
      `Invalid argument hint: ${argumentHint}`,
    );
  }

  return parsedArguments;
}

export type Placeholder =
  | { kind: "single"; position: number }
  | { kind: "default"; position: number; value: string }
  | { kind: "slice"; start: number; end: number }
  | { kind: "named"; name: "ARGUMENTS" }
  | { kind: "rest" };

export class InvalidPlaceholderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlaceholderError";
  }
}

const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\$ARGUMENTS|\$@|\$[1-9]\d*/g;

// `${1:-fallback}` lets prompts declare an inline default without adding another syntax form.
const DEFAULT_PLACEHOLDER_PATTERN = /^\$\{([1-9]\d*):-([^}]*)\}$/;

// `${@:N}` and `${@:N:L}` expand from a 1-based argument position.
const SLICE_PLACEHOLDER_PATTERN = /^\$\{@:([1-9]\d*)(?::([1-9]\d*))?\}$/;

export function parsePlaceholders(
  markdownContent: string,
): Array<Placeholder> | InvalidPlaceholderError {
  if (/\$\\\d/.test(markdownContent)) {
    const match = /\$\\\d/.exec(markdownContent);

    return new InvalidPlaceholderError(
      `Invalid placeholder: ${match?.[0] ?? markdownContent} don't escape placeholders`,
    );
  }

  if (/\$\{\d+\}/.test(markdownContent)) {
    const match = /\$\{\d+\}/.exec(markdownContent);

    return new InvalidPlaceholderError(
      `Invalid placeholder: ${match?.[0] ?? markdownContent} don't wrap placeholders in braces`,
    );
  }

  const placeholders: Placeholder[] = [];

  for (const placeholder of markdownContent.matchAll(PLACEHOLDER_PATTERN)) {
    const [placeholderText] = placeholder;

    if (placeholderText === "$ARGUMENTS") {
      placeholders.push({ kind: "named", name: "ARGUMENTS" });
      continue;
    }

    if (placeholderText === "$@") {
      placeholders.push({ kind: "rest" });
      continue;
    }

    if (/^\$[1-9]\d*$/.test(placeholderText)) {
      placeholders.push({
        kind: "single",
        position: Number(placeholderText.slice(1)),
      });
      continue;
    }

    const defaultMatch = DEFAULT_PLACEHOLDER_PATTERN.exec(placeholderText);

    if (defaultMatch) {
      const [, position, value] = defaultMatch;

      placeholders.push({
        kind: "default",
        position: Number(position),
        value: value ?? "",
      });

      continue;
    }

    const sliceMatch = SLICE_PLACEHOLDER_PATTERN.exec(placeholderText);

    if (sliceMatch) {
      const [, startText, lengthText] = sliceMatch;
      const start = Number(startText);
      const length = lengthText ? Number(lengthText) : Number.POSITIVE_INFINITY;
      const end =
        length === Number.POSITIVE_INFINITY ? length : start + length - 1;

      placeholders.push({
        kind: "slice",
        start,
        end,
      });
    }
  }

  const hasRestPlaceholder = placeholders.some(
    (placeholder) => placeholder.kind === "rest",
  );
  const hasNamedArgumentsPlaceholder = placeholders.some(
    (placeholder) => placeholder.kind === "named",
  );

  if (hasRestPlaceholder && hasNamedArgumentsPlaceholder) {
    return new InvalidPlaceholderError(
      `Invalid placeholder: ${markdownContent} don't mix $ARGUMENTS and $@ placeholders`,
    );
  }

  return placeholders;
}

export function parsePrompt(markdown: string): ParsedPrompt | Error {
  const template = parseTemplate(markdown);
  const parsedArguments = parseArgumentHint(template.argumentHint);

  if (parsedArguments instanceof InvalidArgumentHintError) {
    return parsedArguments;
  }

  const parsedPlaceholders = parsePlaceholders(template.content);

  if (parsedPlaceholders instanceof InvalidPlaceholderError) {
    return parsedPlaceholders;
  }

  return {
    ...template,
    arguments: parsedArguments,
    placeholders: parsedPlaceholders,
  };
}
