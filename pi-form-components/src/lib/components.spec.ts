import { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Picker } from "./components";

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
