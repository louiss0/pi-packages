import { isMap, isScalar, parseDocument } from "yaml";

const INVOCATION_KEY = "disable-model-invocation";

function parseSkillInvocationMetadata(markdown: string) {
  const opening = /^(?:\uFEFF)?---[\t ]*\r?\n/.exec(markdown);
  if (!opening)
    throw new Error("Skill frontmatter: missing opening --- fence.");
  const start = opening[0].length;
  const closing = /^---[\t ]*(?:\r?\n|$)/m.exec(markdown.slice(start));
  if (!closing)
    throw new Error("Skill frontmatter: missing closing --- fence.");
  const end = start + closing.index;
  const document = parseDocument(markdown.slice(start, end), {
    keepSourceTokens: true,
  });
  if (document.errors.length || document.warnings.length) {
    throw new Error(
      `Skill frontmatter YAML: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`,
    );
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new Error("Skill frontmatter: expected a YAML mapping.");
  }
  const value = document.get(INVOCATION_KEY, true);
  if (
    document.has(INVOCATION_KEY) &&
    (!isScalar(value) || typeof value.value !== "boolean")
  ) {
    throw new Error(
      "Skill frontmatter: disable-model-invocation must be a boolean.",
    );
  }
  if (isScalar(value) && value.anchor) {
    throw new Error(
      "Skill frontmatter: anchored invocation flags cannot be changed without affecting aliases.",
    );
  }
  return { start, end, opening, document, value };
}

export function isSkillModelInvocationDisabled(markdown: string): boolean {
  return (
    parseSkillInvocationMetadata(markdown).document.get(INVOCATION_KEY) === true
  );
}

/** Change only the invocation control; leave the rest of the skill intact. */
export function setSkillModelInvocationDisabled(
  markdown: string,
  disabled: boolean,
): string {
  const { start, end, opening, document, value } =
    parseSkillInvocationMetadata(markdown);
  const validate = (updated: string) => {
    if (isSkillModelInvocationDisabled(updated) !== disabled) {
      throw new Error(
        "Skill frontmatter: invocation flag was not updated safely.",
      );
    }
    return updated;
  };
  if (isScalar(value) && value.range) {
    return validate(
      `${markdown.slice(0, start + value.range[0])}${disabled}${markdown.slice(start + value.range[1])}`,
    );
  }
  if (
    isMap(document.contents) &&
    document.contents.flow &&
    document.contents.range
  ) {
    const position = start + document.contents.range[1] - 1;
    const token = document.contents.srcToken;
    const lastItem =
      token?.type === "flow-collection" ? token.items.at(-1) : undefined;
    const trailingComma =
      !lastItem?.key && lastItem?.start.some((part) => part.type === "comma");
    const separator =
      document.contents.items.length && !trailingComma ? ", " : "";
    return validate(
      `${markdown.slice(0, position)}${separator}${INVOCATION_KEY}: ${disabled}${markdown.slice(position)}`,
    );
  }
  const newline = opening[0].endsWith("\r\n") ? "\r\n" : "\n";
  const token = document.contents?.srcToken;
  const indentation =
    token?.type === "block-map" ? " ".repeat(token.indent) : "";
  const terminator = /^\.{3}[\t ]*(?:#.*)?(?:\r?\n|$)/m.exec(
    markdown.slice(start, end),
  );
  const position = terminator ? start + terminator.index : end;
  return validate(
    `${markdown.slice(0, position)}${indentation}${INVOCATION_KEY}: ${disabled}${newline}${markdown.slice(position)}`,
  );
}
