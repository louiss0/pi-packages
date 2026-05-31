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

type Argument = { name: string; required: boolean; position: number };

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
  const argumentHint = typeof argumentHintValue === "string" ? argumentHintValue : "";

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
        return new InvalidArgumentHintError(`Invalid argument hint: ${argumentHint}`);
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
        return new InvalidArgumentHintError(`Invalid argument hint: ${argumentHint}`);
      }

      foundOptionalArgument = true;
      parsedArguments.push({
        name,
        required: false,
        position: index + 1,
      });

      continue;
    }

    return new InvalidArgumentHintError(`Invalid argument hint: ${argumentHint}`);
  }

  return parsedArguments;
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

const PLACEHOLDER_PATTERN = /\{@:([0-9]+)(?::([0-9]+))?\}|\$ARGUMENTS|\$@|\$([0-9]+)/g;

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

  for (const match of markdownContent.matchAll(PLACEHOLDER_PATTERN)) {
    const [placeholder, sliceStart, sliceEnd, singlePosition] = match;

    if (placeholder === "$ARGUMENTS") {
      placeholders.push({ kind: "named", name: "ARGUMENTS" });
      continue;
    }

    if (placeholder === "$@") {
      placeholders.push({ kind: "rest" });
      continue;
    }

    if (singlePosition) {
      placeholders.push({ kind: "single", position: Number(singlePosition) });
      continue;
    }

    if (sliceStart) {
      placeholders.push({
        kind: "slice",
        start: Number(sliceStart),
        end: sliceEnd ? Number(sliceEnd) : Number.POSITIVE_INFINITY,
      });
    }
  }

  const hasRestPlaceholder = placeholders.some((placeholder) => placeholder.kind === "rest");
  const hasArgumentsPlaceholder = placeholders.some(
    (placeholder) => placeholder.kind === "named" || placeholder.kind === "single" || placeholder.kind === "slice",
  );

  if (hasRestPlaceholder && hasArgumentsPlaceholder) {
    return new InvalidPlaceholderError(
      `Invalid placeholder: ${markdownContent} don't mix args and rest placeholders`,
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
