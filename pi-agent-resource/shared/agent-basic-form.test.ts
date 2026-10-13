import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { createAgentBasicForm } from "./agent-basic-form";
import type { AgentFrontmatter, AgentRuntime } from "./agent-contracts";
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;
const tui = {
  requestRender: vi.fn(),
  terminal: { rows: 100, columns: 100 },
} as unknown as TUI;
const essentials: AgentFrontmatter = {
  name: "reviewer",
  description: "Review the code thoroughly and report any problems",
  tools: "read,write,edit",
  model: "claude",
};
function fixture(
  initial = essentials,
  runtime: AgentRuntime = "tintin",
  mode: "create" | "edit" = "create",
  available: readonly string[] = ["read", "write", "edit"],
) {
  const done = vi.fn();
  return {
    form: createAgentBasicForm(
      tui,
      theme,
      runtime,
      initial,
      available,
      mode,
      done,
    ),
    done,
  };
}
function keys(form: Component, ...data: string[]) {
  data.forEach((key) => form.handleInput?.(key));
}
function submit(form: Component) {
  for (let index = 0; index < 4; index++) keys(form, "\t");
  keys(form, "\r");
}

describe("subagent metadata form", () => {
  it("shows metadata and tool checkboxes together, with default tools checked", () => {
    const { form } = fixture();
    const output = form.render(100).join("\n");
    for (const field of [
      "name",
      "description",
      "model",
      "tools",
      "Include advanced settings",
    ])
      expect(output).toContain(field);
    expect(output.toLowerCase()).not.toContain("filename");
    for (const tool of ["read", "write", "edit"])
      expect(output).toContain(`[x] ${tool}`);
  });
  it("accepts directly typed fields without asking for the name or filename separately", () => {
    const { form, done } = fixture({ tools: "read,write,edit" });
    keys(
      form,
      "reviewer",
      "\t",
      String(essentials.description),
      "\t",
      "claude",
      "\t",
      "\t",
      "\r",
    );
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: essentials,
      filename: "reviewer",
      advanced: false,
    });
  });
  it("derives the filename from the agent name", () => {
    const initial = { ...essentials, name: "code-reviewer" };
    const { form, done } = fixture(initial);
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: initial,
      filename: "code-reviewer",
      advanced: false,
    });
  });
  it("opens optional advanced settings only when the checkbox is selected", () => {
    const { form, done } = fixture();
    keys(form, "\t", "\t", "\t", "\t", " ", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: essentials,
      filename: "reviewer",
      advanced: true,
    });
  });
  it("keeps validation errors in the form until the essentials are corrected", () => {
    const { form, done } = fixture({ tools: "read,write,edit" });
    submit(form);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain("Name is required");
    keys(
      form,
      "\t",
      "reviewer",
      "\t",
      String(essentials.description),
      "\t",
      "claude",
      "\t",
      "\t",
      "\r",
    );
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: essentials,
      filename: "reviewer",
      advanced: false,
    });
  });
  it.each([
    "../escape",
    "nul",
  ])("rejects an unsafe name-derived filename: %s", (name) => {
    const { form, done } = fixture({ ...essentials, name });
    submit(form);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain(
      "Name must be safe for a filename",
    );
  });
  it("lets tool arrows navigate the embedded multiselect instead of changing fields", () => {
    const { form, done } = fixture();
    keys(form, "\t", "\t", "\t", "\x1b[B", " ", "\t", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: { ...essentials, tools: "read,edit" },
      filename: "reviewer",
      advanced: false,
    });
  });
  it.each([
    "tintin",
    "nico",
  ] as const)("formats newly selected extension tools for %s", (runtime) => {
    const { form, done } = fixture(essentials, runtime, "create", [
      "read",
      "write",
      "edit",
      "plain-extension",
      "my_extension/tool",
      "ext:already/tool",
    ]);
    keys(
      form,
      "\t",
      "\t",
      "\t",
      "\x1b[B",
      "\x1b[B",
      "\x1b[B",
      " ",
      "\x1b[B",
      " ",
      "\x1b[B",
      " ",
      "\t",
      "\r",
    );
    const extra =
      runtime === "tintin"
        ? "ext:plain-extension,ext:my_extension/tool,ext:already/tool"
        : "plain-extension,my_extension/tool,ext:already/tool";
    expect(done.mock.calls[0][0].frontmatter.tools).toBe(
      `read,write,edit,${extra}`,
    );
  });
  it("preserves existing unknown runtime selectors and legacy definitions on a no-op", () => {
    const initial = {
      name: "MixedCase",
      description: "Brief",
      tools: "read,ext:absent/tool",
    };
    const { form, done } = fixture(initial, "tintin", "edit");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      frontmatter: initial,
      filename: undefined,
      advanced: false,
    });
  });
  it("cancels the form without mutating existing metadata", () => {
    const initial = { ...essentials };
    const { form, done } = fixture(initial);
    keys(form, "changed", "\x1b");
    expect(done).toHaveBeenCalledExactlyOnceWith(null);
    expect(initial).toEqual(essentials);
  });
});
