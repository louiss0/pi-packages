import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { setSkillModelInvocationDisabled } from "./skill-invocation";

describe("skill model invocation Markdown updates", () => {
  it.each([
    "# Missing frontmatter",
    "---\nname: review\n",
    "---\nname: [\n---\nBody",
    "---\n- not a mapping\n---\nBody",
    "---\ndisable-model-invocation: true\ndisable-model-invocation: false\n---\nBody",
    "---\ndisable-model-invocation: [true]\n---\nBody",
    "---\ndisable-model-invocation: &flag true\nmetadata:\n  other-control: *flag\n---\nBody",
  ])("refuses malformed skill metadata rather than rewriting it: %s", (original) => {
    expect(() => setSkillModelInvocationDisabled(original, true)).toThrow(
      /frontmatter/i,
    );
  });
  it("preserves an indented root mapping when adding the flag", () => {
    const original =
      "---\n  name: review\n  description: Review code\n---\nBody";
    const updated = setSkillModelInvocationDisabled(original, true);
    expect(updated).toBe(
      "---\n  name: review\n  description: Review code\n  disable-model-invocation: true\n---\nBody",
    );
    expect(parseFrontmatter(updated).frontmatter).toEqual({
      name: "review",
      description: "Review code",
      "disable-model-invocation": true,
    });
  });

  it("inserts the flag before a YAML document terminator", () => {
    const original =
      "---\nname: review\ndescription: Review code\n... # end YAML\n# Retain final comment\n---\nBody";
    const updated = setSkillModelInvocationDisabled(original, true);
    expect(updated).toBe(
      "---\nname: review\ndescription: Review code\ndisable-model-invocation: true\n... # end YAML\n# Retain final comment\n---\nBody",
    );
    expect(parseFrontmatter(updated).frontmatter).toEqual({
      name: "review",
      description: "Review code",
      "disable-model-invocation": true,
    });
  });

  it("handles a trailing comma in flow-style metadata", () => {
    const original =
      '---\n{ name: review, description: "Review code", }\n---\nBody';
    const updated = setSkillModelInvocationDisabled(original, true);
    expect(parseFrontmatter(updated).frontmatter).toEqual({
      name: "review",
      description: "Review code",
      "disable-model-invocation": true,
    });
  });

  it("adds an invocation flag to flow-style metadata without changing other entries", () => {
    const original =
      '---\n{ name: review, description: "Review code" } # keep\n---\nBody';
    const updated = setSkillModelInvocationDisabled(original, true);
    expect(updated).toBe(
      '---\n{ name: review, description: "Review code" , disable-model-invocation: true} # keep\n---\nBody',
    );
    expect(parseFrontmatter(updated).frontmatter).toEqual({
      name: "review",
      description: "Review code",
      "disable-model-invocation": true,
    });
  });

  it("reenables a disabled skill, preserving quoted keys, comments, CRLF and the body", () => {
    const original =
      "\uFEFF---\r\nname: review\r\n# Keep this comment\r\n'disable-model-invocation': true # manual only\r\ndescription: Review code\r\n---\r\n\r\ndisable-model-invocation: true\r\n";
    const updated = setSkillModelInvocationDisabled(original, false);

    expect(updated).toBe(
      "\uFEFF---\r\nname: review\r\n# Keep this comment\r\n'disable-model-invocation': false # manual only\r\ndescription: Review code\r\n---\r\n\r\ndisable-model-invocation: true\r\n",
    );
    expect(
      parseFrontmatter(updated).frontmatter["disable-model-invocation"],
    ).toBe(false);
  });
  it("disables automatic invocation without changing the skill's metadata or body", () => {
    const original =
      "---\nname: review\ndescription: Review code\nmetadata:\n  owner: team\n---\n\n# Review\nKeep this body.\n";
    const updated = setSkillModelInvocationDisabled(original, true);

    expect(updated).toBe(
      "---\nname: review\ndescription: Review code\nmetadata:\n  owner: team\ndisable-model-invocation: true\n---\n\n# Review\nKeep this body.\n",
    );
    expect(
      parseFrontmatter(updated).frontmatter["disable-model-invocation"],
    ).toBe(true);
  });
});
