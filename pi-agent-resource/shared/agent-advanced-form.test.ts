import {
  ConfirmationBox,
  LabelledInput,
  Picker,
} from "@code-fixer-23/pi-form-components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { createAgentAdvancedForm } from "./agent-advanced-form";
import {
  AGENT_PROFILES,
  type AgentFrontmatter,
  type AgentRuntime,
} from "./agent-contracts";
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;
const tui = {
  requestRender: vi.fn(),
  terminal: { rows: 500, columns: 100 },
} as unknown as TUI;
const essentials: AgentFrontmatter = {
  name: "reviewer",
  description: "Review the code thoroughly and report any problems",
  tools: "read,grep",
  model: "claude",
};
function fixture(runtime: AgentRuntime, names: string[], initial = essentials) {
  const fields = names.map((name) => {
    const field = AGENT_PROFILES[runtime].fields.find(
      (field) => field.key === name,
    );
    if (!field) throw new Error(name);
    return field;
  });
  const done = vi.fn();
  return {
    form: createAgentAdvancedForm(
      tui,
      theme,
      runtime,
      "Test",
      fields,
      initial,
      done,
    ),
    done,
  };
}
function keys(form: Component, ...keys: string[]) {
  keys.forEach((key) => form.handleInput?.(key));
}
function focus(form: Component, name: string) {
  for (let count = 0; count < 150; count++) {
    if (
      form.render(100).some((line) => {
        const text = line.trim().replace(/^>\s+\[[ x]\]\s+/, "› ");
        const prefix = `› ${name}`;
        return (
          text === prefix ||
          text.startsWith(`${prefix}:`) ||
          text.startsWith(`${prefix} (`)
        );
      })
    )
      return;
    keys(form, "\t");
  }
  throw new Error(`No directly fillable field ${name}`);
}
function submit(form: Component & Focusable) {
  // Form submits with Enter on its final field. Walk forward until the footer
  // transition is reached; callers stop as soon as their callback fires.
  keys(form, "\r");
}

