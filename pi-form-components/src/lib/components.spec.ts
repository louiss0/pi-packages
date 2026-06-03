import { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Input, Key, matchesKey, Text, type TUI } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import { itemChoiceStyle, MultiSelect, Picker } from "./components";

vi.mock("@earendil-works/pi-tui", () => {
  const module =
    vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");

  return {
    ...module,
    matchesKey: (data: string, key: string) => data === key,
  };
});

const DOWN_ARROW = "\u001b[B";

function createTheme() {
  return new Theme(
    {
      accent: "#00ffff",
      borderAccent: "#00ffff",
      dim: "#888888",
      muted: "#888888",
      warning: "#ffaa00",
    } as ConstructorParameters<typeof Theme>[0],
    {} as ConstructorParameters<typeof Theme>[1],
    "truecolor",
  );
}

function createTui() {
  return {
    requestRender: vi.fn(),
  } as unknown as TUI & { requestRender: ReturnType<typeof vi.fn> };
}

function createItems(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `cmd-${String(index + 1).padStart(2, "0")}`,
  );
}

vi.mock("@earendil-works/pi-tui", async () => {
  const module =
    await vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");

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

  describe("MultiSelect", () => {
    it("renders the label and selected items", () => {
      const multiSelect = new MultiSelect(
        {
          title: "What fruits do you like?",
          items: [
            { value: "apple", label: "Apple" },
            { value: "banana", label: "Banana" },
            { value: "orange", label: "Orange" },
          ],
        },
        createTui(),
        createTheme(),
        vi.fn(),
      );

      const lines = multiSelect.render(45);
      expect(lines[0]).toContain("What fruits do you like?");
      expect(lines[1]).toContain("[ ] Apple");
      expect(lines[2]).toContain("[ ] Banana");
      expect(lines[3]).toContain("[ ] Orange");
    });

    it("renders the first selected item when the user presses space", () => {
      const multiSelect = new MultiSelect(
        {
          title: "What fruits do you like?",
          items: [
            { value: "apple", label: "Apple" },
            { value: "banana", label: "Banana" },
            { value: "orange", label: "Orange" },
          ],
        },
        createTui(),
        createTheme(),
        vi.fn(),
      );

      multiSelect.handleInput(Key.space);

      const lines = multiSelect.render(45).join("\n");
      expect(lines).toContain("What fruits do you like?");
      expect(lines).toContain("[x] Apple");
      expect(lines).toContain("[ ] Banana");
      expect(lines).toContain("[ ] Orange");
    });

    it("Changes focus when the user presses down once", () => {
      const multiSelect = new MultiSelect(
        {
          title: "What fruits do you like?",
          items: [
            { value: "apple", label: "Apple" },
            { value: "banana", label: "Banana" },
            { value: "orange", label: "Orange" },
          ],
        },
        createTui(),
        createTheme(),
        vi.fn(),
      );

      multiSelect.handleInput(Key.down);

      const lines = multiSelect.render(45).join("\n");
      expect(lines).toContain("What fruits do you like?");
      expect(lines).toContain("[ ] Apple");
      expect(lines).toContain("> [ ] Banana");
      expect(lines).toContain("[ ] Orange");
    });

    it("Changes focus when the user presses down twice then up once", () => {
      const multiSelect = new MultiSelect(
        {
          title: "What shows are you into?",
          items: [
            { value: "GoT", label: "Game of Thrones" },
            { value: "pokemon", label: "Pokemon" },
            { value: "orange-is-the-new-black", label: "Orange Is The New Black" },
          ],
        },
        createTui(),
        createTheme(),
        vi.fn(),
      );

      multiSelect.handleInput(Key.down);
      multiSelect.handleInput(Key.down);
      multiSelect.handleInput(Key.up);

      const lines = multiSelect.render(45).join("\n");
      expect(lines).toContain("What shows are you into");
      expect(lines).toContain("[ ] Game of Thrones");
      expect(lines).toContain("> [ ] Pokemon");
      expect(lines).toContain("[ ] Orange Is The New Black");
    });

    it("User can select multiple items", () => {
      const multiSelect = new MultiSelect(
        {
          title: "What ice cream do you like?",
          items: [
            { value: "strawberry", label: "Strawberry" },
            { value: "vanilla", label: "Vanilla" },
            { value: "caramel", label: "Caramel" },
            { value: "banana", label: "Banana" },
          ],
        },
        createTui(),
        createTheme(),
        vi.fn(),
      );

      multiSelect.handleInput(Key.space);
      multiSelect.handleInput(Key.space);
      multiSelect.handleInput(Key.down);
      multiSelect.handleInput(Key.space);

      const lines = multiSelect.render(45).join("\n");
      expect(lines).toContain("What ice cream do you like?");
      expect(lines).toContain("[x] Strawberry");
      expect(lines).toContain("[x] Vanilla");
      expect(lines).toContain("[ ] Caramel");
      expect(lines).toContain("[x] Banana");
    });

    describe("Rendering initial select values based on styles", () => {
      it.for(itemChoiceStyle)("For $s it renders the unselected value", (style) => {
        const multiSelect = new MultiSelect(
          {
            title: "Ice cream",
            items: [{ value: "strawberry", label: "Strawberry" }],
            itemChoiceStyle: style,
          },
          createTui(),
          createTheme(),
          vi.fn(),
        );

        const lines = multiSelect.render(45).join("\n");
        expect(lines).toContain(
          `${multiSelect.itemChoiceStyleRecord[style].unselected} Strawberry`,
        );
      });
    });
  });

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
      const form = new Form(
        {
          title,
          fields,
          footer: options.footer,
          parse,
          spacing: options.spacing,
        },
        tui,
        done,
      );

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

      expect(done).toHaveBeenCalledWith({
        "field-1": "a",
        "field-2": "b",
        "field-3": false,
      });
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

      expect(done).toHaveBeenCalledWith({
        "field-1": "a",
        "field-2": "b",
        "field-3": true,
      });
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
      const { form } = createForm("Title", [], {
        footer: "Footer line 1\nFooter line 2",
      });

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

describe("Picker", () => {
  const done = vi.fn();

  it("loads more items when selection reaches the bottom of the loaded window", () => {
    const tui = createTui();
    const picker = new Picker(
      {
        title: "Commands",
        items: createItems(20),
        itemLimit: 5,
        lazyLoadStep: 5,
      },
      createTheme(),
      tui,
      done,
    );

    expect(picker.render(120).join("\n")).toContain("5 loaded items");

    for (let index = 0; index < 4; index += 1) {
      picker.handleInput(DOWN_ARROW);
    }

    const output = picker.render(120).join("\n");

    expect(output).toContain("10 loaded items");
    expect(output).toContain("cmd-06");
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("filters across all items, not only the loaded window", () => {
    const picker = new Picker(
      {
        title: "Commands",
        items: createItems(20),
        itemLimit: 5,
        lazyLoadStep: 5,
      },
      createTheme(),
      createTui(),
      done,
    );

    for (const character of "cmd-12") {
      picker.handleInput(character);
    }

    const output = picker.render(120).join("\n");

    expect(output).toContain("Filter: cmd-12");
    expect(output).toContain("cmd-12");
    expect(output).not.toContain("No matching commands");
  });
});
