import { Theme } from "@mariozechner/pi-coding-agent";
import { Container, Input, Key, matchesKey, Text, type TUI } from "@mariozechner/pi-tui";

vi.mock("@mariozechner/pi-tui", async () => {
  const module =
    await vi.importActual<typeof import("@mariozechner/pi-tui")>("@mariozechner/pi-tui");

  return {
    ...module,
    matchesKey: (data: string, key: string) => data === key,
  };
});

import { ConfirmationBox, Form, type FormField, LabelledInput, Parse } from "./components";

describe("shared/components", () => {
  function createTheme() {
    const theme = new Theme(
      {
        error: "#ff0000",
        accent: "#00ffff",
        dim: "#888888",
      } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
    return theme;
  }

  function createTui() {
    return {
      requestRender: vi.fn(),
    } as unknown as TUI;
  }

  describe("LabelledInput", () => {
    it("renders the label, typed value, and error messages", () => {
      const input = new LabelledInput("name", createTheme());

      input.setLabelTextPrefix("› ");
      input.setFocused(true);
      input.handleInput("t");
      input.handleInput("e");
      input.handleInput("s");
      input.handleInput("t");
      input.setError("Name is required", "Must be lowercase");

      const lines = input.render(45).join("\n");

      expect(lines).toContain("› name");
      expect(lines).toContain("test");
      expect(lines).toContain("Name is required");
      expect(lines).toContain("Must be lowercase");
    });

    it("clears error messages", () => {
      const input = new LabelledInput("description", createTheme());

      input.setError("Description is required");
      input.clearError();

      expect(input.render(45).join("\n")).not.toContain("Description is required");
    });
  });

  describe("ConfirmationBox", () => {
    it("renders unchecked by default", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");
      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(`  ${theme.getFgAnsi("accent")} [ ]`);
      expect(lines).toContain(" Do you want to fill in the next fields?");
    });

    it("accepts the display message as the second parameter", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Use advanced options?");
      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(" Use advanced options?");
      expect(lines).not.toContain(" Do you want to fill in the next fields?");
    });

    it("renders the focused prefix when focused", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");

      checkbox.setFocused(true);

      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(`> ${theme.getFgAnsi("accent")} [ ]`);
      expect(lines).toContain(" Do you want to fill in the next fields?");
    });

    it("toggles to confirmed when space is pressed", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");

      checkbox.setFocused(true);
      checkbox.handleInput(Key.space);

      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(`> ${theme.getFgAnsi("accent")} [x]`);
      expect(lines).toContain(" Do you want to fill in the next fields?");
    });

    it("toggles back to unchecked when space is pressed twice", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");

      checkbox.handleInput(Key.space);
      checkbox.handleInput(Key.space);

      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(`  ${theme.getFgAnsi("accent")} [ ]`);
      expect(lines).toContain(" Do you want to fill in the next fields?");
    });

    it("confirms the box without toggling it back off", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");

      checkbox.confirm();
      checkbox.confirm();

      const lines = checkbox.render(80).join("\n");

      expect(lines).toContain(`  ${theme.getFgAnsi("accent")} [x]`);
      expect(lines).toContain(" Do you want to fill in the next fields?");
    });

    it("the checkbox is colored", () => {
      const theme = createTheme();
      const checkbox = new ConfirmationBox(theme, "Do you want to fill in the next fields?");
      const lines = checkbox.render(45).join("\n");

      expect(lines).toContain(`${theme.getFgAnsi("accent")} [ ]`);
      expect(lines).not.toContain(
        `${theme.getFgAnsi("accent")} [ ] Do you want to fill in the next fields?`,
      );
    });
  });

  describe("Form", () => {
    class TestField extends Container implements FormField {
      inputs: string[] = [];
      focusedStates: boolean[] = [];
      focused = false;
      #name: string;
      #errorText = new Text("");
      constructor(name: string) {
        super();
        this.#name = name;

        this.addChild(new Text(this.#name));
        this.addChild(new Input());
        this.addChild(this.#errorText);
      }

      setError(error: string) {
        this.#errorText.setText(error);
      }

      clearError() {
        this.#errorText.setText("");
      }

      get name() {
        return this.#name;
      }

      get value() {
        return this.inputs.join();
      }

      setFocused(focused: boolean) {
        this.focused = focused;
        this.focusedStates.push(focused);
      }

      handleInput(data: string) {
        this.inputs.push(data);
      }
    }

    class TestConfirmationBox extends Container implements FormField {
      #value = false;
      focusedStates: boolean[] = [];
      focused = false;
      #name: string;
      #errorText = new Text("");
      constructor(name: string, message: string) {
        super();
        this.#name = name;

        this.addChild(new Text(this.#name));
        this.addChild(new Text(`[] ${message}`));
        this.addChild(this.#errorText);
      }

      get name() {
        return this.#name;
      }

      get value() {
        return this.#value;
      }

      setFocused(focused: boolean) {
        this.focused = focused;
        this.focusedStates.push(focused);
      }

      handleInput(data: string) {
        if (matchesKey(data, Key.space)) {
          this.#value = !this.#value;
        }
      }

      setError(error: string) {
        this.#errorText.setText(error);
      }

      clearError() {
        this.#errorText.setText("");
      }
    }

    function createForm(
      title: string,
      fields: FormField[],
      options: {
        parse?: Parse<Record<string, string | number | boolean>>;
        footer?: string;
        spacing?: number;
      } = {
        parse: () => undefined,
        footer: undefined,
      },
    ) {
      const tui = createTui();
      const done = vi.fn();
      const parse = vi.fn(options.parse);
      const form = new Form(tui, done, {
        title,
        fields,
        footer: options.footer,
        parse,
        spacing: options.spacing,
      });

      form.focused = true;

      return { form, tui, done, parse };
    }

    it("renders the form with errors when submitted with invalid input", () => {
      const errorFields = { "field-1": "Name is required" };
      const { form, done, parse } = createForm("Title", [new TestField("field-1")], {
        parse: () => errorFields,
      });

      form.handleInput(Key.enter);

      expect(parse).toHaveBeenCalledWith({ "field-1": "" });
      expect(done).not.toHaveBeenCalled();

      const lines = form.render(45).join("\n");
      for (const value of Object.values(errorFields)) {
        expect(lines.includes(value)).toBeTruthy();
      }
    });

    it("submits a object with the correct values based on names ", () => {
      const { form, done } = createForm("Title", [
        new TestField("field-1"),
        new TestField("field-2"),
      ]);

      form.handleInput("a");
      form.handleInput(Key.enter);
      form.handleInput("b");
      form.handleInput(Key.enter);

      expect(done).toHaveBeenCalledWith({ "field-1": "a", "field-2": "b" });
    });

    it("submits a object with the correct values based on names with booleans", () => {
      const { form, done } = createForm("Title", [
        new TestField("field-1"),
        new TestField("field-2"),
        new TestConfirmationBox("field-3", "Confirm"),
      ]);

      form.handleInput("a");
      form.handleInput(Key.enter);
      form.handleInput("b");
      form.handleInput(Key.enter);
      form.handleInput(Key.enter);

      expect(done).toHaveBeenCalledWith({ "field-1": "a", "field-2": "b", "field-3": false });
    });

    it("submits a object with the correct values based on names with that have changed", () => {
      const { form, done } = createForm("Title", [
        new TestField("field-1"),
        new TestField("field-2"),
        new TestConfirmationBox("field-3", "Confirm"),
      ]);

      form.handleInput("a");
      form.handleInput(Key.enter);
      form.handleInput("b");
      form.handleInput(Key.enter);
      form.handleInput(Key.space);
      form.handleInput(Key.enter);

      expect(done).toHaveBeenCalledWith({ "field-1": "a", "field-2": "b", "field-3": true });
    });

    it("revalidates field errors while editing after an invalid submit", () => {
      const firstField = new TestField("field-1");
      const secondField = new TestField("field-2");
      const { form } = createForm("Title", [firstField, secondField], {
        parse: (values) => {
          const errors: Record<string, string> = {};

          if (values["field-1"] === "") {
            errors["field-1"] = "Field 1 is required";
          }

          if (values["field-2"] === "") {
            errors["field-2"] = "Field 2 is required";
          }

          return Object.keys(errors).length > 0 ? errors : undefined;
        },
      });

      form.handleInput(Key.enter);
      form.handleInput(Key.enter);

      expect(form.render(45).join("\n")).toContain("Field 1 is required");
      expect(form.render(45).join("\n")).toContain("Field 2 is required");

      form.handleInput(Key.up);
      form.handleInput("a");

      const lines = form.render(45).join("\n");
      expect(lines).not.toContain("Field 1 is required");
      expect(lines).toContain("Field 2 is required");
    });

    it("renders the title centered", () => {
      const { form } = createForm("Title", []);

      const lines = form.render(45);
      const firstLine = lines[0];

      expect(firstLine).toContain("Title");

      const centeredTextRegex = /\s+\S+\s+/;
      expect(firstLine).toMatch(centeredTextRegex);
    });

    it("renders the footer", () => {
      const { form } = createForm("Title", [], { footer: "Footer" });

      const lines = form.render(45);

      expect(lines.at(-1)).toContain("Footer");
    });

    it("renders multiline footers as separate lines", () => {
      const { form } = createForm("Title", [], { footer: "Footer line 1\nFooter line 2" });

      const lines = form.render(45);

      expect(lines).toContain("Footer line 1");
      expect(lines).toContain("Footer line 2");
      expect(lines.some((line) => line.includes("\n"))).toBe(false);
    });

    it("renders the title and footer once", () => {
      const { form } = createForm("Title", [], { footer: "Footer" });

      const lines = form.render(45);

      expect(lines.filter((line) => line.includes("Title"))).toHaveLength(1);
      expect(lines.filter((line) => line.includes("Footer"))).toHaveLength(1);
    });

    it("renders the default spacing between all children", () => {
      const { form } = createForm("Title", [
        new TestField("field-1"),
        new TestField("field-2"),
      ]);

      const lines = form.render(45);
      const emptyLineCount = lines.filter((line) => line === "").length;

      expect(emptyLineCount).toBe(4);
    });

    it("renders custom spacing between all children", () => {
      const { form } = createForm(
        "Title",
        [new TestField("field-1"), new TestField("field-2")],
        { footer: "Footer", spacing: 1 },
      );

      const lines = form.render(45);
      const emptyLineCount = lines.filter((line) => line === "").length;

      expect(emptyLineCount).toBe(3);
    });

    it("focuses the first field when the form becomes focused", () => {
      const firstField = new TestField("");
      createForm("Title", [firstField]);

      expect(firstField.focused).toBe(true);
    });

    it("delegates regular input to the active field", () => {
      const firstField = new TestField("");
      const secondField = new TestField("");
      const { form } = createForm("Title", [firstField, secondField]);

      form.handleInput("a");

      expect(firstField.inputs).toEqual(["a"]);
      expect(secondField.inputs).toEqual([]);
    });

    it("moves focus forward on enter and tab", () => {
      const firstField = new TestField("");
      const secondField = new TestField("");

      const { form, tui } = createForm("Title", [firstField, secondField]);

      form.handleInput(Key.enter);

      expect(firstField.focused).toBe(false);
      expect(secondField.focused).toBe(true);

      form.handleInput(Key.tab);

      expect(firstField.focused).toBe(true);
      expect(secondField.focused).toBe(false);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("moves focus backward on shift tab and up", () => {
      const firstField = new TestField("");
      const secondField = new TestField("");

      const { form } = createForm("Title", [firstField, secondField]);

      form.handleInput(Key.tab);
      form.handleInput(Key.shift("tab"));
      expect(firstField.focused).toBe(true);
      expect(secondField.focused).toBe(false);

      form.handleInput(Key.down);
      form.handleInput(Key.up);
      expect(firstField.focused).toBe(true);
      expect(secondField.focused).toBe(false);
    });

    it("submits when enter is pressed on the last field", () => {
      const { form, done } = createForm("Title", [new TestField("")]);

      form.handleInput(Key.tab);
      form.handleInput(Key.enter);

      expect(done).toHaveBeenCalledTimes(1);

      expect(done).not.toHaveBeenCalledWith(null);
    });

    it("cancels on escape", () => {
      const { form, done } = createForm("Title", [new TestField("")]);

      form.handleInput(Key.escape);

      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(null);
    });
  });
});
