import { describe, expect, it, vi } from "vitest";
import type { FormTheme, PickerTheme } from "./components";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  ConfirmationBox,
  Form,
  LabelledInput,
  MultiSelect,
  Picker,
} from "./components";
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} satisfies FormTheme & PickerTheme;
const tui = { requestRender: vi.fn() } as unknown as TUI;
const items = ["read", "write", "edit"].map((value) => ({
  value,
  label: value,
}));

describe("reusable form control state", () => {
  it("replaces multiselect values safely without losing the highlighted item", () => {
    const field = new MultiSelect(
      "tools",
      { items, initialValues: ["read"] },
      tui,
      theme as Theme,
      vi.fn(),
    );
    field.handleInput("\x1b[B");
    field.setValues(["edit", "edit", "missing"]);
    expect(field.value).toBe("edit");
    field.setValues([]);
    field.handleInput(" ");
    expect(field.value).toBe("write");
  });
  it("preselects picker values beyond the first page and resets filtering", () => {
    const field = new Picker<string>(
      "thinking",
      {
        items: ["default", "low", "medium", "high"],
        itemLimit: 2,
        initialValue: "high",
      },
      theme,
      tui,
      vi.fn(),
    );
    expect(field.value).toBe("high");
    expect(field.render(80).join("\n")).toContain("high");
    field.handleInput("l");
    field.handleInput("o");
    expect(field.value).toBe("low");
    field.setValue("high");
    field.invalidate();
    expect(field.value).toBe("high");
    expect(() => field.setValue("missing")).toThrow("Unknown picker value");
    expect(field.value).toBe("high");
  });
  it("keeps picker navigation inside an embedded form and submits through the form callback", () => {
    const fieldDone = vi.fn();
    const done = vi.fn();
    const field = new Picker(
      "thinking",
      { items: ["default", "off", "high"], itemLimit: 3 },
      theme,
      tui,
      fieldDone,
    );
    const form = new Form<{ thinking: string; name: string }>(
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
    form.handleInput("\t");
    form.handleInput("reviewer");
    form.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      thinking: "off",
      name: "reviewer",
    });
    expect(fieldDone).not.toHaveBeenCalled();
  });
  it("positions existing input text for immediate editing and supports resets", () => {
    const field = new LabelledInput("name", theme, "original");
    field.handleInput("\x15");
    expect(field.value).toBe("");
    field.setValue("replacement");
    field.handleInput("!");
    expect(field.value).toBe("replacement!");
    field.setValue("");
    expect(field.value).toBe("");
  });
  it("sets checkbox state without inventing another checkbox control", () => {
    const field = new ConfirmationBox("enabled", theme, "Enabled");
    field.setValue(true);
    expect(field.value).toBe(true);
    expect(field.render(80).join("\n")).toContain("[x]");
    field.setValue(false);
    expect(field.value).toBe(false);
    expect(field.render(80).join("\n")).toContain("[ ]");
  });
  it("observes only user value changes, including captured keys, before validation", () => {
    const changed = vi.fn();
    const parse = vi.fn(() => undefined);
    const picker = new Picker(
      "thinking",
      { items: ["default", "off"], itemLimit: 2 },
      theme,
      tui,
      vi.fn(),
    );
    const checkbox = new ConfirmationBox("enabled", theme, "Enabled");
    const input = new LabelledInput("name", theme, "before");
    const tools = new MultiSelect(
      "tools",
      { items },
      tui,
      theme as Theme,
      vi.fn(),
    );
    const form = new Form<Record<string, string | boolean>>(
      {
        title: "Agent",
        fields: [picker, checkbox, input, tools],
        parse,
        onFieldChange: changed,
      },
      tui,
      vi.fn(),
    );
    for (const key of ["\x1b[B", "\t", " ", " "]) form.handleInput(key);
    checkbox.setValue(true);
    expect(changed).toHaveBeenCalledTimes(3);
    for (const key of ["\t", "\x15", "after", "\x1b[C", "\t", "\x1b[B", " "])
      form.handleInput(key);
    expect(changed.mock.calls).toEqual([
      ["thinking", "off"],
      ["enabled", true],
      ["enabled", false],
      ["name", ""],
      ["name", "after"],
      ["tools", "write"],
    ]);
    form.handleInput("\r");
    expect(changed.mock.invocationCallOrder.at(-1)).toBeLessThan(
      parse.mock.invocationCallOrder[0],
    );
  });
});
