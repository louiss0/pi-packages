import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Form, LabelledInput, MultiSelect } from "./components";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;
const tui = { requestRender: vi.fn() } as unknown as TUI;
const items = ["read", "write", "edit"].map((value) => ({
  value,
  label: value,
}));

describe("embedded multiselect fields", () => {
  it("preselects existing values and ignores duplicates or absent items", () => {
    const field = new MultiSelect(
      "tools",
      { items, initialValues: ["read", "read", "missing", "edit"] },
      tui,
      theme,
      vi.fn(),
    );
    expect(field.value).toBe("read,edit");
    expect(field.render(80).join("\n")).toContain("[x] read");
  });
  it("does not discard selections on invalidation", () => {
    const field = new MultiSelect(
      "tools",
      { items, initialValues: ["read"] },
      tui,
      theme,
      vi.fn(),
    );
    field.handleInput("\x1b[B");
    field.handleInput(" ");
    field.invalidate();
    expect(field.value).toBe("read,write");
    field.handleInput(" ");
    expect(field.value).toBe("read");
  });
  it("keeps arrows inside a multiselect while Tab moves to the next form field", () => {
    const fieldDone = vi.fn();
    const done = vi.fn();
    const field = new MultiSelect(
      "tools",
      { items, initialValues: ["read"], itemLimit: 2 },
      tui,
      theme,
      fieldDone,
    );
    const form = new Form<{ tools: string; name: string }>(
      {
        title: "Agent",
        fields: [field, new LabelledInput("name", theme)],
        parse: () => undefined,
      },
      tui,
      done,
    );
    form.focused = true;
    form.handleInput("\x1b[B");
    form.handleInput(" ");
    form.handleInput("\t");
    form.handleInput("reviewer");
    form.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      tools: "read,write",
      name: "reviewer",
    });
    expect(fieldDone).not.toHaveBeenCalled();
  });
  it("still supports standalone confirmation and whole-form cancellation", () => {
    const done = vi.fn();
    const field = new MultiSelect(
      "tools",
      { items, initialValues: ["edit"] },
      tui,
      theme,
      done,
    );
    field.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith(["edit"]);
    const formDone = vi.fn();
    const form = new Form<{ tools: string }>(
      { title: "Agent", fields: [field], parse: () => undefined },
      tui,
      formDone,
    );
    form.handleInput("\x1b");
    expect(formDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});
