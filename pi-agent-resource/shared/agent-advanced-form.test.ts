import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createAgentAdvancedForm } from "./agent-advanced-form";
import {
  AGENT_PROFILES,
  type AgentFieldDefinition,
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
const ENTER = "\r";
const TAB = "\t";
const SPACE = " ";
const NEXT_MODE = "\0";
const RESET = "\x12";
const NEST = "\x1b[1;3C";
const LEAVE = "\x1b[1;3D";
const NEXT_CHILD = "\x1b[1;3B";

function fixture(
  runtime: AgentRuntime,
  names: string[],
  initial: AgentFrontmatter = essentials,
) {
  const fields = names.map((name) => {
    const field = AGENT_PROFILES[runtime].fields.find(
      (candidate) => candidate.key === name,
    );
    if (!field) throw new Error(`Missing field: ${name}`);
    return field;
  });
  const done = vi.fn();
  const form = createAgentAdvancedForm(
    tui,
    theme,
    runtime,
    "Test section",
    fields,
    initial,
    done,
  );
  return { form, done };
}
function keys(form: ReturnType<typeof fixture>["form"], ...inputs: string[]) {
  inputs.forEach((input) => form.handleInput?.(input));
}

describe("advanced agent section forms", () => {
  it("renders every section for both runtimes without asking for storage types", () => {
    for (const runtime of ["tintin", "nico"] as const) {
      const groups = new Set(
        AGENT_PROFILES[runtime].fields.map((field) => field.group),
      );
      for (const group of groups) {
        const definitions = AGENT_PROFILES[runtime].fields.filter(
          (field) =>
            field.group === group &&
            !["name", "description", "tools", "model"].includes(field.key),
        );
        const form = createAgentAdvancedForm(
          tui,
          theme,
          runtime,
          group,
          definitions,
          essentials,
          vi.fn(),
        );
        const output = form.render(80).join("\n");
        expect(output).toContain(`Advanced settings — ${group}`);
        definitions.forEach((field) =>
          expect(output).toContain(`${field.key}: Use runtime default`),
        );
        expect(output).not.toContain("Current:");
        expect(() => form.render(24)).not.toThrow();
      }
    }
  });

  it("edits booleans, choices and integer inputs together, with no type dialog", () => {
    const { form, done } = fixture("tintin", [
      "enabled",
      "thinking",
      "max_turns",
    ]);
    keys(form, SPACE, SPACE, TAB, SPACE, TAB, "12", ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      enabled: false,
      thinking: "off",
      max_turns: 12,
    });
  });

  it("preserves omitted fields, explicit null, false, empty text and empty lists", () => {
    const initial = {
      ...essentials,
      enabled: false,
      color: null,
      display_name: "",
      exclude_extensions: [],
    };
    const { form, done } = fixture(
      "tintin",
      ["enabled", "color", "display_name", "exclude_extensions", "max_turns"],
      initial,
    );
    keys(form, ENTER, ENTER, ENTER, ENTER, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
    expect(initial).toEqual({
      ...essentials,
      enabled: false,
      color: null,
      display_name: "",
      exclude_extensions: [],
    });
  });

  it("can reset an existing optional field without deleting other settings", () => {
    const initial = { ...essentials, enabled: false, max_turns: 5 };
    const { form, done } = fixture("tintin", ["enabled"], initial);
    keys(form, RESET, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      max_turns: 5,
    });
    expect(initial.enabled).toBe(false);
  });

  it("offers inheritance behavior and saves an intentional empty selection", () => {
    const inherit = fixture("tintin", ["skills"]);
    keys(inherit.form, NEXT_MODE, NEXT_MODE, ENTER);
    expect(inherit.done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      skills: true,
    });
    const empty = fixture("tintin", ["skills"]);
    keys(empty.form, NEXT_MODE, ENTER);
    expect(empty.done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      skills: [],
    });
  });

  it("uses Nico's supported empty-text representation for an intentional empty selection", () => {
    const { form, done } = fixture("nico", ["defaultReads"]);
    keys(form, NEXT_MODE, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      defaultReads: "",
    });
  });

  it("edits string lists one entry per line instead of selecting list/string types", () => {
    const { form, done } = fixture("nico", ["defaultReads"]);
    keys(form, "README.md", "\x1b\r", "CONTEXT.md", ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      defaultReads: ["README.md", "CONTEXT.md"],
    });
  });

  it("moves the multiline cursor with arrows without switching to another form field", () => {
    const { form, done } = fixture("nico", ["defaultReads"]);
    keys(
      form,
      "README.md",
      "\x1b\r",
      "CONTEXT.md",
      "\x1b[A",
      "\x01",
      "prefix-",
      ENTER,
    );
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      defaultReads: ["prefix-README.md", "CONTEXT.md"],
    });
  });

  it("preserves existing list storage on an unchanged save", () => {
    const initial = { ...essentials, skills: "review,diagnose" };
    const { form, done } = fixture("tintin", ["skills"], initial);
    keys(form, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
  });

  it("embeds nested settings in the form and validates their requirements", () => {
    const { form, done } = fixture("nico", ["toolBudget"]);
    keys(form, NEXT_MODE, NEST, "10", NEXT_CHILD, "5", LEAVE, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      toolBudget: { hard: 10, soft: 5 },
    });
  });

  it("allows specific blocked tools instead of restricting a list to its scalar wildcard shorthand", () => {
    const initial = { ...essentials, toolBudget: { hard: 10, block: "*" } };
    const { form, done } = fixture("nico", ["toolBudget"], initial);
    keys(
      form,
      NEST,
      NEXT_CHILD,
      NEXT_CHILD,
      NEXT_MODE,
      "\x15",
      "write",
      LEAVE,
      ENTER,
    );
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      toolBudget: { hard: 10, block: ["write"] },
    });
  });

  it("keeps the form open for invalid numbers and revalidates corrections", () => {
    const { form, done } = fixture("tintin", ["max_turns"]);
    keys(form, "not a number", ENTER);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(80).join("\n")).toContain("Enter a safe whole number");
    keys(form, "\x15", "-1", ENTER);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(80).join("\n")).toContain("must be non-negative");
    keys(form, "\x15", "0", ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      max_turns: 0,
    });
  });

  it("validates cross-field rules before applying a section", () => {
    const { form, done } = fixture("nico", ["toolBudget"], {
      ...essentials,
      toolBudget: { hard: 10, soft: 20 },
    });
    keys(form, ENTER);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(80).join("\n")).toContain(
      "soft: must be <= toolBudget.hard",
    );
  });

  it("edits arbitrary structured settings without a type-selection question", () => {
    const initial = {
      ...essentials,
      outputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
      },
    };
    const { form, done } = fixture("nico", ["outputSchema"], initial);
    keys(form, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
    expect(form.render(80).join("\n")).toContain("Structured settings (JSON)");
  });

  it("rejects invalid JSON without throwing from rendering or Form value collection", () => {
    const { form, done } = fixture("nico", ["permissions"]);
    keys(form, NEXT_MODE, "\x15", "{bad", ENTER);
    expect(done).not.toHaveBeenCalled();
    expect(form.render(80).join("\n")).toContain("Enter valid JSON");
  });

  it("cancels the whole section without mutating the initial frontmatter", () => {
    const initial = { ...essentials, enabled: true };
    const { form, done } = fixture("tintin", ["enabled"], initial);
    keys(form, NEXT_MODE, "\x1b");
    expect(done).toHaveBeenCalledExactlyOnceWith(null);
    expect(initial.enabled).toBe(true);
  });

  it("keeps the active control visible when the section exceeds the terminal height", () => {
    const smallTui = {
      requestRender: vi.fn(),
      terminal: { rows: 24, columns: 80 },
    } as unknown as TUI;
    const fields = AGENT_PROFILES.tintin.fields.filter(
      (field) => field.group === "Execution",
    );
    const form = createAgentAdvancedForm(
      smallTui,
      theme,
      "tintin",
      "Execution",
      fields,
      essentials,
      vi.fn(),
    );
    expect(form.render(80).length).toBeLessThanOrEqual(19);
    expect(form.render(80).join("\n")).toContain("› max_turns");
    fields.slice(1).forEach(() => keys(form, TAB));
    const output = form.render(80);
    expect(output.length).toBeLessThanOrEqual(19);
    expect(output.join("\n")).toContain("› isolated");
    expect(output.join("\n")).toContain("Enter next/apply");
    keys(form, TAB);
    expect(form.render(80).join("\n")).toContain("› max_turns");
  });

  it("keeps validation feedback visible when the invalid field is offscreen", () => {
    const smallTui = {
      requestRender: vi.fn(),
      terminal: { rows: 24, columns: 80 },
    } as unknown as TUI;
    const fields = AGENT_PROFILES.tintin.fields.filter(
      (field) => field.group === "Execution",
    );
    const done = vi.fn();
    const form = createAgentAdvancedForm(
      smallTui,
      theme,
      "tintin",
      "Execution",
      fields,
      { ...essentials, max_turns: -1 },
      done,
    );
    fields.forEach(() => keys(form, ENTER));
    expect(done).not.toHaveBeenCalled();
    expect(form.render(80).join("\n")).toContain("must be non-negative");
    expect(form.render(80).length).toBeLessThanOrEqual(19);
  });

  it("preserves nested false values and structured collection entries on a no-op", () => {
    const initial: AgentFrontmatter = {
      ...essentials,
      acceptance: {
        level: "checked",
        preserveStagedIndex: true,
        criteria: [
          { id: "tests", must: "Pass tests", evidence: ["commands-run"] },
        ],
        review: { agent: "reviewer", required: false },
      },
    };
    const { form, done } = fixture("nico", ["acceptance"], initial);
    keys(form, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith(initial);
    expect(form.render(80).join("\n")).toContain("criteria: Specific entries");
  });

  it("uses checkbox selections for enumerated list entries", () => {
    const definition: AgentFieldDefinition = {
      key: "skills",
      group: "Context",
      description: "Choose skills",
      kinds: ["list"],
      choices: ["review", "diagnose"],
    };
    const done = vi.fn();
    const form = createAgentAdvancedForm(
      tui,
      theme,
      "tintin",
      "Context",
      [definition],
      essentials,
      done,
    );
    keys(form, NEXT_MODE, SPACE, "\x1b[C", SPACE, ENTER);
    expect(done).toHaveBeenCalledExactlyOnceWith({
      ...essentials,
      skills: ["review", "diagnose"],
    });
    expect(form.render(80).join("\n")).toContain("[x] diagnose");
  });
});