describe("directly fillable advanced section forms", () => {
  it("shows numeric, text and nested inputs immediately, without activation shortcuts", () => {
    const { form } = fixture("nico", [
      "timeoutMs",
      "machine",
      "memory",
      "toolBudget",
    ]);
    const output = form.render(100).join("\n");
    for (const name of [
      "timeoutMs",
      "machine",
      "memory.scope",
      "memory.path",
      "toolBudget.hard",
      "toolBudget.soft",
    ])
      expect(output).toContain(name);
    expect(output).not.toContain("Ctrl+Space");
    expect(output).not.toContain("Custom settings");
    expect(output).not.toContain("Alt+");
  });
  it("fills multiple fields using only typing, value selection and Tab", () => {
    const { form, done } = fixture("tintin", [
      "enabled",
      "thinking",
      "max_turns",
    ]);
    keys(form, " ", " ", "\t", "\x1b[B", "\t", "12", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      enabled: false,
      thinking: "off",
      max_turns: 12,
    });
  });
  it("uses the library ConfirmationBox for boolean fields", () => {
    const render = vi.spyOn(ConfirmationBox.prototype, "render");
    try {
      const { form, done } = fixture("tintin", ["enabled"]);
      expect(form.render(100).join("\n")).toContain("[ ] enabled");
      const checkbox = render.mock.contexts[0];
      expect(checkbox).toBeInstanceOf(ConfirmationBox);
      if (!(checkbox instanceof ConfirmationBox))
        throw new Error("Expected the library checkbox");
      expect(Object.hasOwn(checkbox, "handleInput")).toBe(false);
      keys(form, " ");
      expect(form.render(100).join("\n")).toContain("[x] enabled");
      keys(form, " ", "\r");
      expect(done).toHaveBeenCalledExactlyOnceWith({
        ...essentials,
        enabled: false,
      });
    } finally {
      render.mockRestore();
    }
  });
  it("reuses library inputs and pickers rather than rendering replacements", () => {
    const inputRender = vi.spyOn(LabelledInput.prototype, "render");
    const pickerRender = vi.spyOn(Picker.prototype, "render");
    try {
      const { form, done } = fixture("tintin", ["thinking", "max_turns"]);
      form.render(100);
      expect(pickerRender.mock.contexts[0]).toBeInstanceOf(Picker);
      expect(inputRender.mock.contexts[0]).toBeInstanceOf(LabelledInput);
      keys(form, "\x1b[B", "\t", "12", "\r");
      expect(done).toHaveBeenCalledExactlyOnceWith({
        ...essentials,
        thinking: "off",
        max_turns: 12,
      });
    } finally {
      inputRender.mockRestore();
      pickerRender.mockRestore();
    }
  });
  it("requires a real picker choice instead of treating an unmatched filter as omission", () => {
    const { form, done } = fixture("tintin", ["thinking"]);
    keys(form, "z", "z", "\r");
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain(
      "Select one of the available values",
    );
    keys(form, "\x15", "\x1b[B", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      thinking: "off",
    });
  });
  it("clears every nested control when restoring runtime defaults", () => {
    const initial = {
      ...essentials,
      acceptance: {
        level: "checked",
        evidence: ["commands-run"],
        reason: "Explain the decision",
      },
    };
    const { form, done } = fixture("nico", ["acceptance"], initial);
    keys(form, "\x1b[B", "\x1b[A");
    focus(form, "acceptance.reason");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith(essentials);
    expect(initial.acceptance.evidence).toEqual(["commands-run"]);
  });
  it("leaves untouched optional checkboxes omitted", () => {
    const { form, done } = fixture("tintin", ["enabled"]);
    keys(form, "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith(essentials);
  });
  it("leaves blank optional inputs omitted", () => {
    const { form, done } = fixture("tintin", ["session_dir", "max_turns"]);
    keys(form, "\t", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith(essentials);
  });
  it("preserves legacy explicit null, false, empty text and empty lists on a no-op", () => {
    const initial = {
      ...essentials,
      enabled: false,
      color: null,
      display_name: "",
      exclude_extensions: [],
    };
    const { form, done } = fixture(
      "tintin",
      ["enabled", "color", "display_name", "exclude_extensions"],
      initial,
    );
    focus(form, "exclude_extensions");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
  });
  it("removes an optional input when its existing text is cleared", () => {
    const { form, done } = fixture("tintin", ["session_dir"], {
      ...essentials,
      session_dir: "sessions",
    });
    keys(form, "\x15", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith(essentials);
  });
  it("fills list entries immediately and supports multiline cursor navigation", () => {
    const { form, done } = fixture("nico", ["defaultReads"]);
    focus(form, "defaultReads");
    keys(
      form,
      "README.md",
      "\x1b\r",
      "CONTEXT.md",
      "\x1b[A",
      "\x01",
      "prefix-",
      "\r",
    );
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      defaultReads: ["prefix-README.md", "CONTEXT.md"],
    });
  });
  it("offers meaningful inheritance values without requiring them before entering names", () => {
    const { form, done } = fixture("tintin", ["skills"]);
    focus(form, "skills");
    keys(form, "review", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      skills: ["review"],
    });
    const inherit = fixture("tintin", ["skills"]);
    keys(inherit.form, "\x1b[B", "\t", "\r");
    expect(inherit.done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      skills: true,
    });
  });
  it("preserves existing CSV list representations when nothing changed", () => {
    const initial = { ...essentials, skills: "review,diagnose" };
    const { form, done } = fixture("tintin", ["skills"], initial);
    focus(form, "skills");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
  });
  it("makes nested settings ordinary form fields navigable with Tab", () => {
    const { form, done } = fixture("nico", ["toolBudget"]);
    keys(form, "10", "\t", "5");
    focus(form, "toolBudget.block");
    keys(form, "write", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      toolBudget: { hard: 10, soft: 5, block: ["write"] },
    });
  });
  it("validates numbers and keeps the form open for corrections", () => {
    const { form, done } = fixture("tintin", ["max_turns"]);
    keys(form, "wrong", "\r");
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain("safe whole number");
    keys(form, "\x15", "-1", "\r");
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain("must be non-negative");
    keys(form, "\x15", "0", "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      max_turns: 0,
    });
  });
  it("validates cross-field limits before applying the section", () => {
    const { form, done } = fixture("nico", ["toolBudget"], {
      ...essentials,
      toolBudget: { hard: 10, soft: 20 },
    });
    focus(form, "toolBudget.block");
    submit(form);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain("soft: must be <=");
  });
  it("embeds enumerated-list checkboxes in the same form", () => {
    const { form, done } = fixture("nico", ["acceptance"], {
      ...essentials,
      acceptance: { level: "checked" },
    });
    focus(form, "acceptance.evidence");
    keys(form, " ", "\x1b[B", " ");
    expect(form.render(100).join("\n")).toContain("[x] tests-added");
    focus(form, "acceptance.reason");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      acceptance: {
        level: "checked",
        evidence: ["changed-files", "tests-added"],
      },
    });
  });
  it("fills structured collections as JSON in an already visible field", () => {
    const { form, done } = fixture("nico", ["acceptance"], {
      ...essentials,
      acceptance: { level: "checked" },
    });
    focus(form, "acceptance.verify");
    keys(form, '[{"id":"test","command":"pnpm test"}]');
    focus(form, "acceptance.reason");
    submit(form);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      acceptance: {
        level: "checked",
        verify: [{ id: "test", command: "pnpm test" }],
      },
    });
  });
  it("edits arbitrary mappings directly as JSON, without a type question", () => {
    const { form, done } = fixture("nico", ["permissions"]);
    keys(form, '{"write":"deny"}', "\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      permissions: { write: "deny" },
    });
  });
  it("rejects invalid JSON without throwing during rendering or value collection", () => {
    const { form, done } = fixture("nico", ["permissions"]);
    keys(form, "{bad", "\r");
    expect(done).not.toHaveBeenCalled();
    expect(form.render(100).join("\n")).toContain("Enter valid JSON");
  });
  it("cancels without changing the initial definition", () => {
    const initial = { ...essentials, enabled: false };
    const { form, done } = fixture("tintin", ["enabled"], initial);
    keys(form, " ", "\x1b");
    expect(done).toHaveBeenCalledExactlyOnceWith(null);
    expect(initial.enabled).toBe(false);
  });
  it("keeps focused fields visible in a small terminal", () => {
    const small = {
      requestRender: vi.fn(),
      terminal: { rows: 24, columns: 100 },
    } as unknown as TUI;
    const fields = AGENT_PROFILES.tintin.fields.filter(
      (field) => field.group === "Execution",
    );
    const form = createAgentAdvancedForm(
      small,
      theme,
      "tintin",
      "Execution",
      fields,
      essentials,
      vi.fn(),
    );
    focus(form, "isolated");
    expect(form.render(100).length).toBeLessThanOrEqual(19);
    expect(form.render(100).join("\n")).toContain("[ ] isolated");
  });
});
